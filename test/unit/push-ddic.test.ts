/**
  abap push of DDIC .json files routes through the ICF /ddic/<type>
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
  // 033: AFF canonical — settings under generalInformation.*.
  const json = {
    formatVersion: '1',
    header: { description: 'Test table', originalLanguage: 'EN' },
    name: 'ZTAB_TEST',
    package: pkg,
    generalInformation: {
      deliveryClass: 'A',
      dataClassCategory: 'APPL0',
      sizeCategory: '0',
      clientDependent: false,
    },
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
      generalInformation: expect.objectContaining({ deliveryClass: 'A' }),
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

  it('032 US5: pushes a three-piece TABL artifact (.tabl.json + .tabl.ddic) — wire merges DDL fields', async () => {
    // 024 abap-file-format three-piece layout — wire picks up fields from .tabl.ddic.
    const main = {
      formatVersion: '1',
      header: { description: 'Three-piece test', originalLanguage: 'EN' },
      name: 'ZTAB_3PC',
      package: 'ZPKG',
      deliveryClass: 'A',
      fields: [],
    };
    const ddic = [
      'define table ztab_3pc {',
      '  key mandt : abap.clnt not null;',
      '  country   : abap.char(3) with foreign key [dependent] check t005;',
      '}',
    ].join('\n');
    fs.writeFileSync(path.join(cwd, 'src/ztab_3pc.tabl.json'), JSON.stringify(main, null, 2));
    fs.writeFileSync(path.join(cwd, 'src/ztab_3pc.tabl.ddic'), ddic);
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/ztab_3pc.tabl.json', '--tr', 'TRN001', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfPostDdic).toHaveBeenCalledWith('tabl', expect.objectContaining({
      name: 'ZTAB_3PC',
      transportRequest: 'TRN001',
      // readTablArtifact strips CLIENT/MANDT for client-dependent TABLs.
      // 033: clientDependent lives under generalInformation.* (AFF canonical).
      generalInformation: expect.objectContaining({ clientDependent: true }),
      fields: expect.arrayContaining([
        expect.objectContaining({ fieldName: 'COUNTRY', dataType: 'CHAR', length: 3, checkTable: 'T005' }),
      ]),
    }));
  });

  it('032 US5: STRU push accepts three-piece without .tabl.settings.json sidecar', async () => {
    const main = {
      formatVersion: '1',
      header: { description: 'Structure no-settings', originalLanguage: 'EN' },
      name: 'ZSTR_3PC',
      package: 'ZPKG',
      fields: [],
    };
    const ddic = [
      'define structure zstr_3pc {',
      '  field1 : abap.char(10);',
      '}',
    ].join('\n');
    fs.writeFileSync(path.join(cwd, 'src/zstr_3pc.stru.json'), JSON.stringify(main, null, 2));
    fs.writeFileSync(path.join(cwd, 'src/zstr_3pc.stru.ddic'), ddic);
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zstr_3pc.stru.json', '--tr', 'TRN002', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfPostDdic).toHaveBeenCalledWith('stru', expect.objectContaining({
      name: 'ZSTR_3PC',
      fields: expect.arrayContaining([expect.objectContaining({ fieldName: 'FIELD1' })]),
    }));
  });

  it('032 US5: malformed .tabl.ddic surfaces TABL_DDL_INVALID (exit 7), no ICF call', async () => {
    fs.writeFileSync(path.join(cwd, 'src/ztab_bad.tabl.json'), JSON.stringify({
      formatVersion: '1',
      header: { description: 'Bad DDL', originalLanguage: 'EN' },
      name: 'ZTAB_BAD',
      package: 'ZPKG',
      fields: [],
    }, null, 2));
    fs.writeFileSync(path.join(cwd, 'src/ztab_bad.tabl.ddic'), '@AbapCatalog.deliveryClass : #L\n');
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/ztab_bad.tabl.json', '--tr', 'TRN003', '--yes', '--json'], { cwd });
    expect(res.exitCode).not.toBe(0);
    expect(icfPostDdic).not.toHaveBeenCalled();
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('TABL_DDL_INVALID');
  });
});
