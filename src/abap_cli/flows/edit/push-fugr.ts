import { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError } from '../../output/json.js';
import type { Warning } from '../../output/meta.js';
import {
  enumerateFugr,
  fugrPushTargetFor,
  requestedFunctionModuleFor,
} from '../../formats/fugr-layout.js';
import { toCanonicalFuncSource } from '../../formats/func-pseudo.js';
import type { PushStage } from './push-object.js';

interface FugrResolved {
  subtype: string;
}

/**
 * Push a single FUGR file. FUGR sub-objects (function modules, includes) are
 * independently locked ADT objects, so each file locks its own target
 * object, writes its source, then (for `.func`) verifies the parent group's
 * activation. As of T1.6, the post-write flow no longer trusts a single
 * `activate` call — it now uses `activateAll` for function modules and
 * verifies that the latest and active source match before declaring success.
 *
 * Lock targets:
 *   - `sapl<group>.reps`        → group object URL (function-pool main)
 *   - `l<group><...>.reps`     → include child URL (FXX / OXX / IXX / TOP)
 *   - `<fm>.func`              → FM child URL
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
  const requestedFunctionModule = requestedFunctionModuleFor(
    object.objectUrl,
    resolved.subtype,
  );
  const layout = await enumerateFugr(
    client,
    object.objectUrl,
    requestedFunctionModule,
  );
  const target = fugrPushTargetFor(layout, resolved.subtype, object.objectUrl);
  if (!target) {
    throw new CliError(
      'SAP_ERROR',
      `No source part matches ${resolved.subtype} for ${object.name}`,
      { details: { object: object.name } },
    );
  }

  const targetName = requestedFunctionModule?.name
    ?? layout.includes.find((include) => include.objectUrl === target.objectUrl)?.name
    ?? object.name;
  const targetContext = targetName === object.name ? '' : ` in function group ${object.name}`;

  // Normalize FUNC source to the canonical pseudo syntax before writing — the
  // SAP-native `*"~` comment form would round-trip, but the AFF canonical
  // form is what other tools (abapGit, our own diff) expect.
  const source = resolved.subtype.endsWith('.func')
    ? toCanonicalFuncSource(content, targetName)
    : content;

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
  let unlockWarningEmitted = false;
  const releaseLock = async (): Promise<boolean> => {
    if (!locked || !lockHandle) return true;
    onStage('unlock');
    try {
      await client.unLock(target.objectUrl, lockHandle);
      locked = false;
      return true;
    } catch {
      if (!unlockWarningEmitted) {
        unlockWarningEmitted = true;
        onWarning({
          code: 'UNLOCK_WARNING',
          message: `Object ${targetName}${targetContext} was updated but the edit lock could not be released; release it manually in SE03`,
          details: {
            object: targetName,
            parentObject: object.name,
            objectUrl: target.objectUrl,
            unlock: 'failed',
          },
        });
      }
      return false;
    }
  };
  try {
    onStage('lock');
    const lock = await client.lock(target.objectUrl);
    lockHandle = lock.LOCK_HANDLE;
    locked = true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(
      'LOCK_FAILED',
      `Cannot lock ${targetName}${targetContext} (${resolved.subtype}): ${message}`,
      {
        details: {
          object: targetName,
          parentObject: object.name,
          objectUrl: target.objectUrl,
          subtype: resolved.subtype,
        },
        nextSteps: [
          `Check who holds the lock for ${targetName}${targetContext}; the lock target is ${target.objectUrl}.`,
          'Wait for the lock to be released, or release it manually in SE03.',
        ],
        example: `abap inspect ${object.name} --locks`,
      },
    );
  }

  try {
    onStage('write');
    try {
      await client.setObjectSource(target.sourceUrl, source, lockHandle, transport);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError(
        'SAP_ERROR',
        `Failed to write source of ${targetName}${targetContext} (${resolved.subtype}): ${message}`,
        {
          object: targetName,
          parentObject: object.name,
          objectUrl: target.objectUrl,
          subtype: resolved.subtype,
          stage: 'write',
        },
      );
    }

    if (opts.checkOnly) {
      const checkErrors: { line: number; severity: string; text: string }[] = [];
      if (source.trim() !== '') {
        const results = await client.syntaxCheckContent(
          layout.saplUrl,
          target.sourceUrl,
          source,
        );
        for (const r of results) {
          if (r.severity === 'E') {
            checkErrors.push({ line: r.line, severity: r.severity, text: r.text });
          }
        }
      }
      if (checkErrors.length > 0) {
        throw new CliError(
          'SYNTAX_ERROR',
          `Syntax check failed for ${targetName}${targetContext}`,
          {
            object: targetName,
            parentObject: object.name,
            stage: 'check',
            errors: checkErrors,
          },
        );
      }
      return;
    }

    if (opts.activate !== false) {
      // SAP requires the edit session to be released before activation.
      if (!(await releaseLock())) {
        throw new CliError(
          'SAP_ERROR',
          `Cannot activate ${targetName}${targetContext}: the edit session could not be released`,
          {
            object: targetName,
            parentObject: object.name,
            stage: 'unlock',
          },
        );
      }

      const isFunc = resolved.subtype.endsWith('.func');
      if (isFunc && !requestedFunctionModule) {
        // `requestedFunctionModuleFor` is supposed to resolve a `.func`
        // subtype to a FUGR/FF child URI; if it failed the subtype string
        // is malformed and the upcoming `activateAll` call would crash on
        // the `!` assertion below. Fail early with a clear, actionable
        // message instead.
        throw new CliError(
          'SAP_ERROR',
          `Cannot resolve function module for ${object.name}/${resolved.subtype}`,
          {
            object: object.name,
            subtype: resolved.subtype,
            nextSteps: [
              'Verify the file name is `<name>.fugr.<fm>.func.abap` (lower-case fm, .func extension).',
              'Re-run `abap pull <group>` to refresh the local FUGR files.',
            ],
          },
        );
      }
      onStage('activate');
      try {
        // Function-module activation goes through `activateAll` on the FM
        // child (with parent URI = the group); non-FM pushes use the
        // existing single-object activate, which routes through the array
        // overload internally (see AdtClientWrapper#activate).
        const activation = isFunc
          ? await client.activateAll([
              {
                uri: target.objectUrl,
                type: 'FUGR/FF',
                name: requestedFunctionModule!.name,
                parentUri: object.objectUrl,
              },
            ])
          : await client.activate(object.objectUrl, object.type, object.name);
        // Only fail when the activation result explicitly reports failure.
        // Some ADT builds return void / an empty string when activation
        // succeeded; treat those as success.
        if (
          activation &&
          typeof activation === 'object' &&
          'success' in activation &&
          activation.success === false
        ) {
          const inactiveCount =
            'inactive' in activation && Array.isArray(activation.inactive)
              ? activation.inactive.length
              : 0;
          throw new CliError(
            'ACTIVATION_FAILED',
            `Activation did not complete for ${targetName}${targetContext}`,
            {
              object: targetName,
              parentObject: object.name,
              stage: 'activate',
              detail:
                inactiveCount > 0
                  ? `${inactiveCount} inactive item(s) remain`
                  : 'ADT reported an activation failure',
            },
          );
        }
      } catch (error: unknown) {
        if (error instanceof CliError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new CliError(
          'ACTIVATION_FAILED',
          `Activation failed for ${targetName}${targetContext}: ${message}`,
          {
            object: targetName,
            parentObject: object.name,
            stage: 'activate',
            detail: message,
          },
        );
      }

      // T1.6: post-activation verification — read latest and active sources
      // in parallel and ensure they match. A mismatch means SAP accepted the
      // activate call but did not actually commit the source.
      let latest: string;
      let active: string;
      try {
        [latest, active] = await Promise.all([
          client.getObjectSource(target.sourceUrl),
          client.getActiveObjectSource(target.sourceUrl),
        ]);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new CliError(
          'ACTIVATION_FAILED',
          `Activation completed but could not be verified for ${targetName}${targetContext}`,
          {
            object: targetName,
            parentObject: object.name,
            stage: 'activate',
            detail: message,
          },
        );
      }
      if (latest !== active) {
        throw new CliError(
          'ACTIVATION_FAILED',
          `Activation completed but active source is stale for ${targetName}${targetContext}`,
          {
            object: targetName,
            parentObject: object.name,
            stage: 'activate',
            detail: `${resolved.subtype} active source does not match latest source`,
          },
        );
      }
    }
  } finally {
    await releaseLock();
  }
}
