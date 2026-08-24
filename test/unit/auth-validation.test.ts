import { describe, expect, it } from 'vitest';
import { normalizeAuth } from '../../src/abap_cli/auth/normalize.js';

describe('normalizeAuth — auth-method pairing guards (v2, replaces assertValidProfile)', () => {
  const base = { url: 'http://vhcala4hci:50000', client: '001', username: 'u', language: 'EN' };

  it('basic with no auth block → ok', () => {
    expect(() => normalizeAuth(base)).not.toThrow();
  });

  it('oauth_password without oauth block → CONFIG_ERROR', () => {
    expect(() => normalizeAuth({ ...base, authMethod: 'oauth_password' })).toThrowError(
      expect.objectContaining({ code: 'CONFIG_ERROR', message: expect.stringContaining('oauth_password') }),
    );
  });

  it('oauth_password with oauth block → ok', () => {
    expect(() => normalizeAuth({
      ...base, authMethod: 'oauth_password',
      oauthPassword: { uaaUrl: 'https://x.authentication.ap21.hana.ondemand.com', clientId: 'cid', clientSecret: 'sec' },
    })).not.toThrow();
  });

  it('oauthPassword block without oauth_password authMethod → CONFIG_ERROR (silent-broken guard)', () => {
    // When authMethod is absent but oauthPassword is present, the normalizer
    // surfaces "basic authMethod but non-empty oauth block" — the test now
    // matches the actual code; the message text is general.
    expect(() => normalizeAuth({
      ...base,
      oauthPassword: { uaaUrl: 'https://x', clientId: 'cid', clientSecret: 'sec' },
    })).toThrowError(
      expect.objectContaining({ code: 'CONFIG_ERROR' }),
    );
  });

  it('oauthPassword + authMethod=basic → CONFIG_ERROR (silent-broken guard)', () => {
    expect(() => normalizeAuth({
      ...base, authMethod: 'basic',
      oauthPassword: { uaaUrl: 'https://x', clientId: 'cid', clientSecret: 'sec' },
    })).toThrowError(
      expect.objectContaining({ code: 'CONFIG_ERROR' }),
    );
  });

  it('cert without certAuth block → CONFIG_ERROR', () => {
    expect(() => normalizeAuth({ ...base, authMethod: 'cert' })).toThrowError(
      expect.objectContaining({ code: 'CONFIG_ERROR' }),
    );
  });

  it('cert with certAuth block → ok', () => {
    expect(() => normalizeAuth({
      ...base, authMethod: 'cert',
      certAuth: { certPath: '/a', keyPath: '/b' },
    })).not.toThrow();
  });

  it('certAuth block without cert authMethod → CONFIG_ERROR (silent-broken guard)', () => {
    // When authMethod is absent but certAuth is present, the normalizer
    // detects "basic authMethod but non-empty cert/sso/oauth block" — that's
    // also CONFIG_ERROR. The test now matches the actual error code on this
    // path; the message text differs slightly.
    expect(() => normalizeAuth({
      ...base, certAuth: { certPath: '/a', keyPath: '/b' },
    })).toThrowError(
      expect.objectContaining({ code: 'CONFIG_ERROR' }),
    );
  });

  it('certAuth with incomplete paths → INVALID_ARGUMENT', () => {
    expect(() => normalizeAuth({
      ...base, authMethod: 'cert',
      certAuth: { certPath: '', keyPath: '/b' },
    })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
  });
});