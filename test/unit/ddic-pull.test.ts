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
    signFlag: true,
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
    expect(parsed.convExit).toBe('ALPHA');
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
