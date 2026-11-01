/**
 * Session jar format — v2 round-trip + v1 read compatibility.
 *
 * The jar is the on-disk session identity: cookie set (including
 * `sap-contextid`), CSRF token and the lifecycle metadata (`keyMode`,
 * `reuseFailures`, `reuseBlockedUntil`). It must be readable, tamper evident
 * and bucketed per system.
 */
import { describe, expect, it } from 'vitest';
import {
  computeSystemHash,
  decryptJar,
  encryptJar,
  makeEmptyJar,
  validateJarStructure,
  hasStatefulSessionCookie,
  jarSessionId,
  SESSION_JAR_CONSTANTS,
} from '../../../src/abap_cli/session/jar.js';
import type { SapConfig } from '../../../src/abap_cli/config/project-config.js';

function profile(overrides: Partial<SapConfig> = {}): SapConfig {
  return {
    url: 'https://sap.example:44300',
    client: '100',
    username: 'DEVELOPER',
    password: 'x',
    language: 'EN',
    insecure: true,
    caPath: '',
    sourceDir: '.',
    ...overrides,
  };
}

const KEY = Buffer.alloc(SESSION_JAR_CONSTANTS.KEY_BYTES, 7);

function jar() {
  const j = makeEmptyJar(profile(), 'on-prem', 'dev', 'keychain');
  j.cookies = [
    { name: 'SAP_SESSIONID_S4H_100', value: 'sid-1' },
    { name: 'sap-contextid', value: 'SID%3aANON%3ahost%3asid%3actx-ATT' },
    { name: 'sap-usercontext', value: 'sap-client=100' },
  ];
  j.csrf = { value: 'csrf-1', fetchedAt: '2026-01-01T00:00:00.000Z' };
  j.header.lastLoginAt = '2026-01-01T00:00:00.000Z';
  j.header.reuseFailures = 1;
  j.header.sapSessionId = 'sid-1';
  return j;
}

describe('session jar v2 round-trip', () => {
  it('encrypts and decrypts the full structure', () => {
    const original = jar();
    const blob = encryptJar(original, KEY);
    const decoded = decryptJar(blob, KEY, computeSystemHash(profile()));
    expect(decoded.formatVersion).toBe('2');
    expect(decoded.header.keyMode).toBe('keychain');
    expect(decoded.header.reuseFailures).toBe(1);
    expect(decoded.header.sapSessionId).toBe('sid-1');
    expect(decoded.cookies.map((c) => c.name)).toEqual([
      'SAP_SESSIONID_S4H_100',
      'sap-contextid',
      'sap-usercontext',
    ]);
    expect(decoded.csrf.value).toBe('csrf-1');
  });

  it('reads a v1 jar and normalises it to v2 in memory', () => {
    const legacy = {
      formatVersion: '1',
      header: {
        createdAt: '2025-01-01T00:00:00.000Z',
        lastLoginAt: '2025-01-01T00:00:00.000Z',
        systemHash: computeSystemHash(profile()),
        profileName: 'dev',
        systemType: 'on-prem',
      },
      cookies: [{ name: 'SAP_SESSIONID_S4H_100', value: 'old' }],
      csrf: { value: 'old-csrf', fetchedAt: '2025-01-01T00:00:00.000Z' },
    };
    const blob = encryptJar(legacy as never, KEY);
    const decoded = decryptJar(blob, KEY, computeSystemHash(profile()));
    expect(decoded.formatVersion).toBe('2');
    expect(decoded.header.keyMode).toBe('unknown');
    expect(decoded.header.reuseFailures).toBe(0);
  });

  it('rejects a jar written for another system', () => {
    const blob = encryptJar(jar(), KEY);
    expect(() => decryptJar(blob, KEY, 'ffffffffffffffff')).toThrow(/systemHash mismatch/);
  });

  it('rejects a tampered blob', () => {
    const blob = encryptJar(jar(), KEY);
    blob[blob.length - 5] = blob[blob.length - 5]! ^ 0xff;
    expect(() => decryptJar(blob, KEY, computeSystemHash(profile()))).toThrow(/decrypt failed/);
  });

  it('rejects an unknown future formatVersion', () => {
    const future = { ...jar(), formatVersion: '3' };
    const blob = encryptJar(future as never, KEY);
    expect(() => decryptJar(blob, KEY, computeSystemHash(profile()))).toThrow(/formatVersion/);
  });

  it('rejects a key of the wrong length', () => {
    expect(() => encryptJar(jar(), Buffer.alloc(16))).toThrow(/32 bytes/);
    expect(() => decryptJar(encryptJar(jar(), KEY), Buffer.alloc(16), 'x')).toThrow(/32 bytes/);
  });

  it('validates required header fields', () => {
    expect(() => validateJarStructure({ formatVersion: '2' })).toThrow(/header is missing/);
    expect(() => validateJarStructure({ formatVersion: '2', header: {}, cookies: [] })).toThrow(/createdAt/);
  });
});

describe('stateful session helpers', () => {
  it('detects the stateful session cookie', () => {
    expect(hasStatefulSessionCookie(jar().cookies)).toBe(true);
    expect(hasStatefulSessionCookie([{ name: 'sap-usercontext', value: 'x' }])).toBe(false);
    expect(jarSessionId(jar())).toBe('sid-1');
  });
});
