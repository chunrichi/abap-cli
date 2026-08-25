import { describe, expect, it } from 'vitest';
import { validateInputs, type CollectedConfig } from '../../src/abap_cli/flows/init-flow.js';

describe('init-flow.validateInputs — auth method skip-password rules', () => {
  const baseProfile = {
    url: 'https://vhcala4hci.example.com',
    client: '100',
    username: 'me',
    language: 'EN',
  };

  it('basic auth requires password', () => {
    const c = { ...baseProfile, password: '', transport: '', pkg: '', auth: { method: 'basic' as const } };
    expect(() => validateInputs(c as unknown as CollectedConfig)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT', message: expect.stringContaining('basic') }),
    );
  });

  it('browser_sso skips password requirement', () => {
    const c = { ...baseProfile, password: '', transport: '', pkg: '', auth: { method: 'browser_sso' as const, sso: {} } };
    expect(() => validateInputs(c as unknown as CollectedConfig)).not.toThrow();
  });

  it('cert skips password requirement', () => {
    const c = {
      ...baseProfile, password: '', transport: '', pkg: '',
      auth: { method: 'cert' as const, cert: { certPath: '/a', keyPath: '/b' } },
    };
    expect(() => validateInputs(c as unknown as CollectedConfig)).not.toThrow();
  });

  it('oauth_password skips basic-password requirement', () => {
    const c = {
      ...baseProfile, password: '', transport: '', pkg: '',
      auth: { method: 'oauth_password' as const, oauth: { uaaUrl: 'https://x', clientId: 'c', clientSecret: 's' } },
    };
    expect(() => validateInputs(c as unknown as CollectedConfig)).not.toThrow();
  });
});