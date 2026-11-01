/**
 * Session-key management — the symmetric 32-byte key that encrypts the
 * on-disk cookie jar. Prefers the OS keychain (`abap-cli/session-key`
 * account under the `abap-cli` service); falls back to a PBKDF2-derived
 * key when the keychain is unavailable so CI / Linux-without-dbus still
 * works (with a stderr WARN).
 *
 * The keychain entry is global (one key per OS user, not per profile) —
 * jars are bucketed by system hash on disk, not by key.
 *
 * `ABAP_CLI_SESSION_KEY_MODE=derived` forces the deterministic PBKDF2 key
 * without touching the OS keychain. It exists for hermetic tests/CI (a
 * durable key source that needs no keychain) and is reported as
 * `keyMode:'derived'` by `abap session info`.
 */

import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { SESSION_KEYCHAIN_ACCOUNT, getSessionKey, storeSessionKey, deleteSessionKey, isSecretStoreDurable } from '../config/secrets.js';
import { CliError } from '../output/json.js';
import type { SapConfig } from '../config/project-config.js';
import type { SessionKeyMode } from './jar.js';

const PBKDF2_ITER = 100_000;
const PBKDF2_SALT = 'abap-cli-session-fallback-v1';
const PBKDF2_KEYLEN = 32;
const KEY_BYTES = 32;

/** Force the deterministic derived key (hermetic tests/CI); no keychain I/O. */
export const SESSION_KEY_MODE_ENV = 'ABAP_CLI_SESSION_KEY_MODE';

/** True when the process was told to use the PBKDF2 key source. */
export function sessionKeyModeForced(): boolean {
  return process.env[SESSION_KEY_MODE_ENV]?.toLowerCase() === 'derived';
}

let _keychainAvailable: boolean | null = null;

/** Reset the cached availability flag (used by tests). */
export function resetKeychainCache(): void {
  _keychainAvailable = null;
}

/**
 * Probe keychain with a one-shot `getPassword` against a non-existent
 * account. The keychain is "available" when the call returns `null` (no
 * entry — that's fine, keychain is reachable) instead of throwing
 * (keychain locked, libsecret missing, etc.).
 */
export async function detectKeychainAvailable(): Promise<boolean> {
  if (_keychainAvailable !== null) return _keychainAvailable;
  try {
    const probe = await getSessionKey();
    // A null return means: keychain reachable, no entry yet. A throw means
    // the keychain backend is not usable.
    _keychainAvailable = probe === null || typeof probe === 'string';
  } catch (error: unknown) {
    // Only treat as "unavailable" if the error looks like a real keychain
    // failure. Cfg errors / CliError unrelated to keychain access are
    // re-thrown so we don't silently fall back.
    if (error instanceof CliError && error.code === 'CONFIG_ERROR') {
      _keychainAvailable = false;
    } else {
      throw error;
    }
  }
  return _keychainAvailable;
}

/** PBKDF2 reference vector helper — deterministic per profile. */
export function deriveSessionKey(profile: SapConfig): Buffer {
  const input = `${profile.url}|${profile.username}|${profile.client}`;
  return pbkdf2Sync(input, PBKDF2_SALT, PBKDF2_ITER, PBKDF2_KEYLEN, 'sha256');
}

/** Base64 round-trip for the small set of callers that persist the key. */
export function sessionKeyFromBase64(b64: string): Buffer {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length !== KEY_BYTES) {
    throw new CliError('CONFIG_ERROR', `Decoded session key must be ${KEY_BYTES} bytes, got ${buf.length}.`);
  }
  return buf;
}

export function sessionKeyToBase64(key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new CliError('CONFIG_ERROR', `Session key must be ${KEY_BYTES} bytes, got ${key.length}.`);
  }
  return key.toString('base64');
}

export interface SessionKeyLoadResult {
  key: Buffer;
  /**
   * `ephemeral`: the active secret store does not persist the key across
   * processes (test/CI backends), so cookie-jar reuse is disabled.
   */
  mode: Extract<SessionKeyMode, 'keychain' | 'derived'> | 'ephemeral';
}

