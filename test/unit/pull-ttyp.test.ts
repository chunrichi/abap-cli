/**
 * Spec 036 T036-019 + T036-047: TTYP pull — ADT primary channel and the
 * ICF fallback path selected by channel-detect.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const adtGetTtyp = vi.fn(async () => TTYP_BASIC_XML);
const icfGet = vi.fn(async () => ({
  status: 'success' as const,
  data: { main: ICF_TTYP_DOC },
  error: null,
}));

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: { create: async () => ({ getTtyp: adtGetTtyp }) },
}));
vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: { create: async () => ({ get: icfGet }) },
}));
// Every test supplies an explicit profile + rootDir, so the workspace config
// is never consulted — stub it out so no keychain/native module is loaded.
vi.mock('../../src/abap_cli/config/project-config.js', () => ({
  loadConfig: async () => ({ systemVersion: '793' }),
  findWorkspaceConfig: () => undefined,
}));

const TTYP_BASIC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ttyp:tableType xmlns:ttyp="http://www.sap.com/adt/ddic/tabletypes">
  <ttyp:name>ZMY_TTYP</ttyp:name>
  <ttyp:description>Basic standard table</ttyp:description>
  <ttyp:originalLanguage>EN</ttyp:originalLanguage>
  <ttyp:accessType>STANDARD</ttyp:accessType>
  <ttyp:lineType>STRING</ttyp:lineType>
</ttyp:tableType>`;

const TTYP_HASHED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ttyp:tableType xmlns:ttyp="http://www.sap.com/adt/ddic/tabletypes">
  <ttyp:name>ZMY_HASHED</ttyp:name>
  <ttyp:description>Hashed table</ttyp:description>
  <ttyp:originalLanguage>EN</ttyp:originalLanguage>
  <ttyp:accessType>HASHED</ttyp:accessType>
  <ttyp:lineType>ZMY_STRUCT</ttyp:lineType>
  <ttyp:key keyField="CARRID" descending="false"/>
  <ttyp:key keyField="CONNID" descending="true"/>
</ttyp:tableType>`;

const ICF_TTYP_DOC = {
  formatVersion: '1',
  header: { description: 'ECC fallback table type', originalLanguage: 'EN' },
  accessType: 'standard',
  lineType: { rowType: 'STRING' },
};

/** S/4HANA-era kernel — channel-detect picks ADT. */
const ADT_PROFILE = { kernelRelease: '793' };
/** ECC EHP6 kernel — channel-detect picks ICF. */
const ECC_PROFILE = { kernelRelease: '731' };

let root: string;

beforeEach(() => {
  vi.clearAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pull-ttyp-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('runPullTtyp — ADT channel (036 US2)', () => {
  it('pulls via ADT and writes the json + type.abap pair', async () => {
    const { runPullTtyp } = await import('../../src/abap_cli/flows/edit/pull-ttyp.js');
    const { clearChannelCache } = await import('../../src/abap_cli/flows/edit/channel-detect.js');
    clearChannelCache();

    const result = await runPullTtyp('zmy_ttyp', { profile: ADT_PROFILE, rootDir: root });

    expect(result.channel).toBe('adt');
    expect(result.fallbackReason).toBeUndefined();
    expect(result.object).toBe('ZMY_TTYP');
    expect(adtGetTtyp).toHaveBeenCalledTimes(1);
    expect(icfGet).not.toHaveBeenCalled();
    expect(result.files).toHaveLength(2);

    const json = JSON.parse(fs.readFileSync(path.join(root, 'ttyp/zmy_ttyp/zmy_ttyp.ttyp.json'), 'utf8'));
    expect(json.accessType).toBe('standard');
    expect(json.lineType.rowType).toBe('STRING');
    expect(fs.existsSync(path.join(root, 'ttyp/zmy_ttyp/zmy_ttyp.type.abap'))).toBe(true);
  });

  it('carries the keyDefinition array for hashed tables', async () => {
    adtGetTtyp.mockResolvedValueOnce(TTYP_HASHED_XML);
    const { runPullTtyp } = await import('../../src/abap_cli/flows/edit/pull-ttyp.js');
    const { clearChannelCache } = await import('../../src/abap_cli/flows/edit/channel-detect.js');
    clearChannelCache();

    const result = await runPullTtyp('zmy_hashed', { profile: ADT_PROFILE, rootDir: root });

    expect(result.doc.accessType).toBe('hashed');
    expect(result.doc.keyDefinition).toEqual([
      { keyField: 'CARRID', descending: false },
      { keyField: 'CONNID', descending: true },
    ]);
  });

  it('skips the type.abap sidecar when asked', async () => {
    const { runPullTtyp } = await import('../../src/abap_cli/flows/edit/pull-ttyp.js');
    const { clearChannelCache } = await import('../../src/abap_cli/flows/edit/channel-detect.js');
    clearChannelCache();

    const result = await runPullTtyp('zmy_ttyp', { profile: ADT_PROFILE, rootDir: root, skipTypeAbap: true });

    expect(result.files).toHaveLength(1);
    expect(fs.existsSync(path.join(root, 'ttyp/zmy_ttyp/zmy_ttyp.type.abap'))).toBe(false);
  });
});

describe('runPullTtyp — ICF fallback (036 US5 / SC-003)', () => {
  it('routes to ICF on an ECC EHP6 kernel and reports the fallback reason', async () => {
    const { runPullTtyp } = await import('../../src/abap_cli/flows/edit/pull-ttyp.js');
    const { clearChannelCache } = await import('../../src/abap_cli/flows/edit/channel-detect.js');
    clearChannelCache();

    const result = await runPullTtyp('zmy_ttyp', { profile: ECC_PROFILE, rootDir: root });

    expect(result.channel).toBe('icf');
    expect(result.fallbackReason).toBe('ECC_EHP6_NO_ADT_TABLETYPE');
    expect(icfGet).toHaveBeenCalledWith('/ddic/ttyp/ZMY_TTYP');
    expect(adtGetTtyp).not.toHaveBeenCalled();
  });

  it('maps an ICF NOT_FOUND response onto OBJECT_NOT_FOUND', async () => {
    icfGet.mockResolvedValueOnce({
      status: 'error' as never,
      data: null as never,
      error: { code: 'NOT_FOUND', message: 'TTYP ZMY_MISSING not found' } as never,
    });
    const { runPullTtyp } = await import('../../src/abap_cli/flows/edit/pull-ttyp.js');
    const { clearChannelCache } = await import('../../src/abap_cli/flows/edit/channel-detect.js');
    clearChannelCache();

    await expect(runPullTtyp('zmy_missing', { profile: ECC_PROFILE, rootDir: root })).rejects.toMatchObject({
      code: 'OBJECT_NOT_FOUND',
    });
  });
});
