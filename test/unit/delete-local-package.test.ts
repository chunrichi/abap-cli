/**
 * `abap delete` transport rule for ADT source objects: `$`-prefixed local
 * packages delete without `--tr`; everything else (including `TEST...` names,
 * which are not transport-free) still requires a request before the lock.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runDelete } from '../../src/abap_cli/flows/edit/delete.js';

const lock = vi.fn(async () => ({ LOCK_HANDLE: 'lock-1' }));
const deleteObject = vi.fn(async () => undefined);
const unLock = vi.fn(async () => undefined);
const resolveObject = vi.fn();

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({ lock, deleteObject, unLock, logout: async () => undefined }),
  },
}));

vi.mock('../../src/abap_cli/core/resolve.js', () => ({
  resolveObject: (...args: unknown[]) => resolveObject(...args),
  getObjectParts: vi.fn(async () => []),
}));

function resolved(packageName: string, name = 'ZCL_LOCAL', type = 'CLAS') {
  return {
    name,
    type,
    objectUrl: '/sap/bc/adt/oo/classes/zcl_local',
    packageName,
    parts: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveObject.mockResolvedValue(resolved('$CRW'));
});

describe('abap delete — local package transport rule', () => {
  it('deletes an object in a $-prefixed local package without --tr', async () => {
    resolveObject.mockResolvedValue(resolved('$CRW'));
    const result = await runDelete('ZCL_LOCAL', { type: 'CLAS', yes: true });
    expect(lock).toHaveBeenCalledWith('/sap/bc/adt/oo/classes/zcl_local');
    expect(deleteObject).toHaveBeenCalledWith('/sap/bc/adt/oo/classes/zcl_local', 'lock-1', undefined);
    expect(result.data).toMatchObject({ object: 'ZCL_LOCAL', type: 'CLAS', packageName: '$CRW', deleted: true });
    expect(result.data.transport).toBeUndefined();
  });

  it('requires --tr for a TEST-prefixed package (not transport-free)', async () => {
    resolveObject.mockResolvedValue(resolved('TEST_SCRATCH'));
    await expect(runDelete('ZCL_LOCAL', { type: 'CLAS', yes: true })).rejects.toMatchObject({
      code: 'MISSING_TRANSPORT',
    });
    expect(lock).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('rejects a transportable package without --tr before locking', async () => {
    resolveObject.mockResolvedValue(resolved('ZPKG'));
    await expect(runDelete('ZCL_LOCAL', { type: 'CLAS', yes: true })).rejects.toMatchObject({
      code: 'MISSING_TRANSPORT',
    });
    expect(lock).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('passes the explicit --tr for a transportable package', async () => {
    resolveObject.mockResolvedValue(resolved('ZPKG'));
    const result = await runDelete('ZCL_LOCAL', { type: 'CLAS', tr: 'NDK900123', yes: true });
    expect(deleteObject).toHaveBeenCalledWith('/sap/bc/adt/oo/classes/zcl_local', 'lock-1', 'NDK900123');
    expect(result.data.transport).toBe('NDK900123');
  });
});