export interface SessionKeyPeek {
  mode: Exclude<SessionKeyMode, 'unknown'> | 'missing' | 'ephemeral';
  key?: Buffer;
}

/**
 * Read the key source without creating or writing anything — used by the
 * read-only `abap session info` diagnostic. A keychain that is reachable but
 * has no entry yet reports `missing`; session operations would create one.
 */
export async function peekSessionKey(profile: SapConfig): Promise<SessionKeyPeek> {
  if (sessionKeyModeForced()) return { mode: 'derived', key: deriveSessionKey(profile) };
  if (!(await isSecretStoreDurable())) return { mode: 'ephemeral' };
  const available = await detectKeychainAvailable();
  if (!available) return { mode: 'derived', key: deriveSessionKey(profile) };
  const existing = await getSessionKey();
  if (!existing) return { mode: 'missing' };
  try {
    return { mode: 'keychain', key: sessionKeyFromBase64(existing) };
  } catch {
    return { mode: 'missing' };
  }
}

let _warnedAboutKeychain = false;

/**
 * Resolve the encryption key for the session jar.
 *
 * Order:
 *   0. `ABAP_CLI_SESSION_KEY_MODE=derived` → deterministic derived key.
 *   1. If the secret store is not durable (test/CI backends), return a
 *      derived key in `ephemeral` mode — the jar could never be decrypted by
 *      the next process, so callers disable reuse and log the session out.
 *   2. If keychain is available and an entry exists, use it.
 *   3. If keychain is available but no entry, generate a fresh 32-byte
 *      random key and store it.
 *   4. If keychain is unavailable, fall back to a PBKDF2-derived key
 *      (deterministic per profile) and emit a one-shot stderr WARN so
 *      the user knows their jar is not as strongly protected.
 */
export async function loadOrCreateSessionKey(profile: SapConfig): Promise<SessionKeyLoadResult> {
  if (sessionKeyModeForced()) {
    return { key: deriveSessionKey(profile), mode: 'derived' };
  }
  if (!(await isSecretStoreDurable())) {
    return { key: deriveSessionKey(profile), mode: 'ephemeral' };
  }
  const available = await detectKeychainAvailable();
  if (!available) {
    if (!_warnedAboutKeychain) {
      process.stderr.write(
        `WARN session jar: keychain unavailable, using derived key (PBKDF2). Add an OS keychain entry ` +
          `("${SESSION_KEYCHAIN_ACCOUNT}") to harden session storage.\n`,
      );
      _warnedAboutKeychain = true;
    }
    return { key: deriveSessionKey(profile), mode: 'derived' };
  }
  const existing = await getSessionKey();
  if (existing) {
    try {
      return { key: sessionKeyFromBase64(existing), mode: 'keychain' };
    } catch (error: unknown) {
      // Corrupt keychain entry: rotate by writing a fresh one.
      const fresh = randomBytes(KEY_BYTES);
      await storeSessionKey(sessionKeyToBase64(fresh));
      if (error instanceof CliError) throw error;
      throw new CliError('CONFIG_ERROR', `Existing session key in keychain was malformed; rotated.`);
    }
  }
  const fresh = randomBytes(KEY_BYTES);
  await storeSessionKey(sessionKeyToBase64(fresh));
  return { key: fresh, mode: 'keychain' };
}

/** Remove the keychain entry. Derived-key mode is a no-op. */
export async function wipeSessionKey(): Promise<void> {
  if (_keychainAvailable === false) return;
  try {
    await deleteSessionKey();
  } catch (error: unknown) {
    if (error instanceof CliError && error.code === 'CONFIG_ERROR') return;
    throw error;
  }
}

/** Test-only: force-set the one-shot warn guard. */
export function _setWarnedAboutKeychain(value: boolean): void {
  _warnedAboutKeychain = value;
}

/** Test-only: read the one-shot warn guard. */
export function _hasWarnedAboutKeychain(): boolean {
  return _warnedAboutKeychain;
}
