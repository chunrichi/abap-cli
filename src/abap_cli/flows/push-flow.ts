import { AdtClientWrapper } from '../clients/adt-client.js';
import { IcfClient } from '../clients/icf-client.js';
import { CliError, toErrorShape } from '../output/json.js';
import { collectWarning, type Warning } from '../output/meta.js';
import type { ErrorCode } from '../output/error-codes.js';
import { resolveFile } from '../formats/file-resolver.js';
import { readAbapFile } from '../formats/abap-source.js';
import { parseTextpoolProperties, textpoolCategoryFromExtension } from '../formats/textpool.js';
import { routeTextpool } from '../textpool/textpool-router.js';
import { resolveObject, getObjectParts, validateLocalFile } from './resolve.js';
import { resolveTransport } from './transport.js';
import { resolveLocalTargets } from './local-targets.js';
import { enumerateFugr, fugrPushTargetFor } from '../formats/fugr-layout.js';

export type PushStage =
  | 'lock'
  | 'write'
  | 'check'
  | 'activate'
  | 'unlock'
  // 014 textpool stages (mixed-mode route).
  | 'read'
  | 'textpool-adt'
  | 'textpool-icf';

export interface PushPart {
  subtype: string;
  sourceUrl: string;
  content: string;
}

export interface PushObject {
  name: string;
  type: string;
  objectUrl: string;
}

export interface PushOptions {
  transport: string;
  /** Stop after the syntax check; do not activate. */
  checkOnly: boolean;
  /** Write source but skip activation (used by `abap create --no-activate`). Defaults to true. */
  activate?: boolean;
  /** Plan only — record stages without making mutating ADT calls (FR-012). */
  dryRun?: boolean;
  /** Per-stage callback for --json result reporting (FR-016). */
  onStage?: (stage: PushStage) => void;
  /** Non-fatal warning (e.g. unlock failed after a successful push) — US-5. */
  onWarning?: (warning: Warning) => void;
}

/**
 * Execute lock → set source → syntax check → (activate) → unlock for one object.
 * The lock is always released in a finally block; a failed unlock surfaces as
 * UNLOCK_WARNING on the success path (contracts/cli-commands.md FR-007).
 */
