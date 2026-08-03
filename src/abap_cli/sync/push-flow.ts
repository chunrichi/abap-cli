import type { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError } from '../output/json.js';

export type PushStage = 'lock' | 'write' | 'check' | 'activate' | 'unlock';

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
  let unlockFailed = false;
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
    // Lock is always released; only surface UNLOCK_WARNING when nothing else failed
    if (locked && lockHandle) {
      opts.onStage?.('unlock');
      try {
        await client.unLock(object.objectUrl, lockHandle);
      } catch {
        unlockFailed = true;
      }
    }
  }
  if (unlockFailed) {
    throw new CliError(
      'UNLOCK_WARNING',
      `Object ${object.name} was updated but the edit lock could not be released; release it manually in SE03`,
      { object: object.name, unlock: 'failed' },
    );
  }
}
