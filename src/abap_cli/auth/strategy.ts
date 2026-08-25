/**
 * Runtime strategy interface + registry for auth methods.
 *
 * Each auth method (basic / cert / browser_sso / oauth_password / future) is a
 * standalone module that exports an `AuthStrategy` and self-registers it in
 * the global strategy registry. The public `buildAuth()` in `adapter.ts`
 * resolves the strategy from `sap.auth.method` and delegates.
 *
 * To add a new auth method:
 *   1. Add the method to `AuthMethodV2` in `v2-types.ts`.
 *   2. Create `strategies/<method>.ts` exporting a `registerStrategy({...})`.
 *   3. Add one import line in `registry-bootstrap.ts`.
 *
 * No other file needs to change — clients (`AdtClient`, `IcfClient`, probe,
 * `http-error.ts`) all consume the registry.
 */
import type { ClientOptions } from 'abap-adt-api';
import type { BearerFetcher } from 'abap-adt-api/build/AdtHTTP.js';
import type { SapConfig } from '../config/project-config.js';
import { CliError } from '../output/json.js';
import type { AuthConfig, AuthMethodV2 } from './v2-types.js';

/**
 * Bag of generic auth options collected from the CLI's `--auth-option key=value`
 * flag. Strategies that need additional fields (cert path, UAA URL, …) consume
 * them via `fromOptions()` instead of having a hard-coded Commander option.
 *
 * Adding a new auth method that needs N new CLI fields = 0 new Commander
 * options — users just supply `--auth-option foo=bar` and the strategy reads
 * `opts.bag.foo`.
 */
export interface AuthOptions {
  method: AuthMethodV2;
  bag: Record<string, string>;
}

/** ADTClient consumes these as `(password, options)`. */
export interface BuiltAuthParts {
  passwordOrFetcher: string | BearerFetcher;
  options: ClientOptions;
}

export interface AuthHints {
  nextSteps: string[];
  example: string;
}

export interface AuthStrategy {
  /** Method discriminator — must match one of the `AuthMethodV2` literals. */
  readonly method: AuthMethodV2;
  /**
   * Construct the per-method `AuthConfig` block from the `--auth-option` bag.
   * Strategies that need no extra config (e.g. `basic`) can omit this and
   * `resolveAuthFromOpts()` will default to `{ method }`.
   *
   * `base` is the existing `AuthConfig` for `profile set` (so partial edits
   * can inherit unset fields) or `{ method }` for `profile add` / `init`.
   */
  fromOptions?(opts: AuthOptions, base: AuthConfig): AuthConfig;
  /**
   * Build the login artefacts for this strategy.
   * Implementations should throw `CliError('AUTH_ERROR' | 'CONFIG_ERROR', ...)`
   * with `nextSteps` / `example` populated when the profile is unusable.
   */
  build(sap: SapConfig, systemName: string, auth: AuthConfig): Promise<BuiltAuthParts>;
  /**
   * "What now?" hints surfaced on auth failures (401/403). Owned by the
   * strategy so a new auth method's user-facing guidance ships with the
   * strategy itself — no edit to `http-error.ts` is needed. Optional —
   * strategies that want the generic basic-auth guidance can omit it and
   * `getAuthHints()` will fall back to `BASIC_HINTS`.
   */
  hints?: AuthHints;
}

const STRATEGIES = new Map<AuthMethodV2, AuthStrategy>();

/** Idempotent — re-registering the same method overwrites (used by tests). */
export function registerStrategy(strategy: AuthStrategy): void {
  STRATEGIES.set(strategy.method, strategy);
}

/** Resolve a strategy by method. Throws `CliError('CONFIG_ERROR')` if not registered. */
export function getStrategy(method: AuthMethodV2): AuthStrategy {
  const s = STRATEGIES.get(method);
  if (!s) {
    // All AuthMethodV2 literals MUST be registered at module-load time. This
    // throw catches a missing side-effect import (e.g. new method added to
    // v2-types.ts but strategy not imported into adapter.ts) AND runtime
    // input from `.abap.json` carrying an unknown method literal.
    throw new CliError('CONFIG_ERROR', `Unsupported auth method '${method}'`, {
      nextSteps: [`Run: abap profile set <profile> --auth-method basic`],
      example: `abap profile set <profile> --auth-method basic`,
    });
  }
  return s;
}

