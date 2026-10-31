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
 * (`delete-devc.ts` — packages are deleted without a lock); TRAN, VIEW and SHLP
 * go through the bundled ICF service (`DELETE /tran/<tcode>` /
 * `/ddic/view|shlp/<name>`).
 * CDSV views and similar type codes without an ADT delete endpoint surface as
 * `TYPE_NOT_SUPPORTED`.
 */
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { resolveObject } from '../../core/resolve.js';
import { normalizeTypeInput } from '../../cli/type-alias.js';
import { runDeleteDevc } from './delete-devc.js';
import { runDeleteView } from './delete-view.js';
import { runDeleteShlp } from './delete-shlp.js';

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
  // VIEW (DDIC database view) has no ADT delete endpoint: deletion runs through
  // the bundled ICF service (RS_DD_DELETE_OBJ, $TMP only).
  if (typeUpper === 'VIEW') {
    return runDeleteView(objectName, opts);
  }
  // SHLP (DDIC search help) has no ADT delete endpoint either.
  if (typeUpper === 'SHLP') {
    return runDeleteShlp(objectName, opts);
  }
  // TRAN (SE93 transaction codes) has no ADT delete endpoint: a transaction is
  // repository metadata spread over TSTC/TSTCT/TSTCP/TSTCC/TSTCA plus TADIR, so
  // it is deleted through the bundled ICF service instead.
  if (typeUpper === 'TRAN') {
    return runDeleteTran(objectName, opts);
  }
  // XSLT (transformation programs) are O2 repository objects with no ADT
  // delete endpoint; they are deleted through ICF `DELETE /xslt/<name>`.
  if (typeUpper === 'XSLT') {
    return runDeleteXslt(objectName, opts);
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

/**
 * Delete a transaction code through ICF `DELETE /tran/<tcode>`.
 *
 * The ICF handler removes the transaction tables and the TADIR entry (recording
 * the deletion in the transport request when one is passed). Transport rules
 * mirror the ADT delete path: `$TMP` needs none, everything else needs `--tr`.
 */
async function runDeleteTran(objectName: string, opts: DeleteOptions): Promise<DeleteResult> {
  const name = objectName.trim().toUpperCase();
  const icf = await IcfClient.create();

  const probe = await icf.getTran<{ package?: string }>(name);
  if (probe.status !== 'success' || !probe.data) {
    if (probe.error?.code === 'TRAN_OBJECT_NOT_FOUND') {
      throw new CliError('OBJECT_NOT_FOUND', `Transaction ${name} does not exist`, {
        object: name,
        type: 'TRAN',
        nextSteps: ['Verify the transaction code exists in the target system.'],
      });
    }
    throw new CliError((probe.error?.code ?? 'SAP_ERROR') as ErrorCode, probe.error?.message ?? `Failed to read TRAN ${name}`, {
      object: name,
      type: 'TRAN',
    });
  }

  const packageName = probe.data.package;
  const isLocal = (packageName ?? '').trim().toUpperCase() === '$TMP';
  if (!isLocal && !opts.tr) {
    throw new CliError('MISSING_TRANSPORT', `Transaction ${name} is in package ${packageName ?? '?'}; --tr is required`, {
      details: { object: name, type: 'TRAN', packageName },
      nextSteps: [
        'Pass --tr <request> to record the deletion in a transportable change.',
        'Or recreate the transaction in $TMP if it is local scratch work.',
      ],
      example: `abap delete ${name} --type TRAN --tr NDK900123 --yes`,
    });
  }

  const resp = await icf.deleteTran<{ name: string; type: string; action: string }>(name, opts.tr ? { transportRequest: opts.tr } : {});
  if (resp.status !== 'success' || !resp.data) {
    throw new CliError((resp.error?.code ?? 'DELETE_FAILED') as ErrorCode, resp.error?.message ?? `Failed to delete TRAN ${name}`, {
      object: name,
      type: 'TRAN',
      details: resp.error?.details,
      nextSteps: ['Re-run after fixing the cause above.'],
    });
  }

  return {
    data: {
      object: name,
      type: 'TRAN',
      ...(packageName ? { packageName } : {}),
      deleted: true,
      ...(opts.tr ? { transport: opts.tr } : {}),
      lockReleased: true,
    },
    human: `Deleted TRAN ${name}` + (opts.tr ? ` (transport ${opts.tr})` : ''),
  };
}

/**
 * Delete a transformation program through ICF `DELETE /xslt/<name>`.
 *
 * Transport rules mirror the ADT delete path: `$TMP` needs none, everything
 * else needs `--tr`. The package comes from the ICF GET wire document (the
 * local AFF JSON does not carry it).
 */
async function runDeleteXslt(objectName: string, opts: DeleteOptions): Promise<DeleteResult> {
  const name = objectName.trim().toUpperCase();
  const icf = await IcfClient.create();

  let probe;
  try {
    probe = await icf.getXslt<{ package?: string }>(name);
  } catch (error: unknown) {
    if (error instanceof CliError && error.code === 'XSLT_OBJECT_NOT_FOUND') {
      throw new CliError('OBJECT_NOT_FOUND', `XSLT ${name} does not exist`, {
        object: name,
        type: 'XSLT',
        nextSteps: ['Verify the transformation exists in the target system (SE80 → XSLT Programs).'],
      });
    }
    throw error;
  }
  if (probe.status !== 'success' || !probe.data) {
    if (probe.error?.code === 'XSLT_OBJECT_NOT_FOUND') {
      throw new CliError('OBJECT_NOT_FOUND', `XSLT ${name} does not exist`, {
        object: name,
        type: 'XSLT',
        nextSteps: ['Verify the transformation exists in the target system (SE80 → XSLT Programs).'],
      });
    }
    throw new CliError((probe.error?.code ?? 'SAP_ERROR') as ErrorCode, probe.error?.message ?? `Failed to read XSLT ${name}`, {
      object: name,
      type: 'XSLT',
    });
  }

  const packageName = probe.data.package;
  const isLocal = (packageName ?? '').trim().toUpperCase() === '$TMP';
  if (!isLocal && !opts.tr) {
    throw new CliError('MISSING_TRANSPORT', `XSLT ${name} is in package ${packageName ?? '?'}; --tr is required`, {
      details: { object: name, type: 'XSLT', packageName },
      nextSteps: [
        'Pass --tr <request> to record the deletion in a transportable change.',
        'Or recreate the transformation in $TMP if it is local scratch work.',
      ],
      example: `abap delete ${name} --type XSLT --tr NDK900123 --yes`,
    });
  }

  const resp = await icf.deleteXslt<{ name: string; action: string }>(name, opts.tr ? { transportRequest: opts.tr } : {});
  if (resp.status !== 'success' || !resp.data) {
    throw new CliError((resp.error?.code ?? 'DELETE_FAILED') as ErrorCode, resp.error?.message ?? `Failed to delete XSLT ${name}`, {
      object: name,
      type: 'XSLT',
      details: resp.error?.details,
      nextSteps: ['Re-run after fixing the cause above.'],
    });
  }

  return {
    data: {
      object: name,
      type: 'XSLT',
      ...(packageName ? { packageName } : {}),
      deleted: true,
      ...(opts.tr ? { transport: opts.tr } : {}),
      lockReleased: true,
    },
    human: `Deleted XSLT ${name}` + (opts.tr ? ` (transport ${opts.tr})` : ''),
  };
}