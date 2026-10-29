import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseCookieHeader,
  buildCookieHeader,
  writeCookieStore,
  readCookieStore,
  defaultCookieFile,
  SSO_COOKIE_TTL_MS,
} from '../../src/abap_cli/auth/sso-cookie.js';

describe('auth/sso-cookie', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sso-cookie-'));
  });

  describe('parseCookieHeader', () => {
    it('splits a real SAP cookie header', () => {
      const parsed = parseCookieHeader('MYSAPSSO2=abc%3D; SAP_SESSIONID_TRL_100=xyz; sap-XCSRF-T-123=token');
      expect(parsed).toEqual([
        { name: 'MYSAPSSO2', value: 'abc%3D' },
        { name: 'SAP_SESSIONID_TRL_100', value: 'xyz' },
        { name: 'sap-XCSRF-T-123', value: 'token' },
      ]);
    });

    it('strips CR/LF (HTTP header injection guard)', () => {
      const parsed = parseCookieHeader('foo=bar\r\nSet-Cookie: evil=injected');
      expect(parsed[0]).toEqual({ name: 'foo', value: 'barSet-Cookie: evil=injected' });
      // Sanity: the value can't contain a literal newline.
      expect(parsed[0].value.includes('\n')).toBe(false);
      expect(parsed[0].value.includes('\r')).toBe(false);
    });

    it('roundtrips through buildCookieHeader', () => {
      const header = 'A=1; B=2; C=3';
      expect(buildCookieHeader(parseCookieHeader(header))).toBe(header);
    });
  });

  describe('writeCookieStore / readCookieStore', () => {
    it('writes a file with 0o600 mode and reads it back', async () => {
      const file = path.join(tmp, 'jar.json');
      await writeCookieStore(file, [{ name: 'MYSAPSSO2', value: 'v' }]);
      const stat = fs.statSync(file);
      // Mode is masked with umask; on macOS umask 0o22 → 0o600 & ~0o22 = 0o600 (no change).
      // We just check it's owner-readable & not world-readable.
      expect((stat.mode & 0o077) === 0).toBe(true);
      const store = readCookieStore(file);
      expect(store?.cookies).toEqual([{ name: 'MYSAPSSO2', value: 'v' }]);
    });

    it('returns null when cookie file is missing', () => {
      expect(readCookieStore(path.join(tmp, 'no-such'))).toBeNull();
    });

    it('returns null when cookie file is expired (TTL)', () => {
      const file = path.join(tmp, 'jar.json');
      const fakeNow = Date.now();
      vi.useFakeTimers();
      vi.setSystemTime(fakeNow);
      // writeCookieStore uses real Date.now(); we use a hand-crafted store.
      fs.writeFileSync(
        file,
        JSON.stringify({
          format: 'abap-cli-sso-cookies',
          version: 1,
          capturedAt: fakeNow - SSO_COOKIE_TTL_MS - 1000,
          cookies: [{ name: 'x', value: 'y' }],
        }),
      );
      expect(readCookieStore(file)).toBeNull();
      vi.useRealTimers();
    });

    it('returns null when JSON is corrupt or schema is wrong', () => {
      const file = path.join(tmp, 'jar.json');
      fs.writeFileSync(file, '{ not json');
      expect(readCookieStore(file)).toBeNull();

      fs.writeFileSync(file, JSON.stringify({ format: 'wrong', cookies: [] }));
      expect(readCookieStore(file)).toBeNull();
    });
  });

  it('defaultCookieFile returns ~/.abap-cli/<profile>.sso.cookies.json', () => {
    expect(defaultCookieFile('trial')).toMatch(/\.abap-cli\/trial\.sso\.cookies\.json$/);
  });
});