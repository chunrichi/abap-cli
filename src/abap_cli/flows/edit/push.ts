/**
 * `abap push` flow coordinator.
 *
 * Orchestrates a batch of local files: resolve targets, validate, resolve the
 * transport per object, then hand each file to its route. The routes live in
 * `routing.ts`:
 *
 *   source-kind types    → generic ABAP-source push (this file)
 *   icf-json artifact    → `push-icf.ts` (DDIC / HTTP / TRAN / ENQU)
 *   aff-json artifact    → per-type flows (TTYP / MSAG / DDLS / NROB)
 *   textpool `.properties` → `push-textpool.ts` (mixed ADT/ICF route)
 *
 * `push` is file-driven, not type-driven: the local file layout decides how it
 * is read, so the coordinator resolves the file first and looks the object type
 * up in the routing table.
 */
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError, toErrorShape } from '../../output/json.js';
import { collectWarning, type Warning } from '../../output/meta.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { affObjectToken, resolveFile, type ResolvedFile } from '../../formats/file-resolver.js';
import { readAbapFile } from '../../formats/abap-source.js';
import { resolveObject, getObjectParts, validateLocalFile, type ResolvedObject } from '../../core/resolve.js';
import { resolveTransport } from '../../core/transport.js';
import { resolveLocalTargets } from '../../core/local-targets.js';
import { requireWriteConfirmation } from '../../core/confirmation.js';
import { pushObject, type PushStage } from './push-object.js';
import { pushFugrOne } from './push-fugr.js';
import { pushTextpoolFile } from './push-textpool.js';
import { orderTargetsByDependency } from './push-order.js';
import { deduplicateTablArtifactTargets } from './push-dedup.js';
import { toRelativeOutputPath } from '../../core/path-output.js';
import { pushRouteFor } from './routing.js';
import { isDocuSupportedType } from '../../formats/docu/json.js';
import { hasDocuCompanion } from './docu-companion.js';
import { pushUnsupportedReasonFor } from '../../types/registry.js';
import type { PushFileOptions, PushFileResult, PushOneResult } from './push-types.js';

/**
 * Read-only types (currently DEVC) own a local artifact but have no ADT write
 * endpoint. Reject with the registry's reason instead of falling through to the
 * generic ABAP-source path, which would try to read the artifact as source.
 */
function rejectUnsupportedPushType(objectType: string): void {
  const reason = pushUnsupportedReasonFor(objectType);
  if (!reason) return;
  throw new CliError('TYPE_NOT_SUPPORTED', `Cannot push ${objectType} changes: ${reason}`, {
    type: objectType,
    nextSteps: [
      `Type ${objectType} is read-only in abap-cli; edit the object in SAP GUI if supported there.`,
      'Re-create the object instead: pull, edit, `abap delete`, `abap create`.',
    ],
  });
}

/**
 * `src/zmy.doma.docu.json` is a long-text companion, not an object document:
 * it has no `name` / `format` / `fields`, so running it through the object
 * route would fail confusingly. The companion is pushed automatically by its
 * main document's push, so reject the direct target with that pointer.
 */
function rejectDocuCompanionTarget(resolved: ResolvedFile): void {
  if (resolved.subtype !== 'docu' || !isDocuSupportedType(resolved.objectType)) return;
  const outFile = toRelativeOutputPath(resolved.filePath);
  const mainFile = outFile.replace(/\.docu\.json$/, `.${resolved.objectType.toLowerCase()}.json`);
  throw new CliError('INVALID_ARGUMENT', `${outFile} is a long-text companion; push its main document instead`, {
    file: outFile,
    type: resolved.objectType,
    nextSteps: [
      `Push ${mainFile}; a sibling <name>.<type>.docu.json is sent automatically.`,
      'Delete the companion file to leave the SAP-side long text unchanged.',
    ],
    example: `abap push ${mainFile}`,
  });
}

/** Flow outcome: JSON envelope data + human summary, printed by the command layer. */
export interface PushResult {
  data: Record<string, unknown>;
  human: string;
}

