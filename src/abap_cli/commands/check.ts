import { Command } from 'commander';
import * as path from 'path';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { resolveFile } from '../formats/file-resolver.js';
import { listAbapFiles, readAbapFile } from '../formats/abap-source.js';
import { CliError, printError, printResult, toErrorShape, jsonFromCommand } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';
import { resolveObject, getObjectParts, validateLocalFile } from '../sync/resolve.js';

interface CheckIssue {
  line: number;
  offset: number;
  severity: string;
  text: string;
}

interface CheckFileResult {
  file: string;
  ok: boolean;
  warnings?: CheckIssue[];
  errors?: CheckIssue[];
  error?: { code: string; message: string };
}

export function registerCheckCommand(program: Command): void {
  program
    .command('check')
    .description('Perform syntax check on local ABAP files (no activation, no SAP changes)')
    .addHelpText('after', commonErrorsAfter())
    .argument('[files...]', 'Files to check')
    .option('--all', 'Check all .abap files under the current directory')
    .action(async (files: string[], opts, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        await runCheck(files, opts, json);
      } catch (error: unknown) {
        printError(json, error);
      }
    });
}

async function runCheck(files: string[], opts: { all?: boolean }, json: boolean): Promise<void> {
  const fileList = await collectFiles(files, opts.all);
  const client = await AdtClientWrapper.create();

  const results: CheckFileResult[] = [];
  let failed = 0;
  for (const file of fileList) {
    try {
      results.push(await checkFile(client, file));
    } catch (error: unknown) {
      failed++;
      const err = toErrorShape(error);
      results.push({
        file,
        ok: false,
        error: {
          code: err.code,
          message: err.message,
          ...(Array.isArray(err.errors) ? { errors: err.errors } : {}),
        },
      });
    }
  }

  if (failed > 0) {
    const single = fileList.length === 1;
    const code = single ? (results[0]?.error?.code ?? 'SYNTAX_ERROR') : 'SYNTAX_ERROR';
    const payload = { code, message: `${failed} of ${fileList.length} file(s) failed`, results };
    if (json) {
      console.error(JSON.stringify({ status: 'error', error: payload }, null, 2));
    } else {
      console.error(`Error: ${failed} of ${fileList.length} file(s) failed`);
      for (const r of results.filter((x) => !x.ok)) {
        const detail = r.error ? ` (${r.error.code})` : '';
        console.error(`  ${r.file}${detail}`);
        for (const e of r.errors ?? []) console.error(`    L${e.line}:${e.offset} [${e.severity}] ${e.text}`);
      }
    }
    process.exit(1);
  }

  printResult(json, { results, failed }, humanSummary(results));
}

async function checkFile(client: AdtClientWrapper, file: string): Promise<CheckFileResult> {
  let resolved;
  try {
    resolved = resolveFile(file);
  } catch (error: unknown) {
    throw new CliError('FILE_PARSE_ERROR', `Cannot parse ${file}: ${message(error)}`, { file });
  }
  validateLocalFile(resolved);

  let content: string;
  try {
    content = await readAbapFile(file);
  } catch (error: unknown) {
    throw new CliError('FILE_PARSE_ERROR', `Cannot read ${file}: ${message(error)}`, { file });
  }

  const object = await resolveObject(client, resolved.objectName, resolved.objectType);
  const parts = await getObjectParts(client, object);
  const part = parts.find((p) => p.subtype === resolved.subtype) ?? parts.find((p) => p.subtype === 'main');
  if (!part) {
    throw new CliError('SAP_ERROR', `No source part matches ${resolved.subtype} for ${object.name}`, { object: object.name });
  }

  const mainUrl = (parts.find((p) => p.subtype === 'main') ?? part).sourceUrl;
  // Empty source parts are trivially valid (abap-adt-api rejects empty content)
  const results = content.trim() === '' ? [] : await client.syntaxCheckContent(part.sourceUrl, mainUrl, content);
  const errors = results.filter((r) => r.severity === 'E').map(toIssue);
  const warnings = results.filter((r) => r.severity === 'W').map(toIssue);
  if (errors.length > 0) {
    throw new CliError('SYNTAX_ERROR', `Syntax check failed for ${file}`, { file, stage: 'check', errors });
  }
  return { file, ok: true, warnings };
}

function toIssue(r: { line: number; offset: number; severity: string; text: string }): CheckIssue {
  return { line: r.line, offset: r.offset, severity: r.severity, text: r.text };
}

async function collectFiles(files: string[], all?: boolean): Promise<string[]> {
  if (all) {
    const found = await listAbapFiles(process.cwd());
    return found.filter((f) => f.endsWith('.abap'));
  }
  if (!files || files.length === 0) {
    throw new CliError('USAGE', 'Specify files or use --all');
  }
  return files.map((f) => path.resolve(f));
}

function humanSummary(results: CheckFileResult[]): string {
  const lines = [`Checked ${results.length} file(s):`];
  for (const r of results) lines.push(`  ${r.file} — ${r.ok ? 'OK' : 'FAILED'}`);
  return lines.join('\n');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
