import { describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';

const upsertSystem = vi.fn();

vi.mock('../../src/abap_cli/config/secrets.js', () => ({
  storePassword: () => Promise.resolve(),
}));

vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: () => null,
  upsertSystem: (...args: unknown[]) => upsertSystem(...args),
  listSystemNames: () => [],
  deleteSystem: () => false,
}));

vi.mock('../../src/abap_cli/textpool/textpool-capability.js', () => ({
  probeTextpoolCapability: () => Promise.reject(new Error('not used')),
  recordCapability: () => Promise.resolve(),
}));

import { runAdd } from '../../src/abap_cli/flows/profile-flow.js';

describe('abap profile add — browser_sso', () => {
  it('creates a profile with v2 canonical browser_sso block and custom cookie file', async () => {
    await runAdd('trial', {
      url: 'https://sap.example.com',
      username: 'me',
      authMethod: 'browser_sso',
      ssoCookieFile: '/tmp/trial-cookies.json',
    }, 'json');

    expect(upsertSystem).toHaveBeenCalledWith('trial', expect.objectContaining({
      url: 'https://sap.example.com',
      username: 'me',
      auth: { method: 'browser_sso', sso: { cookieFile: '/tmp/trial-cookies.json' } },
    }));
  });

  it('creates a profile with default cookie file when none supplied', async () => {
    await runAdd('trial', {
      url: 'https://sap.example.com',
      username: 'me',
      authMethod: 'browser_sso',
    }, 'json');

    expect(upsertSystem).toHaveBeenCalledWith('trial', expect.objectContaining({
      auth: { method: 'browser_sso', sso: {} },
    }));
  });
});