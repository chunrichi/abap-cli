import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { resolveFile } from '../formats/file-resolver.js';
import { readAbapFile } from '../formats/abap-source.js';
import { resolveLocalTargets } from '../core/local-targets.js';
import { CliError, printError, printResult, printSchema, jsonFromCommand, type OutputMode } from '../output/json.js';
import { resolveObject, getObjectParts, validateLocalFile } from '../core/resolve.js';
import { runAtcCheck } from '../flows/core/atc.js';
import type { AtcWorkList } from 'abap-adt-api';
import type { CheckIssue } from '../output/issues.js';
import { toOutputPath, toRelativeOutputPath } from '../core/path-output.js';
import { commandSchemas } from '../flows/setup/command-schemas.js';

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
  /** Shortcut for `check syntax` invoked from the parent (`--files <f...>`). */
  files?: string[];
}

export function registerCheckCommand(program: Command): void {
  // Note: the parent `check` has no positional argument — that would shadow
  // the subcommands (`check syntax --all` would otherwise put `syntax` into
  // the parent's `[files...]` variadic). The "bare `abap check <files>`"
  // shortcut is implemented via `check --files ...` (see option below) to
  // keep the subcommand dispatch unambiguous.
  const check = program
    .command('check')
    .description('Validate ABAP source code (syntax / content / atc)')
    .option('--files <files...>', 'Shortcut: run syntax mode on the given files (equivalent to `abap check syntax <files...>`)')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (opts: CheckOptions, cmd) => {
      // --schema branch — emit machine-readable parameter schema (no SAP call).
      if (cmd.optsWithGlobals().schema) {
        printSchema(commandSchemas['check']!, jsonFromCommand(cmd));
        return;
      }
      // Bare `abap check` (no subcommand, no --files) prints subcommand help.
      const hasShortcut = Array.isArray(opts.files) && opts.files.length > 0;
      if (!hasShortcut) {
        console.log(cmd.helpInformation());
        return;
      }
      const files = opts.files as string[];
      const mode = jsonFromCommand(cmd);
      try {
        await runCheck(files, opts, 'syntax', mode);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });

  check
    .command('syntax')
    .description('Syntax check against SAP')
    .argument('[files...]', 'Files to check')
    .option('--all', 'Check all .abap files under the scan root (sourceDir or current dir)')
    .option('--changed', 'Check only files changed since the SAP version')
    .option('--strict', 'Treat warnings as failures')
    .action(async (files: string[], opts: CheckOptions, cmd) => {
      const mode = jsonFromCommand(cmd);
      try {
        await runCheck(files, opts, 'syntax', mode);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });

  check
    .command('content')
    .description('Local-only validation, no SAP call')
    .argument('[files...]', 'Files to check')
    .option('--all', 'Check all .abap files under the scan root (sourceDir or current dir)')
    .option('--changed', 'Check only files changed since the SAP version')
    .option('--strict', 'Treat warnings as failures')
    .action(async (files: string[], opts: CheckOptions, cmd) => {
      const mode = jsonFromCommand(cmd);
      try {
        await runCheck(files, opts, 'content', mode);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });

  check
    .command('atc')
    .description('ATC check against SAP (requires --variant)')
    .argument('[files...]', 'Files to check')
    .requiredOption('--variant <variant>', 'ATC check variant')
    .option('--all', 'Check all .abap files under the scan root (sourceDir or current dir)')
    .option('--changed', 'Check only files changed since the SAP version')
    .option('--strict', 'Treat warnings as failures')
    .option('--out [file]', 'Persist raw ATC worklist to a file (only with --atc); defaults to .abap/atc/<variant>-<timestamp>.json')
    .action(async (files: string[], opts: CheckOptions, cmd) => {
      const mode = jsonFromCommand(cmd);
      try {
        await runCheck(files, opts, 'atc', mode);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}

async function runCheck(files: string[], opts: CheckOptions, checkMode: CheckMode, outMode: OutputMode): Promise<void> {
  if (checkMode === 'atc' && !opts.variant) {
    throw new CliError('INVALID_ARGUMENT', 'check atc requires --variant', {
      nextSteps: ['Pass an ATC variant: abap check atc <file> --variant Z_VARIANT'],
      example: 'abap check atc src/zcl_ok.clas.abap --variant Z_ATC_VAR',
    });
  }
  if (checkMode !== 'atc' && opts.out !== undefined) {
    throw new CliError('INVALID_ARGUMENT', '--out only applies to check atc', {
      nextSteps: ['Use --out with check atc: abap check atc <file> --variant Z_VARIANT --out'],
      example: 'abap check atc src/zcl_ok.clas.abap --variant Z_ATC_VAR --out',
    });
  }

  const fileList = await collectFiles(files, opts);
  if (fileList.length === 0) {
    throw new CliError('USAGE', 'No files to check', {
      nextSteps: ['Provide file paths, or use --all for every .abap file.'],
      example: 'abap check syntax src/zcl_demo.clas.abap',
    });
  }

  // --content is local-only: no SAP client is created (zero SAP calls).
  const client = checkMode === 'content' ? null : await AdtClientWrapper.create();

  const issues: CheckIssue[] = [];
  const worklists: { file: string; worklist: AtcWorkList }[] = [];
  for (const file of fileList) {
    const result = await checkFile(client, file, checkMode, opts);
    issues.push(...result.issues);
    if (result.worklist) worklists.push(result.worklist);
  }

  // --atc --out persists the raw worklists; resolve the output file ONCE so the
  // persisted path and the reported `out` field can never disagree (P0).
  const atcOut = checkMode === 'atc' && opts.out !== undefined ? outPath(opts) : undefined;
  if (atcOut) {
    await persistWorklists(opts, worklists, atcOut);
  }

  // P0: normalize path fields to cwd-relative POSIX in the JSON envelope so
  // agents see the same shape on every platform.
  const outIssues: CheckIssue[] = issues.map((i) => ({ ...i, file: toRelativeOutputPath(i.file) }));
  // `out` is only reported when --atc --out was given (i.e. something was
  // actually persisted). Explicit paths echo the user's input (separators only);
  // the default is the cwd-relative POSIX form of the very file just written.
  const outValue = atcOut !== undefined
    ? (typeof opts.out === 'string' && opts.out.trim() !== '' ? toOutputPath(opts.out) : toRelativeOutputPath(atcOut))
    : undefined;

  const failed = outIssues.some((i) => i.severity === 'error' || (opts.strict && i.severity === 'warning'));
  // Feedback §6: `check syntax` passing while `push` fails activation is not a
  // bug (activation runs generation steps the syntax check does not), but the
  // CLI never said so. State the scope explicitly instead of leaving the user to
  // infer it from two contradicting verdicts.
  const scope = checkScope(checkMode);
  if (failed) {
    const code = checkMode === 'syntax' ? 'SYNTAX_ERROR' : 'VALIDATION_ERROR';
    throw new CliError(code, `${outIssues.length} issue(s) found across ${fileList.length} file(s)`, {
      details: { issues: outIssues, files: fileList.length, scope, ...(outValue !== undefined ? { out: outValue } : {}) },
    });
  }
  printResult(outMode, { issues: outIssues, failure: false, scope, ...(outValue !== undefined ? { out: outValue } : {}) }, humanSummary(outIssues));
}

/**
 * Describe what a `check` run actually validated, so callers do not read a
 * passing syntax check as a guarantee that `abap push` will activate.
 */
function checkScope(mode: 'syntax' | 'content' | 'atc'): {
  validated: string;
  semantics: string;
  activationStillRequired: boolean;
} {
  if (mode === 'content') {
    return {
      validated: 'local-content',
      semantics: 'Offline structural validation of the local file only — no SAP round-trip, no syntax check.',
      activationStillRequired: false,
    };
  }
  if (mode === 'atc') {
    return {
      validated: 'atc',
      semantics: 'ABAP Test Cockpit findings. A clean ATC run does not guarantee that activation succeeds.',
      activationStillRequired: true,
    };
  }
  return {
    validated: 'syntax',
    semantics:
      'ADT syntax check of the local file content. Activation additionally generates artefacts ' +
      '(selection screens, DDL, class includes), so a passing syntax check does NOT guarantee that ' +
      '`abap push` will activate. Use `abap inspect <object> --activation` to verify the result.',
    activationStillRequired: true,
  };
}

/** Persist raw ATC worklists to `file` (resolved once by the caller). */
async function persistWorklists(opts: CheckOptions, worklists: { file: string; worklist: AtcWorkList }[], file: string): Promise<void> {
  // P0: persist the cwd-relative POSIX `file` field; the on-disk `file` is the
  // host-native path for fs.writeFile. Two values because each is consumed by
  // a different reader (agents vs the OS).
  const payload = {
    variant: opts.variant,
    timestamp: new Date().toISOString(),
    files: worklists.map((w) => ({ file: toRelativeOutputPath(w.file), worklist: w.worklist })),
  };
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  } catch (error: unknown) {
    throw new CliError('FILE_PARSE_ERROR', `Cannot write ATC output to ${toOutputPath(file)}: ${message(error)}`, {
      file: toOutputPath(file),
      nextSteps: ['Pick a writable path: abap check atc <file> --variant Z_VARIANT --out /tmp/atc.json'],
      example: 'abap check atc src/zcl_ok.clas.abap --variant Z_ATC_VAR --out /tmp/atc.json',
    });
  }
}

/** Resolve the output file: explicit path, or .abap/atc/<variant>-<timestamp>.json.
 *  Returns the host-native absolute path for fs.writeFile (P0 boundary). */
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

/** `resolveMode` removed in 021: mode is now an explicit subcommand argument. */

/** Resolve the file set from explicit files, --all, or --changed. */
async function collectFiles(files: string[], opts: CheckOptions): Promise<string[]> {
  const scopeCount = Number(Boolean(opts.all)) + Number(Boolean(opts.changed)) + Number(files.length > 0);
  if (scopeCount > 1) {
    throw new CliError('INVALID_ARGUMENT', 'Specify files, --all, or --changed — not a combination', {
      nextSteps: ['Use --all for every file, --changed for the change set, or pass file paths.'],
      example: 'abap check --all',
    });
  }
  if (opts.all || opts.changed) {
    // Whole-workspace scans share resolveLocalTargets scoping: .abap.json::sourceDir
    // when configured (else cwd) + ignore defaults/.abapignore; strays are skipped.
    const targets = await resolveLocalTargets({ all: true });
    const all = targets.files.filter((f) => f.endsWith('.abap'));
    if (opts.all) return all;
    return collectChangedFiles(all);
  }
  return files.map((f) => path.resolve(f));
}

/**
 * The change set: local files whose mtime is newer than the SAP object's
 * changedAt. Empty set fails fast with guidance.
 */
async function collectChangedFiles(all: string[]): Promise<string[]> {
  const client = await AdtClientWrapper.create();
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

  return { issues: await annotateUnknownNames(adt, await syntaxIssues(adt, file, resolved, object, content)) };
}

/** SAP phrasings that mean "this name could not be resolved". */
const UNKNOWN_NAME_PATTERNS: RegExp[] = [
  /Type "([A-Za-z0-9_/]+)" is unknown/i,
  /Unable to interpret "([A-Za-z0-9_/]+)"/i,
  /Field "([A-Za-z0-9_/-]+)" is unknown/i,
  /Unknown identifier "([A-Za-z0-9_/]+)"/i,
];

/** Cap on repository lookups per check run — errors are the rare path. */
const UNKNOWN_TOKEN_LOOKUP_CAP = 5;

function extractUnknownToken(message: string): string | undefined {
  for (const pattern of UNKNOWN_NAME_PATTERNS) {
    const m = pattern.exec(message);
    if (m?.[1]) return m[1].toUpperCase();
  }
  return undefined;
}

/**
 * Feedback F-22 / F-23: `check syntax` relayed SAP's bare `Type "X" is unknown`
 * / `Field "X" is unknown` with no way to tell a typo from an object that exists
 * on the system but is not visible to this check (a release/kernel limitation).
 * Resolve up to {@link UNKNOWN_TOKEN_LOOKUP_CAP} names against the object
 * repository and append the outcome to the message.
 *
 * Best-effort by contract: a lookup failure leaves the original message intact
 * and never fails the check.
 */
async function annotateUnknownNames(
  client: AdtClientWrapper,
  issues: CheckIssue[],
): Promise<CheckIssue[]> {
  let lookups = 0;
  const cache = new Map<string, string | undefined>();
  const out: CheckIssue[] = [];
  for (const issue of issues) {
    if (issue.severity !== 'error' || lookups >= UNKNOWN_TOKEN_LOOKUP_CAP) {
      out.push(issue);
      continue;
    }
    const token = extractUnknownToken(issue.message);
    if (!token) {
      out.push(issue);
      continue;
    }
    // `TABLE-FIELD` cannot be searched directly — point at the field inventory.
    if (token.includes('-')) {
      const table = token.split('-')[0]!;
      out.push({
        ...issue,
        message: `${issue.message} [check the field list: abap fields ${table}]`,
      });
      continue;
    }
    if (!cache.has(token)) {
      lookups += 1;
      cache.set(token, await describeRepositoryName(client, token));
    }
    const note = cache.get(token);
    out.push(note ? { ...issue, message: `${issue.message} [${note}]` } : issue);
  }
  return out;
}

/** One repository lookup for an unresolved name. Returns `undefined` on error. */
async function describeRepositoryName(
  client: AdtClientWrapper,
  token: string,
): Promise<string | undefined> {
  try {
    // ADT quickSearch needs a wildcard; `NAME*` keeps the candidate set small.
    // Fetch a few extra hits: one name can exist as several object kinds (e.g.
    // DEVCLASS is both a data element and an authorization object), and the
    // type-relevant ones must not be hidden behind an unrelated first hit.
    const hits = await client.searchObject(`${token}*`, undefined, 20);
    const exact = hits.filter((h) => String(h['adtcore:name'] ?? '').toUpperCase() === token);
    if (exact.length > 0) {
      const preferred = ['DTEL', 'TTYP', 'TABL', 'STRU', 'DOMA', 'VIEW', 'INTF', 'CLAS', 'PROG', 'FUGR'];
      const rank = (type: string): number => {
        const i = preferred.findIndex((p) => type.startsWith(p));
        return i < 0 ? preferred.length : i;
      };
      const types = [...new Set(exact.map((h) => String(h['adtcore:type'] ?? '')))].sort(
        (a, b) => rank(a) - rank(b) || a.localeCompare(b),
      );
      return `exists in this system as ${token} (${types.slice(0, 3).join(', ')}) — the rejection is a release/kernel limitation, not a typo`;
    }
    if (hits.length > 0) {
      const nearest = hits
        .slice(0, 3)
        .map((h) => `${h['adtcore:name']} (${h['adtcore:type']})`)
        .join(', ');
      return `no exact match; nearest names: ${nearest}`;
    }
    return 'no object with this name exists in this system (check for a typo)';
  } catch {
    return undefined;
  }
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

/** Local-only validation for --content: no SAP calls. */
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
