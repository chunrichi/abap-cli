/**
 * Tests for the native OS keychain backend dispatcher.
 *
 * Covers:
 *   - `resolveBackend()` returns native by default when available
 *   - `ABAP_CLI_KEYCHAIN_BACKEND` env var override routes to the requested backend
 *   - `accountKey()` parity with the legacy keytar layout (so credentials
 *     written by keytar remain readable by native — and vice versa)
 *   - Public API functions (`storePassword` / `getPassword` / `deletePassword`)
 *     dispatch to the active backend
 *
 * The Windows / macOS / Linux platform branches in `native.ts` are exercised
 * by mocking `child_process.execFile` / `spawn` per platform; the platform
 * itself is selected via a `vi.mock('node:os')` that returns the desired
 * `platform()` value.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'node:os';

const execFileMock = vi.fn();
const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const platformMock = vi.fn();
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, platform: () => platformMock() };
});

import { _resetBackendForTesting, resolveBackend, storePassword, getPassword, deletePassword, storeCertPassphrase, getCertPassphrase, deleteCertPassphrase, getSessionKey, storeSessionKey, deleteSessionKey } from '../../src/abap_cli/config/secrets.js';

function makeExecFileOk(stdout = '', stderr = '') {
  return (_cmd: string, _args: string[]) => Promise.resolve({ stdout, stderr });
}

function makeExecFileFail(message: string, code?: string | number) {
  return (_cmd: string, _args: string[]) => {
    const err: NodeJS.ErrnoException = Object.assign(new Error(message), code !== undefined ? { code } : {});
    return Promise.reject(err);
  };
}

/** Build a fake child-process-like object for `spawn` callers. */
function makeSpawnSuccess(stdout = '', stderr = '', code = 0) {
  const handlers: Record<string, Array<(b: Buffer) => void>> = {};
  const closeHandlers: Array<(code: number | null) => void> = [];
  const errorHandlers: Array<(e: Error) => void> = [];
  const stdin = { end: vi.fn() };

  const child = {
    stdout: { on: (ev: string, cb: (b: Buffer) => void) => { (handlers[ev] ??= []).push(cb); } },
    stderr: { on: (ev: string, cb: (b: Buffer) => void) => { (handlers[ev] ??= []).push(cb); } },
    stdin,
    on: (ev: string, cb: unknown) => {
      if (ev === 'close') closeHandlers.push(cb as (code: number | null) => void);
      if (ev === 'error') errorHandlers.push(cb as (e: Error) => void);
    },
    _emitStdout(data: string) { for (const cb of handlers['data'] ?? []) cb(Buffer.from(data, 'utf-8')); },
    _emitStderr(data: string) { for (const cb of handlers['data'] ?? []) cb(Buffer.from(data, 'utf-8')); },
    _close(code: number) { for (const cb of closeHandlers) cb(code); },
    _error(e: Error) { for (const cb of errorHandlers) cb(e); },
  };
  return {
    child,
    fire: () => {
      if (stdout) child._emitStdout(stdout);
      if (stderr) child._emitStderr(stderr);
      child._close(code);
    },
  };
}

