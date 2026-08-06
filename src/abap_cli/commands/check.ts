import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { resolveFile } from '../formats/file-resolver.js';
import { listAbapFiles, readAbapFile } from '../formats/abap-source.js';
import { CliError, printError, printResult, jsonFromCommand } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';
import { resolveObject, getObjectParts, validateLocalFile } from '../core/resolve.js';
import { runAtcCheck } from '../flows/atc.js';
import type { AtcWorkList } from 'abap-adt-api';
import type { CheckIssue } from '../output/issues.js';

type CheckMode = 'syntax' | 'content' | 'atc';

interface CheckOptions {
  syntax?: boolean;
  content?: boolean;
  atc?: boolean;
  variant?: string;
  all?: boolean;
  changed?: boolean;
  strict?: boolean;
  /** ATC raw worklist output file (`--atc` only). Empty string = default path. */
  out?: string;
}

export function registerCheckCommand(program: Command): void {
  program
    .command('check')
    .description('Validate local ABAP files: --syntax (default, against SAP), --content (local), --atc (against SAP)')
    .addHelpText('after', commonErrorsAfter())
    .argument('[files...]', 'Files to check')
    .option('--syntax', 'Syntax check against SAP (default mode)')
    .option('--content', 'Local-only validation, no SAP round-trip')
    .option('--atc', 'ATC check against SAP')
    .option('--variant <variant>', 'ATC check variant (only with --atc)')
    .option('--all', 'Check all .abap files under the current directory')
    .option('--changed', 'Check only files changed since the SAP version')
    .option('--strict', 'Treat warnings as failures')
    .option('--out [file]', 'Persist raw ATC worklist to a file (only with --atc); defaults to .abap/atc/<variant>-<timestamp>.json')
    .action(async (files: string[], opts: CheckOptions, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        await runCheck(files, opts, json);
      } catch (error: unknown) {
        printError(json, error);
      }
    });
}

async function runCheck(files: string[], opts: CheckOptions, json: boolean): Promise<void> {
  const mode = resolveMode(opts);
  if (mode === 'atc' && !opts.variant) {
    throw new CliError('INVALID_ARGUMENT', '--atc requires --variant', {
      nextSteps: ['Pass an ATC variant: abap check <file> --atc --variant Z_VARIANT'],
      example: 'abap check src/zcl_ok.clas.abap --atc --variant Z_ATC_VAR',
    });
  }
  if (mode !== 'atc' && opts.out !== undefined) {
    throw new CliError('INVALID_ARGUMENT', '--out only applies to --atc', {
      nextSteps: ['Use --out with --atc: abap check <file> --atc --variant Z_VARIANT --out'],
      example: 'abap check src/zcl_ok.clas.abap --atc --variant Z_ATC_VAR --out',
    });
  }

  const fileList = await collectFiles(files, opts);
  if (fileList.length === 0) {
    throw new CliError('USAGE', 'No files to check', {
      nextSteps: ['Provide file paths, or use --all for every .abap file.'],
      example: 'abap check src/zcl_demo.clas.abap',
    });
  }

  // --content is local-only: no SAP client is created (zero SAP calls).
  const client = mode === 'content' ? null : await AdtClientWrapper.create();

  const issues: CheckIssue[] = [];
  const worklists: { file: string; worklist: AtcWorkList }[] = [];
  for (const file of fileList) {
    const result = await checkFile(client, file, mode, opts);
    issues.push(...result.issues);
    if (result.worklist) worklists.push(result.worklist);
  }

  if (mode === 'atc' && opts.out !== undefined) {
    await persistWorklists(opts, worklists);
  }

  const failed = issues.some((i) => i.severity === 'error' || (opts.strict && i.severity === 'warning'));
  if (failed) {
    const code = mode === 'syntax' ? 'SYNTAX_ERROR' : 'VALIDATION_ERROR';
    throw new CliError(code, `${issues.length} issue(s) found across ${fileList.length} file(s)`, {
      details: { issues, files: fileList.length, ...(opts.out !== undefined ? { out: outPath(opts) } : {}) },
    });
  }
  printResult(json, { issues, failure: false, ...(opts.out !== undefined ? { out: outPath(opts) } : {}) }, humanSummary(issues));
}

