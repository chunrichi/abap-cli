import { describe, expect, it } from 'vitest';
import { normalizeAuth, canonicalToV1Fields, defaultAuth } from '../../src/abap_cli/auth/normalize.js';

describe('auth/normalize', () => {
  describe('v1 → canonical', () => {
    it('empty profile → basic', () => {
      expect(normalizeAuth({})).toEqual({ method: 'basic' });
    });

    it('authMethod=basic with no blocks → basic', () => {
      expect(normalizeAuth({ authMethod: 'basic' })).toEqual({ method: 'basic' });
    });

    it('authMethod=cert + certAuth → canonical cert', () => {
      expect(normalizeAuth({
        authMethod: 'cert',
        certAuth: { certPath: '/a', keyPath: '/b', caPath: '/ca' },
      })).toEqual({ method: 'cert', cert: { certPath: '/a', keyPath: '/b', caPath: '/ca' } });
    });

    it('authMethod=browser_sso + ssoCookieFile → canonical sso with cookieFile', () => {
      expect(normalizeAuth({ authMethod: 'browser_sso', ssoCookieFile: '/jar.json' })).toEqual({
        method: 'browser_sso',
        sso: { cookieFile: '/jar.json' },
      });
    });

    it('authMethod=browser_sso without ssoCookieFile → canonical sso with empty block', () => {
      expect(normalizeAuth({ authMethod: 'browser_sso' })).toEqual({
        method: 'browser_sso',
        sso: {},
      });
    });

    it('authMethod=oauth_password + oauthPassword → canonical oauth', () => {
      expect(normalizeAuth({
        authMethod: 'oauth_password',
        oauthPassword: {
          uaaUrl: 'https://x.authentication.ap21.hana.ondemand.com',
          clientId: 'cid',
          clientSecret: 'sec',
          serviceKeyFile: '/k.json',
        },
      })).toEqual({
        method: 'oauth_password',
        oauth: {
          uaaUrl: 'https://x.authentication.ap21.hana.ondemand.com',
          clientId: 'cid',
          clientSecret: 'sec',
          serviceKeyFile: '/k.json',
        },
      });
    });

    it('cert without certAuth → CONFIG_ERROR', () => {
      expect(() => normalizeAuth({ authMethod: 'cert' })).toThrowError(
        expect.objectContaining({ code: 'CONFIG_ERROR' }),
      );
    });

    it('cert with empty certPath → INVALID_ARGUMENT', () => {
      expect(() => normalizeAuth({ authMethod: 'cert', certAuth: { certPath: '', keyPath: '/b' } })).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
      );
    });

    it('oauth_password without oauthPassword → CONFIG_ERROR', () => {
      expect(() => normalizeAuth({ authMethod: 'oauth_password' })).toThrowError(
        expect.objectContaining({ code: 'CONFIG_ERROR' }),
      );
    });

    it('basic with leftover cert block → CONFIG_ERROR', () => {
      expect(() => normalizeAuth({ authMethod: 'basic', certAuth: { certPath: '/a', keyPath: '/b' } })).toThrowError(
        expect.objectContaining({ code: 'CONFIG_ERROR' }),
      );
    });

    it('basic with leftover oauth block → CONFIG_ERROR', () => {
      expect(() => normalizeAuth({ authMethod: 'basic', oauthPassword: { uaaUrl: 'x', clientId: 'c', clientSecret: 's' } })).toThrowError(
        expect.objectContaining({ code: 'CONFIG_ERROR' }),
      );
    });

    it('unknown authMethod → INVALID_ARGUMENT', () => {
      expect(() => normalizeAuth({ authMethod: 'kerberos' })).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
      );
    });
  });

  describe('v2 → canonical', () => {
    it('auth: { method: basic } → basic', () => {
      expect(normalizeAuth({ auth: { method: 'basic' } })).toEqual({ method: 'basic' });
    });

    it('auth: { method: cert, cert: {...} } → canonical', () => {
      expect(normalizeAuth({ auth: { method: 'cert', cert: { certPath: '/a', keyPath: '/b' } } })).toEqual({
        method: 'cert',
        cert: { certPath: '/a', keyPath: '/b' },
      });
    });

    it('auth.cert with missing certPath → INVALID_ARGUMENT', () => {
      expect(() => normalizeAuth({ auth: { method: 'cert', cert: { certPath: '', keyPath: '/b' } } })).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
      );
    });

    it('auth.oauth with missing uaaUrl → INVALID_ARGUMENT', () => {
      expect(() => normalizeAuth({ auth: { method: 'oauth_password', oauth: { uaaUrl: '', clientId: 'c', clientSecret: 's' } } })).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
      );
    });

    it('auth.browser_sso without cookieFile → canonical sso with empty block', () => {
      expect(normalizeAuth({ auth: { method: 'browser_sso', sso: {} } })).toEqual({
        method: 'browser_sso',
        sso: {},
      });
    });
  });

  describe('v1 + v2 disagreement', () => {
    it('throws CONFIG_ERROR when methods disagree', () => {
      expect(() => normalizeAuth({
        authMethod: 'basic',
        auth: { method: 'cert', cert: { certPath: '/a', keyPath: '/b' } },
      })).toThrowError(
        expect.objectContaining({ code: 'CONFIG_ERROR', message: expect.stringContaining('disagree') }),
      );
    });

    it('v2 wins when v1 method is absent', () => {
      expect(normalizeAuth({
        auth: { method: 'cert', cert: { certPath: '/a', keyPath: '/b' } },
      })).toEqual({ method: 'cert', cert: { certPath: '/a', keyPath: '/b' } });
    });
  });

  describe('canonicalToV1Fields', () => {
    it('basic → { authMethod: basic }', () => {
      expect(canonicalToV1Fields({ method: 'basic' })).toEqual({ authMethod: 'basic' });
    });

    it('cert → { authMethod: cert, certAuth }', () => {
      expect(canonicalToV1Fields({ method: 'cert', cert: { certPath: '/a', keyPath: '/b' } })).toEqual({
        authMethod: 'cert',
        certAuth: { certPath: '/a', keyPath: '/b' },
      });
    });

    it('browser_sso with cookieFile → { authMethod: browser_sso, ssoCookieFile }', () => {
      expect(canonicalToV1Fields({ method: 'browser_sso', sso: { cookieFile: '/jar' } })).toEqual({
        authMethod: 'browser_sso',
        ssoCookieFile: '/jar',
      });
    });

    it('browser_sso without cookieFile → { authMethod: browser_sso } only', () => {
      expect(canonicalToV1Fields({ method: 'browser_sso', sso: {} })).toEqual({
        authMethod: 'browser_sso',
      });
    });

    it('oauth_password → { authMethod: oauth_password, oauthPassword }', () => {
      expect(canonicalToV1Fields({
        method: 'oauth_password',
        oauth: { uaaUrl: 'u', clientId: 'c', clientSecret: 's' },
      })).toEqual({
        authMethod: 'oauth_password',
        oauthPassword: { uaaUrl: 'u', clientId: 'c', clientSecret: 's' },
      });
    });
  });

  describe('defaultAuth', () => {
    it('returns basic', () => {
      expect(defaultAuth()).toEqual({ method: 'basic' });
    });
  });
});
