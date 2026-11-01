/**
 * Session lifecycle — the single decision point behind issue #70.
 *
 * Contract under test:
 *  - a session is reusable only when the jar lands in a durable store, has a
 *    stateful session cookie and replay is not paused;
 *  - anything else must be released at command end (`needsRelease`), so a
 *    degraded environment is "login + logout per command", never one orphan
 *    SAP session per command;
 *  - repeated auth failures move the jar into a timed "reuse paused" state.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ADTClient } from 'abap-adt-api';
import {
  REUSE_FAILURE_LIMIT,
  SessionLifecycle,
  _resetSessionWarnings,
  reuseIsBlocked,
} from '../../src/abap_cli/session/manager.js';
import { resolveStoreCandidates, writeSessionJar } from '../../src/abap_cli/session/store.js';
import { deriveSessionKey, resetKeychainCache } from '../../src/abap_cli/session/key.js';
import { makeEmptyJar, type SessionJar } from '../../src/abap_cli/session/jar.js';
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

/** Minimal ADT client shape used by `adoptFreshLogin` / `applyTo`. */
function fakeClient(csrf = 'csrf-login'): ADTClient {
  return { httpClient: { csrfToken: csrf } } as unknown as ADTClient;
}

/** Simulate the login response the HTTP wrapper would have captured. */
function seedLoginCookies(lifecycle: SessionLifecycle, sid = 'sid-1'): void {
  lifecycle.controller.observeResponse(
    {
      'set-cookie': [
        `SAP_SESSIONID_S4H_100=${sid}; Path=/; HttpOnly`,
        'sap-contextid=SID%3aANON%3ahost%3asid%3actx-ATT; Path=/sap/bc/adt',
        'sap-usercontext=sap-client=100; Path=/',
      ],
    },
    true,
  );
}

function jar(): SessionJar {
  const j = makeEmptyJar(sap(), 'on-prem', 'dev', 'derived');
  j.cookies = [
    { name: 'SAP_SESSIONID_S4H_100', value: 'sid-old' },
    { name: 'sap-contextid', value: 'SID%3aANON%3ahost%3actx-old-ATT' },
  ];
  j.csrf = { value: 'csrf-old', fetchedAt: '2026-01-01T00:00:00.000Z' };
  return j;
}

let root = '';
let home = '';
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'abap-lifecycle-'));
  home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  for (const name of ['HOME', 'ABAP_CLI_SESSION_DIR', 'ABAP_CLI_SESSION_KEY_MODE', 'ABAP_CLI_SESSION_POLICY', 'ABAP_CLI_KEYCHAIN_BACKEND', 'ABAP_CLI_KEYCHAIN_FIXTURE_PASSWORD']) {
    savedEnv[name] = process.env[name];
  }
  process.env.HOME = home;
  process.env.ABAP_CLI_SESSION_KEY_MODE = 'derived';
  delete process.env.ABAP_CLI_SESSION_DIR;
  delete process.env.ABAP_CLI_SESSION_POLICY;
  delete process.env.ABAP_CLI_KEYCHAIN_BACKEND;
  resetKeychainCache();
  _resetBackendForTesting();
  _resetSessionWarnings();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetKeychainCache();
  _resetBackendForTesting();
  _resetSessionWarnings();
});

describe('fresh install (no jar)', () => {
  it('enables reuse when the home store is writable and does not release yet', async () => {
    const lifecycle = await SessionLifecycle.init(config(null));
    expect(lifecycle.reused).toBe(false);
    expect(lifecycle.reuseEnabled).toBe(true);
    expect(lifecycle.reuseReason).toBeNull();
    expect(lifecycle.needsRelease).toBe(false);
  });

  it('persists a fresh login and hands it to the next command', async () => {
    const cfg = config(null);
    const first = await SessionLifecycle.init(cfg);
    seedLoginCookies(first);
    await first.adoptFreshLogin(fakeClient());
    expect(first.needsRelease).toBe(false);

    const second = await SessionLifecycle.init(cfg);
    expect(second.reused).toBe(true);
    expect(second.reuseEnabled).toBe(true);
    // Reused sessions keep the context cookie (the fix for the SM04 leak).
    expect(second.controller.headerValue()).toContain('sap-contextid=');
  });

  it('falls back to the workspace store when HOME is not writable', async () => {
    const ws = path.join(root, 'workspace');
    fs.mkdirSync(ws, { recursive: true });
    const homeRo = path.join(root, 'home-ro');
    fs.mkdirSync(homeRo, { recursive: true });
    fs.chmodSync(homeRo, 0o555);
    process.env.HOME = homeRo;
    const lifecycle = await SessionLifecycle.init(config(ws));
    expect(lifecycle.reuseEnabled).toBe(true);
    seedLoginCookies(lifecycle);
    await lifecycle.adoptFreshLogin(fakeClient());
    expect(fs.existsSync(path.join(ws, '.abap-cli', '.gitignore'))).toBe(true);
    expect(fs.existsSync(path.join(ws, '.abap-cli', 'sessions'))).toBe(true);
  });
});