/** Persist raw ATC worklists to the requested file (or the default path). */
async function persistWorklists(opts: CheckOptions, worklists: { file: string; worklist: AtcWorkList }[]): Promise<void> {
  const file = outPath(opts);
  const payload = {
    variant: opts.variant,
    timestamp: new Date().toISOString(),
    files: worklists.map((w) => ({ file: w.file, worklist: w.worklist })),
  };
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  } catch (error: unknown) {
    throw new CliError('FILE_PARSE_ERROR', `Cannot write ATC output to ${file}: ${message(error)}`, {
      file,
      nextSteps: ['Pick a writable path: abap check <file> --atc --variant Z_VARIANT --out /tmp/atc.json'],
      example: 'abap check src/zcl_ok.clas.abap --atc --variant Z_ATC_VAR --out /tmp/atc.json',
    });
  }
}

/** Resolve the output file: explicit path, or .abap/atc/<variant>-<timestamp>.json. */
function outPath(opts: CheckOptions): string {
  // commander resolves `--out` without a value to `true`.
  if (typeof opts.out === 'string' && opts.out.trim() !== '') return path.resolve(opts.out);
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
  return path.resolve('.abap', 'atc', `${opts.variant}-${ts}.json`);
}

/** Result of checking one file: issues, plus the raw worklist for --atc. */
interface CheckFileResult {
  issues: CheckIssue[];
  /** Raw worklist entry for --out persistence (atc mode only). */
  worklist?: { file: string; worklist: AtcWorkList };
}

/** Resolve the single active mode flag; defaults to --syntax (FR-006). */
function resolveMode(opts: CheckOptions): CheckMode {
  const active = (['syntax', 'content', 'atc'] as const).filter((m) => opts[m]);
  if (active.length > 1) {
    throw new CliError('INVALID_ARGUMENT', `Check modes are mutually exclusive: ${active.join(', ')}`, {
      nextSteps: ['Pick exactly one mode: --syntax (default), --content, or --atc.'],
      example: 'abap check src/zcl_demo.clas.abap --atc --variant Z_ATC_VAR',
    });
  }
  return active[0] ?? 'syntax';
}

/** Resolve the file set from explicit files, --all, or --changed (FR-007). */
async function collectFiles(files: string[], opts: CheckOptions): Promise<string[]> {
  const scopeCount = Number(Boolean(opts.all)) + Number(Boolean(opts.changed)) + Number(files.length > 0);
  if (scopeCount > 1) {
    throw new CliError('INVALID_ARGUMENT', 'Specify files, --all, or --changed — not a combination', {
      nextSteps: ['Use --all for every file, --changed for the change set, or pass file paths.'],
      example: 'abap check --all',
    });
  }
  if (opts.all) {
    const found = await listAbapFiles(process.cwd());
    return found.filter((f) => f.endsWith('.abap'));
  }
  if (opts.changed) {
    return collectChangedFiles();
  }
  return files.map((f) => path.resolve(f));
}

/**
 * The change set: local files whose mtime is newer than the SAP object's
 * changedAt (research §7). Empty set fails fast with guidance.
 */
async function collectChangedFiles(): Promise<string[]> {
  const client = await AdtClientWrapper.create();
  const all = (await listAbapFiles(process.cwd())).filter((f) => f.endsWith('.abap'));
  const changed: string[] = [];
  for (const file of all) {
    try {
      const resolved = resolveFile(file);
      const object = await resolveObject(client, resolved.objectName, resolved.objectType);
      const struc = await client.objectStructure(object.objectUrl);
      const changedAt = (struc as { 'adtcore:changedAt'?: string })['adtcore:changedAt'];
      const sapTime = changedAt ? new Date(changedAt).getTime() : 0;
      const stat = await fs.stat(file);
      // Allow 1s clock skew between local and SAP clocks.
      if (stat.mtimeMs > sapTime + 1000) changed.push(file);
    } catch {
      // Unresolvable objects are skipped (not part of a detectable change set).
    }
  }
  if (changed.length === 0) {
    throw new CliError('USAGE', 'No changed files to check', {
      nextSteps: ['Run `abap status` to see the local↔SAP differences.', 'Or use --all to check every file.'],
      example: 'abap check --changed',
    });
  }
  return changed;
}

