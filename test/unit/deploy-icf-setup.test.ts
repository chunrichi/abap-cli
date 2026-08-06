import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { deployBundled } from '../../src/abap_cli/flows/deploy-flow.js';

const lock = vi.fn(async () => ({ LOCK_HANDLE: 'lock-1' }));
const setObjectSource = vi.fn(async () => '');
const syntaxCheck = vi.fn(async () => []);
const activate = vi.fn(async () => '');
const unLock = vi.fn(async () => '');
const searchObject = vi.fn(async (name: string) => [
  { 'adtcore:name': name.toUpperCase(), 'adtcore:type': 'CLAS/OC', 'adtcore:uri': `/sap/bc/adt/oo/classes/${name.toLowerCase()}` },
]);
const objectStructure = vi.fn(async (objectUrl: string) => ({
  objectUrl,
  includes: [{ 'class:includeType': 'main', 'abapsource:sourceUri': `${objectUrl}/source/main` }],
}));
const getObjectSource = vi.fn(async (_url: string) => 'SAP VERSION');
// Setup execution (ADT classrun) — T003 runClass on the wrapper.
const runClass = vi.fn(async (_className: string) =>
  JSON.stringify({ status: 'success', action: 'already_active', node: { vhost: 'default_host', url: '/sap/zabap_vibe', handler: 'ZCL_ABAP_VIBE_ICF', active: true } }),
);
const inactiveObjects = vi.fn(async () => []);
const activateAll = vi.fn(async () => ({ messages: [] }));

const client = {
  lock, setObjectSource, syntaxCheck, activate, unLock, searchObject, objectStructure, getObjectSource, runClass, inactiveObjects, activateAll,
  getConfig: () => ({ sap: { username: 'MOCKUSER' } }),
} as never;

let sourceDir: string;
beforeEach(() => {
  vi.clearAllMocks();
  sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-icf-'));
  fs.writeFileSync(path.join(sourceDir, 'zcl_abap_vibe_icf.clas.abap'), 'CLASS zcl_abap_vibe_icf DEFINITION PUBLIC.\nENDCLASS.\n');
});

describe('abap deploy — ICF setup trigger (US3, FR-008..010, FR-016)', () => {
  it('non-dry-run triggers setup and reports icfNode status', async () => {
    const summary = await deployBundled(client, { transport: 'TRN001', yes: true, sourceDir });
    expect(runClass).toHaveBeenCalledWith('ZCL_ABAP_VIBE_ICF_SETUP');
    expect(summary.icfNode).toMatchObject({ status: 'success', active: true, url: '/sap/zabap_vibe' });
  });

  it('--dry-run plans the setup step without triggering it', async () => {
    const summary = await deployBundled(client, { transport: 'TRN001', yes: true, dryRun: true, sourceDir });
    expect(runClass).not.toHaveBeenCalled();
    expect(summary.icfNode).toMatchObject({ status: 'planned' });
  });

  it('repeated deploy is idempotent (setup reports already_active)', async () => {
    await deployBundled(client, { transport: 'TRN001', yes: true, sourceDir });
    await deployBundled(client, { transport: 'TRN001', yes: true, sourceDir });
    expect(runClass).toHaveBeenCalledTimes(2);
    expect(runClass.mock.results[1].value).toContain('already_active');
  });

  it('setup failure surfaces a structured SAP_ERROR', async () => {
    runClass.mockResolvedValueOnce(
      JSON.stringify({ status: 'error', error: { code: 'ICF_ADMIN_REQUIRED', message: 'missing SICF permission' } }),
    );
    await expect(deployBundled(client, { transport: 'TRN001', yes: true, sourceDir })).rejects.toMatchObject({
      code: 'SAP_ERROR',
      details: { code: 'ICF_ADMIN_REQUIRED' },
    });
  });
});
