/**
 * Session jar — encrypted blob holding a live SAP HTTP session so the next
 * CLI process can skip the login round-trip.
 *
 * The jar is stored by `session/store.ts`; this module only owns the format:
 *
 *   nonce (12 bytes) | ciphertext (N bytes) | auth tag (16 bytes)
 *
 * Format v2 adds the fields the session lifecycle needs to make honest reuse
 * decisions (`keyMode`, `reuseFailures`, `reuseBlockedUntil`) and the SAP
 * session identity (`sapSessionId`). v1 jars are still readable and are
 * normalised to v2 in memory on decrypt.
 *
 * The cookie set is the *complete* set the SAP session was opened with —
 * including `sap-contextid`. An S/4HANA ADT request that carries the session
 * cookie but not its context cookie is routed into a brand-new SAP session
 * (HTTP 200, no error), which is how the CLI used to leave one orphan session
 * per command in SM04. Context cookies are therefore only droppable when the
 * set has no stateful session cookie at all (stateless / degraded ICM).
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { CliError } from '../output/json.js';
import type { SapConfig } from '../config/project-config.js';

const ALGO = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const FORMAT_VERSION = '2' as const;

/** Where the jar encryption key came from when the jar was written. */
export type SessionKeyMode = 'keychain' | 'derived' | 'unknown';

export interface SessionJarHeader {
  createdAt: string;
  lastLoginAt: string;
  lastUsedAt?: string;
  systemHash: string;
  profileName: string;
  systemType: string;
  keyMode: SessionKeyMode;
  /** Consecutive commands whose replayed session SAP rejected with an auth error. */
  reuseFailures: number;
  /** Reuse is paused until this instant after `reuseFailures` crossed the limit. */
  reuseBlockedUntil?: string;
  /** `SAP_SESSIONID_<sid>_<client>` value, for diagnostics only. */
  sapSessionId?: string;
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
  formatVersion: typeof FORMAT_VERSION;
  header: SessionJarHeader;
  cookies: SessionJarCookie[];
  csrf: SessionJarCsrf;
}

/** Cookie name that carries the ABAP/ICM context id. */
export function isContextCookieName(name: string): boolean {
  return name.toLowerCase() === 'sap-contextid';
}

/** Cookie name prefix that identifies a stateful SAP session. */
export function isStatefulCookieName(name: string): boolean {
  return /^SAP_SESSIONID_/i.test(name);
}

/** True when the cookie set carries a stateful SAP session cookie. */
export function hasStatefulSessionCookie(cookies: readonly SessionJarCookie[]): boolean {
  return cookies.some((c) => isStatefulCookieName(c.name));
}

/** `SAP_SESSIONID_...` value of the set, for diagnostics only. */
export function jarSessionId(jar: SessionJar): string | undefined {
  return jar.cookies.find((c) => isStatefulCookieName(c.name))?.value;
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
 * written for profile A from being silently reused by profile B. v1 jars are
 * normalised to the v2 shape (unknown key mode / no failure counters).
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
  if (v.formatVersion !== '1' && v.formatVersion !== FORMAT_VERSION) {
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

  const keyMode =
    h.keyMode === 'keychain' || h.keyMode === 'derived' || h.keyMode === 'unknown' ? h.keyMode : 'unknown';
  const reuseFailures = typeof h.reuseFailures === 'number' && Number.isFinite(h.reuseFailures) ? h.reuseFailures : 0;
  const validatedHeader: SessionJarHeader = {
    createdAt: h.createdAt as string,
    lastLoginAt: h.lastLoginAt as string,
    systemHash: h.systemHash as string,
    profileName: h.profileName as string,
    systemType: h.systemType as string,
    keyMode,
    reuseFailures,
  };
  if (typeof h.lastUsedAt === 'string') validatedHeader.lastUsedAt = h.lastUsedAt;
  if (typeof h.reuseBlockedUntil === 'string') validatedHeader.reuseBlockedUntil = h.reuseBlockedUntil;
  if (typeof h.sapSessionId === 'string') validatedHeader.sapSessionId = h.sapSessionId;

  return {
    formatVersion: FORMAT_VERSION,
    header: validatedHeader,
    cookies: validatedCookies,
    csrf: validatedCsrf,
  };
}

/** Convenience for tests / docs: build a well-formed jar from primitives. */
export function makeEmptyJar(
  profile: SapConfig,
  systemType: string,
  profileName: string,
  keyMode: SessionKeyMode = 'unknown',
): SessionJar {
  const now = new Date().toISOString();
  return {
    formatVersion: FORMAT_VERSION,
    header: {
      createdAt: now,
      lastLoginAt: now,
      systemHash: computeSystemHash(profile),
      profileName,
      systemType,
      keyMode,
      reuseFailures: 0,
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
  FORMAT_VERSION,
} as const;