/** Orchestrate `abap push` across files: validate targets, resolve transport, push each file. */
export async function runPush(files: string[], opts: PushFileOptions): Promise<PushResult> {
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
  requireWriteConfirmation(
    'abap push',
    { ...opts, supportsDryRun: true },
    'abap push <files...> --tr <transport> --yes',
  );
  const target = await resolveLocalTargets({ files: files.length > 0 ? files : undefined, all: opts.all });
  if (target.files.length === 0) {
    throw new CliError('USAGE', 'Specify files or use --all', {
      nextSteps: ["Provide one or more file paths: abap push src/foo.abap src/bar.abap --tr NDK123456", "Or use --all with a .abapignore at the workspace root."],
      example: 'abap push src/foo.abap --tr NDK123456',
    });
  }
  // collapse TABL/STRU artifact groups (`.tabl.json` + `.tabl.ddic` [
  // `.tabl.settings.json`]) to a single canonical file so --all does not push
  // the same object three times. Runs before the dependency sort so the
  // canonical (priority 30) wins over the sidecar path.
  target.files = deduplicateTablArtifactTargets(target.files);

  // dependency order so DDIC prerequisites push before the objects that
  // reference them (DOMA → DTEL → TABL → ... → HTTP). Stable for same priority.
  target.files = orderTargetsByDependency(target.files);

  // --atomic: structural validation of every file (NO content syntax
  // check — it establishes an SAP edit session that breaks the later activate,
  // per real-SAP findings). Any failure → zero writes.
  if (opts.atomic) {
    const validationFailures: { file: string; code?: string; message: string }[] = [];
    for (const file of target.files) {
      try {
        const resolved = resolveFile(file);
        validateLocalFile(resolved);
        rejectDocuCompanionTarget(resolved);
        rejectUnsupportedPushType(resolved.objectType);
        const route = pushRouteFor(resolved.objectType);
        if (route && route.kind !== 'source') {
          // Artifact routes own their validators (DDIC / HTTP / TRAN / AFF
          // dual-channel types); the ABAP-source path only needs to be readable.
          await route.validate(file, resolved.objectType);
        } else {
          await readAbapFile(file);
        }
      } catch (error: unknown) {
        const err = toErrorShape(error);
        validationFailures.push({ file: toRelativeOutputPath(file), code: err.code as string, message: err.message as string });
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
  const results: PushFileResult[] = [];
  let failed = 0;
  const onWarning = (w: Warning) => collectWarning(w.code, w.message, w.details);
  for (const file of target.files) {
    const stages: PushStage[] = [];
    const onStage = (s: PushStage) => stages.push(s);
    try {
      const { transport, status, docu } = await pushOne(client, file, opts, onStage, onWarning);
      if (opts.dryRun) {
        results.push({ file, status: 'dry-run', plan: stages, written: false, activated: false, ...(docu ? { docu } : {}) });
      } else {
        const resolvedStatus =
          status ?? (opts.checkOnly ? 'checked-only' : (opts.activate === false ? 'written' : 'activated'));
        results.push({
          file,
          status: resolvedStatus,
          transport,
          stage: stages[stages.length - 1],
          written: !opts.checkOnly,
          activated: resolvedStatus === 'activated',
          ...(docu ? { docu } : {}),
        });
      }
      if (opts.failFast && failed > 0) break;
    } catch (error: unknown) {
      failed++;
      const err = toErrorShape(error);
      const details = (err.details ?? {}) as Record<string, unknown>;
      results.push({
        file,
        status: 'failed',
        code: err.code,
        message: typeof err.message === 'string' ? err.message : undefined,
        nextSteps: Array.isArray(err.nextSteps) ? (err.nextSteps as string[]) : undefined,
        stage: (typeof err.stage === 'string' ? err.stage : stages[stages.length - 1]) as PushStage | undefined,
        errors: Array.isArray(err.errors) ? err.errors : undefined,
        unlock: typeof err.unlock === 'string' ? err.unlock : undefined,
        detail: typeof err.detail === 'string' ? err.detail : undefined,
        // Distinguish "never reached SAP" from "written but left inactive".
        written: typeof details.written === 'boolean' ? details.written : err.code === 'ACTIVATION_FAILED',
        activated: false,
        lineScope: typeof details.lineScope === 'string' ? details.lineScope : undefined,
        messages: Array.isArray(details.messages) ? details.messages : undefined,
      });
      if (opts.failFast) break;
    }
  }

  if (failed > 0) {
    // Aggregate exit code follows the category of the first failed file
    // (or PUSH_FAILED fallback); thrown so the unified renderer in the action
    // handles envelope + exit code.
    const single = target.files.length === 1;
    const code = (single ? (results[0]?.code ?? 'PUSH_FAILED') : 'PUSH_FAILED') as ErrorCode;
    const firstFailed = results.find((r) => r.status === 'failed');
    const aggregateCode = (firstFailed?.code ?? code) as ErrorCode;
    // Single-file runs surface the original failure (message + nextSteps) so the
    // cause is visible without unwrapping `details.results`.
    const message = single && firstFailed?.message ? firstFailed.message : `${failed} of ${target.files.length} file(s) failed`;
    const nextSteps = single && firstFailed?.nextSteps ? firstFailed.nextSteps : undefined;
    throw new CliError(aggregateCode, message, {
      details: {
        results: results.map(normalizePushResult),
        failed,
        // Lift the per-file activation context so single-file consumers do not
        // have to unwrap `details.results` (F-05 / F-08).
        ...(firstFailed?.written !== undefined ? { written: firstFailed.written } : {}),
        ...(firstFailed?.activated !== undefined ? { activated: firstFailed.activated } : {}),
        ...(firstFailed?.lineScope ? { lineScope: firstFailed.lineScope } : {}),
        ...(firstFailed?.messages ? { messages: firstFailed.messages } : {}),
      },
      nextSteps: nextSteps ?? [
        "Inspect the failing file's `code` and `stage` fields.",
        'Fix the issue and re-run with --keep-going (default) or --fail-fast to stop earlier.',
      ],
      example: 'abap push src/foo.abap --tr NDK123456',
    });
  }

  return {
    data: opts.dryRun
      ? { dryRun: true, results: results.map(normalizePushResult) }
      : { results: results.map(normalizePushResult), failed },
    human: humanSummary(results),
  };
}

/** Normalize a PushFileResult path to a cwd-relative POSIX form (P0).
 *  `r.file` is an absolute host-native path from resolveLocalTargets; the
 *  agent contract wants a stable relative path that reads the same on every
 *  platform. */
function normalizePushResult(r: PushFileResult): PushFileResult {
  return { ...r, file: toRelativeOutputPath(r.file) };
}

/**
 * Resolve the transport for one object:
 * - an object already assigned to a request reuses it — push must NOT change it
 * - explicit --tr is honored only when it matches the binding or the object is unbound
 * - $TMP objects are transport-free (no request needed)
 * - otherwise: --tr > config > user's first modifiable request > NO_TRANSPORT
 */
async function resolveObjectTransport(
  client: AdtClientWrapper,
  opts: PushFileOptions,
  object: ResolvedObject,
): Promise<string> {
  if (opts.dryRun) {
    return opts.tr ?? client.getConfig().transport ?? 'DRY_RUN';
  }

  // FR-1: $TMP objects are transport-free — an explicit --tr is ignored
  // (warn instead of silently dropping, so agents don't assume it applied).
  // Checked before transportInfo so $TMP objects skip the bound-request lookup.
  if (object.packageName === '$TMP') {
    if (opts.tr) {
      collectWarning('PUSH_TR_IGNORED_TMP', `$TMP object ${object.name} is transport-free; ignoring --tr ${opts.tr}`, {
        object: object.name,
        tr: opts.tr,
      });
    }
    return '';
  }

  // Which request already owns this object (read-only, best-effort)?
  let bound: string | undefined;
  try {
    const info = await client.transportInfo(object.objectUrl);
    bound = info.TRANSPORTS?.[0]?.TRKORR;
  } catch {
    // transportInfo is best-effort; fall through to normal resolution.
  }

  if (opts.tr) {
    if (bound && bound !== opts.tr) {
      throw new CliError(
        'VALIDATION_ERROR',
        `Object ${object.name} is already assigned to transport ${bound}; cannot push under ${opts.tr}`,
        {
          object: object.name,
          bound,
          requested: opts.tr,
          nextSteps: [
            `Re-run without --tr to push into the object's request (${bound}).`,
            `Or move the object first: abap transport assign ${object.name} ${opts.tr}`,
          ],
          example: `abap push src/${affObjectToken(object.name)}.${object.type.split('/')[0]!.toLowerCase()}.abap`,
        },
      );
    }
    return opts.tr;
  }

  if (bound) return bound;
  return resolveTransport(client, opts.tr, client.getConfig().transport);
}

/**
 * Dispatch one file: textpool → routing table (ICF / AFF artifact) → generic
 * ADT source-object path.
 */
async function pushOne(
  client: AdtClientWrapper,
  file: string,
  opts: PushFileOptions,
  onStage: (s: PushStage) => void,
  onWarning: (w: Warning) => void,
): Promise<PushOneResult> {
  let resolved: ResolvedFile;
  try {
    resolved = resolveFile(file);
  } catch (error: unknown) {
    const outFile = toRelativeOutputPath(file);
    throw new CliError('FILE_PARSE_ERROR', `Cannot parse ${outFile}: ${message(error)}`, { details: { file: outFile } });
  }
  validateLocalFile(resolved);
  rejectDocuCompanionTarget(resolved);
  rejectUnsupportedPushType(resolved.objectType);

  // Textpool .properties files route via ADT/ICF (mixed mode, cache-decided).
  if (resolved.route === 'textpool') {
    await pushTextpoolFile(client, resolved, file, opts, onStage);
    return { transport: opts.tr ?? client.getConfig().transport ?? '' };
  }

  // Artifact routes (AFF `.json`): ICF JSON documents and channel-routed
  // dual-channel types. The routing table owns the per-type handlers and
  // validators, so there is no per-type branching here.
  const route = pushRouteFor(resolved.objectType);
  if (route && route.kind !== 'source') {
    // Guard once for every artifact route instead of inside each handler. Both
    // flags are meaningless before the write (validation is part of the push).
    if (opts.checkOnly) {
      throw new CliError('VALIDATION_ERROR', '--check-only is not supported for AFF JSON artifact files', {
        nextSteps: ['DDIC/HTTP/TRAN/TTYP/MSAG/DDLS/ENQU/NROB files are validated during push; drop --check-only.'],
      });
    }
    if (opts.dryRun) {
      onStage('ddic-icf');
      // DOMA/DTEL long text is a second ICF call, so it shows up in the plan.
      if (await hasDocuCompanion(file, resolved.objectType)) onStage('docu-icf');
      return { transport: opts.tr ?? client.getConfig().transport ?? 'DRY_RUN', status: 'dry-run' };
    }
    if (route.kind === 'icf-json') onStage('ddic-icf');
    const result = await route.run({ client, resolved, file, opts });
    if (route.kind === 'aff-json') {
      onStage(result.channel === 'adt' ? 'channel-adt' : 'channel-icf');
    }
    return result;
  }

  return pushSourceFile(client, resolved, file, opts, onStage, onWarning);
}

/**
 * Generic ABAP-source push: resolve the ADT object, map the file to a source
 * part, write it and activate. Also the fallback for files whose object type is
 * not in the routing table (e.g. an ADT type pulled from an older release).
 */
async function pushSourceFile(
  client: AdtClientWrapper,
  resolved: ResolvedFile,
  file: string,
  opts: PushFileOptions,
  onStage: (s: PushStage) => void,
  onWarning: (w: Warning) => void,
): Promise<PushOneResult> {
  let content: string;
  try {
    content = await readAbapFile(file);
  } catch (error: unknown) {
    const outFile = toRelativeOutputPath(file);
    throw new CliError('FILE_PARSE_ERROR', `Cannot read ${outFile}: ${message(error)}`, { details: { file: outFile } });
  }

  // a missing ADT object must not silently fall through to a write that
  // creates it — surface OBJECT_NOT_FOUND with a `create` pointer.
  let object: ResolvedObject;
  try {
    object = await resolveObject(client, resolved.objectName, resolved.objectType);
  } catch (error: unknown) {
    if (error instanceof CliError && error.code === 'OBJECT_NOT_FOUND') {
      throw new CliError('OBJECT_NOT_FOUND', error.message, {
        object: resolved.objectName,
        type: resolved.objectType,
        nextSteps: [
          ...(Array.isArray(error.nextSteps) ? (error.nextSteps as string[]) : []),
          `Create it first: abap create ${resolved.objectType} ${resolved.objectName} --package <package> --description "<desc>"`,
        ],
        example: `abap create ${resolved.objectType} ${resolved.objectName} --package <package> --description "<desc>"`,
      });
    }
    throw error;
  }
  const transport = await resolveObjectTransport(client, opts, object);

  if (resolved.objectType === 'FUGR') {
    await pushFugrOne(client, object, resolved, content, transport, opts, onStage, onWarning);
    return { transport };
  }

  const parts = await getObjectParts(client, object);
  // Only the object's main file may map to `main`; a named include (definitions,
  // implementations, macros, …) must match exactly or the push fails instead of
  // silently writing its content into the main source.
  const part = resolved.subtype === 'main'
    ? parts.find((p) => p.subtype === 'main')
    : parts.find((p) => p.subtype === resolved.subtype);
  if (!part) {
    throw new CliError('SAP_ERROR', `No source part matches ${resolved.subtype} for ${object.name}`, {
      details: { object: object.name, subtype: resolved.subtype },
      nextSteps: [
        `The object ${object.name} has no '${resolved.subtype}' include.`,
        `List the available includes: abap inspect ${object.name} --includes`,
      ],
      example: `abap inspect ${object.name} --includes`,
    });
  }

  await pushObject(
    client,
    object,
    [{ subtype: part.subtype, sourceUrl: part.sourceUrl, content }],
    { transport, checkOnly: opts.checkOnly ?? false, activate: opts.activate, dryRun: opts.dryRun, onStage, onWarning },
  );
  return { transport };
}

function humanSummary(results: PushFileResult[]): string {
  const lines = [`Pushed ${results.length} file(s):`];
  for (const r of results) {
    const tr = r.transport ? ` (${r.transport})` : '';
    const plan = r.plan ? ` [${r.plan.join(' → ')}]` : '';
    lines.push(`  ${toRelativeOutputPath(r.file)} → ${r.status}${tr}${plan}`);
  }
  return lines.join('\n');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
