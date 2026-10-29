import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';

const getSystem = vi.fn();
const deleteSystem = vi.fn();
const deletePassword = vi.fn();
const deleteCertPassphrase = vi.fn();

vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: (...args: unknown[]) => getSystem(...args),
  deleteSystem: (...args: unknown[]) => deleteSystem(...args),
  upsertSystem: () => undefined,
  listSystemNames: () => [],
}));

vi.mock('../../src/abap_cli/config/secrets.js', () => ({
  deletePassword: (...args: unknown[]) => deletePassword(...args),
  deleteCertPassphrase: (...args: unknown[]) => deleteCertPassphrase(...args),
}));

// Redirect defaultCookieFile to /tmp so the test never touches the real
// ~/.abap-cli (sandboxed runners may not have unlink permission there).
vi.mock('../../src/abap_cli/auth/sso-cookie.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/abap_cli/auth/sso-cookie.js')>();
  return {
    ...actual,
    defaultCookieFile: (name: string) => `/tmp/test-${name}.sso.cookies.json`,
    clearCookieStore: (file: string) => {
      try { fs.unlinkSync(file); return true; } catch { return false; }
    },
  };
});

import { runDelete } from '../../src/abap_cli/flows/setup/profile.js';

describe('profile-flow.runDelete — v2 canonical cookie jar cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deletePassword.mockResolvedValue(true);
    deleteCertPassphrase.mockResolvedValue(true);
    deleteSystem.mockReturnValue(true);
  });

  it('removes a CUSTOM sso.cookieFile path (regression: snapshot before deleteSystem)', async () => {
    const custom = '/tmp/trial-custom-cookies-v2.json';
    fs.writeFileSync(custom, JSON.stringify({ format: 'abap-cli-sso-cookies', version: 1, capturedAt: Date.now(), cookies: [] }));
    getSystem.mockReturnValue({
      url: 'https://sap.example.com',
      client: '100',
      username: 'me',
      language: 'EN',
      auth: { method: 'browser_sso', sso: { cookieFile: custom } },
    });

    await runDelete('trial', true, 'json');
    expect(fs.existsSync(custom)).toBe(false);
  });

  it('cleans up default cookie jar when auth.sso has no cookieFile', async () => {
    // defaultCookieFile is mocked to /tmp/test-<name>.sso.cookies.json (see
    // vi.mock at the top of this file).
    const defaultPath = '/tmp/test-trial.sso.cookies.json';
    fs.writeFileSync(defaultPath, JSON.stringify({ format: 'abap-cli-sso-cookies', version: 1, capturedAt: Date.now(), cookies: [] }));

    getSystem.mockReturnValue({
      url: 'https://sap.example.com',
      client: '100',
      username: 'me',
      language: 'EN',
      auth: { method: 'browser_sso', sso: {} },
    });

    await runDelete('trial', true, 'json');
    expect(fs.existsSync(defaultPath)).toBe(false);
  });
});