import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('../../src/abap_cli/config/secrets.js', () => ({
  getCertPassphrase: () => Promise.resolve(null),
}));

import { buildAuth } from '../../src/abap_cli/auth/adapter.js';
import { writeCookieStore } from '../../src/abap_cli/auth/sso-cookie.js';

function baseSap(overrides: Record<string, unknown> = {}) {
  return {
    url: 'http://vhcala4hci:50000',
    client: '001',
    username: 'me',
    password: 'unused',
    language: 'EN',
    insecure: true,
    caPath: '',
    sourceDir: process.cwd(),
    auth: { method: 'browser_sso' as const, sso: {} },
    ...overrides,
  };
}

describe('auth/adapter.buildAuth (browser_sso, 026)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws AUTH_ERROR with `abap profile login <name>` nextStep when cookie file is missing', async () => {
    // No cookie file written — adapter should fail-fast.
    await expect(buildAuth(baseSap(), 'nonexistent-profile')).rejects.toMatchObject({
      code: 'AUTH_ERROR',
      message: expect.stringContaining('No SSO cookie file'),
    });
  });

  it('throws AUTH_ERROR when stored cookies are expired', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-sso-'));
    const cookieFile = path.join(dir, 'cookies.json');
    await writeCookieStore(cookieFile, [{ name: 'X', value: 'Y' }]);
    // Force expiry by rewriting capturedAt 31 minutes in the past.
    const raw = JSON.parse(fs.readFileSync(cookieFile, 'utf-8'));
    raw.capturedAt = Date.now() - 31 * 60 * 1000;
    fs.writeFileSync(cookieFile, JSON.stringify(raw));
    await expect(buildAuth(baseSap({ auth: { method: 'browser_sso', sso: { cookieFile } } }), 'p')).rejects.toMatchObject({
      code: 'AUTH_ERROR',
      message: expect.stringContaining('expired'),
    });
  });

  it('returns headers.Cookie with the captured cookies on success', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-sso-'));
    const cookieFile = path.join(dir, 'cookies.json');
    await writeCookieStore(cookieFile, [
      { name: 'MYSAPSSO2', value: 'aaa' },
      { name: 'sap-XCSRF', value: 'bbb' },
    ]);
    const sap = baseSap({ auth: { method: 'browser_sso', sso: { cookieFile } } });
    const built = await buildAuth(sap, 'p');
    expect(built.passwordOrFetcher).toBe('browser-sso');
    expect(built.label).toBe('browser_sso');
    expect(built.options.headers?.Cookie).toBe('MYSAPSSO2=aaa; sap-XCSRF=bbb');
  });

  it('honours a custom sso cookieFile path on the SapConfig', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-sso-'));
    const cookieFile = path.join(dir, 'custom-cookies.json');
    await writeCookieStore(cookieFile, [{ name: 'K', value: 'V' }]);
    const sap = baseSap({ auth: { method: 'browser_sso', sso: { cookieFile } } });
    const built = await buildAuth(sap, 'p');
    expect(built.options.headers?.Cookie).toBe('K=V');
  });
});