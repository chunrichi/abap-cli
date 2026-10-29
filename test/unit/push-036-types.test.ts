/**
 * Spec 036 T036-012 / T036-023 / T036-034 + SC-007: push flows for the three
 * channel-routed types. Covers ADT update, ICF fallback, spec-035
 * OBJECT_NOT_FOUND semantics, and the DDLS sourceType cross-check.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const adtGetTtyp = vi.fn(async () => '<ttyp:tableType/>');
const adtUpdateTtyp = vi.fn(async () => undefined);
const adtGetMsag = vi.fn(async () => '<mc:messageClass/>');
const adtUpdateMsag = vi.fn(async () => undefined);
const adtGetDdls = vi.fn(async () => ({ xml: '<ddl:ddlSource/>', source: '' }));
const adtUpdateDdls = vi.fn(async () => undefined);
const adtLock = vi.fn(async () => ({ LOCK_HANDLE: 'LH1' }));
const adtUnlock = vi.fn(async () => undefined);

const icfPut = vi.fn(async () => ({ status: 'success' as const, data: {}, error: null }));

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      getTtyp: adtGetTtyp,
      updateTtyp: adtUpdateTtyp,
      getMsag: adtGetMsag,
      updateMsag: adtUpdateMsag,
      getDdls: adtGetDdls,
      updateDdls: adtUpdateDdls,
      lock: adtLock,
      unLock: adtUnlock,
    }),
  },
}));
vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: { create: async () => ({ put: icfPut }) },
}));
// Every test supplies an explicit profile, so the workspace config is never
// consulted — stub it out so no keychain/native module is loaded.
vi.mock('../../src/abap_cli/config/project-config.js', () => ({
  loadConfig: async () => ({ systemVersion: '793' }),
  findWorkspaceConfig: () => undefined,
}));

const ADT_PROFILE = { kernelRelease: '793' };
const ECC_PROFILE = { kernelRelease: '731' };

const TTYP_DOC = {
  formatVersion: '1',
  header: { description: 'Push me', originalLanguage: 'EN' },
  accessType: 'standard',
  lineType: { rowType: 'STRING' },
};

const MSAG_DOC = {
  formatVersion: '1',
  header: { description: 'Push me', originalLanguage: 'EN' },
  messages: [{ number: '001', text: 'Object &1 pushed' }],
};

const DDLS_DOC = {
  formatVersion: '1',
  header: { description: 'Push me', originalLanguage: 'EN' },
  sourceOrigin: 'abapDevelopmentTools',
  sourceType: 'viewEntity',
};

const DDLS_SOURCE = `define view entity ZMY_DDLS
  as select from sflight
{
  key carrid
}`;

let cwd: string;

beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'push-036-'));
});
afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

/** Absolute paths keep the flows cwd-independent (vitest workers forbid chdir). */
function write(name: string, doc: unknown): string {
  const file = path.join(cwd, name);
  fs.writeFileSync(file, JSON.stringify(doc, null, 2));
  return file;
}

async function fresh() {
  const { clearChannelCache } = await import('../../src/abap_cli/flows/edit/channel-detect.js');
  clearChannelCache();
}

describe('runPushTtyp (036 US2)', () => {
  it('locks, updates and unlocks via ADT', async () => {
    await fresh();
    const { runPushTtyp } = await import('../../src/abap_cli/flows/edit/push-ttyp.js');
    const file = write('zmy_ttyp.ttyp.json', TTYP_DOC);

    const result = await runPushTtyp(file, { profile: ADT_PROFILE, transport: 'NDK900001' });

    expect(result).toMatchObject({ object: 'ZMY_TTYP', channel: 'adt', action: 'updated' });
    expect(adtLock).toHaveBeenCalledWith('/sap/bc/adt/ddic/tabletypes/ZMY_TTYP');
    expect(adtUpdateTtyp).toHaveBeenCalledWith('ZMY_TTYP', expect.stringContaining('ttyp:tableType'), 'LH1', 'NDK900001');
    expect(adtUnlock).toHaveBeenCalledWith('/sap/bc/adt/ddic/tabletypes/ZMY_TTYP', 'LH1');
  });

  it('reports OBJECT_NOT_FOUND instead of creating the object (spec 035)', async () => {
    await fresh();
    adtGetTtyp.mockRejectedValueOnce(new Error('404'));
    const { runPushTtyp } = await import('../../src/abap_cli/flows/edit/push-ttyp.js');
    const file = write('zmy_ttyp.ttyp.json', TTYP_DOC);

    await expect(runPushTtyp(file, { profile: ADT_PROFILE })).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    expect(adtUpdateTtyp).not.toHaveBeenCalled();
  });

  it('falls back to ICF on an ECC EHP6 kernel', async () => {
    await fresh();
    const { runPushTtyp } = await import('../../src/abap_cli/flows/edit/push-ttyp.js');
    const file = write('zmy_ttyp.ttyp.json', TTYP_DOC);

    const result = await runPushTtyp(file, { profile: ECC_PROFILE });

    expect(result.channel).toBe('icf');
    expect(result.fallbackReason).toBe('ECC_EHP6_NO_ADT_TABLETYPE');
    expect(icfPut).toHaveBeenCalledWith('/ddic/ttyp/ZMY_TTYP', { main: TTYP_DOC });
    expect(adtUpdateTtyp).not.toHaveBeenCalled();
  });

  it('surfaces an ICF LOCK_FAILED response as a CLI error', async () => {
    await fresh();
    icfPut.mockResolvedValueOnce({
      status: 'error' as never,
      data: null as never,
      error: { code: 'LOCK_FAILED', message: 'ZMY_TTYP is locked by another user' } as never,
    });
    const { runPushTtyp } = await import('../../src/abap_cli/flows/edit/push-ttyp.js');
    const file = write('zmy_ttyp.ttyp.json', TTYP_DOC);

    await expect(runPushTtyp(file, { profile: ECC_PROFILE })).rejects.toThrow(/locked by another user/);
  });

  it('rejects a schema-invalid document before touching SAP', async () => {
    await fresh();
    const { runPushTtyp } = await import('../../src/abap_cli/flows/edit/push-ttyp.js');
    const file = write('zmy_bad.ttyp.json', { ...TTYP_DOC, accessType: 'invalid' });

    await expect(runPushTtyp(file, { profile: ADT_PROFILE })).rejects.toMatchObject({ code: 'AFF_FIXTURE_INVALID' });
    expect(adtLock).not.toHaveBeenCalled();
  });
});

