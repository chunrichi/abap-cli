/**
 * F-17 — the session-jar write warning must be emitted once per process, not on
 * every command.
 *
 * The condition (unwritable config dir) belongs to the environment, so warning
 * each time was pure noise — and it buried the real consequence: session reuse
 * silently stops working and every command performs a fresh login.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const h = vi.hoisted(() => ({ home: { value: '' } }));

// reuse.ts imports `* as os from 'os'`; cover both specifiers so the mock wins
// regardless of how vitest normalises the builtin.
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => h.home.value };
});
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => h.home.value };
});

import { markJarPersisted, resetJarWarnings } from '../../src/abap_cli/session/reuse.js';
import type { SessionJar } from '../../src/abap_cli/session/jar.js';

const jar: SessionJar = {
  formatVersion: '1',
  header: {
    createdAt: '2026-01-01T00:00:00Z',
    lastLoginAt: '2026-01-01T00:00:00Z',
    systemHash: 'aaaaaaaaaaaaaaaa',
    profileName: 'p',
    systemType: 'on-prem',
  },
  cookies: [{ name: 'SAP_SESSIONID_X', value: 'v' }],
  csrf: { value: 'c', fetchedAt: '2026-01-01T00:00:00Z' },
} as unknown as SessionJar;

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

let stderr: string[];
let originalWrite: typeof process.stderr.write;

beforeEach(() => {
  resetJarWarnings();
  stderr = [];
  originalWrite = process.stderr.write.bind(process.stderr);
  // @ts-expect-error test stub
  process.stderr.write = (chunk: string) => {
    stderr.push(String(chunk));
    return true;
  };
  // A regular FILE where the home directory should be → mkdirSync of
  // <home>/.abap-cli/sessions fails deterministically with ENOTDIR.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarwarn-'));
  const notADir = path.join(dir, 'not-a-dir');
  fs.writeFileSync(notADir, 'x');
  h.home.value = notADir;
});

afterEach(() => {
  process.stderr.write = originalWrite;
});

describe('session jar write warning (F-17)', () => {
  it('warns once with actionable guidance, then stays silent', async () => {
    const key = Buffer.alloc(32, 1);
    await markJarPersisted(jar, profile, key);
    await markJarPersisted(jar, profile, key);
    await markJarPersisted(jar, profile, key);

    const warnings = stderr.filter((line) => line.includes('WARN session jar'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Session reuse is disabled');
    expect(warnings[0]).toContain('abap session');
  });
});
