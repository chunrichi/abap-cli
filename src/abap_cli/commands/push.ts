import { Command } from 'commander';
import * as path from 'path';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { resolveFile } from '../formats/file-resolver.js';
import { listAbapFiles, readAbapFile } from '../formats/abap-source.js';
import { CliError, printError, printResult, toErrorShape, jsonFromCommand } from '../output/json.js';
import { collectWarning, type Warning } from '../output/meta.js';
import type { ErrorCode } from '../output/error-codes.js';
import { commonErrorsAfter } from '../output/help-text.js';
import { resolveObject, getObjectParts, validateLocalFile } from '../sync/resolve.js';
import { resolveTransport } from '../sync/transport.js';
import { pushObject, type PushStage } from '../sync/push-flow.js';
import { resolveLocalTargets } from '../sync/local-targets.js';
import { enumerateFugr, fugrPushTargetFor } from '../formats/fugr-layout.js';

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
    .option('--atomic', 'Validate all files first; write nothing if any file fails validation')
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
  opts: { all?: boolean; tr?: string; checkOnly?: boolean; activate?: boolean; dryRun?: boolean; failFast?: boolean; atomic?: boolean },
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

  // --atomic phase 1: structural validation of every file (NO content syntax
  // check — it establishes an SAP edit session that breaks the later activate,
  // per 008 real-SAP findings and research §11). Any failure → zero writes.
  if (opts.atomic) {
    const validationFailures: { file: string; code?: string; message: string }[] = [];
    for (const file of target.files) {
      try {
        const resolved = resolveFile(file);
        validateLocalFile(resolved);
        await readAbapFile(file);
      } catch (error: unknown) {
        const err = toErrorShape(error);
        validationFailures.push({ file, code: err.code as string, message: err.message as string });
      }
    }
    if (validationFailures.length > 0) {
      throw new CliError('VALIDATION_ERROR', `${validationFailures.length} file(s) failed validation; nothing was written`, {
        details: { failures: validationFailures, atomic: true },
        nextSteps: ['Fix the failing files and re-run.', 'Or drop --atomic to push the valid files individually.'],
        example: 'abap push src/foo.abap --tr NDK123456 --atomic',
      });
    }
  }

  const client = await AdtClientWrapper.create();
  // In dry-run we don't need a real transport; pass --tr or config transport.
  const transport = opts.dryRun
    ? (opts.tr ?? client.getConfig().transport ?? 'DRY_RUN')
    : await resolveTransport(client, opts.tr, client.getConfig().transport);

  const results: PushFileResult[] = [];
  let failed = 0;
  const onWarning = (w: Warning) => collectWarning(w.code, w.message, w.details);
  for (const file of target.files) {
    const stages: PushStage[] = [];
    const onStage = (s: PushStage) => stages.push(s);
    try {
      await pushOne(client, file, transport, opts, onStage, onWarning);
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
    // Aggregate exit code follows the category of the first failed file
    // (or PUSH_FAILED fallback); thrown so the unified renderer in the action
    // handles envelope + exit code (FR-011).
    const single = target.files.length === 1;
    const code = (single ? (results[0]?.code ?? 'PUSH_FAILED') : 'PUSH_FAILED') as ErrorCode;
    const firstFailed = results.find((r) => r.status === 'failed');
    const aggregateCode = (firstFailed?.code ?? code) as ErrorCode;
    throw new CliError(aggregateCode, `${failed} of ${target.files.length} file(s) failed`, {
      details: { results, failed },
      nextSteps: [
        "Inspect the failing file's `code` and `stage` fields.",
        'Fix the issue and re-run with --keep-going (default) or --fail-fast to stop earlier.',
      ],
      example: 'abap push src/foo.abap --tr NDK123456',
    });
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
  onWarning: (w: Warning) => void,
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

  if (resolved.objectType === 'FUGR') {
    await pushFugrOne(client, object, resolved, content, transport, opts, onStage, onWarning);
    return;
  }

  const parts = await getObjectParts(client, object);
  const part = parts.find((p) => p.subtype === resolved.subtype) ?? parts.find((p) => p.subtype === 'main');
  if (!part) {
    throw new CliError('SAP_ERROR', `No source part matches ${resolved.subtype} for ${object.name}`, { details: { object: object.name } });
  }

  await pushObject(
    client,
    object,
    [{ subtype: part.subtype, sourceUrl: part.sourceUrl, content }],
    { transport, checkOnly: opts.checkOnly ?? false, activate: opts.activate, dryRun: opts.dryRun, onStage, onWarning },
  );
}

/**
 * Push a single FUGR file. FUGR sub-objects (function modules, includes) are
 * independently locked ADT objects, so each file locks its own target object,
 * writes its source, then activates the enclosing function group.
 */
async function pushFugrOne(
  client: AdtClientWrapper,
  object: { name: string; type: string; objectUrl: string },
  resolved: { subtype: string },
  content: string,
  transport: string,
  opts: { checkOnly?: boolean; activate?: boolean; dryRun?: boolean },
  onStage: (s: PushStage) => void,
  onWarning: (w: Warning) => void,
): Promise<void> {
  const layout = await enumerateFugr(client, object.objectUrl);
  const target = fugrPushTargetFor(layout, resolved.subtype, object.objectUrl);
  if (!target) {
    throw new CliError('SAP_ERROR', `No source part matches ${resolved.subtype} for ${object.name}`, { details: { object: object.name } });
  }

  if (opts.dryRun) {
    onStage('lock');
    onStage('write');
    if (opts.checkOnly) onStage('check');
    else if (opts.activate !== false) onStage('activate');
    onStage('unlock');
    return;
  }

  let lockHandle: string | undefined;
  let locked = false;
  try {
    onStage('lock');
    const lock = await client.lock(target.objectUrl);
    lockHandle = lock.LOCK_HANDLE;
    locked = true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError('LOCK_FAILED', `Cannot lock ${object.name} (${resolved.subtype}): ${message}`, { details: { object: object.name } });
  }

  try {
    onStage('write');
    try {
      await client.setObjectSource(target.sourceUrl, content, lockHandle, transport);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError('SAP_ERROR', `Failed to write source of ${object.name} (${resolved.subtype}): ${message}`, {
        object: object.name,
        subtype: resolved.subtype,
        stage: 'write',
      });
    }

    if (opts.checkOnly) {
      const checkErrors: { line: number; severity: string; text: string }[] = [];
      if (content.trim() !== '') {
        const results = await client.syntaxCheckContent(target.sourceUrl, layout.saplUrl, content);
        for (const r of results) {
          if (r.severity === 'E') checkErrors.push({ line: r.line, severity: r.severity, text: r.text });
        }
      }
      if (checkErrors.length > 0) {
        throw new CliError('SYNTAX_ERROR', `Syntax check failed for ${object.name}`, {
          object: object.name,
          stage: 'check',
          errors: checkErrors,
        });
      }
      return;
    }

    if (opts.activate !== false) {
      onStage('activate');
      try {
        await client.activate(object.objectUrl, object.type, object.name);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new CliError('ACTIVATION_FAILED', `Activation failed for ${object.name}: ${message}`, {
          object: object.name,
          stage: 'activate',
          detail: message,
        });
      }
    }
  } finally {
    onStage('unlock');
    if (locked && lockHandle) {
      try {
        await client.unLock(target.objectUrl, lockHandle);
      } catch {
        onWarning({
          code: 'UNLOCK_WARNING',
          message: `Object ${object.name} was updated but the edit lock could not be released; release it manually in SE03`,
          details: { object: object.name, unlock: 'failed' },
        });
      }
    }
  }
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