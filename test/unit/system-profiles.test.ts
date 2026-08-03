import { describe, expect, it, vi, beforeEach } from 'vitest';
import { exportProfiles, importProfiles } from '../../src/abap_cli/sync/profiles.js';

const { upsertSystemMock, storePasswordMock } = vi.hoisted(() => ({
  upsertSystemMock: vi.fn(),
  storePasswordMock: vi.fn(async () => undefined),
}));

vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: (name: string) =>
    name === 'mock'
      ? { url: 'http://localhost:8080', client: '100', username: 'MOCKUSER', language: 'EN', insecure: false }
      : null,
  listSystemNames: () => ['mock'],
  upsertSystem: upsertSystemMock,
}));

vi.mock('../../src/abap_cli/crypto/secrets.js', () => ({
  getPassword: vi.fn(async () => undefined),
  storePassword: storePasswordMock,
  deletePassword: vi.fn(),
}));

describe('system export/import (US8, FR-026)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('export excludes passwords by default', async () => {
    const bundle = await exportProfiles();
    expect(bundle.format).toBe('abap-cli-profiles');
    expect(bundle.systems).toHaveLength(1);
    expect(bundle.systems[0].name).toBe('mock');
    expect(bundle.systems[0].password).toBeUndefined();
  });

  it('import restores profiles and routes passwords to the keychain', async () => {
    const bundle = {
      format: 'abap-cli-profiles',
      version: 1,
      exportedAt: '2026-08-04T00:00:00Z',
      systems: [{ name: 'mock', url: 'http://localhost:8080', client: '100', username: 'MOCKUSER', language: 'EN', password: 'secret' }],
    };
    const result = await importProfiles(bundle);
    expect(result.imported[0].action).toBe('updated'); // mock profile already exists
    expect(storePasswordMock).toHaveBeenCalledWith('mock', 'secret');
  });
});
