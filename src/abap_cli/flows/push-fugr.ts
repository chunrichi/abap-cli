import { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError } from '../output/json.js';
import type { Warning } from '../output/meta.js';
import { enumerateFugr, fugrPushTargetFor } from '../formats/fugr-layout.js';
import type { PushStage } from './push-object.js';

interface FugrResolved {
  subtype: string;
}

/**
 * Push a single FUGR file. FUGR sub-objects (function modules, includes) are
 * independently locked ADT objects, so each file locks its own target object,
 * writes its source, then activates the enclosing function group.
 */
export async function pushFugrOne(
  client: AdtClientWrapper,
  object: { name: string; type: string; objectUrl: string },
  resolved: FugrResolved,
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
    throw new CliError('LOCK_FAILED', `Cannot lock ${object.name} (${resolved.subtype}): ${message}`, {
      details: { object: object.name, subtype: resolved.subtype },
      nextSteps: [
        `Check who holds the lock: abap inspect ${object.name} --locks`,
        'Wait for the lock to be released, or release it manually in SE03.',
      ],
      example: `abap inspect ${object.name} --locks`,
    });
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
