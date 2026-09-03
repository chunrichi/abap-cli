/**
 * IcfClient cookie reuse (FR-010) + stale-cookie 401 fallback.
 *
 * - reuse mode injects the jar Cookie header into axios defaults.
 * - a 401/403 on a reused cookie drops the header and retries once with
 *   basic-auth before surfacing a transport error.
 * - cloud/btp profiles never read or write the jar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const loadJarMock = vi.fn().mockResolvedValue(null);
  const keyMock = vi.fn().mockResolvedValue({ key: Buffer.alloc(32, 1), mode: 'derived' });
  const loadConfigMock = vi.fn();
  const buildAuthMock = vi.fn();
  const policyEnv = vi.fn();
  return { loadJarMock, keyMock, loadConfigMock, buildAuthMock, policyEnv };
});

const jarFixture = {
  formatVersion: '1',
  header: {
    createdAt: '2026-01-01T00:00:00Z',
    lastLoginAt: '2026-01-01T00:00:00Z',
    systemHash: 'aaaaaaaaaaaaaaaa',
    profileName: 'vhcala4hci',
    systemType: 'on-prem',
  },
  cookies: [{ name: 'SAP_SESSIONID_VH4_001', value: 'abc' }],
  csrf: { value: 'csrf', fetchedAt: '2026-01-01T00:00:00Z' },
};

vi.mock('../../../src/abap_cli/session/reuse.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/abap_cli/session/reuse.js')>();
  return {
    ...actual,
    loadJarFromDisk: h.loadJarMock,
    icfCookieHeader: (jar: { cookies: Array<{ name: string; value: string }> }) =>
      jar.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
  };
});

vi.mock('../../../src/abap_cli/session/key.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/abap_cli/session/key.js')>();
  return { ...actual, loadOrCreateSessionKey: h.keyMock };
});

vi.mock('../../../src/abap_cli/config/project-config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/abap_cli/config/project-config.js')>();
  return { ...actual, loadConfig: h.loadConfigMock };
});

vi.mock('../../../src/abap_cli/auth/adapter.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/abap_cli/auth/adapter.js')>();
  return { ...actual, buildAuth: h.buildAuthMock };
});

// Redirect the real jar-loading so reuse mode is decided purely by mocks.
import { IcfClient } from '../../../src/abap_cli/clients/icf-client.js';
import { resetRegistry } from '../../../src/abap_cli/session/registry.js';

function defaultConfig(systemType?: string) {
  return {
    sap: {
      url: 'http://vhcala4hci:50000',
      client: '001',
      username: 'DEVELOPER',
      password: 'pw',
      language: 'EN',
      insecure: true,
      caPath: '',
      auth: { method: 'basic' },
      sourceDir: '.',
      systemType,
    },
    transport: '',
    package: '',
    systemName: 'vhcala4hci',
  };
}

describe('IcfClient cookie reuse', () => {
  beforeEach(() => {
    resetRegistry();
    vi.clearAllMocks();
    h.loadConfigMock.mockResolvedValue(defaultConfig());
    h.buildAuthMock.mockResolvedValue({ passwordOrFetcher: 'pw', options: { headers: {} }, label: 'basic' });
  });

  afterEach(() => {
    resetRegistry();
    delete process.env.ABAP_CLI_SESSION_POLICY;
  });

  it('injects the jar Cookie header in reuse mode', async () => {
    h.loadJarMock.mockResolvedValue(jarFixture as never);
    const client = await IcfClient.create();
    const headers = (client as unknown as { http: { defaults: { headers: { common: Record<string, string> } } } }).http.defaults
      .headers.common;
    expect(headers['Cookie']).toBe('SAP_SESSIONID_VH4_001=abc');
  });

  it('falls back to basic-auth (drops Cookie) on a reused-cookie 401', async () => {
    h.loadJarMock.mockResolvedValue(jarFixture as never);
    const client = await IcfClient.create();

    // Stub the axios instance verbs: first get() 401, second succeeds.
    const http = (client as unknown as {
      http: { defaults: Record<string, unknown>; get: ReturnType<typeof vi.fn> };
    }).http;
    const failing = Object.assign(new Error('Unauthorized'), {
      isAxiosError: true,
      response: { status: 401, data: {} },
    });
    http.get = vi.fn()
      .mockRejectedValueOnce(failing)
      .mockResolvedValue({ data: { status: 'success', data: null, error: null } });

    const resp = await client.get('/tcode/SE38');
    expect(http.get).toHaveBeenCalledTimes(2);
    // Cookie header was dropped before the retry.
    const common = http.defaults.headers.common as Record<string, string>;
    expect(common['Cookie']).toBeUndefined();
    expect(resp.status).toBe('success');
  });

  it('does not touch the jar for cloud profiles', async () => {
    h.loadConfigMock.mockResolvedValue(defaultConfig('cloud'));
    h.loadJarMock.mockClear();
    const client = await IcfClient.create();
    expect(h.loadJarMock).not.toHaveBeenCalled();
    expect(h.keyMock).not.toHaveBeenCalled();
    void client;
  });

  it('does not touch the jar under always-logout', async () => {
    process.env.ABAP_CLI_SESSION_POLICY = 'always-logout';
    h.loadJarMock.mockClear();
    const client = await IcfClient.create();
    expect(h.loadJarMock).not.toHaveBeenCalled();
    void client;
  });
});
