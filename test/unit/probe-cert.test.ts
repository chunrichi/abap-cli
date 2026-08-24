import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const getSystem = vi.fn();
vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: (...args: unknown[]) => getSystem(...args),
}));

const { probeSystem } = await import('../../src/abap_cli/clients/probe.js');

describe('probeSystem — cert auth (v2 canonical)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports authMethod=cert on the SystemProbe layers', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-cert-'));
    const cert = path.join(dir, 'cert.pem');
    const key = path.join(dir, 'key.pem');
    fs.writeFileSync(cert, 'BEGIN');
    fs.writeFileSync(key, 'BEGIN');
    getSystem.mockReturnValueOnce({
      url: 'http://localhost:1',
      client: '100',
      username: 'u',
      language: 'EN',
      auth: { method: 'cert', cert: { certPath: cert, keyPath: key } },
    });
    // Use a non-existent host so the auth/adt/icf layers fail predictably; we
    // only assert that the cert pre-flight passes (tls: ok or skipped, not
    // CONFIG_ERROR).
    const probe = await probeSystem('trial');
    expect(probe.tls.error?.code).not.toBe('CONFIG_ERROR');
    expect(probe.auth.authMethod).toBe('cert');
    expect(probe.adt.authMethod).toBe('cert');
    expect(probe.icf.authMethod).toBe('cert');
  });

  it('cert pre-flight fails TLS layer when cert file is missing', async () => {
    getSystem.mockReturnValueOnce({
      url: 'https://localhost:1',
      client: '100',
      username: 'u',
      language: 'EN',
      auth: { method: 'cert', cert: { certPath: '/no/such/cert.pem', keyPath: '/no/such/key.pem' } },
    });
    const probe = await probeSystem('trial');
    expect(probe.tls.ok).toBe(false);
    expect(probe.tls.error?.code).toBe('CONFIG_ERROR');
    expect(probe.tls.error?.message).toMatch(/cert auth pre-flight/);
    expect(probe.tls.authMethod).toBe('cert');
  });

  it('reports authMethod=basic when profile has no auth method (defaults)', async () => {
    getSystem.mockReturnValueOnce({
      url: 'http://localhost:1',
      client: '100',
      username: 'u',
      language: 'EN',
      auth: { method: 'basic' },
    });
    const probe = await probeSystem('trial');
    expect(probe.tls.authMethod).toBe('basic');
    expect(probe.auth.authMethod).toBe('basic');
  });
});