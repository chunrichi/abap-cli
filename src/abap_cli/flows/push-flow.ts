import * as path from 'path';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { IcfClient } from '../clients/icf-client.js';
import { CliError, toErrorShape } from '../output/json.js';
import { collectWarning, type Warning } from '../output/meta.js';
import type { ErrorCode } from '../output/error-codes.js';
import { resolveFile } from '../formats/file-resolver.js';
import { readAbapFile } from '../formats/abap-source.js';
import { resolveObject, getObjectParts, validateLocalFile, type ResolvedObject } from '../core/resolve.js';
import { resolveTransport } from '../core/transport.js';
import { resolveLocalTargets } from '../core/local-targets.js';
import { requireWriteConfirmation } from '../core/confirmation.js';
import { readDdicJson, localToWire, validateDdicObject, type DdicSupportedType } from '../dictionary/ddic-json.js';
import { readHttpJson, localToWire as httpLocalToWire, validateHttpObject } from '../dictionary/http-json.js';
import { pushObject, type PushStage } from './push-object.js';
import { pushFugrOne } from './push-fugr.js';
import { pushTextpoolFile } from './push-textpool.js';
import { getExtensionRegistry } from '../extensions/registry.js';
import { toRelativeOutputPath } from '../core/path-output.js';

/** Options for the file-level `abap push` orchestration (distinct from pushObject's PushOptions). */
export interface PushFileOptions {
  all?: boolean;
  tr?: string;
  checkOnly?: boolean;
  activate?: boolean;
  dryRun?: boolean;
  failFast?: boolean;
  atomic?: boolean;
  yes?: boolean;
}

export interface PushFileResult {
  file: string;
  status: 'activated' | 'checked-only' | 'written' | 'failed' | 'dry-run';
  transport?: string;
  code?: string;
  stage?: PushStage;
  errors?: unknown[];
  unlock?: string;
  detail?: string;
  /** Original failure message (aggregate reuses it for single-file runs). */
  message?: string;
  /** Original failure nextSteps (aggregate reuses them for single-file runs). */
  nextSteps?: string[];
  plan?: string[];
}

/** Flow outcome: JSON envelope data + human summary, printed by the command layer. */
export interface PushResult {
  data: Record<string, unknown>;
  human: string;
}

interface PushOneResult {
  /** Transport used for this file ('' when the object is transport-free). */
  transport: string;
  /** Status override for routes without the standard activate semantics (DDIC). */
  status?: PushFileResult['status'];
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

