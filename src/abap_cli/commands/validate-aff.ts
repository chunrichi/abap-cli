#!/usr/bin/env node
/**
 * `abap validate:aff <file-or-dir> [--wire <wire-dir>] [--json]`
 *
 * Validates one file or every JSON file under a directory against the
 * abap-file-format schemas declared in `src/abap_cli/aff/schema-paths.ts`.
 *
 * Exit codes follow the unified contract (`output/exit-codes.ts`):
 *   0  all files passed (or only WARN)
 *   2  USAGE — missing target, path does not exist, target is not JSON
 *   7  VALIDATION_ERROR — at least one file failed schema validation or is
 *      missing a required companion (AFF_SCHEMA_* failures are VALIDATION_ERROR
 *      too, raised while loading a schema)
 *
 * Output (unified envelope, see `output/json.ts`):
 *   success → stdout `{ status, meta, data: { summary, files } }`
 *   failure → stderr `{ status, meta, error: { code, category, message, details, nextSteps } }`
 * `data.files[].path` is cwd-relative POSIX; `--json` is compact,
 * `--pretty-json` indents.
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { Command } from 'commander';
import { validateFile, type ValidateResult } from '../aff/schema-validator.js';
import { routeAffSchema } from '../aff/router.js';
import { checkCompanions } from '../aff/companion-check.js';
import { toOutputPath, toRelativeOutputPath } from '../core/path-output.js';
import { CliError, printError, printResult, printSchema, jsonFromCommand, isJsonMode, type CommandSchema } from '../output/json.js';
import { categoryOf } from '../output/error-codes.js';
import { exitCodeFor } from '../output/exit-codes.js';
import { schemaOption } from './schema-helpers.js';

export const SCHEMA: CommandSchema = {
  schemaVersion: 1,
  command: 'validate:aff',
  description: 'Validate JSON files against official abap-file-format (AFF) canonical schemas (Draft 2020-12).',
  usage: 'abap validate:aff <file-or-dir> [--wire <wire-dir>]',
  scope: 'local',
  arguments: [{ name: 'file-or-dir', type: 'string', required: true, description: 'A JSON file or directory of JSON files to validate.' }],
  options: [
    { name: '--wire', type: 'string', valuePlaceholder: '<wire-dir>', description: 'Also recursively validate every JSON under a wire directory.' },
    schemaOption(),
  ],
  globalOptions: ['--json', '--pretty-json'],
  examples: [
    { description: 'Validate a single AFF file', command: 'abap validate:aff src/zmy_basic.tabl.json' },
    { description: 'Validate every AFF file under a directory', command: 'abap validate:aff src/' },
    { description: 'Validate a wire payload directory', command: 'abap validate:aff src/zt_x.tabl.json --wire path/to/wire' },
  ],
  errors: [
    { code: 'USAGE', category: 'USAGE', exitCode: 2 },
    { code: 'VALIDATION_ERROR', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'AFF_SCHEMA_MISSING', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'AFF_SCHEMA_INVALID', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'AFF_SCHEMA_COMPILE_ERROR', category: 'VALIDATION_ERROR', exitCode: 7 },
  ],
};

/** One validated file in `data.files[]`. */
export interface ValidateAffFile {
  /** `fail` means schema errors OR a required companion is missing. */
  status: 'pass' | 'warn' | 'fail';
  /** cwd-relative POSIX path. */
  path: string;
  type?: string;
  errors?: { path: string; keyword: string; message: string }[];
  extraFields?: string[];
  /** Required companions that do not exist next to the main JSON (basenames). */
  missingCompanions?: string[];
  /** Optional companions that do not exist (basenames). */
  optionalCompanions?: string[];
}

export interface ValidateAffData {
  summary: { pass: number; warn: number; fail: number };
  files: ValidateAffFile[];
}

export interface ValidateAffOptions {
  /** Extra directory of wire payloads to validate alongside the targets. */
  wire?: string;
  /** Directory relative paths are resolved against (defaults to process.cwd()). */
  cwd?: string;
}

export interface ValidateAffResult {
  data: ValidateAffData;
  /** Per-file human lines (PASS / WARN / FAIL) for non-JSON output. */
  lines: string[];
  /** Present when at least one file failed — caller renders the unified error
   *  envelope (`VALIDATION_ERROR`, exit 7) with `details` = `data`. */
  failure?: CliError;
}

/** Collect the JSON files under one explicit target; an explicit target must
 *  exist (a typo used to silently validate nothing and exit 0). */
