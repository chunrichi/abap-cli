/**
 * Type pool (TYPE) delete flow — ADT only.
 *
 * Reads the package from the metadata resource (quickSearch does not report
 * type pools), enforces the local-package / `--tr` rule, then deletes through
 * the standard ADT lifecycle (lock → DELETE → unlock).
 */
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { assertTypegroupName, parseTypegroupMeta, typegroupUrl } from '../../clients/typegroups.js';
import { CliError } from '../../output/json.js';
import { isLocalPackageName } from '../../core/transport.js';
import type { DeleteOptions, DeleteResult } from './delete.js';

export async function runDeleteType(objectName: string, opts: DeleteOptions): Promise<DeleteResult> {
  const name = assertTypegroupName(objectName);
  const client = await AdtClientWrapper.create();

  let packageName: string | undefined;
  try {
    packageName = parseTypegroupMeta((await client.getTypegroup(name)).xml).packageName;
  } catch (error) {
    if (error instanceof CliError && (error.details?.httpStatus === 404 || error.code === 'OBJECT_NOT_FOUND')) {
      throw new CliError('OBJECT_NOT_FOUND', `TYPE ${name} not found`, { object: name, type: 'TYPE' });
    }
    throw error;
  }

  if (!isLocalPackageName(packageName) && !opts.tr) {
    throw new CliError('MISSING_TRANSPORT', `TYPE ${name} is in package ${packageName ?? '?'}; --tr is required`, {
      object: name,
      type: 'TYPE',
      details: { packageName },
      nextSteps: [
        'Pass --tr <request> to record the deletion in a transportable change.',
        'Or move the object to a local package ($TMP) if it is local scratch work.',
      ],
      example: `abap delete ${name} --type TYPE --tr NDK900123 --yes`,
    });
  }

  const url = typegroupUrl(name);
  let lockHandle: string | undefined;
  let lockReleased = false;
  try {
    const lock = await client.lock(url);
    lockHandle = lock.LOCK_HANDLE;
    if (typeof lockHandle !== 'string' || lockHandle === '') {
      throw new CliError('LOCK_FAILED', `SAP returned no LOCK_HANDLE for ${name}`, {
        details: { object: name, type: 'TYPE' },
        nextSteps: ['The object may be locked by another user; retry after the lock is released.'],
      });
    }
    await client.deleteObject(url, lockHandle, opts.tr);
  } finally {
    if (lockHandle) {
      await client.unLock(url, lockHandle).catch(() => undefined);
      lockReleased = true;
    }
  }

  return {
    data: {
      object: name,
      type: 'TYPE',
      packageName,
      deleted: true,
      ...(opts.tr ? { transport: opts.tr } : {}),
      lockReleased,
    },
    human: `Deleted TYPE ${name}` + (opts.tr ? ` (transport ${opts.tr})` : ''),
  };
}
