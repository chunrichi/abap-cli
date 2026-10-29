/**
 * T3.3 — `runPullBdef` end-to-end: BDEF pull writes
 *   <root>/bdef/<lower>/<lower>.bdef.json
 *   <root>/bdef/<lower>/<lower>.bdef.abdl
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ABDL_BODY = `managed;
define behavior for ZI_TRAVEL alias Travel
{
  use create;
  use update;
  use delete;
}`;

const objectStructureMock = vi.fn(async () => ({
  metaData: {
    'adtcore:description': 'Travel BO',
    'adtcore:masterLanguage': 'EN',
    'abapsource:sourceUri': 'source/main',
  },
}));

const getObjectSourceMock = vi.fn(async () => ABDL_BODY);

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      objectStructure: objectStructureMock,
      getObjectSource: getObjectSourceMock,
    }),
  },
}));

let root: string;
beforeEach(() => {
  vi.clearAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pull-bdef-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

async function load() {
  return import('../../src/abap_cli/flows/edit/pull-bdef.js');
}

describe('runPullBdef (T3.3)', () => {
  it('writes the .bdef.json + .bdef.abdl pair', async () => {
    const { runPullBdef } = await load();
    const result = await runPullBdef('zrb_travel_bdef', { rootDir: root });
    expect(result.object).toBe('ZRB_TRAVEL_BDEF');
    expect(result.files).toHaveLength(2);

    const dir = path.join(root, 'bdef', 'zrb_travel_bdef');
    expect(fs.existsSync(path.join(dir, 'zrb_travel_bdef.bdef.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'zrb_travel_bdef.bdef.abdl'))).toBe(true);

    const abdl = fs.readFileSync(path.join(dir, 'zrb_travel_bdef.bdef.abdl'), 'utf8');
    expect(abdl).toContain('managed;');
    expect(abdl).toContain('define behavior for ZI_TRAVEL');
  });

  it('validates the metadata against bdef-v1.json (AFF pre-validation)', async () => {
    const { runPullBdef } = await load();
    // The `*.bdef.json` mapping in `affTypeFromFilename` returns 'BDEF',
    // which routes to `bdef-v1.json` in `aff/schema-paths.ts`. If pre-validation
    // fired, the run would throw AFF_FIXTURE_INVALID; we expect a clean resolve.
    await expect(runPullBdef('zrb_travel_bdef', { rootDir: root })).resolves.toMatchObject({
      object: 'ZRB_TRAVEL_BDEF',
    });
  });

  it('uses .abdl as the source extension (not .acds / .abap)', async () => {
    const { runPullBdef } = await load();
    const result = await runPullBdef('zrb_travel_bdef', { rootDir: root });
    const extensions = result.files.map((f) => path.extname(f));
    expect(extensions).toContain('.json');
    expect(extensions).toContain('.abdl');
    expect(extensions).not.toContain('.acds');
  });

  it('emits a top-level header shape (no sourceOrigin / generalInformation)', async () => {
    const { runPullBdef } = await load();
    await runPullBdef('zrb_travel_bdef', { rootDir: root });
    const json = JSON.parse(
      fs.readFileSync(
        path.join(root, 'bdef', 'zrb_travel_bdef', 'zrb_travel_bdef.bdef.json'),
        'utf8',
      ),
    );
    expect(json.formatVersion).toBe('1');
    expect(json.header).toEqual({ description: 'Travel BO', originalLanguage: 'en' });
    // BDEF does not get sourceOrigin / sourceType (those are DDLS / SRVD only).
    expect(json.sourceOrigin).toBeUndefined();
    expect(json.sourceType).toBeUndefined();
    expect(json.generalInformation).toBeUndefined();
  });
});
