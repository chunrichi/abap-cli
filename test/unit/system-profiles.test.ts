import { describe, expect, it, vi, beforeEach } from 'vitest';
import { exportProfiles, importProfiles } from '../../src/abap_cli/config/profiles.js';

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

vi.mock('../../src/abap_cli/config/secrets.js', () => ({
  getPassword: vi.fn(async () => undefined),
  storePassword: storePasswordMock,
  deletePassword: vi.fn(),
}));

describe('connection export/import ()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('export excludes passwords by default', async () => {
    const bundle = await exportProfiles();
    expect(bundle.format).toBe('abap-cli-profiles');
    expect(bundle.systems).toHaveLength(1);
    expect(bundle.systems[0].name).toBe('mock');
    expect(bundle.systems[0].password).toBeUndefined();
  });

  it('import skips existing profiles by default', async () => {
    const bundle = {
      format: 'abap-cli-profiles',
      version: 1,
      exportedAt: '2026-08-04T00:00:00Z',
      systems: [{ name: 'mock', url: 'http://localhost:8080', client: '100', username: 'MOCKUSER', language: 'EN', password: 'secret' }],
    };
    const result = await importProfiles(bundle);
    expect(result.imported[0].action).toBe('skipped'); // mock profile already exists
    expect(upsertSystemMock).not.toHaveBeenCalled();
    expect(storePasswordMock).not.toHaveBeenCalled();
  });

  it('import --overwrite updates existing profiles and routes passwords to the keychain', async () => {
    const bundle = {
      format: 'abap-cli-profiles',
      version: 1,
      exportedAt: '2026-08-04T00:00:00Z',
      systems: [{ name: 'mock', url: 'http://localhost:8080', client: '100', username: 'MOCKUSER', language: 'EN', password: 'secret' }],
    };
    const result = await importProfiles(bundle, { overwrite: true });
    expect(result.imported[0].action).toBe('updated');
    expect(upsertSystemMock).toHaveBeenCalledWith('mock', expect.objectContaining({ username: 'MOCKUSER' }));
    expect(storePasswordMock).toHaveBeenCalledWith('mock', 'secret');
  });
});
