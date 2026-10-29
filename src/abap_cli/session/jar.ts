/**
 * Session jar — encrypted blob persisted at `~/.abap-cli/sessions/<system-hash>.json`.
 *
 * The blob is the on-disk representation of an active SAP HTTP session
 * (`SAP_SESSIONID_<sid>_<client>` cookie + CSRF token) so subsequent
 * invocations of any command can skip the `ADTClient.login()` round-trip
 * and just inject the headers.
 *
 * Layout (T034-003):
 *   nonce (12 bytes) | ciphertext (N bytes) | auth tag (16 bytes)
 *
 * The whole payload is opaque bytes; the structured shape lives in the
 * inner `SessionJar` JSON which is only revealed after `decryptJar` succeeds.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { CliError } from '../output/json.js';
import type { SapConfig } from '../config/project-config.js';

const ALGO = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface SessionJarHeader {
  createdAt: string;
  lastLoginAt: string;
  systemHash: string;
  profileName: string;
  systemType: string;
}

export interface SessionJarCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  expiresAt?: string;
}

export interface SessionJarCsrf {
  value: string;
  fetchedAt: string;
  expiresAt?: string;
}

export interface SessionJar {
  formatVersion: '1';
  header: SessionJarHeader;
  cookies: SessionJarCookie[];
  csrf: SessionJarCsrf;
}

/**
 * Deterministic per-system hash. Same `url | username | client` always
 * produces the same hex string, so cookie jars are bucketed by system
 * (different profiles / clients never collide).
 */
export function computeSystemHash(profile: SapConfig): string {
  const input = `${profile.url}|${profile.username}|${profile.client}`;
  return createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 16);
}

/** Encrypt a structured jar with a 32-byte symmetric key. */
export function encryptJar(jar: SessionJar, key: Buffer): Buffer {
  if (key.length !== KEY_BYTES) {
    throw new CliError('CONFIG_ERROR', `Session key must be ${KEY_BYTES} bytes, got ${key.length}.`);
  }
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGO, key, nonce);
  const plaintext = Buffer.from(JSON.stringify(jar), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ciphertext, tag]);
}

/**
 * Decrypt and validate a jar blob. The system hash check prevents a jar
 * written for profile A from being silently reused by profile B.
 */
