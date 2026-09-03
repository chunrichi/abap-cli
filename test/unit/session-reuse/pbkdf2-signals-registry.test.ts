/**
 * SessionKey derivation + registry / signals / always-logout behaviour
 * (SC-007 e/f/g).
 *
 * - PBKDF2 reference vector is stable across Node versions.
 * - `sessionKeyFromBase64` / `sessionKeyToBase64` round-trip.
 * - `registry` drain is idempotent and calls logout()/cleanup() once.
 * - `end-of-command` only drains under `always-logout`.
 * - signal handler drains clients and exits once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveSessionKey, sessionKeyFromBase64, sessionKeyToBase64 } from '../../../src/abap_cli/session/key.js';
import { drainClients, registerAdtClient, registerIcfClient, resetRegistry } from '../../../src/abap_cli/session/registry.js';
import { _resetPolicyGuard, runAlwaysLogoutIfNeeded } from '../../../src/abap_cli/session/end-of-command.js';
import { _resetSignalState, handleSignal } from '../../../src/abap_cli/session/signals.js';
import type { SapConfig } from '../../../src/abap_cli/config/project-config.js';

function profile(): SapConfig {
  return {
    url: 'http://vhcala4hci:50000',
    client: '001',
    username: 'DEVELOPER',
    password: 'x',
    language: 'EN',
    insecure: true,
    caPath: '',
    auth: { method: 'basic' },
    sourceDir: '.',
  };
}

describe('deriveSessionKey (PBKDF2 reference vector)', () => {
  it('matches the reference vector for the canonical profile', () => {
    // Reference computed with Node crypto.pbkdf2Sync (sha256, 100k iter).
    expect(deriveSessionKey(profile()).toString('hex')).toBe(
      '0bb9d58b747f6532efc325c12233a3b47fd618c748e8529e591f02d979699274',
    );
  });

  it('is deterministic across calls', () => {
    expect(deriveSessionKey(profile()).equals(deriveSessionKey(profile()))).toBe(true);
  });

  it('changes when any profile field changes', () => {
    const base = deriveSessionKey(profile()).toString('hex');
    const other = deriveSessionKey({ ...profile(), client: '100' }).toString('hex');
    expect(other).not.toBe(base);
  });
});

describe('sessionKey base64 round-trip', () => {
  it('round-trips a 32-byte key', () => {
    const key = deriveSessionKey(profile());
    expect(sessionKeyFromBase64(sessionKeyToBase64(key)).equals(key)).toBe(true);
  });

  it('rejects a base64 string of the wrong length', () => {
    expect(() => sessionKeyFromBase64('aGVsbG8=')).toThrow();
  });
});

describe('registry drain', () => {
  beforeEach(() => {
    resetRegistry();
    _resetPolicyGuard();
    _resetSignalState();
  });
  afterEach(() => {
    resetRegistry();
    _resetPolicyGuard();
    _resetSignalState();
  });

  it('calls logout() on every registered ADT client exactly once', async () => {
    const a = { logout: vi.fn().mockResolvedValue(undefined) };
    const b = { logout: vi.fn().mockResolvedValue(undefined) };
    registerAdtClient(a as never);
    registerAdtClient(b as never);
    await drainClients({ adt: true, icf: false });
    expect(a.logout).toHaveBeenCalledTimes(1);
    expect(b.logout).toHaveBeenCalledTimes(1);
    // Second drain is a no-op (registry already empty).
    await drainClients({ adt: true, icf: false });
    expect(a.logout).toHaveBeenCalledTimes(1);
  });

  it('calls cleanup() on every registered ICF client', async () => {
    const a = { cleanup: vi.fn() };
    registerIcfClient(a as never);
    await drainClients({ adt: false, icf: true });
    expect(a.cleanup).toHaveBeenCalledTimes(1);
  });

  it('tolerates a logout() that throws', async () => {
    const a = { logout: vi.fn().mockRejectedValue(new Error('network down')) };
    registerAdtClient(a as never);
    await expect(drainClients({ adt: true, icf: false })).resolves.toBeUndefined();
  });
});

describe('runAlwaysLogoutIfNeeded', () => {
  beforeEach(() => {
    resetRegistry();
    _resetPolicyGuard();
  });
  afterEach(() => {
    resetRegistry();
    _resetPolicyGuard();
  });

  it('drains clients when policy is always-logout', async () => {
    const a = { logout: vi.fn().mockResolvedValue(undefined) };
    registerAdtClient(a as never);
    const cfg = {
      sap: {
        url: 'http://x', client: '001', username: 'U', password: '', language: 'EN',
        insecure: true, caPath: '', auth: { method: 'basic' as const }, sourceDir: '.',
        sessionPolicy: 'always-logout' as const,
      },
      transport: '', package: '', systemName: 'x',
    };
    await runAlwaysLogoutIfNeeded(cfg as never);
    expect(a.logout).toHaveBeenCalledTimes(1);
  });

  it('does NOT drain clients when policy is reuse (default)', async () => {
    const a = { logout: vi.fn().mockResolvedValue(undefined) };
    registerAdtClient(a as never);
    const cfg = {
      sap: {
        url: 'http://x', client: '001', username: 'U', password: '', language: 'EN',
        insecure: true, caPath: '', auth: { method: 'basic' as const }, sourceDir: '.',
      },
      transport: '', package: '', systemName: 'x',
    };
    await runAlwaysLogoutIfNeeded(cfg as never);
    expect(a.logout).not.toHaveBeenCalled();
  });

  it('is guarded to run once per process even under always-logout', async () => {
    const a = { logout: vi.fn().mockResolvedValue(undefined) };
    registerAdtClient(a as never);
    const cfg = {
      sap: {
        url: 'http://x', client: '001', username: 'U', password: '', language: 'EN',
        insecure: true, caPath: '', auth: { method: 'basic' as const }, sourceDir: '.',
        sessionPolicy: 'always-logout' as const,
      },
      transport: '', package: '', systemName: 'x',
    };
    await runAlwaysLogoutIfNeeded(cfg as never);
    // A second registered client after the guard fired is not drained this run.
    const b = { logout: vi.fn().mockResolvedValue(undefined) };
    registerAdtClient(b as never);
    await runAlwaysLogoutIfNeeded(cfg as never);
    expect(b.logout).not.toHaveBeenCalled();
  });
});

describe('signal handler', () => {
  beforeEach(() => {
    resetRegistry();
    _resetSignalState();
  });
  afterEach(() => {
    resetRegistry();
    _resetSignalState();
  });

  it('drains clients then exits 130 on SIGINT', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const a = { logout: vi.fn().mockResolvedValue(undefined) };
    registerAdtClient(a as never);
    try {
      await handleSignal('SIGINT');
      expect(a.logout).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(130);
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('exits 143 on SIGTERM', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      await handleSignal('SIGTERM');
      expect(exitSpy).toHaveBeenCalledWith(143);
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('only exits once for a second signal while already exiting', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      await handleSignal('SIGINT');
      await handleSignal('SIGINT');
      expect(exitSpy).toHaveBeenCalledTimes(1);
    } finally {
      exitSpy.mockRestore();
    }
  });
});
