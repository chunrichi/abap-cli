/**
 * Secrets storage — backend dispatcher.
 *
 * Resolves the platform-appropriate `SecretsBackend` on first use:
 *   1. `ABAP_CLI_KEYCHAIN_BACKEND` env var (`native` | `keytar`) forces a
 *      specific backend. `keytar` requires the optional dependency.
 *   2. Default: native OS keychain (`cmdkey` / `security` / `secret-tool`).
 *
 * The native backend uses the same `SERVICE` / account-key conventions as
 * the legacy `keytar` backend so credentials persist across upgrades and
 * platforms (macOS users migrating from Windows keep their password visible).
 *
 * Public API (the seven exports below) is unchanged from the pre-F refactor:
 *   - `flows/setup/profile.ts`, `flows/setup/init.ts`
 *   - `clients/probe.ts`, `adc/runtime-probe.ts`
 *   - `auth/strategies/cert.ts`, `auth/strategies/oauth-password.ts`
 *   - `session/key.ts`, `session/jar.ts`
 * keep their imports. Adding a new backend only requires dropping a file
 * under `secrets/` and adding it to the resolver below.
 */
import { CliError } from '../output/json.js';
import { createNativeBackend } from './secrets/native.js';
import { createKeytarBackend, tryCreateKeytarBackend } from './secrets/keytar.js';
import type { SecretsBackend } from './secrets-types.js';

const SERVICE = 'abap-cli';

/** Account suffix for X.509 cert passphrase (kept off the main keychain entry). */
export const CERT_PASSPHRASE_SUFFIX = '.cert-passphrase';

/** Account name for the global session-jar encryption key. */
export const SESSION_KEYCHAIN_ACCOUNT = 'abap-cli/session-key';

/** Per-account credentials the CLI cares about. */
export type SecretKind = 'password' | 'cert-passphrase' | 'session-key';

/* Re-export so existing call sites keep `import { SecretsBackend } from '../secrets.js'` */
export type { SecretsBackend };

/* ─────────── Backend resolution ─────────── */

let cachedBackend: SecretsBackend | undefined;

/**
 * Resolve the active secrets backend. Memoised for the process lifetime so
 * `doctor` / `profile test` don't pay the keychain probe cost repeatedly.
 *
 * Selection rules:
 *   - `ABAP_CLI_KEYCHAIN_BACKEND=keytar` → keytar (throws if absent)
 *   - `ABAP_CLI_KEYCHAIN_BACKEND=native` → native (throws if unsupported)
 *   - Otherwise: keytar if installed (legacy compatibility — preserves
 *     entries written by previous `keytar`-only versions of abap-cli).
 *     Falls back to native when keytar is unavailable.
 *
 * Why keytar-first by default: keytar uses the macOS Keychain Services API
 * directly (not the `security` CLI), so it can read entries that previous
 * `keytar`-only versions wrote — those entries are not always visible to
 * `security find-generic-password`. Once a project is on a fresh install,
 * users can opt in to native via `ABAP_CLI_KEYCHAIN_BACKEND=native`.
 */
export async function resolveBackend(): Promise<SecretsBackend> {
  if (cachedBackend) return cachedBackend;

  const choice = process.env.ABAP_CLI_KEYCHAIN_BACKEND?.toLowerCase();
  if (choice === 'keytar') {
    cachedBackend = createKeytarBackend();
    return cachedBackend;
  }
  if (choice === 'native') {
    cachedBackend = createNativeBackend();
    return cachedBackend;
  }

  // Default: prefer keytar if it's installed (legacy compatibility).
  const keytar = tryCreateKeytarBackend();
  if (keytar) {
    cachedBackend = keytar;
    return cachedBackend;
  }

  // No keytar — fall back to native.
  try {
    const native = createNativeBackend();
    if (await native.isAvailable()) {
      cachedBackend = native;
      return cachedBackend;
    }
  } catch {
    // Unsupported platform — fall through to the error below.
  }

  throw new CliError('CONFIG_ERROR',
    'No keychain backend available. Install libsecret-tools (Linux) or set ABAP_CLI_KEYCHAIN_BACKEND=keytar with the keytar dependency installed.');
}

/** Test-only: forget the cached backend. */
export function _resetBackendForTesting(): void {
  cachedBackend = undefined;
}

/* ─────────── Public API ─────────── */

function accountKey(account: string, kind: SecretKind): string {
  if (kind === 'cert-passphrase') return `${account}${CERT_PASSPHRASE_SUFFIX}`;
  if (kind === 'session-key') return SESSION_KEYCHAIN_ACCOUNT;
  return account;
}

export async function storePassword(account: string, password: string): Promise<void> {
  const backend = await resolveBackend();
  await backend.set(account, 'password', password);
}

export async function getPassword(account: string): Promise<string | null> {
  const backend = await resolveBackend();
  return backend.get(account, 'password');
}

export async function deletePassword(account: string): Promise<boolean> {
  const backend = await resolveBackend();
  return backend.delete(account, 'password');
}

export async function storeCertPassphrase(account: string, passphrase: string): Promise<void> {
  const backend = await resolveBackend();
  await backend.set(account, 'cert-passphrase', passphrase);
}

export async function getCertPassphrase(account: string): Promise<string | null> {
  const backend = await resolveBackend();
  return backend.get(account, 'cert-passphrase');
}

export async function deleteCertPassphrase(account: string): Promise<boolean> {
  const backend = await resolveBackend();
  return backend.delete(account, 'cert-passphrase');
}

/** Global 32-byte session-jar encryption key (shared across profiles). */
export async function getSessionKey(): Promise<string | null> {
  const backend = await resolveBackend();
  return backend.get(SESSION_KEYCHAIN_ACCOUNT, 'session-key');
}

export async function storeSessionKey(base64: string): Promise<void> {
  const backend = await resolveBackend();
  await backend.set(SESSION_KEYCHAIN_ACCOUNT, 'session-key', base64);
}

export async function deleteSessionKey(): Promise<boolean> {
  const backend = await resolveBackend();
  return backend.delete(SESSION_KEYCHAIN_ACCOUNT, 'session-key');
}
