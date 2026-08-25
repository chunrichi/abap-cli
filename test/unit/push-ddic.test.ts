/**
 * 014: abap push of DDIC .json files routes through the ICF /ddic/<type>
 * endpoint (pushDdicFile). Covers: wire conversion + transportRequest,
 * $TMP transport-free path, --check-only rejection, validation, dry-run.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerPushCommand } from '../../src/abap_cli/commands/push.js';
import { makeProgram, runCommand } from './cli-helper.js';

const icfPostDdic = vi.fn(async () => ({
  status: 'success' as const,
  data: { name: 'ZTAB_TEST', type: 'TABL', action: 'updated' },
  error: null,
}));

vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: {
    create: async () => ({
      postDdic: icfPostDdic,
      getDdic: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
    }),
  },
}));

// DDIC push never touches ADT — the client is created but unused.
vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      getConfig: () => ({ sap: { username: 'MOCKUSER' }, transport: '' }),
    }),
  },
}));

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'push-ddic-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
});

function writeTableJson(pkg = 'ZPKG', extra: Record<string, unknown> = {}) {
  const json = {
    formatVersion: '1',
    header: { description: 'Test table', originalLanguage: 'EN' },
    name: 'ZTAB_TEST',
    package: pkg,
    deliveryClass: 'A',
    dataClass: 'APPL0',
    sizeCategory: '0',
    clientDependent: false,
    fields: [{ fieldName: 'FIELD1', dataType: 'CHAR', length: 20, keyFlag: true }],
    ...extra,
  };
  fs.writeFileSync(path.join(cwd, 'src/ztab_test.tabl.json'), JSON.stringify(json, null, 2));
}

describe('014 abap push DDIC (.json via ICF)', () => {
  it('pushes a .tabl.json via POST /ddic/tabl with the resolved transport', async () => {
    writeTableJson('ZPKG');
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/ztab_test.tabl.json', '--tr', 'TRN001', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfPostDdic).toHaveBeenCalledWith('tabl', expect.objectContaining({
      name: 'ZTAB_TEST',
      transportRequest: 'TRN001',
      deliveryClass: 'A',
      fields: expect.arrayContaining([
        expect.objectContaining({ fieldName: 'FIELD1', dataType: 'CHAR', length: 20, keyFlag: true }),
      ]),
    }));
    const out = JSON.parse(res.stdout);
    expect(out.data.results[0].status).toBe('written');
    expect(out.data.results[0].stage).toBe('ddic-icf');
    expect(out.data.results[0].transport).toBe('TRN001');
  });

  it('pushes a $TMP DDIC object with no transport and no --tr', async () => {
    writeTableJson('$TMP');
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/ztab_test.tabl.json', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfPostDdic).toHaveBeenCalledWith('tabl', expect.objectContaining({
      name: 'ZTAB_TEST',
      transportRequest: undefined,
    }));
    const out = JSON.parse(res.stdout);
    expect(out.data.results[0].status).toBe('written');
    expect(out.data.results[0].transport).toBe('');
  });

  it('rejects --check-only for DDIC files', async () => {
    writeTableJson('ZPKG');
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/ztab_test.tabl.json', '--check-only', '--yes', '--json'], { cwd });
    expect(res.exitCode).not.toBe(0);
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('VALIDATION_ERROR');
    expect(icfPostDdic).not.toHaveBeenCalled();
  });

  it('fails validation with VALIDATION_ERROR and writes nothing', async () => {
    // Missing fields list → invalid TABL.
    fs.writeFileSync(path.join(cwd, 'src/ztab_test.tabl.json'), JSON.stringify({ name: 'ZTAB_TEST', deliveryClass: 'A' }, null, 2));
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/ztab_test.tabl.json', '--tr', 'TRN001', '--yes', '--json'], { cwd });
    expect(res.exitCode).not.toBe(0);
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('VALIDATION_ERROR');
    expect(icfPostDdic).not.toHaveBeenCalled();
  });

  it('plans only under --dry-run (no ICF call)', async () => {
    writeTableJson('ZPKG');
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/ztab_test.tabl.json', '--tr', 'TRN001', '--dry-run', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfPostDdic).not.toHaveBeenCalled();
    const out = JSON.parse(res.stdout);
    expect(out.data.dryRun).toBe(true);
    expect(out.data.results[0].plan).toContain('ddic-icf');
  });
});
