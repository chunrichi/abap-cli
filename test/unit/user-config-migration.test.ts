/**
 * Stored-profile migration for the removed auth methods.
 *
 * The CLI only supports basic auth now. Older `systems.json` entries that
 * still declare `cert` / `browser_sso` / `oauth_password` / `sso` are read as
 * basic profiles with an in-memory `unsupportedAuth` marker (used for the
 * migration error), and the next write drops the legacy fields.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { assertSupportedAuth } from '../../src/abap_cli/config/validation.js';

const home = vi.hoisted(() => ({ dir: '' }));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => home.dir };
});

function systemsPath(): string {
  return path.join(home.dir, '.abap-cli', 'systems.json');
}

function writeSystems(systems: Record<string, unknown>): void {
  fs.mkdirSync(path.join(home.dir, '.abap-cli'), { recursive: true });
  fs.writeFileSync(systemsPath(), JSON.stringify({ systems }, null, 2), 'utf-8');
}

async function loadUserConfigModule() {
  vi.resetModules();
  return import('../../src/abap_cli/config/user-config.js');
}

beforeEach(() => {
  home.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'user-cfg-legacy-'));
});

afterEach(() => {
  fs.rmSync(home.dir, { recursive: true, force: true });
});

describe('user-config: removed auth methods on stored profiles', () => {
  it('marks v2 and flat v1 auth declarations as unsupported', async () => {
    writeSystems({
      basicV2: { url: 'https://a.example', username: 'u', auth: { method: 'basic' } },
      certV2: { url: 'https://b.example', username: 'u', auth: { method: 'cert', cert: { certPath: '/c', keyPath: '/k' } } },
      oauthV1: { url: 'https://c.example', username: 'u', authMethod: 'oauth_password', oauthPassword: { uaaUrl: 'x', clientId: 'y', clientSecret: 'z' } },
      ssoV1: { url: 'https://d.example', username: 'u', ssoCookieFile: '/tmp/jar.json' },
      plain: { url: 'https://e.example', username: 'u' },
    });

    const { loadUserConfig } = await loadUserConfigModule();
    const systems = loadUserConfig().systems;

    expect(systems.basicV2!.unsupportedAuth).toBeUndefined();
    expect(systems.plain!.unsupportedAuth).toBeUndefined();
    expect(systems.certV2!.unsupportedAuth).toBe('cert');
    expect(systems.oauthV1!.unsupportedAuth).toBe('oauth_password');
    expect(systems.ssoV1!.unsupportedAuth).toBe('browser_sso');
  });

  it('drops the legacy auth fields and the in-memory marker on the next save', async () => {
    writeSystems({
      certV2: { url: 'https://b.example', username: 'u', auth: { method: 'cert', cert: { certPath: '/c', keyPath: '/k' } } },
      plain: { url: 'https://e.example', username: 'u' },
    });

    const { loadUserConfig, saveUserConfig } = await loadUserConfigModule();
    const config = loadUserConfig();
    expect(config.systems.certV2!.unsupportedAuth).toBe('cert');
    saveUserConfig(config);

    const onDisk = JSON.parse(fs.readFileSync(systemsPath(), 'utf-8'));
    expect(onDisk.systems.certV2).toEqual({
      url: 'https://b.example',
      client: '100',
      username: 'u',
      language: 'EN',
    });
    expect(onDisk.systems.certV2).not.toHaveProperty('auth');
    expect(onDisk.systems.certV2).not.toHaveProperty('unsupportedAuth');

    // A reload no longer knows the entry used to be cert-auth: it is basic,
    // and the missing password surfaces through the normal auth failure path.
    const reloaded = await loadUserConfigModule();
    expect(reloaded.loadUserConfig().systems.certV2!.unsupportedAuth).toBeUndefined();
  });

  it('assertSupportedAuth explains the migration and passes for basic profiles', () => {
    expect(() => assertSupportedAuth('old', { unsupportedAuth: 'cert' }))
      .toThrowError(/removed 'cert' auth method/);
    expect(() => assertSupportedAuth('dev', {})).not.toThrow();
  });
});
