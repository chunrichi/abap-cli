/**
 * PR2 — `--user <sap-user>` filter for `abap pull --tr`.
 *
 * Owner comes from `showTransport` (direct objects inherit transport owner;
 * task objects inherit their task's owner). The filter is case-insensitive.
 * Objects without owner are kept (silent-drop avoidance — see PR2 rationale
 * in this PR's design rationale).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerPullCommand } from '../../src/abap_cli/commands/pull.js';
import { makeProgram, runCommand } from './cli-helper.js';

const transportDetails = vi.fn();
const pullObject = vi.fn();
const runPullHttp = vi.fn();
const runPullTran = vi.fn();
const runPullDdic = vi.fn();
const resolveObject = vi.fn();

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      transportDetails,
      searchObject: vi.fn(async () => []),
      getConfig: () => ({ sap: { username: 'MOCKUSER', client: '001', language: 'EN' }, transport: 'TRN001', package: '$TMP' }),
      raw: { classRun: vi.fn() },
    }),
  },
}));

vi.mock('../../src/abap_cli/flows/edit/pull-source.js', () => ({
  pullObject: (...args: unknown[]) => pullObject(...args),
}));

vi.mock('../../src/abap_cli/flows/edit/pull-http.js', () => ({
  runPullHttp: (...args: unknown[]) => runPullHttp(...args),
}));

vi.mock('../../src/abap_cli/flows/edit/pull-transport.js', () => ({
  runPullTran: (...args: unknown[]) => runPullTran(...args),
}));

vi.mock('../../src/abap_cli/flows/edit/pull-ddic.js', () => ({
  runPullDdic: (...args: unknown[]) => runPullDdic(...args),
  isDdicSupportedType: (t: string) => ['DOMA', 'DTEL', 'TABL', 'STRU'].includes(t),
}));

vi.mock('../../src/abap_cli/core/resolve.js', () => ({
  resolveObject: (...args: unknown[]) => resolveObject(...args),
  getObjectParts: vi.fn(),
  validateLocalFile: vi.fn(),
}));

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pull-tr-user-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  // Default: pullObject succeeds with one file written.
  pullObject.mockResolvedValue({ entries: [], written: [], skipped: [], failed: [] });
  // resolveObject echoes the requested name so per-object assertions can match what was filtered through.
  resolveObject.mockImplementation(async (_client: unknown, name: string, type: string) => ({
    name,
    type,
    objectUrl: `/x/${type}/${name}`,
    packageName: '$TMP',
    mainSource: '',
    transport: '',
  }));
  runPullHttp.mockResolvedValue(undefined);
  runPullTran.mockResolvedValue(undefined);
  runPullDdic.mockResolvedValue(undefined);
});

describe('pull --tr --user owner filter', () => {
  it('drops objects whose task owner does not match --user', async () => {
    transportDetails.mockResolvedValue({
      'tm:number': 'NDK123456',
      'tm:desc': 'mixed',
      'tm:status': 'D',
      'tm:owner': 'ALICE',
      objects: [],
      tasks: [
        {
          'tm:number': 'NDK123456',
          'tm:owner': 'ALICE',
          'tm:desc': '',
          'tm:status': 'D',
          objects: [{ 'tm:name': 'ZCL_ALICE', 'tm:type': 'CLAS', 'tm:obj_info': '' }],
        },
        {
          'tm:number': 'NDK123457',
          'tm:owner': 'BOB',
          'tm:desc': '',
          'tm:status': 'D',
          objects: [{ 'tm:name': 'ZCL_BOB', 'tm:type': 'CLAS', 'tm:obj_info': '' }],
        },
      ],
    });

    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', '--tr', 'NDK123456', '--user', 'alice', '--json'], { cwd });

    expect(res.exitCode).toBeUndefined();
    expect(pullObject).toHaveBeenCalledTimes(1);
    expect(pullObject.mock.calls[0]![1]).toMatchObject({ name: 'ZCL_ALICE', type: 'CLAS' });
  });

  it('keeps direct objects whose transport owner matches --user', async () => {
    transportDetails.mockResolvedValue({
      'tm:number': 'NDK999999',
      'tm:desc': 'direct',
      'tm:status': 'D',
      'tm:owner': 'CAROL',
      objects: [{ 'tm:name': 'ZCL_DIRECT', 'tm:type': 'CLAS', 'tm:obj_info': '' }],
      tasks: [],
    });

    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', '--tr', 'NDK999999', '--user', 'CAROL', '--json'], { cwd });

    expect(res.exitCode).toBeUndefined();
    expect(pullObject).toHaveBeenCalledTimes(1);
    expect(pullObject.mock.calls[0]![1]).toMatchObject({ name: 'ZCL_DIRECT', type: 'CLAS' });
  });

  it('reports "no match" when filter excludes everything (still exit 0)', async () => {
    transportDetails.mockResolvedValue({
      'tm:number': 'NDK000000',
      'tm:desc': 'empty-match',
      'tm:status': 'D',
      'tm:owner': 'ALICE',
      objects: [{ 'tm:name': 'ZCL_OTHER', 'tm:type': 'CLAS', 'tm:obj_info': '' }],
      tasks: [],
    });

    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', '--tr', 'NDK000000', '--user', 'BOB', '--json'], { cwd });

    expect(res.exitCode).toBeUndefined();
    expect(pullObject).not.toHaveBeenCalled();
    expect(runPullHttp).not.toHaveBeenCalled();
    expect(runPullDdic).not.toHaveBeenCalled();
    // JSON envelope reports the filter context; "no match" human text only appears in non-JSON mode.
    const envelope = JSON.parse(res.stdout.split('\n').find((l) => l.trim().startsWith('{'))!) as { data: { filtered: number; user: string; requested: number; pulled: number } };
    expect(envelope.data.filtered).toBe(1);
    expect(envelope.data.user).toBe('BOB');
    expect(envelope.data.requested).toBe(0);
    expect(envelope.data.pulled).toBe(0);
  });

  it('rejects --user without --tr with INVALID_ARGUMENT (exit 2)', async () => {
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', '--user', 'ALICE', '--json'], { cwd });

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toMatch(/--user can only be used with --tr/);
  });

  it('without --user, behaves as before — all objects pulled', async () => {
    transportDetails.mockResolvedValue({
      'tm:number': 'NDK111111',
      'tm:desc': 'all',
      'tm:status': 'D',
      'tm:owner': 'ALICE',
      objects: [{ 'tm:name': 'ZCL_A', 'tm:type': 'CLAS', 'tm:obj_info': '' }],
      tasks: [
        {
          'tm:number': 'NDK111112',
          'tm:owner': 'BOB',
          'tm:desc': '',
          'tm:status': 'D',
          objects: [{ 'tm:name': 'ZCL_B', 'tm:type': 'CLAS', 'tm:obj_info': '' }],
        },
      ],
    });

    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', '--tr', 'NDK111111', '--json'], { cwd });

    expect(res.exitCode).toBeUndefined();
    expect(pullObject).toHaveBeenCalledTimes(2);
    const pulled = pullObject.mock.calls.map((c) => (c[1] as { name: string }).name).sort();
    expect(pulled).toEqual(['ZCL_A', 'ZCL_B']);
  });
});
