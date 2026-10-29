/**
 * Shared types for secrets backends. Lives in its own file to avoid circular
 * imports between `secrets.ts` (dispatcher) and `secrets/backends/*.ts`.
 */

/** Per-account credentials the CLI cares about (kept in sync with keychain account names). */
export type SecretKind = 'password' | 'cert-passphrase' | 'session-key';

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
  /**
   * Lightweight reachability probe. Implementations should NOT cache the
   * result — the dispatcher calls it on `doctor env.deps` and on first use.
   */
  isAvailable(): Promise<boolean>;
}
