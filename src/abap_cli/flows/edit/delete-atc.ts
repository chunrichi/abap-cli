/**
 * ATC configuration object delete flow — CHKC / CHKO / CHKV (ADT only).
 *
 * The generic ADT delete path (`delete.ts`) resolves the object via
 * quickSearch, which does not report the object's package. ATC objects must
 * therefore read their package from the resource XML first, so the
 * local-package vs transportable rule can be enforced before the lock.
 *
 * Deletion itself is the standard ADT lifecycle: lock → DELETE → unlock. A
 * CHKC with child categories, or a CHKO whose implementing class is still
 * referenced, is rejected by SAP; those messages surface verbatim.
 */
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { atcObjectUrl, parseAtcPackageName } from '../../clients/atc.js';
import { CliError } from '../../output/json.js';
import { isLocalPackageName } from '../../core/transport.js';
import type { AtcType } from '../../formats/atc/json.js';
import type { DeleteOptions, DeleteResult } from './delete.js';

export async function runDeleteAtc(type: AtcType, objectName: string, opts: DeleteOptions): Promise<DeleteResult> {
  const name = objectName.trim().toUpperCase();
  const client = await AdtClientWrapper.create();

  let packageName: string | undefined;
  try {
    const xml = await client.getAtcObject(type, name);
    packageName = parseAtcPackageName(type, xml);
  } catch (error) {
    if (error instanceof CliError && (error.details?.httpStatus === 404 || error.code === 'OBJECT_NOT_FOUND')) {
      throw new CliError('OBJECT_NOT_FOUND', `${type} ${name} not found`, {
        object: name,
        type,
      });
    }
    throw error;
  }

  if (!isLocalPackageName(packageName) && !opts.tr) {
    throw new CliError(
      'MISSING_TRANSPORT',
      `${type} ${name} is in package ${packageName ?? '?'}; --tr is required`,
      {
        object: name,
        type,
        details: { packageName },
        nextSteps: [
          'Pass --tr <request> to record the deletion in a transportable change.',
          'Or move the object to a local package ($TMP) first if it is local scratch work.',
        ],
        example: `abap delete ${name} --type ${type} --tr NDK900123 --yes`,
      },
    );
  }

  const objectUrl = atcObjectUrl(type, name);
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
