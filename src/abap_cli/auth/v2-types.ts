/**
 * Canonical auth shape for SystemProfile. Discriminated union so that the
 * `method` field and the per-method block can never disagree (replaces the
 * `authMethod` + optional `certAuth`/`oauthPassword` flat shape that caused
 * silent-broken profiles when blocks drifted from the discriminator).
 *
 *   - basic           no extra config — username + password from profile
 *   - cert            X.509 client cert (PEM files, optional passphrase)
 *   - browser_sso     captured SSO cookies (file path optional, defaults to
 *                     `~/.abap-cli/<profile>.sso.cookies.json`)
 *   - oauth_password  BTP OAuth2 password grant — service-key clientid/secret +
 *                     UAA token endpoint, user password resolved at runtime
 *
 * Adding a method: add a union member + a `buildAuth` branch in adapter.ts.
 * The validation step is type-driven (no string compares) and any block/method
 * mismatch becomes a compile error rather than a silent runtime fallback.
 */
import { CliError } from '../output/json.js';

export type AuthMethodV2 = 'basic' | 'cert' | 'browser_sso' | 'oauth_password';

export interface CertAuthBlock {
  certPath: string;
  keyPath: string;
  /** Optional X.509 CA override — falls back to the profile-level caPath. */
  caPath?: string;
}

export interface SsoAuthBlock {
  /** Optional cookie-jar path; defaults to ~/.abap-cli/<profile>.sso.cookies.json. */
  cookieFile?: string;
}

export interface OAuthPasswordBlock {
  /** BTP UAA token endpoint, e.g. https://<sub>.authentication.<region>.hana.ondemand.com */
  uaaUrl: string;
  /** Service-key OAuth clientid (not the user's SAP ID). */
  clientId: string;
  /** Service-key OAuth clientsecret. Persisted in systems.json (mode 0600). */
  clientSecret: string;
  /** Optional override — defaults to the path the service key was loaded from. */
  serviceKeyFile?: string;
}

export type AuthConfig =
  | { method: 'basic' }
  | { method: 'cert'; cert: CertAuthBlock }
  | { method: 'browser_sso'; sso: SsoAuthBlock }
  | { method: 'oauth_password'; oauth: OAuthPasswordBlock };

/** Default when the field is absent — back-compat with pre-v2 profiles. */
export const DEFAULT_AUTH_CONFIG: AuthConfig = { method: 'basic' };

/** Convenience function returning a fresh default auth config. */
export function defaultAuth(): AuthConfig {
  return DEFAULT_AUTH_CONFIG;
}

/** Coerce arbitrary input to a known AuthMethodV2; throws on unknown. */
export function parseAuthMethodV2(raw: unknown): AuthMethodV2 {
  if (raw === 'basic' || raw === 'cert' || raw === 'browser_sso' || raw === 'oauth_password') return raw;
  throw new CliError('INVALID_ARGUMENT', `Unknown authMethod '${String(raw)}'. Supported: basic, cert, browser_sso, oauth_password.`);
}

/** True iff the block matches the method (compile-time enforced for typed input). */
export function authHasMethod(auth: AuthConfig, method: AuthMethodV2): boolean {
  return auth.method === method;
}
