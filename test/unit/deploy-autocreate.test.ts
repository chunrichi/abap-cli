/**
 * abap deploy — auto-create when object does not exist on the target system.
 *
 * Mirrors the first-time deploy scenario on a fresh SAP system where the
 * bundled classes are not yet known. The flow must:
 *  1. detect OBJECT_NOT_FOUND
 *  2. call createObject (ADT) with the description from <name>.<type>.json
 *  3. re-resolve the object URL
 *  4. push the bundled source
 *  5. report `objects[].status: 'created'`
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CliError } from '../../src/abap_cli/output/json.js';
import { deployBundled } from '../../src/abap_cli/sync/deploy-flow.js';

const lock = vi.fn(async () => ({ LOCK_HANDLE: 'lock-1' }));
const setObjectSource = vi.fn(async () => '');
const syntaxCheck = vi.fn(async () => []);
const activate = vi.fn(async () => '');
const unLock = vi.fn(async () => '');
const createObject = vi.fn(async () => undefined);
const objectStructure = vi.fn(async (objectUrl: string) => ({
  objectUrl,
  includes: [{ 'class:includeType': 'main', 'abapsource:sourceUri': `${objectUrl}/source/main` }],
}));
const getObjectSource = vi.fn(async (_url: string) => 'SAP VERSION');
const runClass = vi.fn(async () =>
  JSON.stringify({ status: 'success', action: 'already_active', node: { active: true } }),
);
const inactiveObjects = vi.fn(async () => []);
const activateAll = vi.fn(async () => ({ messages: [] }));

// searchObject: first call returns [] (object not found), subsequent calls
// return the freshly created object.
let searchCalls = 0;
const searchObject = vi.fn(async (name: string) => {
  searchCalls += 1;
  if (searchCalls === 1) return [];
  return [
    {
      'adtcore:name': name.toUpperCase(),
      'adtcore:type': 'CLAS/OC',
      'adtcore:uri': `/sap/bc/adt/oo/classes/${name.toLowerCase()}`,
    },
  ];
});

const client = {
  lock, setObjectSource, syntaxCheck, activate, unLock, createObject,
  searchObject, objectStructure, getObjectSource, runClass, inactiveObjects, activateAll,
  getConfig: () => ({ sap: { username: 'MOCKUSER' } }),
} as never;

let sourceDir: string;
beforeEach(() => {
  vi.clearAllMocks();
  searchCalls = 0;
  sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-autocreate-'));
  fs.writeFileSync(
    path.join(sourceDir, 'zcl_fresh.clas.abap'),
    'CLASS zcl_fresh DEFINITION PUBLIC.\nENDCLASS.\n',
  );
  fs.writeFileSync(
    path.join(sourceDir, 'zcl_fresh.clas.json'),
    JSON.stringify({ formatVersion: '1', header: { description: 'Fresh local class', originalLanguage: 'en' } }, null, 2),
  );
});

describe('abap deploy — auto-create missing objects (US6.1)', () => {
  it('calls createObject then pushObject when the object is missing', async () => {
    const summary = await deployBundled(client, {
      transport: 'TRN001', yes: true, sourceDir, package: '$TMP',
    });
    expect(createObject).toHaveBeenCalledTimes(1);
    expect(createObject).toHaveBeenCalledWith(expect.objectContaining({
      objtype: 'CLAS/OC',
      name: 'ZCL_FRESH',
      parentName: '$TMP',
      description: 'Fresh local class',
    }));
    expect(setObjectSource).toHaveBeenCalledTimes(1);
    const [file] = summary.files;
    expect(file?.status).toBe('deployed');
    const [obj] = summary.objects;
    expect(obj).toMatchObject({ object: 'ZCL_FRESH', type: 'CLAS', status: 'created' });
    expect(summary.icfNode).toMatchObject({ status: 'success' });
  });

  it('queries inactiveObjects and calls activateAll for per-part activation', async () => {
    inactiveObjects.mockResolvedValueOnce([
      {
        object: {
          'adtcore:uri': '/sap/bc/adt/oo/classes/zcl_fresh#main',
          'adtcore:type': 'CLAS/OC',
          'adtcore:name': 'ZCL_FRESH',
        },
      },
    ]);
    await deployBundled(client, {
      transport: 'TRN001', yes: true, sourceDir, package: '$TMP',
    });
    expect(inactiveObjects).toHaveBeenCalled();
    expect(activateAll).toHaveBeenCalledWith([
      expect.objectContaining({
        uri: '/sap/bc/adt/oo/classes/zcl_fresh#main',
        name: 'ZCL_FRESH',
      }),
    ]);
  });

  it('skips activateAll when there are no inactive items', async () => {
    inactiveObjects.mockResolvedValueOnce([]);
    await deployBundled(client, {
      transport: 'TRN001', yes: true, sourceDir, package: '$TMP',
    });
    expect(activateAll).not.toHaveBeenCalled();
  });

  it('skips activateAll under --dry-run (no mutating calls)', async () => {
    await deployBundled(client, {
      transport: 'TRN001', yes: true, dryRun: true, sourceDir, package: '$TMP',
    });
    expect(inactiveObjects).not.toHaveBeenCalled();
    expect(activateAll).not.toHaveBeenCalled();
  });

  it('passes empty transport for $TMP (transportOptional) and creates without --tr', async () => {
    const summary = await deployBundled(client, {
      transport: '', yes: true, sourceDir, package: '$TMP',
    });
    expect(createObject).toHaveBeenCalledWith(expect.objectContaining({ transport: '' }));
    expect(summary.objects[0]?.status).toBe('created');
  });

  it('--dry-run plans creation without calling createObject', async () => {
    const summary = await deployBundled(client, {
      transport: 'TRN001', yes: true, dryRun: true, sourceDir, package: '$TMP',
    });
    expect(createObject).not.toHaveBeenCalled();
    expect(setObjectSource).not.toHaveBeenCalled();
    expect(summary.dryRun).toBe(true);
    expect(summary.objects[0]?.status).toBe('created');
    expect(summary.icfNode).toMatchObject({ status: 'planned' });
  });

  it('surfaces CREATE_FAILED when the create call rejects', async () => {
    createObject.mockRejectedValueOnce(
      new CliError('CREATE_FAILED', 'insufficient privileges', { object: 'ZCL_FRESH' }),
    );
    const summary = await deployBundled(client, {
      transport: 'TRN001', yes: true, sourceDir, package: '$TMP',
    });
    expect(summary.objects[0]).toMatchObject({ status: 'failed', code: 'CREATE_FAILED' });
    expect(summary.files[0]?.status).toBe('failed');
  });

  it('falls back to a default description when the .json file is absent', async () => {
    fs.unlinkSync(path.join(sourceDir, 'zcl_fresh.clas.json'));
    const summary = await deployBundled(client, {
      transport: 'TRN001', yes: true, sourceDir, package: '$TMP',
    });
    expect(createObject).toHaveBeenCalledWith(expect.objectContaining({
      description: expect.stringMatching(/Auto-created/),
    }));
    expect(summary.objects[0]?.status).toBe('created');
  });
});
