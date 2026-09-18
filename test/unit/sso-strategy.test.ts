/**
 * Tests for the `sso` auth strategy and `sso-negotiate` SPNEGO helpers.
 *
 * Covers:
 *   - `parseAuthMethodV2` accepts 'sso' alongside existing methods
 *   - `normalizeAuth` round-trips `{ authMethod: 'sso', negotiate: { spn } }`
 *   - Strategy registration adds 'sso' to `registeredMethods()`
 *   - `deriveSpn` defaults to `HTTP/<host>` per RFC 4559
 *   - `buildSsoAuth` returns a BearerFetcher and SSL config
 *   - `acquireNegotiateToken` rejects on unsupported platforms with a hint
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { registeredMethods } from '../../src/abap_cli/auth/strategy.js';
import { parseAuthMethodV2 } from '../../src/abap_cli/auth/v2-types.js';
import { normalizeAuth, canonicalToV1Fields } from '../../src/abap_cli/auth/normalize.js';
import { deriveSpn, acquireNegotiateToken } from '../../src/abap_cli/auth/sso-negotiate.js';

const platformMock = vi.fn();
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, platform: () => platformMock() };
});

describe('auth/sso: parseAuthMethodV2', () => {
  it("accepts 'sso' as a valid method", () => {
    expect(parseAuthMethodV2('sso')).toBe('sso');
  });

  it('still rejects unknown methods', () => {
    expect(() => parseAuthMethodV2('totally-bogus')).toThrow(/Unknown authMethod/);
  });
});

describe('auth/sso: normalizeAuth round-trip', () => {
  it('v1 → v2 → v1 with negotiate.spn preserved', () => {
    const v1 = { authMethod: 'sso', negotiate: { spn: 'HTTP/sap.example.com', reauthOnExpiry: true } };
    const v2 = normalizeAuth(v1);
    expect(v2.method).toBe('sso');
    if (v2.method === 'sso') {
      expect(v2.negotiate.spn).toBe('HTTP/sap.example.com');
      expect(v2.negotiate.reauthOnExpiry).toBe(true);
    }
    expect(canonicalToV1Fields(v2)).toEqual(v1);
  });

  it('v2 canonical stays v2', () => {
    const v2 = normalizeAuth({ auth: { method: 'sso', negotiate: { spn: 'HTTP/x' } } });
    expect(v2).toEqual({ method: 'sso', negotiate: { spn: 'HTTP/x' } });
  });

  it("basic method with stray negotiate block → CONFIG_ERROR", () => {
    expect(() => normalizeAuth({ authMethod: 'basic', negotiate: { spn: 'HTTP/x' } }))
      .toThrow(/non-empty cert\/sso\/oauth\/negotiate block/);
  });
});

describe('auth/sso: strategy registration', () => {
  it("includes 'sso' once strategies are imported", async () => {
    // Force registry-bootstrap side-effects to run.
    await import('../../src/abap_cli/auth/registry-bootstrap.js');
    expect(registeredMethods()).toContain('sso');
  });
});

describe('auth/sso: deriveSpn', () => {
  it('defaults to HTTP/<host> per RFC 4559', () => {
    expect(deriveSpn('https://vhcala4hci:50000')).toBe('HTTP/vhcala4hci');
    expect(deriveSpn('http://sap.example.com')).toBe('HTTP/sap.example.com');
  });

  it('honours an explicit override', () => {
    expect(deriveSpn('https://vhcala4hci:50000', 'HTTP/alt')).toBe('HTTP/alt');
  });
});

describe('auth/sso: acquireNegotiateToken', () => {
  beforeEach(() => { platformMock.mockReset(); });

  it('rejects unsupported platforms with an AUTH_ERROR hint', async () => {
    platformMock.mockReturnValue('aix');
    await expect(acquireNegotiateToken('HTTP/test')).rejects.toMatchObject({
      code: 'AUTH_ERROR',
      message: expect.stringContaining('not supported on platform'),
    });
  });
});

describe('auth/sso: buildSsoAuth', () => {
  it('returns a BearerFetcher and SSL config', async () => {
    platformMock.mockReturnValue('aix'); // unsupported at acquire time but build itself is sync
    const { buildSsoAuth } = await import('../../src/abap_cli/auth/sso-negotiate.js');
    const parts = buildSsoAuth(
      {
        url: 'https://vhcala4hci:50000',
        client: '001',
        username: 'me',
        password: 'unused',
        language: 'EN',
        insecure: true,
        caPath: '',
        sourceDir: process.cwd(),
        auth: { method: 'sso', negotiate: {} },
      },
      'test',
    );
    expect(typeof parts.passwordOrFetcher).toBe('function');
    expect(parts.options.httpsAgent).toBeDefined();
  });

  it("strategy's build() strips the placeholder Authorization header", async () => {
    platformMock.mockReturnValue('aix');
    const { getStrategy } = await import('../../src/abap_cli/auth/strategy.js');
    await import('../../src/abap_cli/auth/registry-bootstrap.js');
    const strategy = getStrategy('sso');
    const parts = await strategy.build(
      {
        url: 'https://vhcala4hci:50000',
        client: '001',
        username: 'me',
        password: 'unused',
        language: 'EN',
        insecure: true,
        caPath: '',
        sourceDir: process.cwd(),
        auth: { method: 'sso', negotiate: {} },
      },
      'test',
      { method: 'sso', negotiate: {} },
    );
    // The placeholder Authorization header is stripped at strategy build time
    // (the real header is set per-request by the fetcher).
    expect(parts.options.headers?.Authorization).toBeUndefined();
  });
});
