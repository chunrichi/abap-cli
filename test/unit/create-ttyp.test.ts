/**
 * TTYP create — ADT path (collection POST registers the header, a locked PUT
 * writes the row type) and the local rejections that never touch SAP.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const adtCreateTtyp = vi.fn(async () => undefined);
const adtLock = vi.fn(async () => ({ LOCK_HANDLE: 'LH1' }));
const adtUpdateTtyp = vi.fn(async () => undefined);
const adtUnlock = vi.fn(async () => undefined);
const adtActivate = vi.fn(async () => ({ messages: [], success: true }));
const icfPost = vi.fn(async () => ({ status: 'success' as const, data: {}, error: null }));

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      createTtyp: adtCreateTtyp,
      lock: adtLock,
      updateTtyp: adtUpdateTtyp,
      unLock: adtUnlock,
      activate: adtActivate,
      getConfig: () => ({ sap: { language: 'EN' } }),
    }),
  },
}));
vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: { create: async () => ({ post: icfPost }) },
}));
// The create flow derives the channel from the workspace config.
vi.mock('../../src/abap_cli/config/project-config.js', () => ({
  loadConfig: async () => ({ systemVersion: '789' }),
}));
// Capture the printed result without touching stdout.
vi.mock('../../src/abap_cli/output/json.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/abap_cli/output/json.js')>();
  return { ...actual, printResult: vi.fn() };
});

import type { CreateOptions } from '../../src/abap_cli/flows/edit/create.js';

let cwd: string;

beforeEach(() => {
  vi.clearAllMocks();
  adtActivate.mockResolvedValue({ messages: [], success: true });
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'create-ttyp-'));
});
afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

function writeDoc(name: string, doc: unknown): string {
  const file = path.join(cwd, name);
  fs.writeFileSync(file, JSON.stringify(doc, null, 2));
  return file;
}

const TTYP_DOC = {
  formatVersion: '1',
  header: { description: 'Probe table type', originalLanguage: 'EN' },
  accessType: 'standard',
  lineType: { rowType: 'CHAR', rowTypeLength: 10 },
};

async function run(name: string, doc: unknown, opts: Partial<CreateOptions> = {}) {
  const { clearChannelCache } = await import('../../src/abap_cli/flows/edit/channel-detect.js');
  clearChannelCache();
  const { runCreateTtyp } = await import('../../src/abap_cli/flows/edit/create-ttyp.js');
  const file = writeDoc(`${name.toLowerCase()}.ttyp.json`, doc);
  await runCreateTtyp(name, { package: '$TMP', file, ...opts } as CreateOptions, 'json');
}

describe('runCreateTtyp — ADT channel', () => {
  it('creates the header, then writes the row type through a locked PUT', async () => {
    await run('ZMY_CHARS', TTYP_DOC);

    expect(adtCreateTtyp).toHaveBeenCalledWith(
      expect.stringContaining('<ttyp:dataType>CHAR</ttyp:dataType><ttyp:length>000010</ttyp:length><ttyp:decimals>000000</ttyp:decimals>'),
      undefined,
    );
    expect(adtLock).toHaveBeenCalledWith('/sap/bc/adt/ddic/tabletypes/ZMY_CHARS');
    expect(adtUpdateTtyp).toHaveBeenCalledWith(
      'ZMY_CHARS',
      expect.stringContaining('<ttyp:typeKind>predefinedAbapType</ttyp:typeKind>'),
      'LH1',
      undefined,
    );
    expect(adtUnlock).toHaveBeenCalledWith('/sap/bc/adt/ddic/tabletypes/ZMY_CHARS', 'LH1');
    expect(adtActivate).toHaveBeenCalledWith('/sap/bc/adt/ddic/tabletypes/ZMY_CHARS', 'TTYP/DA', 'ZMY_CHARS');
    expect(icfPost).not.toHaveBeenCalled();
  });
});

describe('runCreateTtyp — local rejections', () => {
  it('rejects an inline rowStructure with TTYP_ROW_STRUCTURE_UNSUPPORTED before touching SAP', async () => {
    await expect(run('ZMY_ROWSTRUCT', {
      ...TTYP_DOC,
      lineType: { rowStructure: { fieldName: 'ROW', dataType: 'CHAR', length: 1 } },
    })).rejects.toMatchObject({ code: 'TTYP_ROW_STRUCTURE_UNSUPPORTED' });

    expect(adtCreateTtyp).not.toHaveBeenCalled();
    expect(icfPost).not.toHaveBeenCalled();
  });

  it('rejects a negative rowTypeLength through the AFF schema', async () => {
    await expect(run('ZMY_BADLEN', {
      ...TTYP_DOC,
      lineType: { rowType: 'CHAR', rowTypeLength: -1 },
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(adtCreateTtyp).not.toHaveBeenCalled();
  });
});
