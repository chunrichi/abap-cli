/**
 * config/paths.ts + project-config cwd injection + per-cwd cache isolation.
 *
 * This test file exercises:
 *   1. `paths.ts` path constants honour the injected `home`.
 *   2. `findWorkspaceConfig({ cwd })` walks up from the supplied cwd.
 *   3. `loadConfig({ cwd })` resolves the workspace config from the
 *      supplied directory instead of `process.cwd()`.
 *   4. Per-cwd cache: changing the config file in one workspace does not
 *      invalidate the cache for another workspace.
 *   5. `existingWorkspaceConfigPath` returns the existing file or the cwd
 *      candidate — the "write prefers existing" rule.
 */
import { describe, expect, it, beforeAll, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  userConfigDir,
  userConfigPath,
  USER_CONFIG_DIR_NAME,
  USER_CONFIG_FILE_NAME,
} from '../../src/abap_cli/config/paths.js';
import type {
  findWorkspaceConfig as FindWorkspaceConfig,
  loadConfig as LoadConfig,
  existingWorkspaceConfigPath as ExistingWorkspaceConfigPath,
  writeProjectConfig as WriteProjectConfig,
  resetConfig as ResetConfig,
} from '../../src/abap_cli/config/project-config.js';

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

describe('config/paths.ts — home injection', () => {
  it('userConfigDir honors injected home', () => {
    expect(userConfigDir('/tmp/fake-home')).toBe(path.join('/tmp/fake-home', USER_CONFIG_DIR_NAME));
  });

  it('userConfigPath joins dir + file name correctly', () => {
    expect(userConfigPath('/tmp/fake-home')).toBe(
      path.join('/tmp/fake-home', USER_CONFIG_DIR_NAME, USER_CONFIG_FILE_NAME),
    );
  });

  it('defaults to os.homedir() when home is not passed', () => {
    const realHome = os.homedir();
    expect(userConfigDir()).toBe(path.join(realHome, USER_CONFIG_DIR_NAME));
    expect(userConfigPath()).toBe(path.join(realHome, USER_CONFIG_DIR_NAME, USER_CONFIG_FILE_NAME));
  });
});

describe('findWorkspaceConfig — unchanged semantics', () => {
  let findWorkspaceConfig: typeof FindWorkspaceConfig;

  beforeAll(async () => {
    const mod = await import('../../src/abap_cli/config/project-config.js');
    findWorkspaceConfig = mod.findWorkspaceConfig;
  });

  it('finds the nearest .abap.json in a nested tree', () => {
    const root = tmp('paths-find');
    const child = path.join(root, 'pkg', 'sub');
    fs.mkdirSync(child, { recursive: true });
    const rootConfig = path.join(root, '.abap.json');
    fs.writeFileSync(rootConfig, JSON.stringify({ system: 'root' }));
    expect(findWorkspaceConfig(child)).toBe(rootConfig);
  });

  it('child .abap.json wins over an ancestor', () => {
    const root = tmp('paths-find2');
    const child = path.join(root, 'pkg', 'sub');
    fs.mkdirSync(child, { recursive: true });
    fs.writeFileSync(path.join(root, '.abap.json'), JSON.stringify({ system: 'root' }));
    const childConfig = path.join(child, '.abap.json');
    fs.writeFileSync(childConfig, JSON.stringify({ system: 'child' }));
    expect(findWorkspaceConfig(child)).toBe(childConfig);
  });

  it('stops at .git boundary', () => {
    const outer = tmp('paths-find3');
    const repo = path.join(outer, 'repo');
    const child = path.join(repo, 'pkg');
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(child, { recursive: true });
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.writeFileSync(path.join(outer, '.abap.json'), JSON.stringify({ system: 'outer' }));
    expect(findWorkspaceConfig(child)).toBeNull();
  });
});

describe('existingWorkspaceConfigPath — write prefers existing', () => {
  let existingWorkspaceConfigPath: typeof ExistingWorkspaceConfigPath;

  beforeAll(async () => {
    const mod = await import('../../src/abap_cli/config/project-config.js');
    existingWorkspaceConfigPath = mod.existingWorkspaceConfigPath;
  });

  it('returns the existing .abap.json path when present', () => {
    const dir = tmp('paths-existing');
    const existing = path.join(dir, '.abap.json');
    fs.writeFileSync(existing, '{}');
    expect(existingWorkspaceConfigPath(dir)).toBe(existing);
  });

  it('falls back to <cwd>/.abap.json when no existing config', () => {
    const dir = tmp('paths-fresh');
    const expected = path.join(dir, '.abap.json');
    expect(existingWorkspaceConfigPath(dir)).toBe(expected);
  });
});

