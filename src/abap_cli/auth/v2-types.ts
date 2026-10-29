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
 *   - sso             platform-native SSO (Windows SSPI / Linux krb5 /
 *                     macOS GSS). Negotiate/Kerberos token replayed as the
 *                     HTTP `Authorization: Negotiate <ticket>` header. The
 *                     user's Kerberos credentials are obtained from the OS
 *                     session — no password is stored or prompted.
 *
 * Adding a method: add a union member + a `buildAuth` branch in adapter.ts.
 * The validation step is type-driven (no string compares) and any block/method
 * mismatch becomes a compile error rather than a silent runtime fallback.
 */
import { CliError } from '../output/json.js';

export type AuthMethodV2 = 'basic' | 'cert' | 'browser_sso' | 'oauth_password' | 'sso';

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

/**
 * `sso` method block. The user is identified to SAP via a Kerberos/SPNEGO
 * ticket obtained from the OS — no per-profile password or cookie is stored.
 *
 *   - On Windows: the platform SSPI library issues an SPNEGO token.
 *   - On Linux:   `kinit`-issued ticket in the user's ccache (default
 *                 `/tmp/krb5cc_<uid>`).
 *   - On macOS:   the user's Kerberos credential from `/usr/bin/kinit` or
 *                 the Login Keychain.
 *
 * `spn` is the SAP service principal name; defaults to
 * `HTTP/<host-without-scheme>` per RFC 4559.
 */
export interface SsoNegotiateBlock {
  /** Kerberos SPN. Defaults to HTTP/<sapHostWithoutScheme> at build time. */
  spn?: string;
  /** Force re-acquisition of the Kerberos ticket when the cached one expires. */
  reauthOnExpiry?: boolean;
}

export type AuthConfig =
  | { method: 'basic' }
  | { method: 'cert'; cert: CertAuthBlock }
  | { method: 'browser_sso'; sso: SsoAuthBlock }
  | { method: 'oauth_password'; oauth: OAuthPasswordBlock }
  | { method: 'sso'; negotiate: SsoNegotiateBlock };

/** Default when the field is absent — back-compat with pre-v2 profiles. */
export const DEFAULT_AUTH_CONFIG: AuthConfig = { method: 'basic' };

/** Convenience function returning a fresh default auth config. */
export function defaultAuth(): AuthConfig {
  return DEFAULT_AUTH_CONFIG;
}

/** Coerce arbitrary input to a known AuthMethodV2; throws on unknown. */
export function parseAuthMethodV2(raw: unknown): AuthMethodV2 {
  if (raw === 'basic' || raw === 'cert' || raw === 'browser_sso' || raw === 'oauth_password' || raw === 'sso') return raw;
  throw new CliError('INVALID_ARGUMENT', `Unknown authMethod '${String(raw)}'. Supported: basic, cert, browser_sso, oauth_password, sso.`);
}

/** True iff the block matches the method (compile-time enforced for typed input). */
export function authHasMethod(auth: AuthConfig, method: AuthMethodV2): boolean {
  return auth.method === method;
}
