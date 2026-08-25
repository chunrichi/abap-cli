/**
 * Secrets storage — OS keychain via keytar, wrapped behind a small
 * `SecretsBackend` interface so additional backends can be added later
 * (e.g. 1Password CLI, HashiCorp Vault, encrypted-file) without touching
 * callers.
 *
 * Public API (the six exports below) is unchanged from pre-F refactor — all
 * callers (`flows/profile-flow.ts`, `flows/init-flow.ts`, `clients/probe.ts`,
 * `adc/runtime-probe.ts`, `auth/strategies/cert.ts`, `auth/strategies/oauth-password.ts`)
 * keep their imports. Adding a new backend requires:
 *   1. Implement `SecretsBackend` in `secrets/backends/<name>.ts`.
 *   2. Use it in the six functions below.
 *
 * No other file needs to change.
 */
import keytar from 'keytar';
import { CliError } from '../output/json.js';

const SERVICE = 'abap-cli';

/** Account suffix for X.509 cert passphrase (kept off the main keychain entry). */
const CERT_PASSPHRASE_SUFFIX = '.cert-passphrase';

/** Per-account credentials the CLI cares about (kept in sync with keychain account names). */
export type SecretKind = 'password' | 'cert-passphrase';

/**
 * Minimal credential-store contract. Implementations must NOT throw on
 * "missing entry" — return `null` from `get` and `false` from `delete`.
 * Other errors (keychain locked, FS permission denied, vault unreachable)
 * should throw `CliError('CONFIG_ERROR', ...)`.
 */
export interface SecretsBackend {
  readonly name: string;
  get(account: string, kind: SecretKind): Promise<string | null>;
  set(account: string, kind: SecretKind, value: string): Promise<void>;
  delete(account: string, kind: SecretKind): Promise<boolean>;
}

/**
 * keytar-backed implementation. Translates keytar exceptions into CliError
 * so the legacy `keychainError()` behaviour is preserved (callers catch on
 * `code === 'CONFIG_ERROR'`).
 */
const keytarBackend: SecretsBackend = {
  name: 'keytar',
  async get(account, kind) {
    try {
      return await keytar.getPassword(SERVICE, accountKey(account, kind));
    } catch (error: unknown) {
      throw keychainError('read', error);
    }
  },
  async set(account, kind, value) {
    try {
      await keytar.setPassword(SERVICE, accountKey(account, kind), value);
    } catch (error: unknown) {
      throw keychainError('store', error);
    }
  },
  async delete(account, kind) {
    try {
      return await keytar.deletePassword(SERVICE, accountKey(account, kind));
    } catch (error: unknown) {
      throw keychainError('delete', error);
    }
  },
};

function accountKey(account: string, kind: SecretKind): string {
  return kind === 'cert-passphrase' ? `${account}${CERT_PASSPHRASE_SUFFIX}` : account;
}

/* ─────────── Public API (unchanged signatures) ─────────── */

export async function storePassword(account: string, password: string): Promise<void> {
  await keytarBackend.set(account, 'password', password);
}

export async function getPassword(account: string): Promise<string | null> {
  return keytarBackend.get(account, 'password');
}

export async function deletePassword(account: string): Promise<boolean> {
  return keytarBackend.delete(account, 'password');
}

export async function storeCertPassphrase(account: string, passphrase: string): Promise<void> {
  await keytarBackend.set(account, 'cert-passphrase', passphrase);
}

export async function getCertPassphrase(account: string): Promise<string | null> {
  return keytarBackend.get(account, 'cert-passphrase');
}

export async function deleteCertPassphrase(account: string): Promise<boolean> {
  return keytarBackend.delete(account, 'cert-passphrase');
}

function keychainError(op: string, error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  throw new CliError('CONFIG_ERROR', `Cannot ${op} password in OS keychain: ${message}`);
}