async function collectFromTarget(target: string, cwd: string): Promise<string[]> {
  const raw = target.trim();
  const usage = (message: string, nextSteps: string[]): CliError =>
    new CliError('USAGE', message, { nextSteps, example: 'abap validate:aff src/ --json' });
  if (!raw) {
    throw usage('Empty path target.', ['Pass an AFF JSON file or a directory of AFF JSON files.']);
  }
  const abs = path.resolve(cwd, raw);
  let stat: Awaited<ReturnType<typeof fsp.stat>>;
  try {
    stat = await fsp.stat(abs);
  } catch {
    throw usage(`Path not found: ${toOutputPath(raw)}.`, [
      'Check the path; it must be an AFF JSON file or a directory of AFF JSON files.',
      'Validate the workspace fixtures: abap validate:aff test/fixtures --json',
    ]);
  }
  if (stat.isFile()) {
    if (!abs.endsWith('.json')) {
      throw usage(`Not an AFF JSON file: ${toOutputPath(raw)}.`, [
        'Pass a `.json` AFF file or a directory containing AFF JSON files.',
      ]);
    }
    return [abs];
  }
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith('.json')) out.push(full);
    }
  }
  await walk(abs);
  out.sort();
  return out;
}

/** Validate a single file with companion awareness. Unknown (non-AFF) JSON is
 *  skipped by the caller; nothing here is emitted for it. */
async function validateOne(filePath: string): Promise<{
  result: ValidateResult;
  missing: string[];
  optional: string[];
}> {
  const route = routeAffSchema(filePath);
  if (!route || !route.isJson) {
    return { result: { type: 'UNKNOWN', filePath, status: 'pass', errors: [] }, missing: [], optional: [] };
  }
  const result = await validateFile(filePath, route.type, route.schemaFile);
  const comp = await checkCompanions(filePath);
  return { result, missing: comp.missing, optional: comp.optional };
}

/** Human line for one validated file (paths are already cwd-relative POSIX). */
function humanLine(entry: ValidateAffFile): string {
  const companionNote = entry.missingCompanions?.length
    ? ` [+missing companion: ${entry.missingCompanions.join(', ')}]`
    : entry.optionalCompanions?.length
      ? ` [+optional companion missing: ${entry.optionalCompanions.join(', ')}]`
      : '';
  if (entry.status === 'pass') return `PASS ${entry.path}${companionNote}`;
  if (entry.status === 'warn') return `WARN ${entry.path}: extra fields: ${(entry.extraFields ?? []).join(', ')}${companionNote}`;
  const first = entry.errors?.[0];
  if (first) {
    const more = (entry.errors?.length ?? 0) > 1 ? ` (+${(entry.errors?.length ?? 1) - 1} more)` : '';
    return `FAIL ${entry.path}: ${first.path || '/'} ${first.keyword}: ${first.message}${more}${companionNote}`;
  }
  return `FAIL ${entry.path}: missing companion: ${(entry.missingCompanions ?? []).join(', ') || 'unknown'}`;
}

/**
 * Validate the given targets (and optional wire directory).
 *
 * Throws `CliError('USAGE')` for missing / nonexistent targets and propagates
 * `AFF_SCHEMA_*` schema-loading failures (both VALIDATION_ERROR, exit 7).
 * File-level failures are returned as `result.failure` so the command layer can
 * print the per-file lines in human mode before the unified error envelope.
 */
