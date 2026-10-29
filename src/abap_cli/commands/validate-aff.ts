#!/usr/bin/env node
/**
 * `abap validate:aff <file-or-dir> [--wire <wire-dir>] [--json]`
 *
 * Validates one file or every JSON file under a directory against the
 * abap-file-format schemas declared in `src/abap_cli/aff/schema-paths.ts`.
 *
 * Exit code:
 *   0  all files passed (or only WARN)
 *   1  at least one file failed validation or could not be parsed
 *   2  usage error (unknown option / missing argument)
 *
 * Output:
 *   stdout, one line per file:
 *     PASS <path>
 *     WARN <path>: extra fields: <keys>
 *     FAIL <path>: <instancePath> <keyword>: <message>
 *   In `--json` mode, the same lines are aggregated into an envelope:
 *     { status, summary: { pass, warn, fail }, files: [...] }
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { Command } from 'commander';
import {
  validateFile,
  type ValidateResult,
  type ValidateError,
} from '../aff/schema-validator.js';
import { routeAffSchema } from '../aff/router.js';
import { checkCompanions } from '../aff/companion-check.js';
import { printSchema, jsonFromCommand } from '../output/json.js';
import { commandSchemas } from '../flows/setup/command-schemas.js';

interface RunOptions {
  wire?: string;
  json?: boolean;
}

interface JsonLine {
  status: 'pass' | 'warn' | 'fail';
  path: string;
  type?: string;
  errors?: { path: string; keyword: string; message: string }[];
  extraFields?: string[];
  missingCompanions?: string[];
  optionalCompanions?: string[];
}

/** Collect *.json under a single file or recursively under a directory.
 *  A missing target yields no files rather than throwing — callers treat an
 *  empty result as "nothing to validate". */
async function collectJsonFiles(root: string): Promise<string[]> {
  let stat;
  try {
    stat = await fsp.stat(root);
  } catch {
    return [];
  }
  if (stat.isFile()) return [path.resolve(root)];
  const out: string[] = [];
  async function walk(p: string): Promise<void> {
    const entries = await fsp.readdir(p, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.endsWith('.json')) out.push(full);
    }
  }
  await walk(path.resolve(root));
  out.sort();
  return out;
}

/** Shape an error into a stable human string. */
function errorLine(e: ValidateError): string {
  const where = e.instancePath || '/';
  return `${where} ${e.keyword}: ${e.message}`;
}

/** Validate a single file with companion awareness. */
async function validateOne(
  filePath: string,
  options: { reportCompanions: boolean },
): Promise<{ result: ValidateResult; missing: string[]; optional: string[] }> {
  const route = routeAffSchema(filePath);
  if (!route || !route.isJson) {
    // Not in scope — emit a synthetic PASS line so the caller can still see it.
    return {
      result: { type: 'UNKNOWN', filePath, status: 'pass', errors: [] },
      missing: [],
      optional: [],
    };
  }
  const result = await validateFile(filePath, route.type, route.schemaFile);
  let missing: string[] = [];
  let optional: string[] = [];
  if (options.reportCompanions) {
    const comp = await checkCompanions(filePath);
    missing = comp.missing;
    optional = comp.optional;
  }
  return { result, missing, optional };
}

/** Emit one line per file. */
function emitHuman(r: { result: ValidateResult; missing: string[]; optional: string[] }): string {
  const where = r.result.filePath ?? '<unknown>';
  const companionNote =
    r.missing.length > 0
      ? ` [+missing companion: ${r.missing.join(', ')}]`
      : r.optional.length > 0
      ? ` [+optional companion missing: ${r.optional.join(', ')}]`
      : '';
  if (r.result.status === 'pass' && r.missing.length === 0) return `PASS ${where}${companionNote}`;
  if (r.result.status === 'warn' && r.missing.length === 0)
    return `WARN ${where}: extra fields: ${(r.result.extraFields ?? []).join(', ')}${companionNote}`;
  if (r.result.status === 'fail') {
    const first = r.result.errors[0];
    const head = first ? errorLine(first) : 'unspecified';
    const more = r.result.errors.length > 1 ? ` (+${r.result.errors.length - 1} more)` : '';
    return `FAIL ${where}: ${head}${more}${companionNote}`;
  }
  return `FAIL ${where}: missing companion${companionNote}`;
}

