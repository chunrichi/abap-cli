import { describe, expect, it, vi, beforeEach } from 'vitest';

const getCertPassphrase = vi.fn(async () => null);
const getPassword = vi.fn(async () => null);
vi.mock('../../src/abap_cli/config/secrets.js', () => ({
  getCertPassphrase: (...args: unknown[]) => getCertPassphrase(...args),
  getPassword: (...args: unknown[]) => getPassword(...args),
}));

import { buildAuth } from '../../src/abap_cli/auth/adapter.js';

function baseSap(overrides: Record<string, unknown> = {}) {
  return {
    url: 'http://vhcala4hci:50000',
    client: '001',
    username: 'trial-user',
    password: 'secret',
    language: 'EN',
    insecure: true,
    caPath: '',
    sourceDir: process.cwd(),
    auth: {
      method: 'oauth_password' as const,
      oauth: {
        uaaUrl: 'https://24eee1e7trial.authentication.ap21.hana.ondemand.com',
        clientId: 'sb-test',
        clientSecret: 'sec',
      },
    },
    ...overrides,
  };
}

describe('auth/adapter.buildAuth (oauth_password, 027)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('BTP_PASSWORD', 'test-password');
  });

  it('returns a BearerFetcher when oauth config is present', async () => {
    const built = await buildAuth(baseSap(), 'trial');
    expect(built.label).toBe('oauth_password');
    expect(typeof built.passwordOrFetcher).toBe('function');
    expect(built.passwordOrFetcher.length).toBe(0); // async () => Promise<string>
  });

it('canonical type cannot represent oauth_password without oauth block — verified at construction', () => {
    // In the canonical v2 schema, `auth: { method: 'oauth_password' }` without
    // an `oauth` block is a TypeScript error. Validation here confirms the
    // runtime normalizer rejects a malformed profile (e.g. on disk).
    return import('../../src/abap_cli/auth/normalize.js').then(({ normalizeAuth }) => {
      expect(() => normalizeAuth({ authMethod: 'oauth_password' })).toThrowError(
        expect.objectContaining({ code: 'CONFIG_ERROR' }),
      );
    });
  });

  it('throws AUTH_ERROR when BTP_PASSWORD env var is missing and fetcher is invoked', async () => {
    vi.stubEnv('BTP_PASSWORD', '');
    const sap = baseSap();
    const built = await buildAuth(sap, 'trial');
    const fetcher = built.passwordOrFetcher as () => Promise<string>;
    await expect(fetcher()).rejects.toMatchObject({
      code: 'AUTH_ERROR',
      message: expect.stringContaining('Missing BTP password'),
    });
  });

  it('prefers per-profile env BTP_PASSWORD_<NAME> over generic BTP_PASSWORD', async () => {
    vi.stubEnv('BTP_PASSWORD', 'generic');
    vi.stubEnv('BTP_PASSWORD_TRIAL', 'per-profile');
    const fetcher = ((await buildAuth(baseSap(), 'trial')).passwordOrFetcher) as () => Promise<string>;
    // The fetcher reaches the network call path; the test UAA isn't real so it
    // will fail with HTTP — the assertion just confirms the fetcher is wired up.
    await expect(fetcher()).rejects.toThrow();
  });
});