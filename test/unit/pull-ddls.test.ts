/**
 * DDLS pull — ADT-only channel plus the ECC hard error
 * (exit 64, `DDLS_NOT_SUPPORTED_ON_ECC`, zero SAP calls).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const VIEW_ENTITY_SOURCE = `@AccessControl.authorizationCheck: #NOT_REQUIRED
define view entity ZMY_VIEW_ENTITY
  as select from sflight
{
  key carrid,
  key connid,
      price
}`;

const DDIC_BASED_SOURCE = `@AbapCatalog.sqlViewName: 'ZMYDDICV'
define view ZMY_DDIC_BASED
  as select from spfli
{
  key carrid,
  key connid
}`;

/** Real ADT metadata document: header in attributes, source fetched separately. */
function wireBody(_source: string, description: string, sourceType = 'view entity'): string {
  return `<?xml version="1.0" encoding="utf-8"?><ddl:ddlSource ddl:source_origin="0" ddl:source_type="${sourceType}" ddl:source_type_description="View Entity" ddl:source_origin_description="ABAP Development Tools" abapsource:sourceUri="source/main" adtcore:name="ZMY_VIEW_ENTITY" adtcore:type="DDLS/DF" adtcore:description="${description}" adtcore:language="EN" adtcore:masterLanguage="EN" xmlns:ddl="http://www.sap.com/adt/ddic/ddlsources" xmlns:abapsource="http://www.sap.com/adt/abapsource" xmlns:adtcore="http://www.sap.com/adt/core"/>`;
}

const adtGetDdls = vi.fn(async () => ({
  xml: wireBody(VIEW_ENTITY_SOURCE, 'View entity'),
  source: VIEW_ENTITY_SOURCE,
}));

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: { create: async () => ({ getDdls: adtGetDdls }) },
}));
// Every test supplies an explicit profile + rootDir, so the workspace config
// is never consulted — stub it out so no keychain/native module is loaded.
vi.mock('../../src/abap_cli/config/project-config.js', () => ({
  loadConfig: async () => ({ systemVersion: '793' }),
  findWorkspaceConfig: () => undefined,
}));

const ADT_PROFILE = { kernelRelease: '793' };
/** ECC EHP6 — DDL sources do not exist on this kernel. */
const ECC_PROFILE = { kernelRelease: '731' };

let root: string;
beforeEach(() => {
  vi.clearAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pull-ddls-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

async function load() {
  const { runPullDdls } = await import('../../src/abap_cli/flows/edit/pull-ddls.js');
  const { clearChannelCache } = await import('../../src/abap_cli/flows/edit/channel-detect.js');
  clearChannelCache();
  return runPullDdls;
}

describe('runPullDdls — ADT channel', () => {
  it('writes the .ddls.json + .ddls.acds pair', async () => {
    const runPullDdls = await load();
    const result = await runPullDdls('zmy_view_entity', { profile: ADT_PROFILE, rootDir: root });

    expect(result.channel).toBe('adt');
    expect(result.files).toHaveLength(2);
    expect(result.doc.sourceType).toBe('viewEntity');

    const dir = root;
    const json = JSON.parse(fs.readFileSync(path.join(dir, 'zmy_view_entity.ddls.json'), 'utf8'));
    expect(json.sourceType).toBe('viewEntity');
    expect(json.header.originalLanguage).toBe('EN');
    expect(fs.readFileSync(path.join(dir, 'zmy_view_entity.ddls.acds'), 'utf8')).toContain('define view entity');
  });

  it('detects the ddicBasedView form from the DDL body', async () => {
    adtGetDdls.mockResolvedValueOnce({
      xml: wireBody(DDIC_BASED_SOURCE, 'DDIC based view', 'ddic based view'),
      source: DDIC_BASED_SOURCE,
    });
    const runPullDdls = await load();
    const result = await runPullDdls('zmy_ddic_based', { profile: ADT_PROFILE, rootDir: root });

    expect(result.doc.sourceType).toBe('ddicBasedView');
    expect(result.source).toContain('sqlViewName');
  });
});

describe('runPullDdls — ECC hard error (036 / )', () => {
  it('throws DDLS_NOT_SUPPORTED_ON_ECC without contacting SAP', async () => {
    const runPullDdls = await load();
    await expect(runPullDdls('zmy_view_entity', { profile: ECC_PROFILE, rootDir: root })).rejects.toMatchObject({
      code: 'DDLS_NOT_SUPPORTED_ON_ECC',
    });
    expect(adtGetDdls).not.toHaveBeenCalled();
  });

  it('exposes the upgrade hint in the error message', async () => {
    const runPullDdls = await load();
    await expect(runPullDdls('zmy_view_entity', { profile: ECC_PROFILE, rootDir: root })).rejects.toThrow(
      /ECC EHP7\+ or S\/4HANA/,
    );
  });

  it('maps an ADT 404 onto OBJECT_NOT_FOUND', async () => {
    const { CliError } = await import('../../src/abap_cli/output/json.js');
    adtGetDdls.mockRejectedValueOnce(
      new CliError('SAP_ERROR', 'Resource DDLS ZMY_NOPE does not exist.', { details: { httpStatus: 404 } }),
    );
    const runPullDdls = await load();
    await expect(runPullDdls('zmy_nope', { profile: ADT_PROFILE, rootDir: root })).rejects.toMatchObject({
      code: 'OBJECT_NOT_FOUND',
    });
  });

  it('honours an explicit ddlsSupported flag on an old kernel', async () => {
    const runPullDdls = await load();
    const result = await runPullDdls('zmy_view_entity', {
      profile: { kernelRelease: '731', ddlsSupported: true },
      rootDir: root,
    });
    expect(result.channel).toBe('adt');
  });
});