async function checkFile(
  client: AdtClientWrapper | null,
  file: string,
  mode: CheckMode,
  opts: CheckOptions,
): Promise<CheckFileResult> {
  let resolved;
  try {
    resolved = resolveFile(file);
  } catch (error: unknown) {
    return { issues: [{ file, line: 0, severity: 'error', code: 'FILE_PARSE_ERROR', message: message(error) }] };
  }

  let content: string;
  try {
    content = await readAbapFile(file);
  } catch (error: unknown) {
    return { issues: [{ file, line: 0, severity: 'error', code: 'FILE_PARSE_ERROR', message: message(error) }] };
  }

  if (mode === 'content') {
    return { issues: await contentIssues(file, resolved, content) };
  }

  const adt = client!;
  let object;
  try {
    object = await resolveObject(adt, resolved.objectName, resolved.objectType);
  } catch (error: unknown) {
    if (error instanceof CliError) {
      return { issues: [{ file, line: 0, severity: 'error', code: error.code, message: error.message }] };
    }
    throw error;
  }

  if (mode === 'atc') {
    const parts = await getObjectParts(adt, object);
    const mainPart = parts.find((p) => p.subtype === 'main') ?? parts[0]!;
    const result = await runAtcCheck(adt, { variant: opts.variant!, mainUrl: mainPart.sourceUrl, file });
    return { issues: result.issues, worklist: { file, worklist: result.worklist } };
  }

  return { issues: await syntaxIssues(adt, file, resolved, object, content) };
}

async function syntaxIssues(
  client: AdtClientWrapper,
  file: string,
  resolved: { objectName: string; objectType: string; subtype: string },
  object: Awaited<ReturnType<typeof resolveObject>>,
  content: string,
): Promise<CheckIssue[]> {
  const parts = await getObjectParts(client, object);
  const part = parts.find((p) => p.subtype === resolved.subtype) ?? parts.find((p) => p.subtype === 'main');
  if (!part) {
    return [{ file, line: 0, severity: 'error', code: 'SAP_ERROR', message: `No source part matches ${resolved.subtype}` }];
  }
  const mainUrl = (parts.find((p) => p.subtype === 'main') ?? part).sourceUrl;
  // Empty source parts are trivially valid (abap-adt-api rejects empty content).
  const results = content.trim() === '' ? [] : await client.syntaxCheckContent(part.sourceUrl, mainUrl, content);
  return results.map((r) => ({
    file,
    line: r.line,
    severity: r.severity === 'E' ? 'error' : r.severity === 'W' ? 'warning' : 'info',
    code: 'SYNTAX_ERROR',
    message: r.text,
  }));
}

/** Local-only validation for --content (research §6): no SAP calls. */
async function contentIssues(
  file: string,
  resolved: { objectName: string; objectType: string; subtype: string; route: string },
  content: string,
): Promise<CheckIssue[]> {
  const issues: CheckIssue[] = [];
  try {
    validateLocalFile(resolved);
  } catch (error: unknown) {
    if (error instanceof CliError) {
      issues.push({ file, line: 0, severity: 'error', code: error.code, message: error.message });
    }
  }
  if (content.trim() === '') {
    issues.push({ file, line: 0, severity: 'warning', code: 'EMPTY_FILE', message: 'File is empty' });
  }
  return issues;
}

function humanSummary(issues: CheckIssue[]): string {
  if (issues.length === 0) return 'No issues found.';
  const lines = [`${issues.length} issue(s) found:`];
  for (const i of issues) {
    lines.push(`  ${i.file}:${i.line} [${i.severity}] ${i.code} — ${i.message}`);
  }
  return lines.join('\n');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