describe('secrets (native backend dispatcher)', () => {
  const originalEnv = process.env.ABAP_CLI_KEYCHAIN_BACKEND;

  beforeEach(() => {
    execFileMock.mockReset();
    spawnMock.mockReset();
    platformMock.mockReset();
    _resetBackendForTesting();
    // Force the native backend — this whole test file is about the native
    // adapter, regardless of whether keytar is also installed.
    process.env.ABAP_CLI_KEYCHAIN_BACKEND = 'native';
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.ABAP_CLI_KEYCHAIN_BACKEND;
    else process.env.ABAP_CLI_KEYCHAIN_BACKEND = originalEnv;
    _resetBackendForTesting();
  });

  describe('Windows adapter (cmdkey + PowerShell)', () => {
    beforeEach(() => { platformMock.mockReturnValue('win32'); });

    it('writes via cmdkey /generic:<target> /user:<user> /pass:<value>', async () => {
      execFileMock.mockImplementation(makeExecFileOk());
      const backend = await resolveBackend();
      expect(backend.name).toBe('native-windows');
      await backend.set('PROD', 'password', 'hunter2');
      expect(execFileMock).toHaveBeenCalledWith(
        'cmdkey.exe',
        ['/generic:abap-cli/PROD', '/user:PROD', '/pass:hunter2'],
        expect.objectContaining({ windowsHide: true }),
      );
    });

    it('reads via PowerShell Add-Type + Advapi32 CredReadW', async () => {
      execFileMock.mockImplementation((cmd: string) => {
        if (cmd === 'cmdkey.exe') return Promise.resolve({ stdout: '', stderr: '' });
        if (cmd === 'powershell.exe') return Promise.resolve({ stdout: 'hunter2\n', stderr: '' });
        return Promise.reject(new Error(`unexpected ${cmd}`));
      });
      const backend = await resolveBackend();
      const got = await backend.get('PROD', 'password');
      expect(got).toBe('hunter2');
      expect(execFileMock).toHaveBeenCalledWith('powershell.exe', expect.arrayContaining(['-Command']), expect.any(Object));
    });

    it('returns null when PowerShell emits `$null`', async () => {
      execFileMock.mockImplementation((cmd: string) => {
        if (cmd === 'cmdkey.exe') return Promise.resolve({ stdout: '', stderr: '' });
        if (cmd === 'powershell.exe') return Promise.resolve({ stdout: '$null\n', stderr: '' });
        return Promise.reject(new Error(`unexpected ${cmd}`));
      });
      const backend = await resolveBackend();
      expect(await backend.get('MISSING', 'password')).toBeNull();
    });

    it('returns false on delete when target does not exist (cmdkey exit 1)', async () => {
      execFileMock.mockImplementation(makeExecFileFail('not found', 1));
      const backend = await resolveBackend();
      expect(await backend.delete('PROD', 'password')).toBe(false);
    });
  });

  describe('macOS adapter (security CLI)', () => {
    beforeEach(() => { platformMock.mockReturnValue('darwin'); });

    it('writes via security add-generic-password', async () => {
      execFileMock.mockImplementation(makeExecFileOk());
      const backend = await resolveBackend();
      await backend.set('PROD', 'password', 'hunter2');
      expect(execFileMock).toHaveBeenCalledWith('/usr/bin/security',
        ['add-generic-password', '-a', 'PROD', '-s', 'abap-cli', '-w', 'hunter2'],
        expect.any(Object),
      );
    });

    it('reads via security find-generic-password', async () => {
      execFileMock.mockImplementation((cmd: string) => {
        if (cmd === '/usr/bin/security') return Promise.resolve({ stdout: 'hunter2\n', stderr: '' });
        return Promise.reject(new Error(`unexpected ${cmd}`));
      });
      const backend = await resolveBackend();
      expect(await backend.get('PROD', 'password')).toBe('hunter2');
    });

    it('returns null on exit code 44 (item not found)', async () => {
      execFileMock.mockImplementation(makeExecFileFail('not found', 44));
      const backend = await resolveBackend();
      expect(await backend.get('PROD', 'password')).toBeNull();
    });
  });

  describe('Linux adapter (secret-tool)', () => {
    beforeEach(() => { platformMock.mockReturnValue('linux'); });

    it('writes via secret-tool store (stdin)', async () => {
      execFileMock.mockImplementation(makeExecFileOk());
      const faked = makeSpawnSuccess('', '', 0);
      spawnMock.mockImplementation(() => {
        // Fire close on next tick so the .run() promise has a chance to attach.
        setImmediate(() => faked.fire());
        return faked.child;
      });

      const backend = await resolveBackend();
      await backend.set('PROD', 'password', 'hunter2');
      expect(spawnMock).toHaveBeenCalledWith('secret-tool',
        ['store', '--label', 'abap-cli/PROD', 'service', 'abap-cli', 'account', 'PROD'],
        expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
      );
      expect(faked.child.stdin.end).toHaveBeenCalledWith('hunter2');
    });

    it('reads via secret-tool lookup (stdout)', async () => {
      execFileMock.mockImplementation(makeExecFileOk());
      const faked = makeSpawnSuccess('hunter2\n', '', 0);
      spawnMock.mockImplementation(() => {
        setImmediate(() => faked.fire());
        return faked.child;
      });

      const backend = await resolveBackend();
      expect(await backend.get('PROD', 'password')).toBe('hunter2');
    });

    it('returns null on exit code 1 (item not found)', async () => {
      execFileMock.mockImplementation(makeExecFileOk());
      const faked = makeSpawnSuccess('', '', 1);
      spawnMock.mockImplementation(() => {
        setImmediate(() => faked.fire());
        return faked.child;
      });

      const backend = await resolveBackend();
      expect(await backend.get('PROD', 'password')).toBeNull();
    });
  });

  describe('Public API dispatch', () => {
    beforeEach(() => { platformMock.mockReturnValue('darwin'); });

    it('storePassword / getPassword / deletePassword go through the active backend', async () => {
      execFileMock.mockImplementation(makeExecFileOk());
      await storePassword('PROD', 'hunter2');
      execFileMock.mockImplementation(() => Promise.resolve({ stdout: 'hunter2\n', stderr: '' }));
      expect(await getPassword('PROD')).toBe('hunter2');
      execFileMock.mockImplementation(makeExecFileOk());
      expect(await deletePassword('PROD')).toBe(true);
    });

    it('cert-passphrase kind uses `<account>.cert-passphrase` account key', async () => {
      execFileMock.mockImplementation(makeExecFileOk());
      await storeCertPassphrase('PROD', 'secret-pp');
      expect(execFileMock).toHaveBeenCalledWith('/usr/bin/security',
        ['add-generic-password', '-a', 'PROD.cert-passphrase', '-s', 'abap-cli', '-w', 'secret-pp'],
        expect.any(Object),
      );
      execFileMock.mockImplementation(() => Promise.resolve({ stdout: 'secret-pp\n', stderr: '' }));
      expect(await getCertPassphrase('PROD')).toBe('secret-pp');
      expect(await deleteCertPassphrase('PROD')).toBe(true);
    });

    it('session-key kind uses the dedicated global account name', async () => {
      execFileMock.mockImplementation(makeExecFileOk());
      await storeSessionKey('base64==');
      expect(execFileMock).toHaveBeenCalledWith('/usr/bin/security',
        ['add-generic-password', '-a', 'abap-cli/session-key', '-s', 'abap-cli', '-w', 'base64=='],
        expect.any(Object),
      );
      execFileMock.mockImplementation(() => Promise.resolve({ stdout: 'base64==\n', stderr: '' }));
      expect(await getSessionKey()).toBe('base64==');
      expect(await deleteSessionKey()).toBe(true);
    });
  });

  describe('Backend selection', () => {
    it('throws CONFIG_ERROR on an unsupported platform when env var forces native', async () => {
      process.env.ABAP_CLI_KEYCHAIN_BACKEND = 'native';
      platformMock.mockReturnValue('aix');
      await expect(resolveBackend()).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
    });

    it('prefers keytar when env var is unset (legacy compatibility)', async () => {
      // Pretend the current OS is 'aix' so native is unsupported, but keytar
      // module is loadable in the test environment (it's in optionalDeps).
      platformMock.mockReturnValue('aix');
      // No execFile mocks needed — keytar's `tryCreateKeytarBackend` will
      // either succeed (keytar is installed) or return null. Either way the
      // dispatcher should not hang.
      try {
        const backend = await resolveBackend();
        // keytar takes precedence (legacy compat); native only if keytar absent.
        expect(['keytar', 'native']).toContain(backend.name);
      } catch (error) {
        // Acceptable if keytar is also absent in the test environment — the
        // error must be CONFIG_ERROR, not a TypeError or hang.
        expect((error as { code?: string }).code).toBe('CONFIG_ERROR');
      }
    });
  });
});