export async function runValidateAff(
  targets: string[],
  options: ValidateAffOptions = {},
): Promise<ValidateAffResult> {
  const cwd = options.cwd ?? process.cwd();
  if (targets.length === 0) {
    throw new CliError('USAGE', 'A file or directory target is required.', {
      nextSteps: [
        'Pass an AFF JSON file or a directory to validate.',
        'Validate the workspace fixtures: abap validate:aff test/fixtures --json',
      ],
      example: 'abap validate:aff src/zmy_basic.tabl.json --json',
    });
  }

  const collected: string[] = [];
  for (const target of targets) collected.push(...(await collectFromTarget(target, cwd)));
  if (options.wire) collected.push(...(await collectFromTarget(options.wire, cwd)));
  const allFiles = [...new Set(collected)];

  const files: ValidateAffFile[] = [];
  const lines: string[] = [];

  for (const file of allFiles) {
    const r = await validateOne(file);
    // Non-AFF JSON files are outside this command's scope: not validated and
    // not reported (they must not pad the summary with fake passes).
    if (r.result.type === 'UNKNOWN') continue;
    const missingCompanion = r.missing.length > 0;
    const entry: ValidateAffFile = {
      status: r.result.status === 'fail' || missingCompanion ? 'fail' : r.result.status,
      path: toRelativeOutputPath(file, cwd),
      ...(r.result.type ? { type: r.result.type } : {}),
      ...(r.result.errors.length > 0
        ? {
            errors: r.result.errors.map((e) => ({
              path: e.instancePath,
              keyword: e.keyword,
              message: e.message,
            })),
          }
        : {}),
      ...(r.result.extraFields?.length ? { extraFields: r.result.extraFields } : {}),
      ...(r.missing.length ? { missingCompanions: r.missing } : {}),
      ...(r.optional.length ? { optionalCompanions: r.optional } : {}),
    };
    files.push(entry);
    lines.push(humanLine(entry));
  }

  const summary = {
    pass: files.filter((f) => f.status === 'pass').length,
    warn: files.filter((f) => f.status === 'warn').length,
    fail: files.filter((f) => f.status === 'fail').length,
  };
  const data: ValidateAffData = { summary, files };
  const failed = summary.fail;
  if (failed === 0) return { data, lines };

  const missingCount = files.reduce((n, f) => n + (f.missingCompanions?.length ?? 0), 0);
  const failure = new CliError(
    'VALIDATION_ERROR',
    `${failed} of ${files.length} file(s) failed AFF validation${missingCount > 0 ? ` (${missingCount} missing companion(s))` : ''}.`,
    {
      details: data,
      nextSteps: [
        'Inspect error.details.files[] where status is "fail" (schema instance paths and missing companions), fix the files, then re-run.',
      ],
      example: 'abap validate:aff src/ --json',
    },
  );
  return { data, lines, failure };
}

export function registerValidateAffCommand(program: Command): void {
  program
    .command('validate:aff [file-or-dir]')
    .description(
      'Validate JSON files against official abap-file-format (AFF) canonical schemas (Draft 2020-12)',
    )
    .option('--wire <wire-dir>', 'also recursively validate all JSON under a wire directory')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (target: string | undefined, opts: { wire?: string; schema?: boolean }, cmd) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema) {
        printSchema(SCHEMA, mode);
        return;
      }
      // `printError` throws `CliExit`; keep it out of a surrounding try so the
      // top-level runner sees the original exit code instead of re-rendering it.
      const result = await (async (): Promise<ValidateAffResult> => {
        try {
          return await runValidateAff(target ? [target] : [], { wire: opts.wire });
        } catch (error: unknown) {
          printError(mode, error);
        }
      })();
      if (result.failure) {
        // Human mode keeps the per-file PASS/WARN/FAIL lines readable on
        // stderr; JSON mode sends exactly one envelope and nothing on stdout.
        if (!isJsonMode(mode)) for (const line of result.lines) console.error(line);
        printError(mode, result.failure);
      }
      // `files: []` survives stripEmpty: the field is part of the machine
      // contract, and an empty list says "nothing matched", not "field absent".
      printResult(mode, result.data, result.lines.join('\n'), undefined, { preserveEmpty: ['files'] });
    });
}

// Allow `npx tsx src/abap_cli/commands/validate-aff.ts <target> [--wire ...] [--json]`
// invocation outside commander. Defaults to validating `test/fixtures/` when no
// positional target is given (matches the historical `npm run validate:aff` usage).
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('validate-aff.ts')) {
  const argv = process.argv.slice(2);
  const jsonIdx = argv.indexOf('--json');
  const wireIdx = argv.indexOf('--wire');
  const wireVal = wireIdx >= 0 ? argv[wireIdx + 1] : undefined;
  const positional = argv.filter((a, i) => i !== wireIdx && i !== wireIdx + 1 && a !== '--json' && !a.startsWith('-'));
  const targets = positional.length > 0 ? positional : ['test/fixtures/'];
  runValidateAff(targets, { wire: wireVal })
    .then((result) => {
      if (jsonIdx >= 0) {
        process.stdout.write(JSON.stringify(result.data) + '\n');
      } else {
        for (const line of result.lines) process.stdout.write(line + '\n');
      }
      if (result.failure) {
        process.stderr.write(`Error: ${result.failure.message}\n`);
        process.exit(exitCodeFor(categoryOf(result.failure.code)));
      }
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`FAIL: ${msg}\n`);
      process.exit(err instanceof CliError ? exitCodeFor(categoryOf(err.code)) : 1);
    });
}
