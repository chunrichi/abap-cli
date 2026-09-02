/**
 * 014 US3: pull DDIC objects (DOMA/DTEL/TABL/STRU) via the ICF route.
 * Drives `abap pull <name> --type <T>` → GET /ddic/<type>/<name> → local abap-file-format JSON.
 * TDD: written before the T018/T019 wiring.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerPullCommand } from '../../src/abap_cli/commands/pull.js';
import { makeProgram, runCommand } from './cli-helper.js';

const searchObject = vi.fn(async () => [] as any[]);

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      searchObject: (...args: unknown[]) => searchObject(...args),
      getConfig: () => ({ sap: { username: 'MOCKUSER', client: '001', language: 'EN' }, transport: 'TRN001', package: '$TMP' }),
      raw: { classRun: vi.fn() },
    }),
  },
}));

const icfGetDdic = vi.fn(async () => ({
  status: 'success' as const,
  data: {
    name: 'ZDOMA_TEST',
    description: 'Domain',
    dataType: 'QUAN',
    length: 13,
    decimals: 3,
    signFlag: 'X',
    lowercase: '',
    convExit: 'ALPHA',
  },
  error: null,
}));

vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: {
    create: async () => ({
      getDdic: icfGetDdic,
      postDdic: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
    }),
  },
}));

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ddic-pull-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
});

describe('014/US3 pull DDIC', () => {
  it('pulls a DOMA object via GET /ddic/doma/<name> and writes local JSON', async () => {
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZDOMA_TEST', '--type', 'DOMA', '--dir', 'src', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfGetDdic).toHaveBeenCalledWith('doma', 'ZDOMA_TEST');
    const out = JSON.parse(res.stdout);
    expect(out.data).toMatchObject({
      object: 'ZDOMA_TEST',
      type: 'DOMA',
      entries: [{ file: 'src/doma/zdoma_test.doma.json', status: 'written' }],
    });
    const written = fs.readFileSync(path.join(cwd, 'src/doma/zdoma_test.doma.json'), 'utf-8');
    const parsed = JSON.parse(written);
    expect(parsed.name).toBe('ZDOMA_TEST');
    expect(parsed.dataType).toBe('QUAN');
    expect(parsed.length).toBe(13);
    // 032 US9: format flags now live under nested `format.*` (abap-file-format).
    expect(parsed.format).toEqual({ signFlag: 'X', lowercase: '', convExit: 'ALPHA' });
  });

  it('uses --overwrite to replace an existing file', async () => {
    fs.mkdirSync(path.join(cwd, 'src/doma'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src/doma/zdoma_test.doma.json'), '{"old":true}');
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZDOMA_TEST', '--type', 'DOMA', '--dir', 'src', '--overwrite', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const written = JSON.parse(fs.readFileSync(path.join(cwd, 'src/doma/zdoma_test.doma.json'), 'utf-8'));
    expect(written.name).toBe('ZDOMA_TEST');
  });

  it('maps DDIC_OBJECT_NOT_FOUND to OBJECT_NOT_FOUND (exit 8)', async () => {
    icfGetDdic.mockResolvedValueOnce({
      status: 'error',
      data: null,
      error: { code: 'DDIC_OBJECT_NOT_FOUND', message: 'not found' },
    });
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZMISSING', '--type', 'TABL', '--dir', 'src', '--json'], { cwd });
    expect(res.exitCode).toBe(8);
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('OBJECT_NOT_FOUND');
  });

  it('rejects unsupported DDIC types (TTYP) with DDIC_NOT_SUPPORTED', async () => {
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZTYP', '--type', 'TTYP', '--dir', 'src', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('DDIC_NOT_SUPPORTED');
  });
});

// abap-file-format three-piece pull wire for TABL/STRU.
// zcl_abap_vibe_tabl_format returns { mainJson, ddicSource, settingsJson,
// hasSettings, type, warnings? } in response.data; the CLI must write three
// files under src/tabl/<name>.tabl.{json,ddic,settings.json} (TABL) or
// two files (STRU; no settings).
describe('024 pull TABL/STRU abap-file-format three-piece layout', () => {
  const TABL_WIRE = {
    name: 'ZAFFEXAMPLE',
    type: 'TABL' as const,
    mainJson: '{\n  "formatVersion": "1",\n  "header": {\n    "description": "Example"\n  }\n}\n',
    ddicSource: "@EndUserText.label : 'Example'\ndefine table zaffexample {\n\n  key client : abap.clnt not null;\n}\n",
    settingsJson: '{\n  "formatVersion": "1",\n  "generalInformation": {\n    "dataClassCategory": "APPL1"\n  }\n}\n',
    hasSettings: true,
  };

  const STRU_WIRE = {
    name: 'ZSTRUEXAMPLE',
    type: 'STRU' as const,
    mainJson: '{\n  "formatVersion": "1",\n  "header": {\n    "description": "Stru"\n  }\n}\n',
    ddicSource: "@EndUserText.label : 'Stru'\ndefine structure zstruexample {\n  field1 : abap.char(10);\n}\n",
    settingsJson: undefined,
    hasSettings: false,
  };

  it('writes main + ddic + settings.json when the wire carries all three pieces (TABL)', async () => {
    icfGetDdic.mockResolvedValueOnce({ status: 'success', data: TABL_WIRE, error: null });
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZAFFEXAMPLE', '--type', 'TABL', '--dir', 'src', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfGetDdic).toHaveBeenCalledWith('tabl', 'ZAFFEXAMPLE');
    const out = JSON.parse(res.stdout);
    expect(out.data.layout).toBe('tabl-aff-three-piece');
    expect(out.data.written).toEqual([
      'src/tabl/zaffexample.tabl.json',
      'src/tabl/zaffexample.tabl.ddic',
      'src/tabl/zaffexample.tabl.settings.json',
    ]);
    for (const relPath of out.data.written as string[]) {
      expect(fs.existsSync(path.join(cwd, relPath))).toBe(true);
    }
    const main = JSON.parse(fs.readFileSync(path.join(cwd, 'src/tabl/zaffexample.tabl.json'), 'utf-8'));
    expect(main.formatVersion).toBe('1');
    expect(main.header.description).toBe('Example');
    const ddic = fs.readFileSync(path.join(cwd, 'src/tabl/zaffexample.tabl.ddic'), 'utf-8');
    expect(ddic).toMatch(/^@EndUserText\.label/);
    expect(ddic).toMatch(/define table zaffexample/);
    const settings = JSON.parse(fs.readFileSync(path.join(cwd, 'src/tabl/zaffexample.tabl.settings.json'), 'utf-8'));
    expect(settings.generalInformation.dataClassCategory).toBe('APPL1');
  });

  it('writes only main + ddic for STRU when settingsJson is absent', async () => {
    icfGetDdic.mockResolvedValueOnce({ status: 'success', data: STRU_WIRE, error: null });
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZSTRUEXAMPLE', '--type', 'STRU', '--dir', 'src', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfGetDdic).toHaveBeenCalledWith('stru', 'ZSTRUEXAMPLE');
    const out = JSON.parse(res.stdout);
    expect(out.data.layout).toBe('tabl-aff-two-piece');
    expect(out.data.written).toEqual([
      'src/stru/zstruexample.stru.json',
      'src/stru/zstruexample.stru.ddic',
    ]);
    expect(fs.existsSync(path.join(cwd, 'src/stru/zstruexample.stru.settings.json'))).toBe(false);
  });

  it('rejects three-piece wire with malformed DDL (TABL_DDL_INVALID, exit 7)', async () => {
    icfGetDdic.mockResolvedValueOnce({
      status: 'success',
      data: { ...TABL_WIRE, ddicSource: 'this is not DDL at all' },
      error: null,
    });
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZAFFEXAMPLE', '--type', 'TABL', '--dir', 'src', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('TABL_DDL_INVALID');
    // No partial files on disk.
    expect(fs.existsSync(path.join(cwd, 'src/tabl'))).toBe(false);
  });

  it('rejects three-piece wire missing mainJson (TABL_ARTIFACT_INCOMPLETE, exit 7)', async () => {
    const wireMissingMain: typeof TABL_WIRE = { ...TABL_WIRE };
    delete (wireMissingMain as Record<string, unknown>).mainJson;
    icfGetDdic.mockResolvedValueOnce({
      status: 'success',
      data: wireMissingMain,
      error: null,
    });
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZAFFEXAMPLE', '--type', 'TABL', '--dir', 'src', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('TABL_ARTIFACT_INCOMPLETE');
  });

  it('rejects three-piece wire when all three pieces already exist (OVERWRITE_REQUIRED, exit 2)', async () => {
    fs.mkdirSync(path.join(cwd, 'src/tabl'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src/tabl/zaffexample.tabl.json'), '{}');
    fs.writeFileSync(path.join(cwd, 'src/tabl/zaffexample.tabl.ddic'), '');
    fs.writeFileSync(path.join(cwd, 'src/tabl/zaffexample.tabl.settings.json'), '{}');
    icfGetDdic.mockResolvedValueOnce({ status: 'success', data: TABL_WIRE, error: null });
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZAFFEXAMPLE', '--type', 'TABL', '--dir', 'src', '--json'], { cwd });
    expect(res.exitCode).toBe(2);
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('OVERWRITE_REQUIRED');
  });

  it('overwrites all three pieces when --overwrite is set', async () => {
    fs.mkdirSync(path.join(cwd, 'src/tabl'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src/tabl/zaffexample.tabl.json'), '{"old":true}');
    fs.writeFileSync(path.join(cwd, 'src/tabl/zaffexample.tabl.ddic'), 'old-ddl');
    fs.writeFileSync(path.join(cwd, 'src/tabl/zaffexample.tabl.settings.json'), '{"old":true}');
    icfGetDdic.mockResolvedValueOnce({ status: 'success', data: TABL_WIRE, error: null });
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZAFFEXAMPLE', '--type', 'TABL', '--dir', 'src', '--overwrite', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const main = JSON.parse(fs.readFileSync(path.join(cwd, 'src/tabl/zaffexample.tabl.json'), 'utf-8'));
    expect(main).not.toHaveProperty('old');
    expect(main.formatVersion).toBe('1');
  });
});
