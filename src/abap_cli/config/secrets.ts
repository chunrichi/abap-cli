/**
 * Secrets storage — backend dispatcher.
 *
 * Resolves the platform-appropriate `SecretsBackend` on first use:
 *   1. `ABAP_CLI_KEYCHAIN_BACKEND` env var (`native` | `keytar` | `none` |
 *      `fixture`) forces a specific backend. `keytar` requires the optional
 *      dependency; `none` disables keychain access entirely; `fixture` is a
 *      read-only test backend (`ABAP_CLI_KEYCHAIN_FIXTURE_PASSWORD`) that
 *      never touches the OS — use it in CI/E2E so no prompt can block tests.
 *   2. Default: native OS keychain (`cmdkey` / `security` / `secret-tool`).
 *
 * The native backend uses the same `SERVICE` / account-key conventions as
 * the legacy `keytar` backend so credentials persist across upgrades and
 * platforms (macOS users migrating from Windows keep their password visible).
 *
 * Public API is re-exported for:
 *   - `flows/setup/profile.ts`, `flows/setup/init.ts`
 *   - `clients/probe.ts`, `adc/runtime-probe.ts`
 *   - `session/key.ts`, `session/jar.ts`
 * Adding a new backend only requires dropping a file under `secrets/` and
 * adding it to the resolver below.
 */
import { CliError } from '../output/json.js';
import { createNativeBackend } from './secrets/native.js';
import { createKeytarBackend, tryCreateKeytarBackend } from './secrets/keytar.js';
import type { SecretsBackend, SecretKind } from './secrets-types.js';

const SERVICE = 'abap-cli';

/** Account name for the global session-jar encryption key. */
export const SESSION_KEYCHAIN_ACCOUNT = 'abap-cli/session-key';

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
 *   - `ABAP_CLI_KEYCHAIN_BACKEND=none` → disabled backend (no keychain prompts)
 *   - `ABAP_CLI_KEYCHAIN_BACKEND=fixture` → test backend (fixed password, no OS access)
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
/** Explicitly disabled backend — CI/tests only; never touches the OS keychain. */
function createDisabledBackend(): SecretsBackend {
  return {
    name: 'disabled',
    async get() {
      return null;
    },
    async set() {
      throw new CliError(
        'CONFIG_ERROR',
        'Keychain disabled (ABAP_CLI_KEYCHAIN_BACKEND=none): refusing to store credentials.',
      );
    },
    async delete() {
      return false;
    },
    async isAvailable() {
      return false;
    },
  };
}

/** Test/CI backend: fixed password from env + in-memory storage; never touches the OS. */
function createFixtureBackend(): SecretsBackend {
  const value = process.env.ABAP_CLI_KEYCHAIN_FIXTURE_PASSWORD ?? '';
  const memory = new Map<string, string>();
  return {
    name: 'fixture',
    async get(account, kind) {
      if (kind === 'password') return memory.get(account) ?? (value || null);
      return memory.get(`${account}:${kind}`) ?? null;
    },
    async set(account, kind, secret) {
      memory.set(kind === 'password' ? account : `${account}:${kind}`, secret);
    },
    async delete(account, kind) {
      return memory.delete(kind === 'password' ? account : `${account}:${kind}`);
    },
    async isAvailable() {
      return true;
    },
  };
}

export async function resolveBackend(): Promise<SecretsBackend> {
  if (cachedBackend) return cachedBackend;

  const choice = process.env.ABAP_CLI_KEYCHAIN_BACKEND?.toLowerCase();
  if (choice === 'fixture') {
    cachedBackend = createFixtureBackend();
    return cachedBackend;
  }
  if (choice === 'none' || choice === 'disabled') {
    cachedBackend = createDisabledBackend();
    return cachedBackend;
  }
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
