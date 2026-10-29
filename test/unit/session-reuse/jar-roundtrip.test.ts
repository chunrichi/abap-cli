/**
 * SessionJar round-trip + deterministic hash (SC-007 a/b).
 *
 * - encrypt → decrypt is byte-lossless
 * - AES-GCM auth-tag mismatch / wrong system hash → SESSION_JAR_DECRYPT_FAILED
 * - computeSystemHash is deterministic for a profile and changes when any of
 *   url / username / client changes
 */
import { describe, expect, it } from 'vitest';
import { computeSystemHash, decryptJar, encryptJar, makeEmptyJar, validateJarStructure } from '../../../src/abap_cli/session/jar.js';
import { deriveSessionKey } from '../../../src/abap_cli/session/key.js';
import type { SapConfig } from '../../../src/abap_cli/config/project-config.js';

/** Expect a CliError carrying the given machine code. */
function throwsCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error: unknown) {
    expect((error as { code?: string }).code).toBe(code);
    return;
  }
  expect.unreachable('expected function to throw');
}

function profile(overrides: Partial<SapConfig> = {}): SapConfig {
  return {
    url: 'http://vhcala4hci:50000',
    client: '001',
    username: 'DEVELOPER',
    password: 'x',
    language: 'EN',
    insecure: true,
    caPath: '',
    auth: { method: 'basic' },
    sourceDir: '.',
    ...overrides,
  };
}

describe('computeSystemHash', () => {
  it('is deterministic for the same url|username|client', () => {
    const a = profile();
    expect(computeSystemHash(a)).toBe(computeSystemHash(profile()));
  });

  it('changes when the url changes', () => {
    const base = computeSystemHash(profile());
    expect(computeSystemHash(profile({ url: 'http://other:8000' }))).not.toBe(base);
  });

  it('changes when the username changes', () => {
    const base = computeSystemHash(profile());
    expect(computeSystemHash(profile({ username: 'OTHER' }))).not.toBe(base);
  });

  it('changes when the client changes', () => {
    const base = computeSystemHash(profile());
    expect(computeSystemHash(profile({ client: '100' }))).not.toBe(base);
  });

  it('is a 16-char hex string', () => {
    expect(computeSystemHash(profile())).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('encryptJar / decryptJar', () => {
  it('round-trips a jar byte-losslessly', () => {
    const key = deriveSessionKey(profile());
    const jar = makeEmptyJar(profile(), 'on-prem', 'vhcala4hci');
    jar.cookies = [{ name: 'SAP_SESSIONID_VH4_001', value: 'abc123' }];
    jar.csrf = { value: 'token-xyz', fetchedAt: new Date().toISOString() };
    const blob = encryptJar(jar, key);
    const decoded = decryptJar(blob, key, computeSystemHash(profile()));
    expect(decoded).toEqual(jar);
  });

  it('throws SESSION_JAR_DECRYPT_FAILED when the auth tag is corrupted', () => {
    const key = deriveSessionKey(profile());
    const blob = encryptJar(makeEmptyJar(profile(), 'on-prem', 'x'), key);
    const corrupted = Buffer.from(blob);
    corrupted[corrupted.length - 1] ^= 0xff; // flip a bit in the auth tag
    throwsCode(() => decryptJar(corrupted, key, computeSystemHash(profile())), 'SESSION_JAR_DECRYPT_FAILED');
  });

  it('throws SESSION_JAR_DECRYPT_FAILED when systemHash does not match', () => {
    const key = deriveSessionKey(profile());
    const blob = encryptJar(makeEmptyJar(profile(), 'on-prem', 'x'), key);
    throwsCode(() => decryptJar(blob, key, 'deadbeefdeadbeef'), 'SESSION_JAR_DECRYPT_FAILED');
  });

  it('rejects a too-short blob', () => {
    const key = deriveSessionKey(profile());
    throwsCode(() => decryptJar(Buffer.from('short'), key, 'a'.repeat(16)), 'SESSION_JAR_DECRYPT_FAILED');
  });

  it('generates a fresh nonce per encryption (same jar encrypts differently)', () => {
    const key = deriveSessionKey(profile());
    const jar = makeEmptyJar(profile(), 'on-prem', 'x');
    expect(encryptJar(jar, key).equals(encryptJar(jar, key))).toBe(false);
  });
});

describe('validateJarStructure', () => {
  it('accepts a well-formed jar', () => {
    const jar = makeEmptyJar(profile(), 'on-prem', 'x');
    expect(validateJarStructure(jar)).toEqual(jar);
  });

  it('rejects a jar with the wrong formatVersion', () => {
    const jar = makeEmptyJar(profile(), 'on-prem', 'x');
    throwsCode(() => validateJarStructure({ ...jar, formatVersion: '2' }), 'SESSION_JAR_DECRYPT_FAILED');
  });

  it('rejects a jar missing cookies / csrf', () => {
    const jar = makeEmptyJar(profile(), 'on-prem', 'x');
    const { cookies, csrf, ...rest } = jar as unknown as { cookies: unknown[]; csrf: unknown };
    throwsCode(() => validateJarStructure({ ...rest, cookies, csrf: undefined }), 'SESSION_JAR_DECRYPT_FAILED');
  });
});