describe('no durable store', () => {
  it('disables reuse and requires release of the fresh session', async () => {
    const blocker = path.join(root, 'blocker');
    fs.writeFileSync(blocker, 'x');
    process.env.ABAP_CLI_SESSION_DIR = path.join(blocker, 'sessions');
    const homeRo = path.join(root, 'home-ro');
    fs.mkdirSync(homeRo, { recursive: true });
    fs.chmodSync(homeRo, 0o555);
    process.env.HOME = homeRo;

    const lifecycle = await SessionLifecycle.init(config(null));
    expect(lifecycle.reuseEnabled).toBe(false);
    expect(lifecycle.reuseReason).toBe('no-durable-store');
    expect(lifecycle.needsRelease).toBe(false);

    seedLoginCookies(lifecycle);
    await lifecycle.adoptFreshLogin(fakeClient());
    expect(lifecycle.needsRelease).toBe(true);
  });

  it('disables reuse when the key store is ephemeral', async () => {
    process.env.ABAP_CLI_KEYCHAIN_BACKEND = 'fixture';
    delete process.env.ABAP_CLI_SESSION_KEY_MODE;
    _resetBackendForTesting();
    const lifecycle = await SessionLifecycle.init(config(null));
    expect(lifecycle.reuseEnabled).toBe(false);
    expect(lifecycle.reuseReason).toBe('key-store-ephemeral');
  });

  it('disables reuse under always-logout and cloud/BTP modes', async () => {
    process.env.ABAP_CLI_SESSION_POLICY = 'always-logout';
    const always = await SessionLifecycle.init(config(null));
    expect(always.reuseEnabled).toBe(false);
    expect(always.reuseReason).toBe('always-logout');
    delete process.env.ABAP_CLI_SESSION_POLICY;

    const cloudCfg = config(null);
    cloudCfg.sap.systemType = 'btp';
    const cloud = await SessionLifecycle.init(cloudCfg);
    expect(cloud.reuseEnabled).toBe(false);
    expect(cloud.reuseReason).toBe('cloud-btp');
  });
});

describe('stale session recovery', () => {
  it('counts auth failures and pauses reuse after the limit', async () => {
    const cfg = config(null);
    const candidates = resolveStoreCandidates(cfg.sap, { workspaceRoot: null });
    const key = deriveSessionKey(cfg.sap);
    expect(writeSessionJar(jar(), cfg.sap, key, candidates).ok).toBe(true);

    // Command 1: the replayed session is rejected; one re-login is allowed and
    // the refreshed session is still handed to the next command.
    const first = await SessionLifecycle.init(cfg);
    expect(first.reused).toBe(true);
    expect(first.recordAuthFailure()).toBe(true);
    seedLoginCookies(first, 'sid-2');
    await first.adoptFreshLogin(fakeClient());
    expect(first.needsRelease).toBe(false);

    // Command 2: rejected again → the failure limit is crossed and reuse is
    // paused; the session opened now must be released at command end.
    const second = await SessionLifecycle.init(cfg);
    expect(second.reused).toBe(true);
    expect(second.recordAuthFailure()).toBe(true);
    seedLoginCookies(second, 'sid-3');
    await second.adoptFreshLogin(fakeClient());
    expect(second.needsRelease).toBe(true);

    // Command 3 sees the paused jar and must not replay it.
    const third = await SessionLifecycle.init(cfg);
    expect(third.reused).toBe(false);
    expect(third.reuseReason).toBe('reuse-unstable');
  });

  it('retries reuse once the pause expired', async () => {
    const cfg = config(null);
    const candidates = resolveStoreCandidates(cfg.sap, { workspaceRoot: null });
    const paused = jar();
    paused.header.reuseFailures = REUSE_FAILURE_LIMIT;
    paused.header.reuseBlockedUntil = new Date(Date.now() - 60_000).toISOString();
    expect(writeSessionJar(paused, cfg.sap, deriveSessionKey(cfg.sap), candidates).ok).toBe(true);

    const lifecycle = await SessionLifecycle.init(cfg);
    expect(lifecycle.reused).toBe(true);
    expect(lifecycle.reuseReason).toBeNull();
  });

  it('does not treat a fresh-session auth error as a reusable failure', async () => {
    const lifecycle = await SessionLifecycle.init(config(null));
    expect(lifecycle.recordAuthFailure()).toBe(false);
  });

  it('reports the pause state for a jar with a future block', () => {
    const paused = jar();
    paused.header.reuseFailures = REUSE_FAILURE_LIMIT;
    paused.header.reuseBlockedUntil = new Date(Date.now() + 60_000).toISOString();
    expect(reuseIsBlocked(paused)).toBe(true);
  });
});

describe('markReuseSuccess', () => {
  it('clears a persisted failure counter after a successful reuse', async () => {
    const cfg = config(null);
    const candidates = resolveStoreCandidates(cfg.sap, { workspaceRoot: null });
    const withFailure = jar();
    withFailure.header.reuseFailures = 1;
    writeSessionJar(withFailure, cfg.sap, deriveSessionKey(cfg.sap), candidates);

    const lifecycle = await SessionLifecycle.init(cfg);
    expect(lifecycle.reused).toBe(true);
    lifecycle.markReuseSuccess();

    const next = await SessionLifecycle.init(cfg);
    expect(next.reused).toBe(true);
    expect(next.sessionJar?.header.reuseFailures).toBe(0);
  });
});