describe('runPushMsag (036 US3)', () => {
  it('locks, updates and unlocks via ADT', async () => {
    await fresh();
    const { runPushMsag } = await import('../../src/abap_cli/flows/edit/push-msag.js');
    const file = write('zmy_msag.msag.json', MSAG_DOC);

    const result = await runPushMsag(file, { profile: ADT_PROFILE, transport: 'NDK900002' });

    expect(result).toMatchObject({ object: 'ZMY_MSAG', channel: 'adt', action: 'updated' });
    expect(adtUpdateMsag).toHaveBeenCalledWith('ZMY_MSAG', expect.stringContaining('Object &amp;1 pushed'), 'LH1', 'NDK900002');
  });

  it('reports OBJECT_NOT_FOUND for a missing message class', async () => {
    await fresh();
    adtGetMsag.mockRejectedValueOnce(new Error('404'));
    const { runPushMsag } = await import('../../src/abap_cli/flows/edit/push-msag.js');
    const file = write('zmy_msag.msag.json', MSAG_DOC);

    await expect(runPushMsag(file, { profile: ADT_PROFILE })).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' });
  });

  it('falls back to ICF on an ECC EHP6 kernel', async () => {
    await fresh();
    const { runPushMsag } = await import('../../src/abap_cli/flows/edit/push-msag.js');
    const file = write('zmy_msag.msag.json', MSAG_DOC);

    const result = await runPushMsag(file, { profile: ECC_PROFILE });

    expect(result.channel).toBe('icf');
    expect(result.fallbackReason).toBe('ECC_EHP6_NO_ADT_MESSAGECLASS');
    expect(icfPut).toHaveBeenCalledWith('/ddic/msag/ZMY_MSAG', { main: MSAG_DOC });
  });
});

describe('runPushDdls (036 US4)', () => {
  function writeDdls(sourceType = 'viewEntity', source = DDLS_SOURCE): string {
    const file = path.join(cwd, 'zmy_ddls.ddls.json');
    fs.writeFileSync(file, JSON.stringify({ ...DDLS_DOC, sourceType }, null, 2));
    fs.writeFileSync(path.join(cwd, 'zmy_ddls.ddls.acds'), source);
    return file;
  }

  it('locks, updates and unlocks via ADT', async () => {
    await fresh();
    const { runPushDdls } = await import('../../src/abap_cli/flows/edit/push-ddls.js');
    const file = writeDdls();

    const result = await runPushDdls(file, { profile: ADT_PROFILE, transport: 'NDK900003' });

    expect(result).toMatchObject({ object: 'ZMY_DDLS', channel: 'adt', action: 'updated' });
    expect(adtUpdateDdls).toHaveBeenCalledWith('ZMY_DDLS', expect.stringContaining('define view entity'), 'LH1', 'NDK900003');
  });

  it('rejects a sourceType that disagrees with the .acds body', async () => {
    await fresh();
    const { runPushDdls } = await import('../../src/abap_cli/flows/edit/push-ddls.js');
    const file = writeDdls('tableFunction');

    await expect(runPushDdls(file, { profile: ADT_PROFILE })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(adtUpdateDdls).not.toHaveBeenCalled();
  });

  it('rejects a missing .acds companion file', async () => {
    await fresh();
    const { runPushDdls } = await import('../../src/abap_cli/flows/edit/push-ddls.js');
    const file = write('zmy_orphan.ddls.json', DDLS_DOC);

    await expect(runPushDdls(file, { profile: ADT_PROFILE })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('hard-errors on ECC instead of falling back', async () => {
    await fresh();
    const { runPushDdls } = await import('../../src/abap_cli/flows/edit/push-ddls.js');
    const file = writeDdls();

    await expect(runPushDdls(file, { profile: ECC_PROFILE })).rejects.toMatchObject({
      code: 'DDLS_NOT_SUPPORTED_ON_ECC',
    });
    expect(icfPut).not.toHaveBeenCalled();
    expect(adtUpdateDdls).not.toHaveBeenCalled();
  });
});