/**
 * Default hint for an auth method without a registered strategy (or for
 * the `basic` case). Mirrors the old `AUTH_NEXT_STEPS` / `AUTH_EXAMPLE`
 * constants in `http-error.ts` so behaviour is preserved.
 */
const BASIC_HINTS: AuthHints = {
  nextSteps: [
    "Verify credentials: 'abap profile test <name> --json'.",
    "If password expired: 'abap profile set <name> --password <new>'.",
  ],
  example: 'abap profile set <name> --password <new>',
};

/**
 * Resolve the user-facing error hints for a given auth method. Falls back to
 * `basic` hints when the method is unknown so callers never have to special-
 * case a missing strategy.
 */
export function getAuthHints(method: string | undefined): AuthHints {
  if (method && STRATEGIES.has(method as AuthMethodV2)) {
    return STRATEGIES.get(method as AuthMethodV2)!.hints ?? BASIC_HINTS;
  }
  return BASIC_HINTS;
}

/** Test/diagnostic helper — list currently registered methods. */
export function registeredMethods(): AuthMethodV2[] {
  return [...STRATEGIES.keys()];
}

/**
 * Parse `--auth-option key=value` (repeatable) into an `AuthOptions` bag.
 * Empty / missing values throw — commander collects the raw array of
 * strings, so the caller doesn't need to do any extra validation.
 */
export function authOptionsFromCli(opts: { authOption?: unknown }, method: AuthMethodV2): AuthOptions {
  const raw = Array.isArray(opts.authOption) ? opts.authOption : [];
  const bag: Record<string, string> = {};
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const eq = entry.indexOf('=');
    if (eq <= 0) {
      throw new CliError('INVALID_ARGUMENT',
        `--auth-option expects key=value (got '${entry}').`,
        { example: 'abap profile add <name> --auth-method cert --auth-option certPath=/abs/cert.pem --auth-option keyPath=/abs/key.pem' });
    }
    const k = entry.slice(0, eq).trim();
    const v = entry.slice(eq + 1);
    if (!k) continue;
    bag[k] = v;
  }
  return { method, bag };
}

/**
 * Fold legacy per-method CLI flags (`--cert-path`, `--service-key`, …) into
 * the `--auth-option` bag that strategies consume via `fromOptions`. Bag key
 * names are stable and must match each strategy's reader — a mismatch here
 * would silently leave the strategy reading `undefined`, so this mapping is
 * unit-tested.
 */
export function legacyFlagsToBag(opts: Record<string, string | boolean | string[]>): Record<string, string> {
  const bag: Record<string, string> = {};
  if (typeof opts.certPath === 'string') bag.certPath = opts.certPath;
  if (typeof opts.certKey === 'string') bag.keyPath = opts.certKey;
  if (typeof opts.certCa === 'string') bag.caPath = opts.certCa;
  if (typeof opts.ssoCookieFile === 'string') bag.cookieFile = opts.ssoCookieFile;
  if (typeof opts.serviceKey === 'string') bag.serviceKey = opts.serviceKey;
  return bag;
}

/**
 * Construct the canonical `AuthConfig` from CLI options + base profile, by
 * delegating to the registered strategy's `fromOptions()`. Strategies that
 * need no extra config (basic) get a default `{ method }`; strategies that
 * need fields (cert / sso / oauth_password) own their own field parsing —
 * no per-method if/else chain in the caller.
 *
 *   - For `profile add` / `init` / `init wizard`, pass `base = { method }`
 *     so the strategy only reads supplied bag keys.
 *   - For `profile set`, pass `base = profile.auth` so unset fields inherit.
 */
export function resolveAuthFromOptions(opts: AuthOptions, base: AuthConfig): AuthConfig {
  const s = STRATEGIES.get(opts.method);
  if (!s?.fromOptions) {
    // No fromOptions() — strategy takes no extra config beyond method.
    return { method: opts.method } as AuthConfig;
  }
  return s.fromOptions(opts, base);
}