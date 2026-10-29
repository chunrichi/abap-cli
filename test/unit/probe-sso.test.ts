import { describe, expect, it, vi, beforeEach } from 'vitest';

const getSystem = vi.fn();
vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: (...args: unknown[]) => getSystem(...args),
}));

const { probeSystem } = await import('../../src/abap_cli/clients/probe.js');

describe('probeSystem — browser_sso ', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tls layer fails fast when SSO cookie file is missing', async () => {
    getSystem.mockReturnValueOnce({
      url: 'https://localhost:1',
      client: '100',
      username: 'u',
      language: 'EN',
      auth: { method: 'browser_sso', sso: {} },
    });
    const probe = await probeSystem('trial');
    expect(probe.tls.ok).toBe(false);
    expect(probe.tls.error?.code).toBe('AUTH_ERROR');
    expect(probe.tls.error?.message).toMatch(/SSO cookie file not found/);
    expect(probe.tls.authMethod).toBe('browser_sso');
  });
});