// Mock getSystem + getPassword at module level so the import of
// project-config below sees the stubs from the start.
vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: (name: string) => {
    const profiles: Record<string, unknown> = {
      INJECTED: {
        url: 'https://a.example.com',
        client: '100',
        username: 'INJECTED_USER',
        language: 'EN',
        insecure: false,
        ca: '',
        auth: { method: 'basic' },
        systemType: 'on-prem',
        sessionPolicy: 'default',
      },
      STRING: {
        url: 'https://b.example.com',
        client: '100',
        username: 'STRING_USER',
        language: 'EN',
        insecure: false,
        ca: '',
        auth: { method: 'basic' },
        systemType: 'on-prem',
        sessionPolicy: 'default',
      },
      PROFILE_A: {
        url: 'https://a.example.com',
        client: '100',
        username: 'USER_A',
        language: 'EN',
        insecure: false,
        ca: '',
        auth: { method: 'basic' },
        systemType: 'on-prem',
        sessionPolicy: 'default',
      },
      PROFILE_B: {
        url: 'https://b.example.com',
        client: '100',
        username: 'USER_B',
        language: 'EN',
        insecure: false,
        ca: '',
        auth: { method: 'basic' },
        systemType: 'on-prem',
        sessionPolicy: 'default',
      },
    };
    return profiles[name] ?? null;
  },
}));

vi.mock('../../src/abap_cli/config/secrets.js', () => ({
  getPassword: async () => 'FAKE_PASSWORD',
}));

describe('loadConfig({ cwd }) — cwd injection', () => {
  let loadConfig: typeof LoadConfig;
  let writeProjectConfig: typeof WriteProjectConfig;
  let resetConfig: typeof ResetConfig;

  beforeAll(async () => {
    const mod = await import('../../src/abap_cli/config/project-config.js');
    loadConfig = mod.loadConfig;
    writeProjectConfig = mod.writeProjectConfig;
    resetConfig = mod.resetConfig;
  });

  it('uses cwd injection to start the upward .abap.json walk', async () => {
    const dir = tmp('paths-cwd-walk');
    fs.writeFileSync(path.join(dir, '.abap.json'), JSON.stringify({ system: 'INJECTED' }));
    // Empty process cwd — but the supplied `dir` must win.
    const cfg = await loadConfig({ cwd: dir });
    expect(cfg.systemName).toBe('INJECTED');
  });

  it('accepts a plain string cwd argument', async () => {
    const dir = tmp('paths-cwd-string');
    fs.writeFileSync(path.join(dir, '.abap.json'), JSON.stringify({ system: 'STRING' }));
    const cfg = await loadConfig(dir);
    expect(cfg.systemName).toBe('STRING');
  });

  it('per-cwd cache: two cwds produce two independent cache entries', async () => {
    resetConfig();
    const dirA = tmp('paths-cache-A');
    const dirB = tmp('paths-cache-B');
    fs.writeFileSync(path.join(dirA, '.abap.json'), JSON.stringify({ system: 'PROFILE_A', sourceDir: '/old/A' }));
    fs.writeFileSync(path.join(dirB, '.abap.json'), JSON.stringify({ system: 'PROFILE_B', sourceDir: '/old/B' }));

    const cfgA1 = await loadConfig({ cwd: dirA });
    const cfgB1 = await loadConfig({ cwd: dirB });
    expect(cfgA1.sap.sourceDir).toBe('/old/A');
    expect(cfgB1.sap.sourceDir).toBe('/old/B');

    // Mutate A's file. The mtime bump should invalidate A's cache entry on
    // next read but leave B's untouched.
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    await sleep(20);
    fs.writeFileSync(path.join(dirA, '.abap.json'), JSON.stringify({ system: 'PROFILE_A', sourceDir: '/new/A' }));

    const cfgA2 = await loadConfig({ cwd: dirA });
    expect(cfgA2.sap.sourceDir).toBe('/new/A');
    // B's cache is independent — its sourceDir is still the old value
    // because we never told the test to invalidate B's cache.
    const cfgB2 = await loadConfig({ cwd: dirB });
    expect(cfgB2.sap.sourceDir).toBe('/old/B');
  });

  it('writeProjectConfig({ cwd }) targets existingWorkspaceConfigPath', async () => {
    const dir = tmp('paths-write');
    fs.writeFileSync(path.join(dir, '.abap.json'), JSON.stringify({ sourceDir: '/old' }));
    await writeProjectConfig({ sourceDir: '/new' }, { cwd: dir });
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, '.abap.json'), 'utf-8'));
    expect(onDisk.sourceDir).toBe('/new');
  });
});