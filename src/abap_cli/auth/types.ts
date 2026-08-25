/**
 * Connection / login strategy type. `'basic'` stays the default for back-compat
 * (omitting `authMethod` is equivalent to `'basic'`).
 *
 *   - `basic`           username + password → ADTClient password field
 *   - `cert`            X.509 client cert   → https.Agent injection (cert or pfx)
 *   - `browser_sso`     captured SSO cookies → Cookie header injection
 *   - `oauth_password`  CF OAuth2 password grant → Bearer JWT (no browser, no paste)
 *
 * Adding a method: extend the union + parseAuthMethod + assertValidProfile +
 * buildAuth in adapter.ts. SSO cookie file / cert passphrase handling already
 * covers the storage half.
 */
import { CliError } from '../output/json.js';

export type AuthMethod = 'basic' | 'cert' | 'browser_sso' | 'oauth_password';

/** X.509 client certificate bundle (PEM files). SAP maps cert subject → user. */
export interface CertAuthConfig {
  certPath: string;
  keyPath: string;
  caPath?: string;
}

/**
 * OAuth2 password-grant config (BTP ABAP Environment / CF trial). The
 * service-key bundle is stored in `~/.abap-cli/<profile>.service-key.json`
 * (mode 0o600) — only the URL + clientid/clientsecret + endpoints, never the
 * user password (which is prompted each time via `profile login`).
 */
export interface OAuthPasswordConfig {
  /** BTP subaccount UAA token endpoint, e.g. https://<sub>.authentication.<region>.hana.ondemand.com */
  uaaUrl: string;
  /** Service key OAuth clientid (not the user's SAP ID). */
  clientId: string;
  /** Service key OAuth clientsecret. */
  clientSecret: string;
  /** Optional override — defaults to `<HOME>/.abap-cli/<profile>.service-key.json`. */
  serviceKeyFile?: string;
}

/** All supported per-method configs. Future methods add new fields here. */
export interface AuthConfig {
  method: AuthMethod;
  cert?: CertAuthConfig;
  ssoCookieFile?: string;
  oauth?: OAuthPasswordConfig;
}

/** Default when `authMethod` is missing on a stored profile — keeps existing config files valid. */
export const DEFAULT_AUTH_METHOD: AuthMethod = 'basic';

/** Coerce arbitrary input (CLI / JSON / env) to a known AuthMethod; throws CliError on unknown. */
export function parseAuthMethod(raw: unknown): AuthMethod {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_AUTH_METHOD;
  if (raw === 'basic' || raw === 'cert' || raw === 'browser_sso' || raw === 'oauth_password') return raw;
  throw new CliError('INVALID_ARGUMENT', `Unknown authMethod '${String(raw)}'. Supported: basic, cert, browser_sso, oauth_password.`);
}

/** BTP service-key JSON shape we care about. Other fields are ignored. */
interface BtpServiceKeyShape {
  uaa?: { url?: string; clientid?: string; clientsecret?: string };
}

/**
 * Parse a BTP service-key JSON file and extract the OAuth clientid/secret/uaaUrl.
 * Shared between `abap profile add/set` and `abap init` so the file-shape
 * contract lives in one place.
 */
export function parseBtpServiceKey(raw: unknown): { uaaUrl: string; clientId: string; clientSecret: string } {
  const sk = raw as BtpServiceKeyShape;
  if (!sk?.uaa?.url || !sk.uaa.clientid || !sk.uaa.clientsecret) {
    throw new CliError('INVALID_ARGUMENT',
      'Service key missing uaa.url / uaa.clientid / uaa.clientsecret.',
      { example: 'Download the JSON-format service key (not the binding-secret format).' });
  }
  return { uaaUrl: sk.uaa.url, clientId: sk.uaa.clientid, clientSecret: sk.uaa.clientsecret };
}
