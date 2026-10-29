/**
 * Phase 2/3 — `runPull` dispatcher coverage.
 *
 * The per-type pull flows (`runPullTtyp`, `runPullMsag`, ...) are covered by
 * their own tests, but those import the per-type function directly and never
 * exercise the coordinator: the `pullHandlerFor` lookup and the shared
 * `wrapPullResult` envelope. These tests drive `runPull` so a regression in
 * the dispatch table or the envelope shape is caught.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { systemVersion: '793' } as { systemVersion?: string },
}));

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
vi.mock('../../src/abap_cli/config/project-config.js', () => ({
  loadConfig: async () => mockConfig,
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

const ICF_TTYP_DOC = {
  formatVersion: '1',
  header: { description: 'ECC fallback table type', originalLanguage: 'EN' },
  accessType: 'standard',
  lineType: { rowType: 'STRING' },
};

let root: string;
beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.systemVersion = '793';
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pull-dispatch-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

async function runPull(name: string, type: string) {
  const { runPull } = await import('../../src/abap_cli/flows/edit/pull.js');
  return runPull(name, { type, dir: root });
}

describe('pull dispatcher — handler registry routing + envelope', () => {
  it('routes TTYP through the registry table and wraps the result', async () => {
    const res = await runPull('ZMY_TTYP', 'TTYP');
    expect(adtGetTtyp).toHaveBeenCalledWith('ZMY_TTYP');
    expect(res.data).toMatchObject({
      object: 'ZMY_TTYP',
      type: 'TTYP',
      written: 2,
      skipped: 0,
      failed: 0,
      channel: 'adt',
    });
    expect(res.data.entries).toEqual([
      { object: 'ZMY_TTYP', type: 'TTYP', status: 'written', files: expect.any(Array) },
    ]);
    expect(res.data.fallbackReason).toBeUndefined();
    expect(res.human).toBe('Pulled TTYP ZMY_TTYP via adt; wrote 2 file(s)');
  });

  it('keeps envelope field order written/skipped/failed before channel (test contract)', async () => {
    const res = await runPull('ZMY_TTYP', 'TTYP');
    const keys = Object.keys(res.data);
    expect(keys.indexOf('written')).toBeLessThan(keys.indexOf('channel'));
    expect(keys.indexOf('failed')).toBeLessThan(keys.indexOf('channel'));
  });

  it('carries fallbackReason through the wrapper on the ICF path', async () => {
    mockConfig.systemVersion = '731';
    const res = await runPull('ZMY_TTYP', 'TTYP');
    expect(res.data).toMatchObject({ channel: 'icf', fallbackReason: 'ECC_EHP6_NO_ADT_TABLETYPE' });
    expect(res.human).toBe('Pulled TTYP ZMY_TTYP via icf (ECC_EHP6_NO_ADT_TABLETYPE); wrote 2 file(s)');
  });

  it('routes DDLS through the registry table (ADT only)', async () => {
    const { runPull } = await import('../../src/abap_cli/flows/edit/pull.js');
    // DDLS has no ICF path: on an old kernel channel-detect must hard-error
    // before any file write, and the dispatcher must not swallow it.
    mockConfig.systemVersion = '731';
    await expect(runPull('ZMY_DDLS', { type: 'DDLS', dir: root })).rejects.toMatchObject({
      code: 'DDLS_NOT_SUPPORTED_ON_ECC',
    });
  });
});
