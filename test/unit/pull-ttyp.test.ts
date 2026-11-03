/**
 * +: TTYP pull — ADT primary channel and the
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

const TTYP_BASIC_XML = `<?xml version="1.0" encoding="utf-8"?><ttyp:tableType adtcore:masterLanguage="EN" adtcore:name="ZMY_TTYP" adtcore:type="TTYP/DA" adtcore:description="Basic standard table" adtcore:language="EN" xmlns:ttyp="http://www.sap.com/dictionary/tabletype" xmlns:adtcore="http://www.sap.com/adt/core"><ttyp:rowType><ttyp:typeKind>dictionaryType</ttyp:typeKind><ttyp:typeName>LVC_S_TABL</ttyp:typeName><ttyp:builtInType><ttyp:dataType>STRU</ttyp:dataType><ttyp:length>000000</ttyp:length><ttyp:decimals>000000</ttyp:decimals></ttyp:builtInType><ttyp:rangeType/></ttyp:rowType><ttyp:accessType>standard</ttyp:accessType><ttyp:primaryKey><ttyp:definition>standard</ttyp:definition><ttyp:kind>nonUnique</ttyp:kind><ttyp:components/><ttyp:alias/></ttyp:primaryKey></ttyp:tableType>`;

const TTYP_HASHED_XML = `<?xml version="1.0" encoding="utf-8"?><ttyp:tableType adtcore:masterLanguage="EN" adtcore:name="ZMY_HASHED" adtcore:type="TTYP/DA" adtcore:description="Hashed table" adtcore:language="EN" xmlns:ttyp="http://www.sap.com/dictionary/tabletype" xmlns:adtcore="http://www.sap.com/adt/core"><ttyp:rowType><ttyp:typeKind>dictionaryType</ttyp:typeKind><ttyp:typeName>ZMY_STRUCT</ttyp:typeName><ttyp:builtInType><ttyp:dataType>STRU</ttyp:dataType><ttyp:length>000000</ttyp:length><ttyp:decimals>000000</ttyp:decimals></ttyp:builtInType><ttyp:rangeType/></ttyp:rowType><ttyp:accessType>hashed</ttyp:accessType><ttyp:primaryKey><ttyp:definition>keyComponents</ttyp:definition><ttyp:kind>unique</ttyp:kind><ttyp:components><ttyp:component ttyp:name="CARRID"/><ttyp:component ttyp:name="CONNID"/></ttyp:components><ttyp:alias/></ttyp:primaryKey></ttyp:tableType>`;

const TTYP_CHAR10_XML = `<?xml version="1.0" encoding="utf-8"?><ttyp:tableType adtcore:masterLanguage="EN" adtcore:name="ZMY_CHARS" adtcore:type="TTYP/DA" adtcore:description="char10 rows" adtcore:language="EN" xmlns:ttyp="http://www.sap.com/dictionary/tabletype" xmlns:adtcore="http://www.sap.com/adt/core"><ttyp:rowType><ttyp:typeKind>predefinedAbapType</ttyp:typeKind><ttyp:typeName/><ttyp:builtInType><ttyp:dataType>CHAR</ttyp:dataType><ttyp:length>000010</ttyp:length><ttyp:decimals>000000</ttyp:decimals></ttyp:builtInType><ttyp:rangeType/></ttyp:rowType><ttyp:accessType>standard</ttyp:accessType><ttyp:primaryKey><ttyp:definition>standard</ttyp:definition><ttyp:kind>nonUnique</ttyp:kind><ttyp:components/><ttyp:alias/></ttyp:primaryKey></ttyp:tableType>`;

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

describe('runPullTtyp — ADT channel', () => {
  it('pulls via ADT and writes the json document', async () => {
    const { runPullTtyp } = await import('../../src/abap_cli/flows/edit/pull-ttyp.js');
    const { clearChannelCache } = await import('../../src/abap_cli/flows/edit/channel-detect.js');
    clearChannelCache();

    const result = await runPullTtyp('zmy_ttyp', { profile: ADT_PROFILE, rootDir: root });

    expect(result.channel).toBe('adt');
    expect(result.fallbackReason).toBeUndefined();
    expect(result.object).toBe('ZMY_TTYP');
    expect(adtGetTtyp).toHaveBeenCalledTimes(1);
    expect(icfGet).not.toHaveBeenCalled();
    expect(result.files).toHaveLength(1);

    const json = JSON.parse(fs.readFileSync(path.join(root, 'zmy_ttyp.ttyp.json'), 'utf8'));
    expect(json.accessType).toBe('standard');
    expect(json.lineType.rowType).toBe('LVC_S_TABL');
    expect(fs.existsSync(path.join(root, 'zmy_ttyp.type.abap'))).toBe(false);
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
      { keyField: 'CONNID', descending: false },
    ]);
    expect(result.doc.keyKind).toBe('unique');
  });

  it('writes the predefined row type length and renders it in the sidecar', async () => {
    adtGetTtyp.mockResolvedValueOnce(TTYP_CHAR10_XML);
    const { runPullTtyp } = await import('../../src/abap_cli/flows/edit/pull-ttyp.js');
    const { clearChannelCache } = await import('../../src/abap_cli/flows/edit/channel-detect.js');
    clearChannelCache();

    const result = await runPullTtyp('zmy_chars', { profile: ADT_PROFILE, rootDir: root });

    const json = JSON.parse(fs.readFileSync(path.join(root, 'zmy_chars.ttyp.json'), 'utf8'));
    expect(json.lineType).toEqual({ rowType: 'CHAR', rowTypeLength: 10 });
    expect(result.doc.lineType.rowTypeLength).toBe(10);
  });

});

describe('runPullTtyp — runtime ADT endpoint fallback', () => {
  it('falls back to ICF when the ADT endpoint answers "No URI-Mapping"', async () => {
    adtGetTtyp.mockRejectedValueOnce(new Error('No URI-Mapping defined for URI'));
    const { runPullTtyp } = await import('../../src/abap_cli/flows/edit/pull-ttyp.js');
    const { clearChannelCache } = await import('../../src/abap_cli/flows/edit/channel-detect.js');
    clearChannelCache();

    const result = await runPullTtyp('zmy_ttyp', { profile: ADT_PROFILE, rootDir: root });

    expect(result.channel).toBe('icf');
    expect(result.fallbackReason).toBe('ADT_ENDPOINT_UNAVAILABLE');
    expect(icfGet).toHaveBeenCalledWith('/ddic/ttyp/ZMY_TTYP');
  });

  it('maps an ADT 404 onto OBJECT_NOT_FOUND', async () => {
    const { CliError } = await import('../../src/abap_cli/output/json.js');
    adtGetTtyp.mockRejectedValueOnce(
      new CliError('SAP_ERROR', 'Resource TTYP ZMY_NOPE does not exist.', { details: { httpStatus: 404 } }),
    );
    const { runPullTtyp } = await import('../../src/abap_cli/flows/edit/pull-ttyp.js');
    const { clearChannelCache } = await import('../../src/abap_cli/flows/edit/channel-detect.js');
    clearChannelCache();

    await expect(runPullTtyp('zmy_nope', { profile: ADT_PROFILE, rootDir: root })).rejects.toMatchObject({
      code: 'OBJECT_NOT_FOUND',
    });
    expect(icfGet).not.toHaveBeenCalled();
  });
});

describe('runPullTtyp — ICF fallback (036 / )', () => {
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
