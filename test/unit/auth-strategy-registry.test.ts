import { describe, expect, it } from 'vitest';
import {
  authOptionsFromCli,
  getAuthHints,
  getStrategy,
  legacyFlagsToBag,
  resolveAuthFromOptions,
} from '../../src/abap_cli/auth/strategy.js';
// Side-effect import — registers all built-in strategies (basic/cert/browser_sso/oauth_password).
import '../../src/abap_cli/auth/registry-bootstrap.js';

describe('auth strategy registry', () => {
  it('getStrategy resolves every built-in method after bootstrap', () => {
    expect(getStrategy('basic').method).toBe('basic');
    expect(getStrategy('cert').method).toBe('cert');
    expect(getStrategy('browser_sso').method).toBe('browser_sso');
    expect(getStrategy('oauth_password').method).toBe('oauth_password');
  });

  it('getStrategy throws CONFIG_ERROR for an unregistered method', () => {
    expect(() => getStrategy('nope' as never)).toThrowError(
      expect.objectContaining({ code: 'CONFIG_ERROR' }),
    );
  });

  it('getAuthHints falls back to generic basic guidance for unknown methods', () => {
    const hints = getAuthHints('unknown-method');
    expect(hints.example).toContain('abap profile set');
  });

  it('getAuthHints returns cert-specific guidance for cert method', () => {
    const hints = getAuthHints('cert');
    expect(hints.nextSteps.join(' ')).toContain('cert-passphrase');
  });
});

describe('authOptionsFromCli', () => {
  it('parses repeatable key=value pairs into a bag', () => {
    expect(authOptionsFromCli({ authOption: ['a=1', 'b=two'] }, 'cert').bag).toEqual({ a: '1', b: 'two' });
  });

  it('returns an empty bag when no --auth-option given', () => {
    expect(authOptionsFromCli({}, 'cert').bag).toEqual({});
    expect(authOptionsFromCli({ authOption: [] }, 'cert').bag).toEqual({});
  });

  it('throws INVALID_ARGUMENT when an entry lacks "="', () => {
    expect(() => authOptionsFromCli({ authOption: ['noequals'] }, 'cert')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
  });

  it('skips keys that trim to empty', () => {
    expect(authOptionsFromCli({ authOption: ['  =val', 'ok=1'] }, 'cert').bag).toEqual({ ok: '1' });
  });

  it('throws when the key part is empty before any value (no leading key)', () => {
    expect(() => authOptionsFromCli({ authOption: ['=val'] }, 'cert')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
  });

  it('later entries override earlier ones on key collision', () => {
    expect(authOptionsFromCli({ authOption: ['k=first', 'k=second'] }, 'cert').bag).toEqual({ k: 'second' });
  });
});

describe('legacyFlagsToBag', () => {
  it('maps legacy flags to the stable bag key names', () => {
    expect(legacyFlagsToBag({
      certPath: '/a.pem',
      certKey: '/a.key',
      certCa: '/ca.pem',
      ssoCookieFile: '/cookies.txt',
      serviceKey: '/sk.json',
    })).toEqual({
      certPath: '/a.pem',
      keyPath: '/a.key',
      caPath: '/ca.pem',
      cookieFile: '/cookies.txt',
      serviceKey: '/sk.json',
    });
  });

  it('ignores non-string and absent values', () => {
    expect(legacyFlagsToBag({ certKey: 42, certCa: true, certPath: '/a.pem' })).toEqual({ certPath: '/a.pem' });
  });
});

describe('resolveAuthFromOptions', () => {
  it('delegates to the cert strategy (bag → cert block)', () => {
    const result = resolveAuthFromOptions(
      { method: 'cert', bag: { certPath: '/a.pem', keyPath: '/a.key' } },
      { method: 'basic' },
    );
    expect(result).toEqual({ method: 'cert', cert: { certPath: '/a.pem', keyPath: '/a.key' } });
  });

  it('cert strategy requires both certPath and keyPath', () => {
    expect(() => resolveAuthFromOptions(
      { method: 'cert', bag: { certPath: '/a.pem' } },
      { method: 'basic' },
    )).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('strategies without fromOptions produce a bare method block (basic)', () => {
    expect(resolveAuthFromOptions({ method: 'basic', bag: {} }, { method: 'oauth_password' } as never))
      .toEqual({ method: 'basic' });
  });
});
