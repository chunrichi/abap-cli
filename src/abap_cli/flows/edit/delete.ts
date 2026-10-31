/**
 * `abap delete` flow coordinator.
 *
 * Deletes an ABAP object from SAP (read-only counterpart: `abap pull`).
 * Always goes through lock → delete → unlock so an ADT lock is never left
 * behind even when delete itself fails (feedback: `delete` was a
 * completely missing capability, forcing users to leave probe classes
 * behind in the system; this flow provides that capability with a
 * single explicit confirm gate).
 *
 * Supported types: anything reachable by `client.deleteObject` (CLAS, INTF,
 * PROG, FUGR, FUGR/FF, TABL, STRU, DOMA, DTEL, MSAG, TTYP, DDLS, DDLX, BDEF,
 * DCLS, SRVD, SRVB, HTTP, ENQU, NROB). DEVC takes the dedicated package branch
 * (`delete-devc.ts` — packages are deleted without a lock). CDSV views and
 * similar type codes without an ADT delete endpoint surface as
 * `TYPE_NOT_SUPPORTED`.
 */
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError } from '../../output/json.js';
import { resolveObject } from '../../core/resolve.js';
import { normalizeTypeInput } from '../../cli/type-alias.js';
import { runDeleteDevc } from './delete-devc.js';

export interface DeleteOptions {
  /** Object type code (CLAS / PROG / ...). Required — `delete` without a type
   *  is rejected by the command layer to keep the operation unambiguous. */
  type: string;
  /** Optional transport request number. Required for non-`$TMP` objects,
   *  matching `abap push` semantics. */
  tr?: string;
  /** Caller must pass `--yes`; the command layer guards this. */
  yes: boolean;
}

export interface DeleteResult {
  data: {
    object: string;
    type: string;
    packageName?: string;
    deleted: boolean;
    transport?: string;
    lockReleased: boolean;
  };
  human: string;
}

/**
 * Delete a single object.
 *
 * Steps:
 *  1. Resolve the object URL via ADT search (same logic as `pull`).
 *  2. Lock the object for `MODIFY` (delete requires a lock handle).
 *  3. DELETE the object URL.
 *  4. Always release the lock, even when step 3 throws.
 *
 * The transport argument, when given, must be the active request number;
 * passing a closed request causes SAP to reject the delete. We surface the
 * SAP message verbatim in `details.sapErrorBody` via the shared
 * HTTP-error classifier.
 */
export async function runDelete(objectName: string, opts: DeleteOptions): Promise<DeleteResult> {
  if (!opts.yes) {
    // Defense in depth: the command layer rejects `--yes` absence, but a
    // programmatic caller that bypasses the CLI guard cannot rely on this
    // branch alone. Keep it loud.
    throw new CliError('USAGE', 'Deleting an object requires --yes to confirm', {
      nextSteps: ['Re-run with --yes: `abap delete <object> --type <type> --yes`.'],
      example: `abap delete ${objectName} --type ${opts.type} --yes`,
    });
  }

  const typeUpper = normalizeTypeInput(opts.type).type.toUpperCase();
  // Package (DEVC) deletion has its own contract: no lock/unlock cycle and a
  // transport rule derived from the package's software component. It also
  // does not need `resolveObject` (the ADT package resource is addressed by
  // name directly).
  if (typeUpper === 'DEVC') {
    return runDeleteDevc(objectName, opts);
  }
  const client = await AdtClientWrapper.create();
  const resolved = await resolveObject(client, objectName, typeUpper);

  // $TMP is the only transport-free package: enforce the same rule `push`
  // uses, so a missing --tr is rejected before locking.
  const isLocal = (resolved.packageName ?? '').trim().toUpperCase() === '$TMP';
  if (!isLocal && !opts.tr) {
    throw new CliError('MISSING_TRANSPORT', `Object ${resolved.name} is in package ${resolved.packageName ?? '?'}; --tr is required`, {
      details: { object: resolved.name, type: resolved.type, packageName: resolved.packageName },
      nextSteps: [
        'Pass --tr <request> to record the deletion in a transportable change.',
        'Or move the object to $TMP first if it is local scratch work.',
      ],
      example: `abap delete ${resolved.name} --type ${resolved.type} --tr NDK900123 --yes`,
    });
  }

  let lockHandle: string | undefined;
  let lockReleased = false;
  let result: DeleteResult | undefined;
  try {
    const lock = await client.lock(resolved.objectUrl);
    lockHandle = lock.LOCK_HANDLE;
    if (typeof lockHandle !== 'string' || lockHandle === '') {
      throw new CliError('LOCK_FAILED', `SAP returned no LOCK_HANDLE for ${resolved.name}`, {
        details: { object: resolved.name, type: resolved.type },
        nextSteps: [
          'The object may be locked by another user (SE11 → Utilities → Lock entries).',
          'Retry; if persistent, check `abap inspect --activation` for an inactive version.',
        ],
      });
    }

    await client.deleteObject(resolved.objectUrl, lockHandle, opts.tr);

    // Build the result here so `finally` can amend `lockReleased` before the
    // object escapes the function.
    result = {
      data: {
        object: resolved.name,
        type: resolved.type,
        packageName: resolved.packageName,
        deleted: true,
        ...(opts.tr ? { transport: opts.tr } : {}),
        lockReleased,
      },
      human: `Deleted ${resolved.type} ${resolved.name}` + (opts.tr ? ` (transport ${opts.tr})` : ''),
    };
  } catch (error) {
    // Re-throw with the same CliError shape so `printError` can render it.
    throw error instanceof CliError
      ? error
      : new CliError('DELETE_FAILED', `Failed to delete ${resolved.type} ${resolved.name}`, {
          details: { object: resolved.name, type: resolved.type, packageName: resolved.packageName },
        });
  } finally {
    if (lockHandle && !lockReleased) {
      try {
        await client.unLock(resolved.objectUrl, lockHandle);
        lockReleased = true;
      } catch {
        // Lock release is best-effort: leaking a lock is recoverable from
        // SE11, but a failed delete must not be masked by a lock cleanup
        // error.
      }
    }
    if (result) result.data.lockReleased = lockReleased;
  }
  return result!;
}