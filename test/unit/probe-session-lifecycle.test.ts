/**
 * Probe session lifecycle — `profile test` / `init` must not leak SAP sessions.
 *
 * The probe layers open their own raw ADT clients (they run before the
 * workspace wrapper exists). Every one of those logins is a stateful SAP
 * session; leaking them fills the ICM session table, after which SAP answers
 * logins with an anonymous context only and ADT requests fail with
 * `400 Session not found`. One login + one logout per `probeSystem` call,
 * regardless of which layer fails.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  logout: vi.fn(),
  request: vi.fn(),
  getSystem: vi.fn(),
  upsertSystem: vi.fn(),
  getPassword: vi.fn(),
}));

vi.mock('abap-adt-api', () => ({
  ADTClient: vi.fn().mockImplementation(function () {
    return {
      login: (...a: unknown[]) => mocks.login(...a),
      logout: (...a: unknown[]) => mocks.logout(...a),
      httpClient: { request: (...a: unknown[]) => mocks.request(...a) },
    };
  }),
}));

vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: (...a: unknown[]) => mocks.getSystem(...a),
  upsertSystem: (...a: unknown[]) => mocks.upsertSystem(...a),
}));

vi.mock('../../src/abap_cli/config/secrets.js', () => ({
  getPassword: (...a: unknown[]) => mocks.getPassword(...a),
}));

vi.mock('../../src/abap_cli/clients/basic-auth.js', () => ({
  buildBasicAuth: () => ({ password: 'pw', options: {} }),
}));

vi.mock('../../src/abap_cli/config/project-config.js', () => ({
  readCaCertificate: () => undefined,
}));

import { probeSystem } from '../../src/abap_cli/clients/probe.js';

const PROFILE = {
  url: 'http://127.0.0.1:9', // http → TLS layer is skipped
  client: '100',
  username: 'dev',
  language: 'EN',
};

/** Kernel-release Atom fragment the probe parses from /system/information. */
const KERNEL_XML =
  '<atom:feed><atom:entry><atom:id>KernelRelease</atom:id><atom:title>S4</atom:title></atom:entry></atom:feed>';

const OK_PROBE = { status: 200, body: '' };

describe('probeSystem session lifecycle', () => {
  beforeEach(() => {
    mocks.login.mockReset().mockResolvedValue(undefined);
    mocks.logout.mockReset().mockResolvedValue(undefined);
    mocks.request.mockReset();
    mocks.getSystem.mockReset().mockReturnValue(PROFILE);
    mocks.upsertSystem.mockReset();
    mocks.getPassword.mockReset().mockResolvedValue('pw');
    mocks.request.mockImplementation((path: string) =>
      Promise.resolve(path.includes('/system/information') ? { status: 200, body: KERNEL_XML } : OK_PROBE),
    );
  });

  it('opens one stateful session for the whole probe and releases it', async () => {
    const probe = await probeSystem('sys');

    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    expect(probe.tls.ok).toBe(true);
    expect(probe.auth.ok).toBe(true);
    expect(probe.adt.ok).toBe(true);
    expect(probe.icf.ok).toBe(true);
    expect(probe.capabilities).toBeDefined();
    expect(probe.ddlSourceSupported).toBe(true);
  });

  it('releases the session even when a probe endpoint fails', async () => {
    mocks.request.mockImplementation((path: string) => {
      if (path === '/sap/bc/adt/discovery') return Promise.reject(new Error('404 Not Found'));
      return Promise.resolve(path.includes('/system/information') ? { status: 200, body: KERNEL_XML } : OK_PROBE);
    });

    const probe = await probeSystem('sys');

    expect(probe.adt.ok).toBe(false);
    expect(probe.icf.ok).toBe(true);
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(mocks.logout).toHaveBeenCalledTimes(1);
  });

  it('reports a login failure as the auth layer and does not probe further', async () => {
    mocks.login.mockRejectedValue(new Error('401 Unauthorized'));

    const probe = await probeSystem('sys');

    expect(probe.auth.ok).toBe(false);
    expect(probe.adt.skipped).toBe(true);
    expect(probe.icf.skipped).toBe(true);
    // Login failed → no session was established, so there is nothing to log out.
    expect(mocks.logout).not.toHaveBeenCalled();
  });
});