export async function pushObject(
  client: AdtClientWrapper,
  object: PushObject,
  parts: PushPart[],
  opts: PushOptions,
): Promise<void> {
  // Dry-run: record every stage, perform no mutating calls (FR-012).
  if (opts.dryRun) {
    opts.onStage?.('lock');
    for (const part of parts) opts.onStage?.('write');
    opts.onStage?.('check');
    if (!opts.checkOnly && opts.activate !== false) opts.onStage?.('activate');
    opts.onStage?.('unlock');
    return;
  }

  let lockHandle: string | undefined;
  let locked = false;
  try {
    opts.onStage?.('lock');
    const lock = await client.lock(object.objectUrl);
    lockHandle = lock.LOCK_HANDLE;
    locked = true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError('LOCK_FAILED', `Cannot lock ${object.name}: ${message}`, { details: { object: object.name } });
  }

  try {
    // Write each part's source (locked)
    for (const part of parts) {
      try {
        await client.setObjectSource(part.sourceUrl, part.content, lockHandle, opts.transport);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new CliError('SAP_ERROR', `Failed to write source of ${object.name} (${part.subtype}): ${message}`, {
          object: object.name,
          subtype: part.subtype,
          stage: 'write',
        });
      }
    }

    const mainPart = parts.find((p) => p.subtype === 'main');

    // In check-only mode: verify via content-based syntax check, then stop.
    // In full mode: skip it — a content check establishes an edit session on the
    // object in real SAP, which makes the subsequent activate fail with
    // "currently editing". Activation itself performs a complete syntax check.
    if (opts.checkOnly) {
      const checkErrors: { line: number; offset: number; severity: string; text: string; uri: string }[] = [];
      for (const part of parts) {
        if (part.content.trim() === '') continue;
        const mainUrl = mainPart?.sourceUrl ?? part.sourceUrl;
        const results = await client.syntaxCheckContent(part.sourceUrl, mainUrl, part.content);
        for (const r of results) {
          if (r.severity === 'E') checkErrors.push({ line: r.line, offset: r.offset, severity: r.severity, text: r.text, uri: r.uri });
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

    // Write-only mode (create --no-activate): persist source, skip activation.
    if (opts.activate === false) {
      return;
    }

    // Activate — performs a complete syntax check server-side
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
  } finally {
    // Lock is always released on every completion path (check-only, write-only,
    // activate); a failed unlock is a non-fatal UNLOCK_WARNING, never an error.
    if (locked && lockHandle) {
      opts.onStage?.('unlock');
      try {
        await client.unLock(object.objectUrl, lockHandle);
      } catch {
        opts.onWarning?.({
          code: 'UNLOCK_WARNING',
          message: `Object ${object.name} was updated but the edit lock could not be released; release it manually in SE03`,
          details: { object: object.name, unlock: 'failed' },
        });
      }
    }
  }
}

/** Options for the file-level `abap push` orchestration (distinct from pushObject's PushOptions). */
export interface PushFileOptions {
  all?: boolean;
  tr?: string;
  checkOnly?: boolean;
  activate?: boolean;
  dryRun?: boolean;
  failFast?: boolean;
  atomic?: boolean;
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
  plan?: string[];
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

  return {
    data: opts.dryRun ? { dryRun: true, results } : { results, failed },
    human: humanSummary(results),
  };
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

  // 014: textpool .properties files route via ADT/ICF (mixed mode, cache-decided).
  if (resolved.route === 'textpool') {
    await pushTextpoolFile(client, resolved, file, opts, onStage);
    return;
  }

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
 * 014: push a single textpool .properties file via the mixed-mode route
 * (ADT text-elements API when the cached capability allows, otherwise the
 * self-built ICF /textpool endpoint). Route is decided from the recorded
 * profile — no runtime fallback (Q1).
 */
async function pushTextpoolFile(
  client: AdtClientWrapper,
  resolved: { objectName: string; objectType: string; subtype: string },
  file: string,
  opts: { checkOnly?: boolean; activate?: boolean; dryRun?: boolean },
  onStage: (s: PushStage) => void,
): Promise<void> {
  if (opts.checkOnly) {
    throw new CliError('VALIDATION_ERROR', '--check-only is not supported for textpool files', {
      nextSteps: ['Textpool files are validated during push; drop --check-only.'],
    });
  }
  onStage('read');
  let content: string;
  try {
    content = await readAbapFile(file);
  } catch (error: unknown) {
    throw new CliError('FILE_PARSE_ERROR', `Cannot read ${file}: ${message(error)}`, { details: { file } });
  }

  // subtype looks like "texts.en" → file category = first segment.
  // Validate it via textpoolCategoryFromExtension (throws on unknown) then keep
  // both the file name ('texts') and the ADT name ('symbols').
  const rawFileCat = resolved.subtype.split('.')[0] ?? '';
  const adtCat = textpoolCategoryFromExtension(rawFileCat);
  const fileCat = rawFileCat as 'texts' | 'selections' | 'headings';

  // Mixed-mode route: read the cached capability and pick ADT/ICF directly.
  const { loadConfig } = await import('../config/project-config.js');
  const cfg = await loadConfig();
  const route = routeTextpool(cfg.systemName, 'write');
  onStage(route === 'adt' ? 'textpool-adt' : 'textpool-icf');

  if (opts.dryRun) return; // plan only — no mutating call

  if (route === 'adt') {
    const elements = parseTextpoolProperties(fileCat, content);
    const lock = await client.lock(`/sap/bc/adt/textelements/programs/${resolved.objectName.toLowerCase()}`);
    try {
      await client.setTextElements(resolved.objectType, resolved.objectName, adtCat, elements, lock.LOCK_HANDLE ?? '', cfg.transport || undefined);
    } finally {
      try {
        await client.unLock(`/sap/bc/adt/textelements/programs/${resolved.objectName.toLowerCase()}`, lock.LOCK_HANDLE ?? '');
      } catch {
        // best-effort unlock; warning surfaces separately
      }
    }
    return;
  }

  // ICF route: POST /textpool/<category>?object=<name>&type=<type>
  // (the endpoint uses the .properties file category name: texts|selections|headings)
  const elements = parseTextpoolProperties(fileCat, content);
  const icf = await IcfClient.create();
  const resp = await icf.postTextpool<{ written?: number }>(fileCat, resolved.objectName, resolved.objectType, { elements });
  if (resp.status !== 'success') {
    throw new CliError((resp.error?.code as ErrorCode | undefined) ?? 'SAP_ERROR', resp.error?.message ?? 'textpool write failed');
  }
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
