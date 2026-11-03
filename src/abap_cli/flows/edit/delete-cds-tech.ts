/**
 * CDS technical object delete flow — DTDC / DTEB / DSFD / DSFI (ADT only).
 *
 * Deletes through the standard ADT lifecycle (lock → DELETE → unlock). The
 * object's package is read from its metadata resource first, because
 * quickSearch does not report it and the local-package / `--tr` rule lives
 * here. DSFD deletions are behind SAP's `DD_CDS_DSFD` feature parameter; the
 * misleading SAP authorization message is mapped to an actionable error.
 */
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { cdsTechObjectUrl, parseCdsTechMeta, rethrowCdsFeatureError } from '../../clients/cds-tech.js';
import { CliError } from '../../output/json.js';
import { isLocalPackageName } from '../../core/transport.js';
import type { CdsTechType } from '../../formats/cds-tech/json.js';
import type { DeleteOptions, DeleteResult } from './delete.js';

export async function runDeleteCdsTech(type: CdsTechType, objectName: string, opts: DeleteOptions): Promise<DeleteResult> {
  const name = objectName.trim().toUpperCase();
  const client = await AdtClientWrapper.create();

  let packageName: string | undefined;
  try {
    packageName = parseCdsTechMeta(type, await client.getCdsTechObject(type, name)).packageName;
  } catch (error) {
    if (error instanceof CliError && (error.details?.httpStatus === 404 || error.code === 'OBJECT_NOT_FOUND')) {
      throw new CliError('OBJECT_NOT_FOUND', `${type} ${name} not found`, { object: name, type });
    }
    throw error;
  }

  if (!isLocalPackageName(packageName) && !opts.tr) {
    throw new CliError('MISSING_TRANSPORT', `${type} ${name} is in package ${packageName ?? '?'}; --tr is required`, {
      object: name,
      type,
      details: { packageName },
      nextSteps: [
        'Pass --tr <request> to record the deletion in a transportable change.',
        'Or move the object to a local package ($TMP) first if it is local scratch work.',
      ],
      example: `abap delete ${name} --type ${type} --tr NDK900123 --yes`,
    });
  }

  const objectUrl = cdsTechObjectUrl(type, name);
  let lockHandle: string | undefined;
  let lockReleased = false;
  try {
    const lock = await client.lock(objectUrl);
    lockHandle = lock.LOCK_HANDLE;
    if (typeof lockHandle !== 'string' || lockHandle === '') {
      throw new CliError('LOCK_FAILED', `SAP returned no LOCK_HANDLE for ${name}`, {
        details: { object: name, type },
        nextSteps: ['The object may be locked by another user; retry after the lock is released.'],
      });
    }
    await client.deleteObject(objectUrl, lockHandle, opts.tr);
  } catch (error) {
    rethrowCdsFeatureError(type, error);
  } finally {
    if (lockHandle) {
      await client.unLock(objectUrl, lockHandle).catch(() => undefined);
      lockReleased = true;
    }
  }

  return {
    data: {
      object: name,
      type,
      packageName,
      deleted: true,
      ...(opts.tr ? { transport: opts.tr } : {}),
      lockReleased,
    },
    human: `Deleted ${type} ${name}` + (opts.tr ? ` (transport ${opts.tr})` : ''),
  };
}
