/**
 * SM59 (HTTP destination) CLI flows against a mocked ICF service.
 *
 * Drives the full command pipeline (create / pull / push / delete) with the
 * `IcfClient` mocked, pinning the wire payloads, the local file layout, the
 * error-code mapping and the package/transport rejection. The real-SAP side is
 * covered by the integration suite.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerCreateCommand } from '../../src/abap_cli/commands/create.js';
import { registerPullCommand } from '../../src/abap_cli/commands/pull.js';
import { registerPushCommand } from '../../src/abap_cli/commands/push.js';
import { registerDeleteCommand } from '../../src/abap_cli/commands/delete.js';
import { makeProgram, runCommand } from './cli-helper.js';

const icfGetSm59 = vi.fn();
const icfPostSm59 = vi.fn();
const icfDeleteSm59 = vi.fn();
const icfCreate = vi.fn(async () => ({
  getSm59: icfGetSm59,
  postSm59: icfPostSm59,
  deleteSm59: icfDeleteSm59,
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}));

vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: {
    create: (...args: unknown[]) => icfCreate(...args),
  },
}));

// SM59 flows never touch ADT; the client may still be created by the
// pull/push coordinators (channel-independent orchestration).
vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      getConfig: () => ({ sap: { username: 'MOCKUSER' }, transport: '' }),
      searchObject: vi.fn(async () => []),
    }),
  },
}));

const LOCAL: Record<string, unknown> = {
  formatVersion: '1',
  description: 'Demo HTTP destination',
  targetHost: 'example.com',
  port: 443,
  protocol: 'HTTPS',
  pathPrefix: '/api',
};

const WIRE: Record<string, unknown> = { ...LOCAL, name: 'ZSM59_DEMO', type: 'G' };

function success<T>(data: T) {
  return { status: 'success' as const, data, error: null };
}

function failure(code: string, message: string) {
  return { status: 'error' as const, data: null, error: { code, message } };
}

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  icfGetSm59.mockResolvedValue(success(WIRE));
  icfPostSm59.mockResolvedValue(success({ name: 'ZSM59_DEMO', type: 'G', action: 'created' }));
  icfDeleteSm59.mockResolvedValue(success({ name: 'ZSM59_DEMO', type: 'G', action: 'deleted' }));
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sm59-flows-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
});

function writeLocal(name = 'zsm59_demo', doc: Record<string, unknown> = LOCAL) {
  const file = path.join(cwd, 'src', `${name}.sm59.json`);
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  return file;
}

function parseStdout(res: { stdout: string }) {
  return JSON.parse(res.stdout);
}

function parseStderr(res: { stderr: string }) {
  return JSON.parse(res.stderr);
}

describe('abap create SM59', () => {
  it('posts the wire document (name + RFCTYPE G) through /sm59/<name>', async () => {
    writeLocal();
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(
      program,
      ['create', 'SM59', 'ZSM59_DEMO', '--file', 'src/zsm59_demo.sm59.json', '--yes', '--json'],
      { cwd },
    );
    expect(res.exitCode).toBeUndefined();
    expect(icfPostSm59).toHaveBeenCalledWith('ZSM59_DEMO', {
      formatVersion: '1',
      description: 'Demo HTTP destination',
      targetHost: 'example.com',
      port: 443,
      protocol: 'HTTPS',
      pathPrefix: '/api',
      type: 'G',
      name: 'ZSM59_DEMO',
    });
    expect(parseStdout(res)).toMatchObject({
      status: 'success',
      data: {
        object: 'ZSM59_DEMO',
        type: 'SM59',
        action: 'created',
        channel: 'icf',
        description: 'Demo HTTP destination',
        file: 'src/zsm59_demo.sm59.json',
      },
    });
  });

  it('reports an existing destination as updated (upsert)', async () => {
    writeLocal();
    icfPostSm59.mockResolvedValueOnce(success({ name: 'ZSM59_DEMO', type: 'G', action: 'updated' }));
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(
      program,
      ['create', 'SM59', 'ZSM59_DEMO', '--file', 'src/zsm59_demo.sm59.json', '--yes', '--json'],
      { cwd },
    );
    expect(res.exitCode).toBeUndefined();
    expect(parseStdout(res).data.action).toBe('updated');
  });

  it('--check-only validates locally and never creates an ICF client', async () => {
    writeLocal();
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(
      program,
      ['create', 'SM59', 'ZSM59_DEMO', '--file', 'src/zsm59_demo.sm59.json', '--check-only', '--yes', '--json'],
      { cwd },
    );
    expect(res.exitCode).toBeUndefined();
    expect(icfCreate).not.toHaveBeenCalled();
    expect(parseStdout(res)).toMatchObject({ data: { checkOnly: true, valid: true } });
  });

  it('rejects --package / --tr (no package, not transportable) before touching SAP', async () => {
    writeLocal();
    const program = makeProgram();
    registerCreateCommand(program);
    for (const flag of [['--package', '$TMP'], ['--tr', 'NDK900123']]) {
      const res = await runCommand(
        program,
        ['create', 'SM59', 'ZSM59_DEMO', '--file', 'src/zsm59_demo.sm59.json', ...flag, '--yes', '--json'],
        { cwd },
      );
      expect(res.exitCode).toBe(7);
      expect(parseStderr(res)).toMatchObject({ error: { code: 'TYPE_NOT_SUPPORTED', category: 'VALIDATION_ERROR' } });
    }
    expect(icfCreate).not.toHaveBeenCalled();
  });

  it('rejects --no-activate (no activation step)', async () => {
    writeLocal();
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(
      program,
      ['create', 'SM59', 'ZSM59_DEMO', '--file', 'src/zsm59_demo.sm59.json', '--no-activate', '--yes', '--json'],
      { cwd },
    );
    expect(res.exitCode).toBe(7);
    expect(parseStderr(res).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a file name that does not match the destination', async () => {
    writeLocal('zsm59_other');
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(
      program,
      ['create', 'SM59', 'ZSM59_DEMO', '--file', 'src/zsm59_other.sm59.json', '--yes', '--json'],
      { cwd },
    );
    // INVALID_ARGUMENT is a USAGE-category error (exit 2), like the other
    // type-specific file/name mismatch checks.
    expect(res.exitCode).toBe(2);
    expect(parseStderr(res).error.code).toBe('INVALID_ARGUMENT');
    expect(icfPostSm59).not.toHaveBeenCalled();
  });

  it('maps the handler SM59_INVALID_PAYLOAD rejection to exit 7', async () => {
    writeLocal();
    icfPostSm59.mockResolvedValueOnce(failure('SM59_INVALID_PAYLOAD', 'description exceeds 72 characters'));
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(
      program,
      ['create', 'SM59', 'ZSM59_DEMO', '--file', 'src/zsm59_demo.sm59.json', '--yes', '--json'],
      { cwd },
    );
    expect(res.exitCode).toBe(7);
    expect(parseStderr(res).error.code).toBe('SM59_INVALID_PAYLOAD');
  });

  it('returns the ICF write error code when the SAP side rejects the write', async () => {
    writeLocal();
    icfPostSm59.mockResolvedValueOnce(failure('SM59_WRITE_FAILED', 'CX_DEST_API raised'));
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(
      program,
      ['create', 'SM59', 'ZSM59_DEMO', '--file', 'src/zsm59_demo.sm59.json', '--yes', '--json'],
      { cwd },
    );
    expect(res.exitCode).toBe(6);
    expect(parseStderr(res).error.code).toBe('SM59_WRITE_FAILED');
  });
});

describe('abap pull SM59', () => {
  it('writes <name>.sm59.json without the server-owned name/type fields', async () => {
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZSM59_DEMO', '--type', 'SM59', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfGetSm59).toHaveBeenCalledWith('ZSM59_DEMO');
    const pulled = JSON.parse(fs.readFileSync(path.join(cwd, 'src/zsm59_demo.sm59.json'), 'utf8'));
    expect(pulled).toEqual(LOCAL);
    expect(pulled.name).toBeUndefined();
    expect(pulled.type).toBeUndefined();
    expect(parseStdout(res)).toMatchObject({
      data: {
        object: 'ZSM59_DEMO',
        type: 'SM59',
        written: ['src/zsm59_demo.sm59.json'],
        entries: [{ file: 'src/zsm59_demo.sm59.json', status: 'written' }],
      },
    });
  });

  it('maps SM59_OBJECT_NOT_FOUND to OBJECT_NOT_FOUND (exit 8)', async () => {
    icfGetSm59.mockResolvedValueOnce(failure('SM59_OBJECT_NOT_FOUND', 'destination not found'));
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZSM59_DEMO', '--type', 'SM59', '--json'], { cwd });
    expect(res.exitCode).toBe(8);
    expect(parseStderr(res).error.code).toBe('OBJECT_NOT_FOUND');
  });

  it('maps SM59_TYPE_NOT_SUPPORTED to a validation error (exit 7) and keeps details.rfctype', async () => {
    icfGetSm59.mockResolvedValueOnce({
      status: 'error' as const,
      data: null,
      error: { code: 'SM59_TYPE_NOT_SUPPORTED', message: 'RFCTYPE is 3, not G', details: { rfctype: '3' } },
    });
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZSM59_DEMO', '--type', 'SM59', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    expect(parseStderr(res).error.code).toBe('SM59_TYPE_NOT_SUPPORTED');
    expect(parseStderr(res).error.details).toEqual({ rfctype: '3' });
  });

  it('maps a 405 METHOD_NOT_ALLOWED to a validation error (exit 7)', async () => {
    icfGetSm59.mockResolvedValueOnce(failure('METHOD_NOT_ALLOWED', 'GET not supported'));
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZSM59_DEMO', '--type', 'SM59', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    expect(parseStderr(res).error.code).toBe('METHOD_NOT_ALLOWED');
  });

  it('maps SM59_READ_FAILED (authority / API failure) to SAP_ERROR (exit 6)', async () => {
    icfGetSm59.mockResolvedValueOnce(failure('SM59_READ_FAILED', 'CX_DEST_API: no authority'));
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZSM59_DEMO', '--type', 'SM59', '--json'], { cwd });
    expect(res.exitCode).toBe(6);
    expect(parseStderr(res).error.code).toBe('SM59_READ_FAILED');
  });

  it('never maps a non-G GET payload to a local file', async () => {
    icfGetSm59.mockResolvedValueOnce(success({ ...WIRE, type: '3' }));
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZSM59_DEMO', '--type', 'SM59', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    expect(parseStderr(res).error.code).toBe('SM59_TYPE_NOT_SUPPORTED');
    expect(fs.existsSync(path.join(cwd, 'src/zsm59_demo.sm59.json'))).toBe(false);
  });

  it('keeps an existing file unless --overwrite is passed', async () => {
    writeLocal();
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZSM59_DEMO', '--type', 'SM59', '--json'], { cwd });
    expect(res.exitCode).toBe(2);
    expect(parseStderr(res).error.code).toBe('OVERWRITE_REQUIRED');
  });
});

describe('abap push SM59', () => {
  it('updates an existing destination (GET probe + POST)', async () => {
    writeLocal();
    icfPostSm59.mockResolvedValueOnce(success({ name: 'ZSM59_DEMO', type: 'G', action: 'updated' }));
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zsm59_demo.sm59.json', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfGetSm59).toHaveBeenCalledWith('ZSM59_DEMO');
    expect(icfPostSm59).toHaveBeenCalledWith('ZSM59_DEMO', expect.objectContaining({ name: 'ZSM59_DEMO', type: 'G' }));
    expect(parseStdout(res)).toMatchObject({
      data: {
        results: [{ file: 'src/zsm59_demo.sm59.json', status: 'written', written: true, activated: false }],
      },
    });
  });

  it('is update-only: an unknown destination surfaces OBJECT_NOT_FOUND (exit 8)', async () => {
    writeLocal();
    icfGetSm59.mockResolvedValueOnce(failure('SM59_OBJECT_NOT_FOUND', 'not found'));
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zsm59_demo.sm59.json', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBe(8);
    expect(parseStderr(res).error.code).toBe('OBJECT_NOT_FOUND');
    expect(icfPostSm59).not.toHaveBeenCalled();
  });

  it('rejects --tr (not transportable) before writing', async () => {
    writeLocal();
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(
      program,
      ['push', 'src/zsm59_demo.sm59.json', '--tr', 'NDK900123', '--yes', '--json'],
      { cwd },
    );
    expect(res.exitCode).toBe(7);
    expect(parseStderr(res).error.code).toBe('TYPE_NOT_SUPPORTED');
    expect(icfPostSm59).not.toHaveBeenCalled();
  });

  it('--dry-run plans without writing', async () => {
    writeLocal();
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zsm59_demo.sm59.json', '--dry-run', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfPostSm59).not.toHaveBeenCalled();
    expect(parseStdout(res).data.dryRun).toBe(true);
  });
});

describe('abap delete SM59', () => {
  it('deletes through DELETE /sm59/<name>', async () => {
    const program = makeProgram();
    registerDeleteCommand(program);
    const res = await runCommand(program, ['delete', 'ZSM59_DEMO', '--type', 'SM59', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfDeleteSm59).toHaveBeenCalledWith('ZSM59_DEMO');
    expect(parseStdout(res)).toMatchObject({
      data: { object: 'ZSM59_DEMO', type: 'SM59', deleted: true, lockReleased: true },
    });
  });

  it('maps SM59_OBJECT_NOT_FOUND to OBJECT_NOT_FOUND (exit 8)', async () => {
    icfDeleteSm59.mockResolvedValueOnce(failure('SM59_OBJECT_NOT_FOUND', 'not found'));
    const program = makeProgram();
    registerDeleteCommand(program);
    const res = await runCommand(program, ['delete', 'ZSM59_DEMO', '--type', 'SM59', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBe(8);
    expect(parseStderr(res).error.code).toBe('OBJECT_NOT_FOUND');
  });

  it('rejects --tr (not transportable)', async () => {
    const program = makeProgram();
    registerDeleteCommand(program);
    const res = await runCommand(
      program,
      ['delete', 'ZSM59_DEMO', '--type', 'SM59', '--tr', 'NDK900123', '--yes', '--json'],
      { cwd },
    );
    expect(res.exitCode).toBe(7);
    expect(parseStderr(res).error.code).toBe('TYPE_NOT_SUPPORTED');
    expect(icfDeleteSm59).not.toHaveBeenCalled();
  });
});

describe('human output (non-JSON) reads well for a user', () => {
  it('create reports the action and the ICF route', async () => {
    writeLocal();
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(
      program,
      ['create', 'SM59', 'ZSM59_DEMO', '--file', 'src/zsm59_demo.sm59.json', '--yes'],
      { cwd },
    );
    expect(res.exitCode).toBeUndefined();
    expect(res.stdout).toContain('Created SM59 ZSM59_DEMO via ICF (new)');
  });

  it('create reports an overwrite as such', async () => {
    writeLocal();
    icfPostSm59.mockResolvedValueOnce(success({ name: 'ZSM59_DEMO', type: 'G', action: 'updated' }));
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(
      program,
      ['create', 'SM59', 'ZSM59_DEMO', '--file', 'src/zsm59_demo.sm59.json', '--yes'],
      { cwd },
    );
    expect(res.exitCode).toBeUndefined();
    expect(res.stdout).toContain('Created SM59 ZSM59_DEMO via ICF (overwritten)');
  });

  it('pull reports the written file path', async () => {
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZSM59_DEMO', '--type', 'SM59'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(res.stdout).toContain('Pulled SM59 ZSM59_DEMO to src/zsm59_demo.sm59.json');
  });

  it('push reports the file and the written status', async () => {
    writeLocal();
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zsm59_demo.sm59.json', '--yes'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(res.stdout).toContain('Pushed 1 file(s):');
    expect(res.stdout).toContain('src/zsm59_demo.sm59.json → written');
  });

  it('delete reports the deleted destination', async () => {
    const program = makeProgram();
    registerDeleteCommand(program);
    const res = await runCommand(program, ['delete', 'ZSM59_DEMO', '--type', 'SM59', '--yes'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(res.stdout).toContain('Deleted SM59 ZSM59_DEMO');
  });

  it('rejects --package with an actionable human message', async () => {
    writeLocal();
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(
      program,
      ['create', 'SM59', 'ZSM59_DEMO', '--file', 'src/zsm59_demo.sm59.json', '--package', '$TMP', '--yes'],
      { cwd },
    );
    expect(res.exitCode).toBe(7);
    // Human mode prints message + Try lines (the error code lives in --json).
    expect(res.stderr).toContain('Error: SM59 destinations are client-independent');
    expect(res.stderr).toContain('drop --package');
    expect(res.stderr).toContain('Try:');
  });
});
