import { Command } from 'commander';
import * as path from 'path';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { resolveFile } from '../formats/file-resolver.js';
import { listAbapFiles, readAbapFile } from '../formats/abap-source.js';
import { CliError, printError, printResult, toErrorShape, jsonFromCommand } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';
import { resolveObject, getObjectParts, validateLocalFile } from '../sync/resolve.js';
import { resolveTransport } from '../sync/transport.js';
import { pushObject, type PushStage } from '../sync/push-flow.js';
import { resolveLocalTargets } from '../sync/local-targets.js';

export function registerPushCommand(program: Command): void {
  program
    .command('push')
    .description('Push local ABAP files to SAP (lock → set source → syntax check → activate → unlock)')
    .addHelpText('after', commonErrorsAfter())
    .argument('[files...]', 'Files to push')
    .option('--all', 'Push all .abap files under the current directory (honours .abapignore)')
    .option('--tr <transport>', 'Transport number (required in non-TTY mode)')
    .option('--check-only', 'Only perform syntax check; do not activate (mutex with --no-activate)')
    .option('--no-activate', 'Lock + write + skip check + skip activate + unlock')
    .option('--dry-run', 'Plan only — make no mutating ADT calls (FR-012)')
    .option('--fail-fast', 'Stop at the first failing file (default: --keep-going)')
    .action(async (files: string[], opts, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        await runPush(files, opts, json);
      } catch (error: unknown) {
        printError(json, error);
      }
    });
}

interface PushFileResult {
  file: string;
  status: 'activated' | 'checked-only' | 'written' | 'failed' | 'dry-run';
  transport?: string;
  code?: string;
  stage?: PushStage;
  errors?: unknown[];
  unlock?: string;
  detail?: string;
  plan?: string[];
}

async function runPush(
  files: string[],
  opts: { all?: boolean; tr?: string; checkOnly?: boolean; activate?: boolean; dryRun?: boolean; failFast?: boolean },
  json: boolean,
): Promise<void> {
  if (opts.checkOnly && opts.activate === false) {
    throw new CliError(
      'USAGE',
      '--check-only and --no-activate are mutually exclusive',
      {
        nextSteps: ["Use --check-only to stop after the syntax check.", "Use --no-activate to skip the check and activation entirely."],
        example: 'abap push file.abap --tr NDK123456 --check-only',
      },
    );
  }
  const target = await resolveLocalTargets({ files: files.length > 0 ? files : undefined, all: opts.all });
  if (target.files.length === 0) {
    throw new CliError('USAGE', 'Specify files or use --all', {
      nextSteps: ["Provide one or more file paths: abap push src/foo.abap src/bar.abap --tr NDK123456", "Or use --all with a .abapignore at the workspace root."],
      example: 'abap push src/foo.abap --tr NDK123456',
    });
  }

  const client = await AdtClientWrapper.create();
  // In dry-run we don't need a real transport; pass --tr or config transport.
  const transport = opts.dryRun
    ? (opts.tr ?? client.getConfig().transport ?? 'DRY_RUN')
    : await resolveTransport(client, opts.tr, client.getConfig().transport);

  const results: PushFileResult[] = [];
  let failed = 0;
  for (const file of target.files) {
    const stages: PushStage[] = [];
    const onStage = (s: PushStage) => stages.push(s);
    try {
      await pushOne(client, file, transport, opts, onStage);
      if (opts.dryRun) {
        results.push({ file, status: 'dry-run', plan: stages });
      } else {
        results.push({
          file,
          status: opts.checkOnly ? 'checked-only' : (opts.activate === false ? 'written' : 'activated'),
          transport,
          stage: stages[stages.length - 1],
        });
      }
      if (opts.failFast && failed > 0) break;
    } catch (error: unknown) {
      failed++;
      const err = toErrorShape(error);
      results.push({
        file,
        status: 'failed',
        code: err.code,
        stage: (typeof err.stage === 'string' ? err.stage : stages[stages.length - 1]) as PushStage | undefined,
        errors: Array.isArray(err.errors) ? err.errors : undefined,
        unlock: typeof err.unlock === 'string' ? err.unlock : undefined,
        detail: typeof err.detail === 'string' ? err.detail : undefined,
      });
      if (opts.failFast) break;
    }
  }

  if (failed > 0) {
    const single = target.files.length === 1;
    const code = single ? (results[0]?.code ?? 'PUSH_FAILED') : 'PUSH_FAILED';
    const payload = {
      code,
      message: `${failed} of ${target.files.length} file(s) failed`,
      results,
      nextSteps: [
        'Inspect the failing file\'s `code` and `stage` fields.',
        'Fix the issue and re-run with --keep-going (default) or --fail-fast to stop earlier.',
      ],
      example: 'abap push src/foo.abap --tr NDK123456',
    };
    if (json) {
      console.error(JSON.stringify({ status: 'error', error: payload }, null, 2));
    } else {
      console.error(`Error: ${payload.message}`);
      for (const r of results.filter((x) => x.status === 'failed')) {
        console.error(`  ${r.file} — ${r.code ?? 'FAILED'}${r.stage ? ` (stage: ${r.stage})` : ''}`);
      }
    }
    // Aggregate exit code follows the category of the first failed file (or PUSH_FAILED fallback).
    const firstFailed = results.find((r) => r.status === 'failed');
    const aggregateCode = (firstFailed?.code ?? code) as
      'PUSH_FAILED' | 'LOCK_FAILED' | 'ACTIVATION_FAILED' | 'SYNTAX_ERROR' | 'NO_TRANSPORT' | 'OBJECT_NOT_FOUND' | 'TLS_ERROR' | 'AUTH_ERROR' | 'SAP_ERROR' | 'TRANSPORT_CREATE_FAILED' | 'TRANSPORT_NOT_FOUND' | 'OVERWRITE_REQUIRED' | 'CONFIG_ERROR' | 'CREATE_FAILED' | 'DDIC_NOT_SUPPORTED' | 'TYPE_NOT_SUPPORTED' | 'NOT_IMPLEMENTED' | 'USAGE' | 'INVALID_ARGUMENT' | 'FILE_PARSE_ERROR' | 'AMBIGUOUS_OBJECT';
    const { exitCodeFor } = await import('../output/exit-codes.js');
    const { categoryOf } = await import('../output/error-codes.js');
    void exitCodeFor;
    process.exit(exitCodeFor(categoryOf(aggregateCode)));
  }

  printResult(
    json,
    opts.dryRun ? { dryRun: true, results } : { results, failed },
    humanSummary(results),
  );
}

