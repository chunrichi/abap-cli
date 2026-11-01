/**
 * Session store — durable candidate resolution, atomic writes, reads.
 *
 * The store contract is what makes the end-of-command safety net honest:
 * a jar counts as reusable only if it landed in a durable candidate, and a
 * read-only/absent store must be detected instead of silently "succeeding".
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  SESSION_DIR_ENV,
  clearSessionJars,
  jarPathFor,
  quarantineCorruptJars,
  readSessionJars,
  resolveStoreCandidates,
  writeSessionJar,
  writableHint,
  type StoreCandidate,
} from '../../src/abap_cli/session/store.js';
import { computeSystemHash, encryptJar, makeEmptyJar, type SessionJar } from '../../src/abap_cli/session/jar.js';
import { deriveSessionKey } from '../../src/abap_cli/session/key.js';
import type { SapConfig } from '../../src/abap_cli/config/project-config.js';

function profile(): SapConfig {
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

const KEY = deriveSessionKey(profile());

function jar(cookies = [{ name: 'SAP_SESSIONID_S4H_100', value: 'sid' }]): SessionJar {
  const j = makeEmptyJar(profile(), 'on-prem', 'dev', 'derived');
  j.cookies = cookies;
  j.csrf = { value: 'csrf', fetchedAt: '2026-01-01T00:00:00.000Z' };
  return j;
}

function candidate(kind: StoreCandidate['kind'], dir: string): StoreCandidate {
  return { kind, dir, displayDir: dir };
}

let root = '';
const originalEnv = process.env[SESSION_DIR_ENV];
const originalHome = process.env.HOME;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'abap-store-'));
  delete process.env[SESSION_DIR_ENV];
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  if (originalEnv === undefined) delete process.env[SESSION_DIR_ENV];
  else process.env[SESSION_DIR_ENV] = originalEnv;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
});

describe('resolveStoreCandidates', () => {
  it('orders env > home > workspace and includes every durable location', () => {
    process.env[SESSION_DIR_ENV] = path.join(root, 'env-store');
    const home = path.join(root, 'home');
    fs.mkdirSync(home, { recursive: true });
    process.env.HOME = home;
    const candidates = resolveStoreCandidates(profile(), { workspaceRoot: path.join(root, 'ws') });
    expect(candidates.map((c) => c.kind)).toEqual(['env', 'home', 'workspace']);
    expect(candidates[0]!.dir).toBe(path.join(root, 'env-store'));
  });

  it('uses $HOME for the home candidate', () => {
    const home = path.join(root, 'home');
    fs.mkdirSync(home, { recursive: true });
    process.env.HOME = home;
    const candidates = resolveStoreCandidates(profile(), {});
    expect(candidates.find((c) => c.kind === 'home')!.dir).toBe(path.join(home, '.abap-cli', 'sessions'));
    expect(candidates.some((c) => c.kind === 'workspace')).toBe(false);
  });
});

describe('write + read', () => {
  it('writes atomically with 0600 and reads the jar back', () => {
    const store = candidate('env', path.join(root, 'store'));
    const outcome = writeSessionJar(jar(), profile(), KEY, [store]);
    expect(outcome.ok).toBe(true);
    const file = jarPathFor(store, profile());
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const read = readSessionJars(profile(), KEY, [store]);
    expect(read.best?.jar.cookies.map((c) => c.name)).toEqual(['SAP_SESSIONID_S4H_100']);
    expect(read.statuses[0]!.status).toBe('ok');
  });

  it('falls back to the next candidate when one is structurally unwritable', () => {
    const blocker = path.join(root, 'not-a-dir');
    fs.writeFileSync(blocker, 'x');
    const unwritable = candidate('env', path.join(blocker, 'sessions'));
    const writable = candidate('workspace', path.join(root, 'ws', '.abap-cli', 'sessions'));
    const outcome = writeSessionJar(jar(), profile(), KEY, [unwritable, writable]);
    expect(outcome.ok).toBe(true);
    expect(outcome.candidate?.kind).toBe('workspace');
    expect(fs.existsSync(jarPathFor(writable, profile()))).toBe(true);
  });

  it('creates the workspace store self-ignore (.gitignore with *)', () => {
    const ws = path.join(root, 'ws');
    fs.mkdirSync(ws, { recursive: true });
    const store = candidate('workspace', path.join(ws, '.abap-cli', 'sessions'));
    expect(writeSessionJar(jar(), profile(), KEY, [store]).ok).toBe(true);
    expect(fs.readFileSync(path.join(ws, '.abap-cli', '.gitignore'), 'utf8')).toBe('*\n');
  });

  it('picks the newest jar across candidates', () => {
    const older = candidate('home', path.join(root, 'a'));
    const newer = candidate('workspace', path.join(root, 'b'));
    const oldJar = jar();
    oldJar.header.lastLoginAt = '2026-01-01T00:00:00.000Z';
    const newJar = jar([{ name: 'SAP_SESSIONID_S4H_100', value: 'new' }]);
    newJar.header.lastLoginAt = '2026-02-01T00:00:00.000Z';
    writeSessionJar(oldJar, profile(), KEY, [older]);
    writeSessionJar(newJar, profile(), KEY, [newer]);
    const read = readSessionJars(profile(), KEY, [older, newer]);
    expect(read.best?.jar.header.lastLoginAt).toBe('2026-02-01T00:00:00.000Z');
    expect(read.best?.jar.cookies[0]!.value).toBe('new');
  });

  it('reports a corrupt candidate without hiding a valid one', () => {
    const corruptStore = candidate('home', path.join(root, 'a'));
    const validStore = candidate('workspace', path.join(root, 'b'));
    writeSessionJar(jar(), profile(), KEY, [validStore]);
    fs.mkdirSync(corruptStore.dir, { recursive: true });
    fs.writeFileSync(jarPathFor(corruptStore, profile()), Buffer.from('garbage'));
    const read = readSessionJars(profile(), KEY, [corruptStore, validStore]);
    expect(read.statuses.find((s) => s.kind === 'home')?.status).toBe('corrupt');
    expect(read.best?.candidate.kind).toBe('workspace');
  });

  it('reports jars as unreadable when no key is available', () => {
    const store = candidate('env', path.join(root, 'store'));
    writeSessionJar(jar(), profile(), KEY, [store]);
    const read = readSessionJars(profile(), null, [store]);
    expect(read.best).toBeNull();
    expect(read.statuses[0]!.status).toBe('unreadable');
  });
});

describe('quarantine + clear', () => {
  it('renames a corrupt jar so it is not retried forever', () => {
    const store = candidate('env', path.join(root, 'store'));
    fs.mkdirSync(store.dir, { recursive: true });
    fs.writeFileSync(jarPathFor(store, profile()), Buffer.from('garbage'));
    const moved = quarantineCorruptJars(profile(), [store]);
    expect(moved).toHaveLength(1);
    expect(fs.existsSync(jarPathFor(store, profile()))).toBe(false);
    expect(fs.readdirSync(store.dir).some((f) => f.includes('.corrupt-'))).toBe(true);
  });

  it('clears the jar and quarantined copies', () => {
    const store = candidate('env', path.join(root, 'store'));
    writeSessionJar(jar(), profile(), KEY, [store]);
    fs.writeFileSync(`${jarPathFor(store, profile())}.corrupt-123`, 'x');
    const removed = clearSessionJars(profile(), [store]);
    expect(removed).toHaveLength(2);
    expect(fs.existsSync(jarPathFor(store, profile()))).toBe(false);
  });

  it('reports writability hints without creating directories', () => {
    const unwritable = path.join(root, 'ro');
    fs.mkdirSync(unwritable, { recursive: true });
    fs.chmodSync(unwritable, 0o555);
    expect(writableHint(path.join(unwritable, 'sessions'))).toBe(false);
    expect(fs.existsSync(path.join(unwritable, 'sessions'))).toBe(false);
    expect(writableHint(path.join(root, 'fresh'))).toBe(true);
  });
});

describe('encrypted blob on disk', () => {
  it('stores only the encrypted blob (no plaintext cookie names)', () => {
    const store = candidate('env', path.join(root, 'store'));
    writeSessionJar(jar(), profile(), KEY, [store]);
    const raw = fs.readFileSync(jarPathFor(store, profile())).toString('latin1');
    expect(raw).not.toContain('SAP_SESSIONID');
    const systemHash = computeSystemHash(profile());
    expect(jarPathFor(store, profile())).toContain(systemHash);
    // The same jar encrypted twice never produces the same bytes (random nonce).
    expect(encryptJar(jar(), KEY).equals(encryptJar(jar(), KEY))).toBe(false);
  });
});
