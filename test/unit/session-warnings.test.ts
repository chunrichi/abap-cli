/**
 * Degraded session setups must be visible in `--json` (`meta.warnings`), not
 * only as a once-per-process stderr line. The manager dedupes the environment
 * facts per process so an agent doing 100 commands does not get 100 warnings.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionLifecycle, _resetSessionWarnings } from '../../src/abap_cli/session/manager.js';
import { getWarnings, resetWarnings, type Warning } from '../../src/abap_cli/output/meta.js';
import { deriveSessionKey, resetKeychainCache } from '../../src/abap_cli/session/key.js';
import { writeSessionJar } from '../../src/abap_cli/session/store.js';
import { makeEmptyJar } from '../../src/abap_cli/session/jar.js';
import { _resetBackendForTesting } from '../../src/abap_cli/config/secrets.js';
import type { ProjectConfig, SapConfig } from '../../src/abap_cli/config/project-config.js';

function sap(): SapConfig {
  return {
    url: 'https://sap.example:44300',
    client: '100',
    username: 'DEVELOPER',
    password: 'x',
    language: 'EN',
    insecure: true,
    caPath: '',
    sourceDir: '.',
  };
}

function config(workspaceRoot: string | null): ProjectConfig {
  return {
    sap: sap(),
    transport: '',
    package: '',
    systemName: 'dev',
    configPath: workspaceRoot ? path.join(workspaceRoot, '.abap.json') : null,
    workspaceRoot,
  };
}

const codes = (warnings: Warning[]): string[] => warnings.map((w) => w.code);

let root = '';
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'abap-session-warn-'));
  for (const name of ['HOME', 'ABAP_CLI_SESSION_DIR', 'ABAP_CLI_SESSION_KEY_MODE', 'ABAP_CLI_SESSION_POLICY', 'ABAP_CLI_KEYCHAIN_BACKEND']) {
    saved[name] = process.env[name];
  }
  process.env.HOME = path.join(root, 'home');
  fs.mkdirSync(process.env.HOME, { recursive: true });
  process.env.ABAP_CLI_SESSION_KEY_MODE = 'derived';
  delete process.env.ABAP_CLI_SESSION_DIR;
  delete process.env.ABAP_CLI_SESSION_POLICY;
  delete process.env.ABAP_CLI_KEYCHAIN_BACKEND;
  resetKeychainCache();
  _resetBackendForTesting();
  _resetSessionWarnings();
  resetWarnings();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetKeychainCache();
  _resetBackendForTesting();
  _resetSessionWarnings();
  resetWarnings();
});

describe('session warnings', () => {
  it('warns once per process when no durable store is writable', async () => {
    const homeRo = path.join(root, 'home-ro');
    fs.mkdirSync(homeRo, { recursive: true });
    fs.chmodSync(homeRo, 0o555);
    process.env.HOME = homeRo;
    const blocker = path.join(root, 'blocker');
    fs.writeFileSync(blocker, 'x');
    process.env.ABAP_CLI_SESSION_DIR = path.join(blocker, 'sessions');

    await SessionLifecycle.init(config(null));
    await SessionLifecycle.init(config(null));
    const warnings = getWarnings().filter((w) => w.code === 'SESSION_REUSE_DISABLED');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain('ABAP_CLI_SESSION_DIR');
  });

  it('reports the workspace store fallback when HOME is read-only', async () => {
    const ws = path.join(root, 'workspace');
    fs.mkdirSync(ws, { recursive: true });
    const homeRo = path.join(root, 'home-ro');
    fs.mkdirSync(homeRo, { recursive: true });
    fs.chmodSync(homeRo, 0o555);
    process.env.HOME = homeRo;

    await SessionLifecycle.init(config(ws));
    const fallback = getWarnings().filter((w) => w.code === 'SESSION_STORE_FALLBACK');
    expect(fallback).toHaveLength(1);
    expect(fallback[0]!.message).toContain('.abap-cli');
  });

  it('reports a corrupt jar and continues without it', async () => {
    const store = path.join(root, 'home', '.abap-cli', 'sessions');
    fs.mkdirSync(store, { recursive: true });
    // A jar blob that cannot be decrypted (garbage of a plausible length).
    fs.writeFileSync(path.join(store, `${(await import('../../src/abap_cli/session/jar.js')).computeSystemHash(sap())}.json`), Buffer.alloc(64, 1));
    await SessionLifecycle.init(config(null));
    expect(codes(getWarnings())).toContain('SESSION_JAR_CORRUPT');
  });

  it('reports reuse-unstable when a paused jar is found', async () => {
    const home = path.join(root, 'home');
    const candidates = [{ kind: 'home' as const, dir: path.join(home, '.abap-cli', 'sessions'), displayDir: '~' }];
    const jar = makeEmptyJar(sap(), 'on-prem', 'dev', 'derived');
    jar.cookies = [{ name: 'SAP_SESSIONID_S4H_100', value: 'sid' }];
    jar.csrf = { value: 'csrf', fetchedAt: new Date().toISOString() };
    jar.header.reuseFailures = 2;
    jar.header.reuseBlockedUntil = new Date(Date.now() + 60_000).toISOString();
    expect(writeSessionJar(jar, sap(), deriveSessionKey(sap()), candidates).ok).toBe(true);

    await SessionLifecycle.init(config(null));
    expect(codes(getWarnings())).toContain('SESSION_REUSE_UNSTABLE');
  });
});
