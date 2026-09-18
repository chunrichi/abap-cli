/**
 * Legacy `keytar` backend — optional dependency that may be absent in the
 * npm tarball. Kept behind `ABAP_CLI_KEYCHAIN_BACKEND=keytar` for users who
 * already have keytar installed system-wide.
 *
 * If `keytar` cannot be `require()`d (not installed, native binding missing),
 * `createKeytarBackend()` throws `CONFIG_ERROR` so the dispatcher can fall
 * back to a clear error path.
 */
import { createRequire } from 'node:module';
import { CliError } from '../../output/json.js';
import type { SecretKind, SecretsBackend } from '../secrets-types.js';

const require = createRequire(import.meta.url);

const SERVICE = 'abap-cli';

interface KeytarModule {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

/** Lazy load keytar — returns null when the native binding is absent. */
function loadKeytar(): KeytarModule | null {
  try {
    // Resolve from the host module — keytar ships prebuilds for common
    // platforms but some Node 24+ combinations lack the binary.
    const mod = require('keytar') as KeytarModule;
    return mod;
  } catch {
    return null;
  }
}

function accountKey(account: string, kind: SecretKind): string {
  if (kind === 'cert-passphrase') return `${account}.cert-passphrase`;
  if (kind === 'session-key') return 'abap-cli/session-key';
  return account;
}

/**
 * Try to construct a keytar backend. Returns `null` (not throws) when the
 * module cannot be loaded so the dispatcher can present a single clear
 * "keychain unavailable" error to the user.
 */
export function tryCreateKeytarBackend(): SecretsBackend | null {
  const keytar = loadKeytar();
  if (!keytar) return null;
  return {
    name: 'keytar',
    async isAvailable() { return true; },
    async get(account, kind) {
      try {
        return await keytar.getPassword(SERVICE, accountKey(account, kind));
      } catch (error: unknown) {
        throw toConfigError('read', error);
      }
    },
    async set(account, kind, value) {
      try {
        await keytar.setPassword(SERVICE, accountKey(account, kind), value);
      } catch (error: unknown) {
        throw toConfigError('store', error);
      }
    },
    async delete(account, kind) {
      try {
        return await keytar.deletePassword(SERVICE, accountKey(account, kind));
      } catch (error: unknown) {
        throw toConfigError('delete', error);
      }
    },
  };
}

/**
 * Construct a keytar backend and throw `CONFIG_ERROR` when unavailable.
 * Use this when the caller has explicitly opted in to `keytar` (env var).
 */
export function createKeytarBackend(): SecretsBackend {
  const backend = tryCreateKeytarBackend();
  if (!backend) {
    throw new CliError('CONFIG_ERROR',
      "keytar backend requested (ABAP_CLI_KEYCHAIN_BACKEND=keytar) but 'keytar' is not installed. " +
      "Install it with `npm install keytar` or unset the env var to use the native OS keychain.");
  }
  return backend;
}

function toConfigError(op: string, error: unknown): CliError {
  const message = error instanceof Error ? error.message : String(error);
  return new CliError('CONFIG_ERROR', `Cannot ${op} password in keytar: ${message}`);
}