export async function runValidateAff(
  targets: string[],
  options: RunOptions,
): Promise<number> {
  const allFiles: string[] = [];
  for (const t of targets) {
    const files = await collectJsonFiles(t);
    allFiles.push(...files);
  }
  if (options.wire) {
    const wireFiles = await collectJsonFiles(options.wire);
    allFiles.push(...wireFiles);
  }

  const lines: JsonLine[] = [];
  let exitCode = 0;

  for (const file of allFiles) {
    try {
      const r = await validateOne(file, { reportCompanions: true });
      const human = emitHuman(r);
      const passedJson: JsonLine = {
        status: r.result.status,
        path: file,
        type: r.result.type,
        ...(r.result.errors.length > 0
          ? {
              errors: r.result.errors.map((e) => ({
                path: e.instancePath,
                keyword: e.keyword,
                message: e.message,
              })),
            }
          : {}),
        ...(r.result.extraFields ? { extraFields: r.result.extraFields } : {}),
        ...(r.missing.length ? { missingCompanions: r.missing } : {}),
        ...(r.optional.length ? { optionalCompanions: r.optional } : {}),
      };
      // Skip synthetic "unknown-type" pass lines from the report.
      if (r.result.type !== 'UNKNOWN') {
        lines.push(passedJson);
        const isHardFail =
          r.result.status === 'fail' || r.missing.length > 0;
        if (isHardFail) exitCode = 1;
        if (options.json) {
          // JSON mode prints to stdout one object per file (one JSON per line).
          // The aggregator is built below.
        } else {
          const out = human.startsWith('FAIL') ? process.stderr : process.stdout;
          out.write(human + '\n');
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (options.json) {
        lines.push({ status: 'fail', path: file, errors: [{ path: '', keyword: 'exception', message: msg }] });
      } else {
        process.stderr.write(`FAIL ${file}: exception: ${msg}\n`);
      }
      exitCode = 1;
    }
  }

  if (options.json) {
    const summary = {
      pass: lines.filter((l) => l.status === 'pass').length,
      warn: lines.filter((l) => l.status === 'warn').length,
      fail: lines.filter((l) => l.status === 'fail').length,
    };
    const out = { status: exitCode === 0 ? 'success' : 'error', summary, files: lines };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  }

  return exitCode;
}

export function registerValidateAffCommand(program: Command): void {
  program
    .command('validate:aff [file-or-dir]')
    .description(
      'Validate JSON files against official abap-file-format (AFF) canonical schemas (Draft 2020-12)',
    )
    .option('--wire <wire-dir>', 'also recursively validate all JSON under a wire directory')
    .option('--json', 'emit a single JSON envelope instead of per-line PASS/FAIL/WARN')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (target: string, opts: { wire?: string; json?: boolean; schema?: boolean }, cmd) => {
      // --schema: print the JSON parameter schema and exit (no validation, no SAP).
      const allOpts = cmd.optsWithGlobals();
      if (allOpts.schema) {
        printSchema(commandSchemas['validate:aff']!, jsonFromCommand(cmd));
        return;
      }
      // The top-level --json / --pretty-json (added by index.ts) must also
      // activate JSON mode; merge it into our local option.
      const topOpts = (program.optsWithGlobals?.() ?? {}) as { json?: boolean; prettyJson?: boolean };
      const wantJson = Boolean(opts.json) || Boolean(topOpts.json) || Boolean(topOpts.prettyJson);
      const code = await runValidateAff([target], { wire: opts.wire, json: wantJson });
      process.exit(code);
    });
}

// Allow `npx tsx src/abap_cli/commands/validate-aff.ts <target> [--wire ...] [--json]`
// invocation outside commander. Defaults to validating `test/fixtures/` when no
// positional target is given (matches `npm run validate:aff` / `pretest` usage).
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('validate-aff.ts')) {
  const argv = process.argv.slice(2);
  const jsonIdx = argv.indexOf('--json');
  const wireIdx = argv.indexOf('--wire');
  const wireVal = wireIdx >= 0 ? argv[wireIdx + 1] : undefined;
  const positional = argv.filter((a, i) => i !== wireIdx && i !== wireIdx + 1 && a !== '--json' && !a.startsWith('-'));
  const targets = positional.length > 0 ? positional : ['test/fixtures/'];
  runValidateAff(targets, { wire: wireVal, json: jsonIdx >= 0 })
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`FAIL: ${msg}\n`);
      process.exit(1);
    });
}
