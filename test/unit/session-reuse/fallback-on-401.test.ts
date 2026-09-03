/**
 * 401 fallback on a stale reused session (SC-007 d).
 *
 * When a wrapper reuses a persisted jar and the first real request returns
 * 401 (SAP recycled the session), `_call` must:
 *   - re-login,
 *   - re-capture + persist the fresh session,
 *   - retry the original call once.
 *
 * The underlying ADTClient is mocked so no real network is hit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- shared mock handles (vi.hoisted → safe to reference in vi.mock) ----
const h = vi.hoisted(() => {
  const httpClient = {
    cookie: new Map<string, string>(),
    csrfToken: 'fetch',
    ascookies: () => '',
  };
  const mockClient: {
    login: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
    stateful: string;
    httpClient: typeof httpClient;
    searchObject: ReturnType<typeof vi.fn>;
  } = {
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    stateful: 'stateful',
    httpClient,
    searchObject: vi.fn().mockResolvedValue([]),
  };
  return {
    httpClient,
    mockClient,
    login: () => mockClient.login,
    searchObject: () => mockClient.searchObject,
    captureMock: vi.fn(),
    markPersistedMock: vi.fn().mockResolvedValue(undefined),
    loadJarMock: vi.fn().mockResolvedValue(null),
    clearJarMock: vi.fn(),
    injectMock: vi.fn(),
    loadConfigMock: vi.fn(),
    buildAuthMock: vi.fn(),
    keyMock: vi.fn(),
  };
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
  cookies: [{ name: 'SAP_SESSIONID_VH4_001', value: 'stale' }],
  csrf: { value: 'stale-csrf', fetchedAt: '2026-01-01T00:00:00Z' },
};

vi.mock('abap-adt-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('abap-adt-api')>();
  return {
    ...actual,
    ADTClient: vi.fn().mockImplementation(() => h.mockClient),
    session_types: { stateful: 'stateful', stateless: 'stateless', keep: '' },
  };
});

vi.mock('../../../src/abap_cli/session/reuse.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/abap_cli/session/reuse.js')>();
  return {
    ...actual,
    injectSessionIntoAdt: h.injectMock,
    captureSessionFromAdt: h.captureMock,
    markJarPersisted: h.markPersistedMock,
    loadJarFromDisk: h.loadJarMock,
    clearJarFromDisk: h.clearJarMock,
    icfCookieHeader: vi.fn(),
  };
});

vi.mock('../../../src/abap_cli/session/key.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/abap_cli/session/key.js')>();
  return {
    ...actual,
    loadOrCreateSessionKey: h.keyMock,
  };
});

vi.mock('../../../src/abap_cli/config/project-config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/abap_cli/config/project-config.js')>();
  return {
    ...actual,
    loadConfig: h.loadConfigMock,
  };
});

vi.mock('../../../src/abap_cli/auth/adapter.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/abap_cli/auth/adapter.js')>();
  return {
    ...actual,
    buildAuth: h.buildAuthMock,
  };
});

import { AdtClientWrapper } from '../../../src/abap_cli/clients/adt-client.js';
import { resetRegistry } from '../../../src/abap_cli/session/registry.js';

function defaultConfig(extra: { sessionPolicy?: string; systemType?: string } = {}) {
  return {
    sap: {
      url: 'http://vhcala4hci:50000',
      client: '001',
      username: 'DEVELOPER',
      password: 'x',
      language: 'EN',
      insecure: true,
      caPath: '',
      auth: { method: 'basic' },
      sourceDir: '.',
      ...extra,
    },
    transport: '',
    package: '',
    systemName: 'vhcala4hci',
  };
}

function seedStale401(): void {
  h.searchObject().mockReset();
  h.searchObject().mockImplementationOnce(async () => {
    const err = new Error('authentication failed') as Error & { status?: number };
    err.status = 401;
    throw err;
  });
  h.searchObject().mockResolvedValue([{ 'adtcore:name': 'ZCL_X', 'adtcore:type': 'CLAS/OC' }]);
}

describe('AdtClientWrapper 401 fallback (reuse mode)', () => {
  beforeEach(() => {
    resetRegistry();
    vi.clearAllMocks();
    h.loadConfigMock.mockResolvedValue(defaultConfig());
    h.buildAuthMock.mockResolvedValue({ passwordOrFetcher: 'x', options: { headers: {} }, label: 'basic' });
    h.keyMock.mockResolvedValue({ key: Buffer.alloc(32, 1), mode: 'derived' });
    h.login().mockReset().mockResolvedValue(undefined);
    h.httpClient.cookie.clear();
    h.httpClient.cookie.set('SAP_SESSIONID_VH4_001', 'SAP_SESSIONID_VH4_001=stale');
    h.httpClient.csrfToken = 'stale-csrf';
    seedStale401();
  });

  afterEach(() => {
    resetRegistry();
  });

  it('re-logins + retries once on a stale-jar 401, then succeeds', async () => {
    h.loadJarMock.mockResolvedValue(jarFixture as never);
    const wrapper = await AdtClientWrapper.create();
    expect(wrapper.reusedSession).toBe(true);

    const hits = await wrapper.searchObject('ZCL');
    expect(hits).toHaveLength(1);
    expect(h.searchObject()).toHaveBeenCalledTimes(2); // 1 fail + 1 retry
    expect(h.login()).toHaveBeenCalledTimes(1); // fallback re-login
    expect(h.captureMock).toHaveBeenCalled();
    expect(h.markPersistedMock).toHaveBeenCalled();
  });

  it('does not fallback twice when the retry also fails', async () => {
    h.loadJarMock.mockResolvedValue(jarFixture as never);
    h.searchObject().mockReset();
    h.searchObject().mockRejectedValue(Object.assign(new Error('authentication failed'), { status: 401 }));
    const wrapper = await AdtClientWrapper.create();
    await expect(wrapper.searchObject('ZCL')).rejects.toMatchObject({ code: 'AUTH_ERROR' });
    expect(h.login()).toHaveBeenCalledTimes(1); // exactly one fallback
  });

  it('is skipped in always-logout mode (no jar read, no fallback retry)', async () => {
    process.env.ABAP_CLI_SESSION_POLICY = 'always-logout';
    try {
      h.loadConfigMock.mockResolvedValue(defaultConfig({ sessionPolicy: 'always-logout' }));
      h.searchObject().mockReset().mockResolvedValue([{ 'adtcore:name': 'ZCL_X', 'adtcore:type': 'CLAS/OC' }]);
      const wrapper = await AdtClientWrapper.create();
      const hits = await wrapper.searchObject('ZCL');
      expect(hits).toHaveLength(1);
      expect(h.loadJarMock).not.toHaveBeenCalled();
      expect(h.searchObject()).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.ABAP_CLI_SESSION_POLICY;
    }
  });

  it('fresh login when no jar exists, then persists a new jar', async () => {
    h.loadJarMock.mockResolvedValue(null);
    h.searchObject().mockReset().mockResolvedValue([{ 'adtcore:name': 'ZCL_X', 'adtcore:type': 'CLAS/OC' }]);
    const wrapper = await AdtClientWrapper.create();
    expect(wrapper.reusedSession).toBe(false);
    const hits = await wrapper.searchObject('ZCL');
    expect(hits).toHaveLength(1);
    expect(h.login()).toHaveBeenCalledTimes(1); // ensureSession login
    expect(h.captureMock).toHaveBeenCalled();
    expect(h.markPersistedMock).toHaveBeenCalled();
  });

  it('is skipped entirely for cloud/btp profiles (no jar read/write)', async () => {
    h.loadConfigMock.mockResolvedValue(defaultConfig({ systemType: 'cloud' }));
    h.searchObject().mockReset().mockResolvedValue([{ 'adtcore:name': 'ZCL_X', 'adtcore:type': 'CLAS/OC' }]);
    const wrapper = await AdtClientWrapper.create();
    await wrapper.searchObject('ZCL');
    expect(h.loadJarMock).not.toHaveBeenCalled();
    expect(h.keyMock).not.toHaveBeenCalled();
  });
});