export function decryptJar(blob: Buffer, key: Buffer, expectedSystemHash: string): SessionJar {
  if (key.length !== KEY_BYTES) {
    throw new CliError('CONFIG_ERROR', `Session key must be ${KEY_BYTES} bytes, got ${key.length}.`);
  }
  if (blob.length < NONCE_BYTES + TAG_BYTES) {
    throw new CliError('SESSION_JAR_DECRYPT_FAILED', 'Session jar blob is too short to be valid.');
  }
  const nonce = blob.subarray(0, NONCE_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const ciphertext = blob.subarray(NONCE_BYTES, blob.length - TAG_BYTES);
  const decipher = createDecipheriv(ALGO, key, nonce);
  decipher.setAuthTag(tag);
  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new CliError('SESSION_JAR_DECRYPT_FAILED', 'Session jar decrypt failed: auth tag mismatch or corrupt blob.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext.toString('utf8'));
  } catch {
    throw new CliError('SESSION_JAR_DECRYPT_FAILED', 'Session jar payload is not valid JSON.');
  }
  const jar = validateJarStructure(parsed);
  if (jar.header.systemHash !== expectedSystemHash) {
    throw new CliError(
      'SESSION_JAR_DECRYPT_FAILED',
      `Session jar systemHash mismatch (expected ${expectedSystemHash}, got ${jar.header.systemHash}).`,
    );
  }
  return jar;
}

function isStringOrUndefined(v: unknown): v is string | undefined {
  return v === undefined || typeof v === 'string';
}

/** Coerce unknown input into a `SessionJar` or throw. */
export function validateJarStructure(value: unknown): SessionJar {
  if (!value || typeof value !== 'object') {
    throw new CliError('SESSION_JAR_DECRYPT_FAILED', 'Session jar must be a JSON object.');
  }
  const v = value as Record<string, unknown>;
  if (v.formatVersion !== '1') {
    throw new CliError('SESSION_JAR_DECRYPT_FAILED', `Unsupported session jar formatVersion: ${String(v.formatVersion)}`);
  }
  const header = v.header as Record<string, unknown> | undefined;
  if (!header || typeof header !== 'object') {
    throw new CliError('SESSION_JAR_DECRYPT_FAILED', 'Session jar header is missing.');
  }
  const h = header as Record<string, unknown>;
  const requiredString = ['createdAt', 'lastLoginAt', 'systemHash', 'profileName', 'systemType'] as const;
  for (const field of requiredString) {
    if (typeof h[field] !== 'string') {
      throw new CliError('SESSION_JAR_DECRYPT_FAILED', `Session jar header.${field} must be a string.`);
    }
  }
  const cookies = v.cookies;
  if (!Array.isArray(cookies)) {
    throw new CliError('SESSION_JAR_DECRYPT_FAILED', 'Session jar cookies must be an array.');
  }
  const validatedCookies: SessionJarCookie[] = cookies.map((c, idx) => {
    if (!c || typeof c !== 'object') {
      throw new CliError('SESSION_JAR_DECRYPT_FAILED', `Session jar cookies[${idx}] is not an object.`);
    }
    const cc = c as Record<string, unknown>;
    if (typeof cc.name !== 'string' || typeof cc.value !== 'string') {
      throw new CliError('SESSION_JAR_DECRYPT_FAILED', `Session jar cookies[${idx}].name/value must be strings.`);
    }
    const cookie: SessionJarCookie = { name: cc.name, value: cc.value };
    if (typeof cc.domain === 'string') cookie.domain = cc.domain;
    if (typeof cc.path === 'string') cookie.path = cc.path;
    if (typeof cc.httpOnly === 'boolean') cookie.httpOnly = cc.httpOnly;
    if (isStringOrUndefined(cc.expiresAt)) cookie.expiresAt = cc.expiresAt as string | undefined;
    return cookie;
  });
  const csrf = v.csrf as Record<string, unknown> | undefined;
  if (!csrf || typeof csrf !== 'object' || typeof csrf.value !== 'string' || typeof csrf.fetchedAt !== 'string') {
    throw new CliError('SESSION_JAR_DECRYPT_FAILED', 'Session jar csrf must be an object with string value/fetchedAt.');
  }
  const validatedCsrf: SessionJarCsrf = { value: csrf.value, fetchedAt: csrf.fetchedAt };
  if (isStringOrUndefined(csrf.expiresAt)) validatedCsrf.expiresAt = csrf.expiresAt as string | undefined;
  return {
    formatVersion: '1',
    header: {
      createdAt: h.createdAt as string,
      lastLoginAt: h.lastLoginAt as string,
      systemHash: h.systemHash as string,
      profileName: h.profileName as string,
      systemType: h.systemType as string,
    },
    cookies: validatedCookies,
    csrf: validatedCsrf,
  };
}

/** Convenience for tests / docs: build a well-formed jar from primitives. */
export function makeEmptyJar(profile: SapConfig, systemType: string, profileName: string): SessionJar {
  const now = new Date().toISOString();
  return {
    formatVersion: '1',
    header: {
      createdAt: now,
      lastLoginAt: now,
      systemHash: computeSystemHash(profile),
      profileName,
      systemType,
    },
    cookies: [],
    csrf: { value: '', fetchedAt: now },
  };
}

/** Constants exported for tests and downstream code. */
export const SESSION_JAR_CONSTANTS = {
  ALGO,
  NONCE_BYTES,
  TAG_BYTES,
  KEY_BYTES,
} as const;