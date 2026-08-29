/**
  pull an object's active version source from a remote system via the
 * Version Management endpoint (/version-source). Drives `abap pull <name> --remote <id>`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerPullCommand } from '../../src/abap_cli/commands/pull.js';
import { makeProgram, runCommand } from './cli-helper.js';

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      searchObject: vi.fn(async () => [] as any[]),
      getConfig: () => ({ sap: { username: 'MOCKUSER', client: '001', language: 'EN' }, transport: 'TRN001', package: '$TMP' }),
      raw: { classRun: vi.fn() },
    }),
  },
}));

const icfGetRemoteSource = vi.fn(async () => ({
  status: 'success' as const,
  data: {
    objectType: 'REPS',
    objectName: 'ZPROG',
    version: '00000',
    source: 'REPORT zprog.\nWRITE: \'hi\'.\n',
  },
  error: null,
}));

vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: {
    create: async () => ({
      getRemoteSource: icfGetRemoteSource,
      getDdic: vi.fn(),
      postDdic: vi.fn(),
      getTextpool: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
    }),
  },
}));

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pull-remote-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
});

describe('015 remote pull', () => {
  it('pulls a PROG via GET /version-source (REPS) and writes the standard source file', async () => {
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZPROG', '--remote', 'PRD', '--dir', 'src', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfGetRemoteSource).toHaveBeenCalledWith('REPS', 'ZPROG', 'PRD');
    const out = JSON.parse(res.stdout);
    expect(out.data).toMatchObject({
      object: 'ZPROG',
      type: 'PROG',
      remote: 'PRD',
      version: '00000',
      entries: [{ file: 'src/prog/zprog/zprog.prog.abap', status: 'written' }],
    });
    const written = fs.readFileSync(path.join(cwd, 'src/prog/zprog/zprog.prog.abap'), 'utf-8');
    expect(written).toContain('REPORT zprog.');
  });

  it('maps INTF --type to VRSD type INTF', async () => {
    icfGetRemoteSource.mockResolvedValueOnce({
      status: 'success',
      data: { objectType: 'INTF', objectName: 'ZIF_DEMO', version: '00000', source: 'INTERFACE zif_demo.\nENDINTERFACE.' },
      error: null,
    });
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZIF_DEMO', '--type', 'INTF', '--remote', 'PRD', '--dir', 'src', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfGetRemoteSource).toHaveBeenCalledWith('INTF', 'ZIF_DEMO', 'PRD');
    expect(JSON.parse(res.stdout).data.entries[0].file).toBe('src/intf/zif_demo/zif_demo.intf.abap');
  });

  it('normalizes REMOTE_VERSION_NOT_FOUND to OBJECT_NOT_FOUND', async () => {
    icfGetRemoteSource.mockResolvedValueOnce({
      status: 'error',
      data: null,
      error: { code: 'REMOTE_VERSION_NOT_FOUND', message: 'active version (00000) could not be read' },
    });
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZPROG', '--remote', 'PRD', '--json'], { cwd });
    expect(res.exitCode).toBe(8);
    const err = JSON.parse(res.stderr);
    expect(err.error.code).toBe('OBJECT_NOT_FOUND');
  });

  it('rejects unsupported object types with TYPE_NOT_SUPPORTED', async () => {
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZCL_X', '--type', 'FUGR', '--remote', 'PRD', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    const err = JSON.parse(res.stderr);
    expect(err.error.code).toBe('TYPE_NOT_SUPPORTED');
    expect(icfGetRemoteSource).not.toHaveBeenCalled();
  });

  it('rejects an invalid remote system ID with INVALID_ARGUMENT', async () => {
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZPROG', '--remote', 'bad id!', '--json'], { cwd });
    expect(res.exitCode).toBe(2);
    const err = JSON.parse(res.stderr);
    expect(err.error.code).toBe('INVALID_ARGUMENT');
  });

  it('refuses to overwrite a differing local file without --overwrite', async () => {
    fs.mkdirSync(path.join(cwd, 'src/prog/zprog'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src/prog/zprog/zprog.prog.abap'), 'REPORT zprog.\nold\n');
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZPROG', '--remote', 'PRD', '--dir', 'src', '--json'], { cwd });
    expect(res.exitCode).toBe(2);
    const err = JSON.parse(res.stderr);
    expect(err.error.code).toBe('OVERWRITE_REQUIRED');
  });

  it('--overwrite replaces the local file', async () => {
    fs.mkdirSync(path.join(cwd, 'src/prog/zprog'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src/prog/zprog/zprog.prog.abap'), 'REPORT zprog.\nold\n');
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZPROG', '--remote', 'PRD', '--dir', 'src', '--overwrite', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(fs.readFileSync(path.join(cwd, 'src/prog/zprog/zprog.prog.abap'), 'utf-8')).toContain('REPORT zprog.');
  });
});

describe('015 bare pull prints help', () => {
  it('abap pull (no object) prints the command help and exits 0', async () => {
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(res.stdout).toContain('Usage:');
    expect(res.stdout).toContain('--remote');
    expect(icfGetRemoteSource).not.toHaveBeenCalled();
  });
});