async function pushOne(
  client: AdtClientWrapper,
  file: string,
  transport: string,
  opts: { checkOnly?: boolean; activate?: boolean; dryRun?: boolean },
  onStage: (s: PushStage) => void,
): Promise<void> {
  let resolved;
  try {
    resolved = resolveFile(file);
  } catch (error: unknown) {
    throw new CliError('FILE_PARSE_ERROR', `Cannot parse ${file}: ${message(error)}`, { details: { file } });
  }
  validateLocalFile(resolved);

  let content: string;
  try {
    content = await readAbapFile(file);
  } catch (error: unknown) {
    throw new CliError('FILE_PARSE_ERROR', `Cannot read ${file}: ${message(error)}`, { details: { file } });
  }

  const object = await resolveObject(client, resolved.objectName, resolved.objectType);
  const parts = await getObjectParts(client, object);
  const part = parts.find((p) => p.subtype === resolved.subtype) ?? parts.find((p) => p.subtype === 'main');
  if (!part) {
    throw new CliError('SAP_ERROR', `No source part matches ${resolved.subtype} for ${object.name}`, { details: { object: object.name } });
  }

  await pushObject(
    client,
    object,
    [{ subtype: part.subtype, sourceUrl: part.sourceUrl, content }],
    { transport, checkOnly: opts.checkOnly ?? false, activate: opts.activate, dryRun: opts.dryRun, onStage },
  );
}

function humanSummary(results: PushFileResult[]): string {
  const lines = [`Pushed ${results.length} file(s):`];
  for (const r of results) {
    const tr = r.transport ? ` (${r.transport})` : '';
    const plan = r.plan ? ` [${r.plan.join(' → ')}]` : '';
    lines.push(`  ${r.file} → ${r.status}${tr}${plan}`);
  }
  return lines.join('\n');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}