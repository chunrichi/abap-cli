/**
 * T3.2 — `pull-strategy.ts#strategyFor` dispatches the Phase 3 types
 * to the right strategy:
 *   - SRVB → metadataOnlyStrategy (no source, only `<name>.srvb.json`)
 *   - SRVD / BDEF / DCLS / DDLX / DDLA → sourceObjectStrategy
 *     (joined to the CLAS/PROG/INTF/DDLS family)
 *   - Unknown type → CliError('TYPE_NOT_SUPPORTED')
 *
 * The "filename" assertions inspect the strategy closure directly (via
 * `SourceObjectStrategy` filenames registered with `buildFilename`) so
 * we don't need a working objectStructure mock for the source-bearing
 * types — the `sourceObjectStrategy` only calls `client.*` when
 * `.files()` runs, and we only test the SRVB path end-to-end.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SAMPLE_BINDING = {
  name: 'ZMY_BINDING',
  description: 'My binding',
  masterLanguage: 'EN',
  binding: { type: 'SRVD', version: '1', category: 0, implementation: { name: 'ZCL_UI' } },
  services: [
    {
      name: 'ZUI_BINDING',
      version: 1,
      releaseState: 'RELEASED',
      serviceDefinition: { uri: '/x', type: 'SRVD', name: 'ZSD_UI' },
    },
  ],
  packageRef: { uri: '/x', type: 'DEVC', name: 'ZMY_PKG' },
  links: [],
};

const objectStructureMock = vi.fn(async () => ({
  metaData: {
    'adtcore:description': 'My binding',
    'adtcore:masterLanguage': 'EN',
  },
}));

const serviceBindingMock = vi.fn(async () => SAMPLE_BINDING);

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      objectStructure: objectStructureMock,
      serviceBinding: serviceBindingMock,
    }),
  },
}));

let root: string;
beforeEach(() => {
  vi.clearAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pull-srvb-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

async function loadStrategy() {
  return import('../../src/abap_cli/formats/pull-strategy.js');
}

async function loadPullSource() {
  return import('../../src/abap_cli/flows/edit/pull-source.js');
}

async function loadFileResolver() {
  return import('../../src/abap_cli/formats/file-resolver.js');
}

const noopAdtClient = {
  objectStructure: objectStructureMock,
  serviceBinding: serviceBindingMock,
};

describe('strategyFor dispatch (T3.2)', () => {
  it('returns the metadata-only strategy for SRVB', async () => {
    const { strategyFor } = await loadStrategy();
    const strategy = strategyFor('SRVB');
    const files = await strategy.files({
      client: noopAdtClient as never,
      object: { name: 'ZMY_BINDING', type: 'SRVB', objectUrl: '/sap/bc/adt/srvb/srvbs/zmy_binding' },
      opts: {},
    });
    expect(files).toHaveLength(1);
    expect(files[0]!.filename).toBe('zmy_binding.srvb.json');
  });

  it('source-bearing Phase 3 types map to the .acds / .abdl extension', async () => {
    const { sourceExtensionForObjectType } = await loadFileResolver();
    expect(sourceExtensionForObjectType('SRVD')).toBe('.acds');
    expect(sourceExtensionForObjectType('BDEF')).toBe('.abdl');
    expect(sourceExtensionForObjectType('DCLS')).toBe('.acds');
    expect(sourceExtensionForObjectType('DDLX')).toBe('.acds');
    expect(sourceExtensionForObjectType('DDLA')).toBe('.acds');
  });

  it('DDLS / PROG / CLAS keep the pre-Phase-3 extension', async () => {
    const { sourceExtensionForObjectType } = await loadFileResolver();
    expect(sourceExtensionForObjectType('DDLS')).toBe('.acds');
    expect(sourceExtensionForObjectType('PROG')).toBe('.abap');
    expect(sourceExtensionForObjectType('CLAS')).toBe('.abap');
    expect(sourceExtensionForObjectType('INTF')).toBe('.abap');
  });

  it('throws TYPE_NOT_SUPPORTED for an unknown type', async () => {
    const { strategyFor } = await loadStrategy();
    expect(() => strategyFor('ZZZ')).toThrowError(expect.objectContaining({ code: 'TYPE_NOT_SUPPORTED' }));
  });
});

describe('SRVB end-to-end pull (T3.2)', () => {
  it('writes the <name>.srvb.json file under <rootDir>/srvb/<name>/', async () => {
    const { pullObject } = await loadPullSource();
    const result = await pullObject(
      noopAdtClient as never,
      { name: 'ZMY_BINDING', type: 'SRVB', objectUrl: '/sap/bc/adt/srvb/srvbs/zmy_binding' },
      { dir: root },
    );
    expect(result.written).toHaveLength(1);
    const target = path.join(root, 'srvb', 'zmy_binding', 'zmy_binding.srvb.json');
    expect(fs.existsSync(target)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    expect(parsed).toMatchObject({
      formatVersion: '1',
      bindingType: 'SRVD 1',
      bindingTypeCategory: 'ui',
      header: { description: 'My binding', originalLanguage: 'en' },
    });
    expect(parsed.services[0]).toEqual({
      name: 'ZUI_BINDING',
      versions: [{ serviceVersion: '1', serviceDefinition: 'ZSD_UI' }],
    });
  });
});