  // --atomic phase 1: structural validation of every file (NO content syntax
  // check — it establishes an SAP edit session that breaks the later activate,
  // per 008 real-SAP findings and research §11). Any failure → zero writes.
  if (opts.atomic) {
    const validationFailures: { file: string; code?: string; message: string }[] = [];
    for (const file of target.files) {
      try {
        const resolved = resolveFile(file);
        validateLocalFile(resolved);
        if (resolved.route === 'icf') {
          // 022: HTTP service uses its own JSON shape; route via the dedicated helper.
          if (resolved.objectType === 'HTTP') {
            const local = await readHttpJson(path.resolve(process.cwd(), file));
            const errors = validateHttpObject(local);
            if (errors.length > 0) throw new CliError('VALIDATION_ERROR', errors.join('; '));
          } else {
            // DDIC: structurally validate the JSON (readAbapFile only reads text).
            const local = await readDdicJson(path.resolve(process.cwd(), file));
            const errors = validateDdicObject(local, resolved.objectType);
            if (errors.length > 0) throw new CliError('VALIDATION_ERROR', errors.join('; '));
          }
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
      // ValidationRule hook: FR-002
      await getExtensionRegistry().runValidation('push', {
        command: 'push',
        argv: process.argv.slice(2),
        files: [file],
      });
      const { transport, status } = await pushOne(client, file, opts, onStage, onWarning);
      if (opts.dryRun) {
        results.push({ file, status: 'dry-run', plan: stages });
      } else {
        results.push({
          file,
          status: status ?? (opts.checkOnly ? 'checked-only' : (opts.activate === false ? 'written' : 'activated')),
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
        message: typeof err.message === 'string' ? err.message : undefined,
        nextSteps: Array.isArray(err.nextSteps) ? (err.nextSteps as string[]) : undefined,
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
    // Single-file runs surface the original failure (message + nextSteps) so the
    // cause is visible without unwrapping `details.results` (FR-011).
    const message = single && firstFailed?.message ? firstFailed.message : `${failed} of ${target.files.length} file(s) failed`;
    const nextSteps = single && firstFailed?.nextSteps ? firstFailed.nextSteps : undefined;
    throw new CliError(aggregateCode, message, {
      details: { results: results.map(normalizePushResult), failed },
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
          example: `abap push src/${object.name.toLowerCase()}.abap`,
        },
      );
    }
    return opts.tr;
  }

  if (bound) return bound;
  if (object.packageName === '$TMP') return '';
  return resolveTransport(client, opts.tr, client.getConfig().transport);
}

/** 014/022: push a .json file via the self-built ICF service.
 *  DDIC types (DOMA/DTEL/TABL/STRU) → POST /ddic/<type>.
 *  HTTP service (022)              → POST /http/<name>.
 */
async function pushDdicFile(
  client: AdtClientWrapper,
  resolved: { objectName: string; objectType: string },
  file: string,
  opts: PushFileOptions,
  onStage: (s: PushStage) => void,
): Promise<PushOneResult> {
  if (opts.checkOnly) {
    throw new CliError('VALIDATION_ERROR', '--check-only is not supported for ICF-routed JSON files', {
      nextSteps: ['DDIC/HTTP files are validated during push; drop --check-only.'],
    });
  }
  onStage('ddic-icf');
  if (opts.dryRun) {
    return { transport: opts.tr ?? client.getConfig().transport ?? 'DRY_RUN', status: 'dry-run' };
  }

  // 022: HTTP service has its own wire format; route via the dedicated helper.
  if (resolved.objectType === 'HTTP') {
    return pushHttpFile(client, resolved, file, opts);
  }

  let local: { name: string; package?: string; transportRequest?: string; [key: string]: unknown };
  try {
    local = await readDdicJson(path.resolve(process.cwd(), file));
  } catch (error: unknown) {
    const m = error instanceof Error ? error.message : String(error);
    const outFile = toRelativeOutputPath(file);
    throw new CliError('INVALID_ARGUMENT', `Cannot read DDIC file ${outFile}: ${m}`, { file: outFile });
  }
  const type = resolved.objectType as DdicSupportedType;
  const errors = validateDdicObject(local, type);
  if (errors.length > 0) {
    const outFile = toRelativeOutputPath(file);
    throw new CliError('VALIDATION_ERROR', `Invalid ${type} definition in ${outFile}: ${errors.join('; ')}`, {
      file: outFile,
      type,
      object: resolved.objectName,
      details: errors,
    });
  }

  const wire = localToWire(type, local);
  // Transport: --tr > config > file's recorded request > ($TMP → none) > user's open request.
  const packageName = (wire.package ?? '').toUpperCase();
  let transport = opts.tr ?? client.getConfig().transport ?? local.transportRequest ?? '';
  if (!transport && packageName !== '$TMP') {
    transport = await resolveTransport(client, opts.tr, client.getConfig().transport);
  }
  wire.transportRequest = transport || undefined;

  const icf = await IcfClient.create();
  const resp = await icf.postDdic<{ name: string; type: string; action: 'created' | 'updated' }>(type.toLowerCase(), wire);
  if (resp.status !== 'success' || !resp.data) {
    const code = (resp.error?.code ?? 'DDIC_CREATE_FAILED') as ErrorCode;
    throw new CliError(code, resp.error?.message ?? `Failed to push ${type} ${resolved.objectName}`, {
      object: resolved.objectName,
      type,
      details: resp.error?.details,
      nextSteps: [
        'Verify the file conforms to the abap-file-format JSON schema.',
        'Re-run after fixing the cause above.',
      ],
    });
  }
  return { transport, status: 'written' };
}

/**
 * 022: push a HTTP service .json file via ICF POST /http/<name>.
 * The SAP-side handler creates/updates a SICF node with the given handler class + URL.
 */
async function pushHttpFile(
  client: AdtClientWrapper,
  resolved: { objectName: string; objectType: string },
  file: string,
  opts: PushFileOptions,
): Promise<PushOneResult> {
  let local: { name: string; package?: string; transportRequest?: string; [key: string]: unknown };
  try {
    local = await readHttpJson(path.resolve(process.cwd(), file));
  } catch (error: unknown) {
    const m = error instanceof Error ? error.message : String(error);
    const outFile = toRelativeOutputPath(file);
    throw new CliError('INVALID_ARGUMENT', `Cannot read HTTP service file ${outFile}: ${m}`, { file: outFile });
  }
  const errors = validateHttpObject(local);
  if (errors.length > 0) {
    const outFile = toRelativeOutputPath(file);
    throw new CliError('VALIDATION_ERROR', `Invalid HTTP service definition in ${outFile}: ${errors.join('; ')}`, {
      file: outFile,
      type: 'HTTP',
      object: resolved.objectName,
      details: errors,
    });
  }

  const wire = httpLocalToWire(local);
  // Transport: --tr > config > file's recorded request > ($TMP → none) > user's open request.
  const packageName = (wire.package ?? '').toUpperCase();
  let transport = opts.tr ?? client.getConfig().transport ?? local.transportRequest ?? '';
  if (!transport && packageName !== '$TMP') {
    transport = await resolveTransport(client, opts.tr, client.getConfig().transport);
  }
  wire.transportRequest = transport || undefined;

  const icf = await IcfClient.create();
  const resp = await icf.postHttp<{ name: string; type: string; action: 'created' | 'updated' }>(resolved.objectName, wire);
  if (resp.status !== 'success' || !resp.data) {
    const code = (resp.error?.code ?? 'HTTP_CREATE_FAILED') as ErrorCode;
    throw new CliError(code, resp.error?.message ?? `Failed to push HTTP service ${resolved.objectName}`, {
      object: resolved.objectName,
      type: 'HTTP',
      details: resp.error?.details,
      nextSteps: [
        'Verify the file conforms to the abap-file-format HTTP service JSON schema.',
        'Re-run after fixing the cause above.',
      ],
    });
  }
  return { transport, status: 'written' };
}

async function pushOne(
  client: AdtClientWrapper,
  file: string,
  opts: PushFileOptions,
  onStage: (s: PushStage) => void,
  onWarning: (w: Warning) => void,
): Promise<PushOneResult> {
  let resolved;
  try {
    resolved = resolveFile(file);
  } catch (error: unknown) {
    const outFile = toRelativeOutputPath(file);
    throw new CliError('FILE_PARSE_ERROR', `Cannot parse ${outFile}: ${message(error)}`, { details: { file: outFile } });
  }
  validateLocalFile(resolved);

  // 014: textpool .properties files route via ADT/ICF (mixed mode, cache-decided).
  if (resolved.route === 'textpool') {
    await pushTextpoolFile(client, resolved, file, opts, onStage);
    return { transport: opts.tr ?? client.getConfig().transport ?? '' };
  }

  // 014: DDIC .json files (DOMA/DTEL/TABL/STRU) push via ICF /ddic/<type>.
  if (resolved.route === 'icf') {
    return pushDdicFile(client, resolved, file, opts, onStage);
  }

  let content: string;
  try {
    content = await readAbapFile(file);
  } catch (error: unknown) {
    const outFile = toRelativeOutputPath(file);
    throw new CliError('FILE_PARSE_ERROR', `Cannot read ${outFile}: ${message(error)}`, { details: { file: outFile } });
  }

  const object = await resolveObject(client, resolved.objectName, resolved.objectType);
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
