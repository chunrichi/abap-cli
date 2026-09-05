/**
 * T3.1 — `runPullSrvd` end-to-end: SRVD pull writes
 *   <root>/srvd/<lower>/<lower>.srvd.json
 *   <root>/srvd/<lower>/<lower>.srvd.acds
 *
 * The .srvd.json file is schema-validated against srvd-v1.json inside
 * writePullFile (the `affTypeFromFilename('*.srvd.json')` mapping now
 * returns 'SRVD'). The .srvd.acds body is written as-is (any extension
 * the pull-strategy produces).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const adtGetSrvdSource = 'define service ZSD_TEST {\n  expose ZC_MY_ENTITY as MyEntity;\n}';

const objectStructureMock = vi.fn(async () => ({
  metaData: {
    'adtcore:description': 'Service def',
    'adtcore:masterLanguage': 'EN',
    'sourceOrigin': 'abapDevelopmentTools',
    'sourceType': 'definition',
    'abapsource:sourceUri': 'source/main',
  },
}));

const getSrvdMock = vi.fn(async () => adtGetSrvdSource);

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      objectStructure: objectStructureMock,
      getSrvd: getSrvdMock,
      // pull-strategy.ts uses getObjectSource for the source-bearing
      // OutputFile content callback; mirror it through the same fixture.
      getObjectSource: getSrvdMock,
    }),
  },
}));
// Workspace config is irrelevant here — stub it so no keychain load fires.
vi.mock('../../src/abap_cli/config/project-config.js', () => ({
  loadConfig: async () => ({ systemVersion: '793' }),
  findWorkspaceConfig: () => undefined,
}));

let root: string;
beforeEach(() => {
  vi.clearAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pull-srvd-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

async function load() {
  return import('../../src/abap_cli/flows/edit/pull-srvd.js');
}

describe('runPullSrvd (T3.1)', () => {
  it('writes the .srvd.json + .srvd.acds pair', async () => {
    const { runPullSrvd } = await load();
    const result = await runPullSrvd('zsd_test', { rootDir: root });
    expect(result.object).toBe('ZSD_TEST');
    expect(result.files).toHaveLength(2);

    const dir = path.join(root, 'srvd', 'zsd_test');
    const jsonPath = path.join(dir, 'zsd_test.srvd.json');
    const acdsPath = path.join(dir, 'zsd_test.srvd.acds');
    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(acdsPath)).toBe(true);

    const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    expect(json).toMatchObject({
      formatVersion: '1',
      header: { description: 'Service def', originalLanguage: 'en' },
    });
    expect(json.generalInformation).toEqual({
      sourceOrigin: 'abapDevelopmentTools',
      sourceType: 'definition',
    });
    expect(fs.readFileSync(acdsPath, 'utf8')).toContain('define service ZSD_TEST');
  });

  it('uses the generalInformation nested shape (not the top-level DDLS shape)', async () => {
    const { runPullSrvd } = await load();
    await runPullSrvd('zsd_test', { rootDir: root });
    const json = JSON.parse(
      fs.readFileSync(path.join(root, 'srvd', 'zsd_test', 'zsd_test.srvd.json'), 'utf8'),
    );
    // SRVD nests sourceOrigin/sourceType under generalInformation (per
    // srvd-v1.json). Top-level sourceOrigin/sourceType would not match
    // the schema.
    expect(json.sourceOrigin).toBeUndefined();
    expect(json.sourceType).toBeUndefined();
    expect(json.generalInformation).toBeDefined();
  });

  it('defaults sourceType to definition when ADT does not return one', async () => {
    objectStructureMock.mockResolvedValueOnce({
      metaData: {
        'adtcore:description': 'Service def',
        'adtcore:masterLanguage': 'EN',
        'abapsource:sourceUri': 'source/main',
      },
    });
    const { runPullSrvd } = await load();
    await runPullSrvd('zsd_test', { rootDir: root });
    const json = JSON.parse(
      fs.readFileSync(path.join(root, 'srvd', 'zsd_test', 'zsd_test.srvd.json'), 'utf8'),
    );
    expect(json.generalInformation).toEqual({
      sourceOrigin: 'abapDevelopmentTools',
      sourceType: 'definition',
    });
  });

  it('passes the AFF pre-validation (srvd-v1.json shape)', async () => {
    const { runPullSrvd } = await load();
    // If pre-validation failed, runPullSrvd would throw AFF_FIXTURE_INVALID.
    await expect(runPullSrvd('zsd_test', { rootDir: root })).resolves.toMatchObject({
      object: 'ZSD_TEST',
    });
  });
});
