/**
 * Tests for `abap profile cookie` — the headless cookie-import path.
 *
 * Covers:
 *   - rejects unknown profile
 *   - rejects profiles with auth.method !== 'browser_sso'
 *   - rejects empty / unparseable header
 *   - rejects header with no SAP_SESSIONID_*
 *   - writes cookie jar with redacted output (no plaintext value)
 *   - honours --cookie-file override
 *   - reads header from --from-file
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: vi.fn(),
}));

import { runCookieImport } from '../../src/abap_cli/flows/setup/cookie-import.js';
import * as userConfig from '../../src/abap_cli/config/user-config.js';

const getSystemMock = userConfig.getSystem as unknown as ReturnType<typeof vi.fn>;

const sampleHeader = 'SAP_SESSIONID_001_100=AbCdEf123; route=R/001%2F100%2Fabc; sap-usercontext=sap-usercontext=eyJhY2NvdW50Ijp7Ik5PIjoiREVWRUxPUEVSIiwiQ0xJRU5UIjoiMDAxIiwiTEFOR1VBR0UiOiJFTiJ9fQ==';

function profileBrowserSso() {
  return {
    url: 'https://sap.example.com',
    client: '100',
    username: 'me',
    language: 'EN',
    auth: { method: 'browser_sso' as const, sso: {} },
  };
}

function profileBasic() {
  return {
    url: 'https://sap.example.com',
    client: '100',
    username: 'me',
    language: 'EN',
    auth: { method: 'basic' as const },
  };
}

describe('profile cookie (cookie-import)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cookie-profile-'));
    getSystemMock.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('rejects an unknown profile with CONFIG_ERROR', async () => {
    getSystemMock.mockReturnValue(null);
    await expect(runCookieImport('NOPE', sampleHeader, {}, 'human'))
      .rejects.toMatchObject({ code: 'CONFIG_ERROR', message: expect.stringContaining("not found") });
  });

  it('rejects a profile with auth.method !== browser_sso', async () => {
    getSystemMock.mockReturnValue(profileBasic());
    await expect(runCookieImport('BASIC', sampleHeader, {}, 'human'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining("not 'browser_sso'") });
  });

  it('rejects an empty header', async () => {
    getSystemMock.mockReturnValue(profileBrowserSso());
    await expect(runCookieImport('SSO', '   ', {}, 'human'))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT', message: expect.stringContaining('No cookies parsed') });
  });

  it('rejects a header without SAP_SESSIONID_*', async () => {
    getSystemMock.mockReturnValue(profileBrowserSso());
    await expect(runCookieImport('SSO', 'foo=bar; baz=qux', {}, 'human'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('SAP_SESSIONID_') });
  });

  it('writes the cookie jar and redacts values', async () => {
    getSystemMock.mockReturnValue(profileBrowserSso());
    const target = path.join(tmpDir, 'SSO.sso.cookies.json');
    const logSpy = vi.mocked(console.log);
    await runCookieImport('SSO', sampleHeader, { cookieFile: target }, 'json');

    expect(fs.existsSync(target)).toBe(true);

    // Result should NOT include the raw cookie values — only length.
    const logged = logSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
    expect(logged).not.toContain('AbCdEf123');
    expect(logged).not.toContain('eyJhY2NvdW50');
    expect(logged).toContain('valueLength');

    // But the on-disk file DOES contain the real values.
    const onDisk = fs.readFileSync(target, 'utf-8');
    expect(onDisk).toContain('AbCdEf123');
  });

  it('honours --cookie-file override', async () => {
    getSystemMock.mockReturnValue(profileBrowserSso());
    const override = path.join(tmpDir, 'my.jar');
    await runCookieImport('SSO', sampleHeader, { cookieFile: override }, 'human');
    expect(fs.existsSync(override)).toBe(true);
  });

  it('reads the header from --from-file', async () => {
    getSystemMock.mockReturnValue(profileBrowserSso());
    const headerFile = path.join(tmpDir, 'header.txt');
    fs.writeFileSync(headerFile, sampleHeader, 'utf-8');
    // The CLI reads the file before calling runCookieImport; emulate that here.
    const content = fs.readFileSync(headerFile, 'utf-8');
    const raw = content.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
    await runCookieImport('SSO', raw, { cookieFile: path.join(tmpDir, 'jar.json') }, 'human');
    expect(fs.existsSync(path.join(tmpDir, 'jar.json'))).toBe(true);
  });

  it('ignores blank lines when reading --from-file', async () => {
    getSystemMock.mockReturnValue(profileBrowserSso());
    const headerFile = path.join(tmpDir, 'header.txt');
    fs.writeFileSync(headerFile, '\n\n   \n' + sampleHeader + '\n\n', 'utf-8');
    const content = fs.readFileSync(headerFile, 'utf-8');
    const raw = content.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
    await runCookieImport('SSO', raw, { cookieFile: path.join(tmpDir, 'jar2.json') }, 'human');
    expect(fs.existsSync(path.join(tmpDir, 'jar2.json'))).toBe(true);
  });
});
