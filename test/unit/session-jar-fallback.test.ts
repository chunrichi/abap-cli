/**
 * S-8 — session jar writes transparently fall back to `$TMPDIR/abap-cli/...`
 * when the canonical `~/.abap-cli/sessions/<hash>.json` path is not
 * writable (sandboxed environments, read-only filesystems, $HOME pointing
 * at a regular file, etc).
 *
 * The fallback path is cached per profile so the warning fires exactly
 * once per process; subsequent commands reuse the cached path silently.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const h = vi.hoisted(() => ({ home: { value: '' }, tmp: { value: '' }, realTmp: '' }));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  h.realTmp = actual.tmpdir();
  return { ...actual, homedir: () => h.home.value, tmpdir: () => h.tmp.value };
});
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  h.realTmp = actual.tmpdir();
  return { ...actual, homedir: () => h.home.value, tmpdir: () => h.tmp.value };
});

import {
  getFallbackJarPath,
  loadJarFromDisk,
  markJarPersisted,
  resetJarWarnings,
} from '../../src/abap_cli/session/reuse.js';
import { computeSystemHash } from '../../src/abap_cli/session/jar.js';
import type { SessionJar } from '../../src/abap_cli/session/jar.js';

// Build a profile + jar whose header.systemHash matches the actual
// computeSystemHash(profile) so the round-trip decrypt can pass the
// hash check (the jar path is keyed by the hash; encrypt embeds it
// in the header; decrypt rejects mismatches).
const profile = {
  url: 'http://x:50000',
  client: '001',
  username: 'U',
  password: 'p',
  language: 'EN',
  insecure: true,
  caPath: '',
  auth: { method: 'basic' as const },
  sourceDir: '.',
  systemName: 'p',
} as never;

const jar: SessionJar = {
  formatVersion: '1',
  header: {
    createdAt: '2026-01-01T00:00:00Z',
    lastLoginAt: '2026-01-01T00:00:00Z',
    systemHash: computeSystemHash(profile),
    profileName: 'p',
    systemType: 'on-prem',
  },
  cookies: [{ name: 'SAP_SESSIONID_X', value: 'v' }],
  csrf: { value: 'c', fetchedAt: '2026-01-01T00:00:00Z' },
} as unknown as SessionJar;

let stderr: string[];
let originalWrite: typeof process.stderr.write;
let fallbackDir: string;

beforeEach(() => {
  resetJarWarnings();
  stderr = [];
  h.tmp.value = h.realTmp;
  originalWrite = process.stderr.write.bind(process.stderr);
  // @ts-expect-error test stub
  process.stderr.write = (chunk: string) => {
    stderr.push(String(chunk));
    return true;
  };
  // Writable temp dir + the home-dir failure fixture used by F-17.
  fallbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarfallback-'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarwarn-'));
  const notADir = path.join(dir, 'not-a-dir');
  fs.writeFileSync(notADir, 'x');
  h.home.value = notADir;
});

afterEach(() => {
  process.stderr.write = originalWrite;
  // Wipe any jars the run produced so subsequent tests start clean.
  for (const root of [fallbackDir, path.join(os.tmpdir(), 'abap-cli')]) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

describe('session jar fallback (S-8)', () => {
  it('writes to $TMPDIR/abap-cli/sessions/<hash>.json when the home-dir path is unwritable', async () => {
    const key = Buffer.alloc(32, 1);
    await expect(markJarPersisted(jar, profile, key)).resolves.toBe(true);

    const fallbackPath = getFallbackJarPath(profile);
    expect(fallbackPath).toBeDefined();
    expect(fs.existsSync(fallbackPath!)).toBe(true);
    expect(fs.statSync(fallbackPath!).mode & 0o777).toBe(0o600);
  });

  it('emits exactly one fallback warning per process, then stays silent', async () => {
    const key = Buffer.alloc(32, 1);
    await markJarPersisted(jar, profile, key);
    await markJarPersisted(jar, profile, key);
    await markJarPersisted(jar, profile, key);

    const warnings = stderr.filter((line) => line.includes('WARN session jar'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('home directory is not writable');
    expect(warnings[0]).toContain('Falling back to');
  });

  it('round-trips through the fallback path: write then load', async () => {
    const key = Buffer.alloc(32, 1);
    await markJarPersisted(jar, profile, key);

    const fallbackPath = getFallbackJarPath(profile);
    expect(fallbackPath).toBeDefined();

    const loaded = await loadJarFromDisk(profile, key);
    expect(loaded).not.toBeNull();
    expect(loaded?.header.systemHash).toBe(jar.header.systemHash);
    expect(loaded?.cookies).toEqual(jar.cookies);
  });

  it('does not write to the home-dir path on the fallback', async () => {
    const key = Buffer.alloc(32, 1);
    await markJarPersisted(jar, profile, key);

    // The home-dir session file must NOT exist (the path was structurally
    // unwritable; the fallback caught it instead).
    const homeDir = path.join(h.home.value, '.abap-cli', 'sessions');
    expect(fs.existsSync(homeDir)).toBe(false);
  });

  it('resetJarWarnings clears the cached fallback so the next run re-derives it', async () => {
    const key = Buffer.alloc(32, 1);
    await markJarPersisted(jar, profile, key);
    expect(getFallbackJarPath(profile)).toBeDefined();

    resetJarWarnings();
    expect(getFallbackJarPath(profile)).toBeUndefined();
  });

  it('falls through a stale home-dir jar and still reuses the fallback jar', async () => {
    const key = Buffer.alloc(32, 1);
    await markJarPersisted(jar, profile, key);
    expect(getFallbackJarPath(profile)).toBeDefined();

    // Next run: the home dir is writable again and holds a jar encrypted
    // under a rotated key (undecryptable with `key`).
    resetJarWarnings();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jarhome-'));
    h.home.value = home;
    const primaryPath = path.join(home, '.abap-cli', 'sessions', `${computeSystemHash(profile)}.json`);
    fs.mkdirSync(path.dirname(primaryPath), { recursive: true });
    fs.writeFileSync(primaryPath, Buffer.from('stale jar encrypted with another key'));

    const loaded = await loadJarFromDisk(profile, key);
    expect(loaded?.cookies).toEqual(jar.cookies);
    // A usable fallback must not look like a fresh login.
    expect(stderr.filter((line) => line.includes('re-logging in'))).toHaveLength(0);
  });

  it('emits one fresh-login warning when every candidate jar fails to decrypt', async () => {
    const key = Buffer.alloc(32, 1);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jarhome-'));
    h.home.value = home;
    const primaryPath = path.join(home, '.abap-cli', 'sessions', `${computeSystemHash(profile)}.json`);
    fs.mkdirSync(path.dirname(primaryPath), { recursive: true });
    fs.writeFileSync(primaryPath, Buffer.from('stale jar encrypted with another key'));

    const loaded = await loadJarFromDisk(profile, key);
    expect(loaded).toBeNull();
    const warnings = stderr.filter((line) => line.includes('WARN session jar'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('re-logging in');
  });

  it('resolves false when neither the home dir nor the TMPDIR fallback can be written', async () => {
    const key = Buffer.alloc(32, 1);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarunwritable-'));
    const tmpFile = path.join(dir, 'tmp-not-a-dir');
    fs.writeFileSync(tmpFile, 'x');
    const homeFile = path.join(dir, 'home-not-a-dir');
    fs.writeFileSync(homeFile, 'x');
    h.home.value = homeFile;
    h.tmp.value = tmpFile; // mkdir under TMPDIR fails with ENOTDIR

    await expect(markJarPersisted(jar, profile, key)).resolves.toBe(false);

    const warnings = stderr.filter((line) => line.includes('WARN session jar'));
    expect(warnings.some((line) => line.includes('Session reuse is disabled'))).toBe(true);
  });
});
