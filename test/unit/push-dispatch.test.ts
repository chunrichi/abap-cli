/**
 * Phase 4 — ICF push routing table (`ICF_PUSH_HANDLERS`).
 *
 * `push-ddic.test.ts` / `http-push.test.ts` cover each route's payload shape
 * individually. This file covers the routing layer Phase 4 introduced: one
 * table lookup per `.json` file plus the shared `--check-only` / `--dry-run`
 * guard that used to live inside `pushDdicFile`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerPushCommand } from '../../src/abap_cli/commands/push.js';
import { makeProgram, runCommand } from './cli-helper.js';

const icfOk = () => ({ status: 'success' as const, data: { name: 'X', type: 'X', action: 'updated' }, error: null });

const icfPostDdic = vi.fn(async () => icfOk());
const icfGetDdic = vi.fn(async () => icfOk());
const icfPostHttp = vi.fn(async () => icfOk());
const icfPostTran = vi.fn(async () => icfOk());
const icfGetTran = vi.fn(async () => icfOk());

vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: {
    create: async () => ({
      postDdic: icfPostDdic,
      getDdic: icfGetDdic,
      postHttp: icfPostHttp,
      postTran: icfPostTran,
      getTran: icfGetTran,
      getHttp: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
    }),
  },
}));

// ICF-routed pushes never touch ADT for the write itself; channel-routed
// TTYP / MSAG / DDLS DO (their flows lock + update over ADT on a modern kernel).
const adtGetTtyp = vi.fn(async () => '<ttyp:tableType/>');
const adtUpdateTtyp = vi.fn(async () => undefined);
const adtGetMsag = vi.fn(async () => '<mc:messageClass/>');
const adtUpdateMsag = vi.fn(async () => undefined);
const adtGetDdls = vi.fn(async () => ({ xml: '<ddl:ddlSource/>', source: '' }));
const adtUpdateDdls = vi.fn(async () => undefined);
const adtLock = vi.fn(async () => ({ LOCK_HANDLE: 'LH1' }));
const adtUnLock = vi.fn(async () => undefined);

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      getConfig: () => ({ transport: 'TRN001' }),
      getTtyp: adtGetTtyp,
      updateTtyp: adtUpdateTtyp,
      getMsag: adtGetMsag,
      updateMsag: adtUpdateMsag,
      getDdls: adtGetDdls,
      updateDdls: adtUpdateDdls,
      lock: adtLock,
      unLock: adtUnLock,
    }),
  },
}));

// Channel detection reads the workspace profile; pin it to a modern kernel so
// TTYP / MSAG / DDLS take their ADT path.
vi.mock('../../src/abap_cli/config/project-config.js', () => ({
  loadConfig: async () => ({ systemVersion: '793' }),
  findWorkspaceConfig: () => undefined,
}));

let cwd: string;
beforeEach(() => {
  // Reset implementations + history so each case starts from the same client.
  icfPostDdic.mockReset().mockResolvedValue(icfOk());
  icfGetDdic.mockReset().mockResolvedValue(icfOk());
  icfPostHttp.mockReset().mockResolvedValue(icfOk());
  icfPostTran.mockReset().mockResolvedValue(icfOk());
  icfGetTran.mockReset().mockResolvedValue(icfOk());
  for (const fn of [adtGetTtyp, adtUpdateTtyp, adtGetMsag, adtUpdateMsag, adtGetDdls, adtUpdateDdls, adtLock, adtUnLock]) {
    fn.mockClear();
  }
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'push-dispatch-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
});

function write(rel: string, doc: unknown) {
  fs.writeFileSync(path.join(cwd, rel), JSON.stringify(doc, null, 2));
  return rel;
}

function push(args: string[]) {
  const program = makeProgram();
  registerPushCommand(program);
  return runCommand(program, ['push', ...args, '--yes', '--json'], { cwd });
}

const HTTP_DOC = {
  formatVersion: '1',
  name: 'ZHTTP_DISPATCH',
  header: { description: 'HTTP dispatch', originalLanguage: 'EN' },
  generalInformation: { handlerClass: 'ZCL_HTTP_HANDLER', url: '/sap/zhttp' },
};

const TABL_DOC = {
  formatVersion: '1',
  name: 'ZTAB_DISPATCH',
  package: '$TMP',
  header: { description: 'Table dispatch', originalLanguage: 'EN' },
  generalInformation: { deliveryClass: 'A', dataClassCategory: 'APPL0', sizeCategory: '0', clientDependent: false },
  fields: [{ fieldName: 'FIELD1', dataType: 'CHAR', length: 20, keyFlag: true }],
};

const DOMA_DOC = {
  name: 'ZDOMA_DISPATCH',
  description: 'Domain dispatch',
  format: { dataType: 'CHAR', length: 10, decimals: 0, signFlag: '', lowercase: '', convExit: '' },
};

const DTEL_DOC = {
  name: 'ZDTEL_DISPATCH',
  description: 'Data element dispatch',
  dataTypeInformation: { category: 'domain', typeName: 'ZDOMA_DISPATCH' },
};

const DOCS: Record<string, unknown> = { HTTP: HTTP_DOC, TABL: TABL_DOC, DOMA: DOMA_DOC, DTEL: DTEL_DOC };
const fileFor = (type: string) => `src/z${type.toLowerCase()}_dispatch.${type.toLowerCase()}.json`;

describe('Phase 4 — ICF push routing table', () => {
  it('HTTP routes to postHttp without an existence probe', async () => {
    write(fileFor('HTTP'), DOCS.HTTP);
    const res = await push([fileFor('HTTP'), '--tr', 'TRN001']);
    expect(res.exitCode).toBeUndefined();
    expect(icfPostHttp).toHaveBeenCalledTimes(1);
    expect(icfGetDdic).not.toHaveBeenCalled();
    expect(icfPostDdic).not.toHaveBeenCalled();
    const result = JSON.parse(res.stdout).data.results[0] as { status: string; stage: string };
    expect(result).toMatchObject({ status: 'written', stage: 'ddic-icf' });
  });

  it('TABL routes to postDdic + getDdic existence probe', async () => {
    write(fileFor('TABL'), DOCS.TABL);
    const res = await push([fileFor('TABL'), '--tr', 'TRN001']);
    expect(res.exitCode).toBeUndefined();
    expect(icfPostDdic).toHaveBeenCalledTimes(1);
    expect(icfGetDdic).toHaveBeenCalledTimes(1);
    expect(icfPostHttp).not.toHaveBeenCalled();
  });

  it('DOMA routes to postDdic + getDdic existence probe', async () => {
    write(fileFor('DOMA'), DOCS.DOMA);
    const res = await push([fileFor('DOMA'), '--tr', 'TRN001']);
    expect(res.exitCode).toBeUndefined();
    expect(icfPostDdic).toHaveBeenCalledTimes(1);
    expect(icfGetDdic).toHaveBeenCalledTimes(1);
  });

  it('DTEL routes to postDdic + getDdic existence probe', async () => {
    write(fileFor('DTEL'), DOCS.DTEL);
    const res = await push([fileFor('DTEL'), '--tr', 'TRN001']);
    expect(res.exitCode).toBeUndefined();
    expect(icfPostDdic).toHaveBeenCalledTimes(1);
    expect(icfGetDdic).toHaveBeenCalledTimes(1);
  });

  it('TRAN routes to postTran + getTran existence probe (not the DDIC path)', async () => {
    const fixture = JSON.parse(fs.readFileSync(path.resolve('test/fixtures/tran/z_aff_example_tran.tran.json'), 'utf8'));
    write('src/z_aff_example_tran.tran.json', { ...fixture, name: 'Z_AFF_EXAMPLE_TRAN' });
    const res = await push(['src/z_aff_example_tran.tran.json', '--tr', 'TRN001']);
    expect(res.exitCode).toBeUndefined();
    expect(icfPostTran).toHaveBeenCalledTimes(1);
    expect(icfGetTran).toHaveBeenCalledTimes(1);
    expect(icfPostDdic).not.toHaveBeenCalled();
  });

  it.each(['HTTP', 'TABL', 'DOMA', 'DTEL'])('%s rejects --check-only before any ICF call', async (type) => {
    write(fileFor(type), DOCS[type]);
    const res = await push([fileFor(type), '--check-only', '--tr', 'TRN001']);
    expect(res.exitCode).not.toBe(0);
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('VALIDATION_ERROR');
    expect(out.error.message).toMatch(/--check-only is not supported/);
    expect(icfPostHttp).not.toHaveBeenCalled();
    expect(icfPostDdic).not.toHaveBeenCalled();
  });

  it.each(['HTTP', 'TABL', 'DOMA', 'DTEL'])('%s plans without any ICF call under --dry-run', async (type) => {
    write(fileFor(type), DOCS[type]);
    const res = await push([fileFor(type), '--dry-run', '--tr', 'TRN001']);
    expect(res.exitCode).toBeUndefined();
    expect(JSON.parse(res.stdout).data.dryRun).toBe(true);
    expect(icfPostHttp).not.toHaveBeenCalled();
    expect(icfPostDdic).not.toHaveBeenCalled();
  });

  it('an ICF-routed type still fails validation before any ICF call', async () => {
    write('src/zdoma_bad.doma.json', { name: 'ZDOMA_BAD', description: 'missing format' });
    const res = await push(['src/zdoma_bad.doma.json', '--tr', 'TRN001']);
    expect(res.exitCode).not.toBe(0);
    expect(icfPostDdic).not.toHaveBeenCalled();
    expect(icfGetDdic).not.toHaveBeenCalled();
  });

  it('TTYP .json resolves to its channel-routed flow, not the ICF table', async () => {
    // Regression: TTYP/MSAG/DDLS reach `route: 'adt'` (registry source='ADT') but
    // are AFF JSON, so `pushOne` must intercept them before the generic source
    // path. Before the fix they fell through to resolveObject/readAbapFile.
    const doc = {
      formatVersion: '1',
      header: { description: 'tt', originalLanguage: 'EN' },
      accessType: 'standard',
      lineType: { rowType: 'STRING' },
    };
    write('src/zmy_tt.ttyp.json', doc);
    const res = await push(['src/zmy_tt.ttyp.json', '--tr', 'TRN001']);
    expect(res.exitCode).toBeUndefined();
    expect(adtGetTtyp).toHaveBeenCalledTimes(1);
    expect(adtUpdateTtyp).toHaveBeenCalledTimes(1);
    // Must not have gone down the ICF table.
    expect(icfPostDdic).not.toHaveBeenCalled();
    expect(icfPostHttp).not.toHaveBeenCalled();
    const result = JSON.parse(res.stdout).data.results[0] as { status: string; stage: string };
    expect(result).toMatchObject({ status: 'written', stage: 'channel-adt' });
  });

  it('MSAG .json routes to its channel flow', async () => {
    write('src/zmy_msag.msag.json', {
      formatVersion: '1',
      header: { description: 'ms', originalLanguage: 'EN' },
      messages: [{ number: '001', text: 'hello' }],
    });
    const res = await push(['src/zmy_msag.msag.json', '--tr', 'TRN001']);
    expect(res.exitCode).toBeUndefined();
    expect(adtGetMsag).toHaveBeenCalledTimes(1);
    expect(adtUpdateMsag).toHaveBeenCalledTimes(1);
    expect(icfPostDdic).not.toHaveBeenCalled();
  });

  it('channel-routed JSON rejects --check-only before any write', async () => {
    write('src/zmy_tt.ttyp.json', {
      formatVersion: '1',
      header: { description: 'tt', originalLanguage: 'EN' },
      accessType: 'standard',
      lineType: { rowType: 'STRING' },
    });
    const res = await push(['src/zmy_tt.ttyp.json', '--check-only', '--tr', 'TRN001']);
    expect(res.exitCode).not.toBe(0);
    expect(JSON.parse(res.stderr).error.code).toBe('VALIDATION_ERROR');
    expect(adtUpdateTtyp).not.toHaveBeenCalled();
    expect(adtGetTtyp).not.toHaveBeenCalled();
  });

  it('channel-routed JSON plans without any SAP call under --dry-run', async () => {
    write('src/zmy_tt.ttyp.json', {
      formatVersion: '1',
      header: { description: 'tt', originalLanguage: 'EN' },
      accessType: 'standard',
      lineType: { rowType: 'STRING' },
    });
    const res = await push(['src/zmy_tt.ttyp.json', '--dry-run', '--tr', 'TRN001']);
    expect(res.exitCode).toBeUndefined();
    expect(JSON.parse(res.stdout).data.dryRun).toBe(true);
    expect(adtGetTtyp).not.toHaveBeenCalled();
    expect(adtUpdateTtyp).not.toHaveBeenCalled();
  });
});
