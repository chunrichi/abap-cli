import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const getCertPassphrase = vi.fn(async () => null);
vi.mock('../../src/abap_cli/config/secrets.js', () => ({
  getCertPassphrase: (...args: unknown[]) => getCertPassphrase(...args),
}));

const { buildAuth } = await import('../../src/abap_cli/auth/adapter.js');

function baseSap(overrides: Record<string, unknown> = {}) {
  return {
    url: 'http://vhcala4hci:50000',
    client: '001',
    username: 'dev',
    password: 'secret',
    language: 'EN',
    insecure: true,
    caPath: '',
    sourceDir: process.cwd(),
    auth: { method: 'basic' as const },
    ...overrides,
  };
}

describe('auth/adapter.buildAuth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('basic auth: returns password as-is', async () => {
    const result = await buildAuth(baseSap({ password: 'p@ss' }), 'dev');
    expect(result.passwordOrFetcher).toBe('p@ss');
    expect(result.label).toBe('basic');
  });

  it('cert auth: returns "x509-cert-auth" password stub and a populated httpsAgent', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-adapter-'));
    const cert = path.join(dir, 'cert.pem');
    const key = path.join(dir, 'key.pem');
    fs.writeFileSync(cert, '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n');
    fs.writeFileSync(key, '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n');
    getCertPassphrase.mockResolvedValueOnce(null);

    const sap = baseSap({
      auth: { method: 'cert' as const, cert: { certPath: cert, keyPath: key } },
      password: 'should-be-ignored',
    });
    const result = await buildAuth(sap, 'trial');

    expect(result.passwordOrFetcher).toBe('x509-cert-auth');
    expect(result.options.httpsAgent).toBeDefined();
    expect(result.label).toBe('cert');
    expect(getCertPassphrase).toHaveBeenCalledWith('trial');
  });

  it('cert auth: CONFIG_ERROR when certPath file is missing', async () => {
    const sap = baseSap({
      auth: { method: 'cert' as const, cert: { certPath: '/non/existent/cert.pem', keyPath: '/non/existent/key.pem' } },
    });
    await expect(buildAuth(sap, 'dev')).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
  });

  it('cert auth: requires both certPath and keyPath (CONFIG_ERROR on empty)', async () => {
    const sap = baseSap({
      auth: { method: 'cert' as const, cert: { certPath: '', keyPath: '' } },
    });
    await expect(buildAuth(sap, 'dev')).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
  });

  it('cert auth: rejects unknown auth method with CONFIG_ERROR', async () => {
    const sap = baseSap({ auth: { method: 'oauth_onprem' as unknown as 'basic' } });
    await expect(buildAuth(sap, 'dev')).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
  });
});