import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { deployBundled } from '../../src/abap_cli/sync/deploy-flow.js';

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
const runClass = vi.fn(async (_className: string) =>
  JSON.stringify({ status: 'success', action: 'already_active', node: { active: true } }),
);

const client = {
  lock, setObjectSource, syntaxCheck, activate, unLock, searchObject, objectStructure, getObjectSource, runClass,
  getConfig: () => ({ sap: { username: 'MOCKUSER' } }),
} as never;

let sourceDir: string;
beforeEach(() => {
  vi.clearAllMocks();
  sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-'));
  fs.mkdirSync(path.join(sourceDir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'zcl_deploy.clas.abap'), 'CLASS zcl_deploy DEFINITION PUBLIC.\nENDCLASS.\n');
});

describe('abap deploy (US6, FR-018..020, SC-005)', () => {
  it('--dry-run makes zero mutating calls and returns a per-file plan', async () => {
    const summary = await deployBundled(client, { transport: 'TRN001', yes: true, dryRun: true, sourceDir });
    expect(lock).not.toHaveBeenCalled();
    expect(setObjectSource).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    expect(unLock).not.toHaveBeenCalled();
    expect(summary.dryRun).toBe(true);
    expect(summary.files.length).toBeGreaterThan(0);
    expect(summary.files.every((f) => f.status === 'deployed')).toBe(true);
  });

  it('--diff reports the per-file changed flag', async () => {
    getObjectSource.mockResolvedValueOnce('SAP VERSION'); // differs from local
    const summary = await deployBundled(client, { transport: 'TRN001', yes: true, diff: true, sourceDir });
    expect(summary.files[0].changed).toBe(true);
  });

  it('non-interactive without --yes fails fast with VALIDATION_ERROR', async () => {
    const prev = (process.stdin as { isTTY?: unknown }).isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      await expect(
        deployBundled(client, { transport: 'TRN001', sourceDir }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    } finally {
      if (prev === undefined) delete (process.stdin as { isTTY?: unknown }).isTTY;
      else Object.defineProperty(process.stdin, 'isTTY', { value: prev, configurable: true });
    }
  });

  it('--force bypasses safety guards and reports forced:true', async () => {
    getObjectSource.mockResolvedValueOnce('SAP VERSION'); // unchanged vs local? no: differs
    const summary = await deployBundled(client, { transport: 'TRN001', yes: true, force: true, sourceDir });
    expect(summary.forced).toBe(true);
  });
});
