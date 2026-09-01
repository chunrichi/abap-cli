/**
 * Profile auth-shape normalizer.
 *
 * Two shapes exist on disk — flat fields with optional blocks:
 *     ```
 *     {
 *       "authMethod": "cert",
 *       "certAuth": { "certPath": "...", "keyPath": "..." },
 *       "ssoCookieFile": "/path/to/cookies.json",
 *       "oauthPassword": { "uaaUrl": "...", ... }
 *     }
 *     ```
 *
 * and the canonical discriminated union under `auth`:
 *     ```
 *     {
 *       "auth": { "method": "cert", "cert": { "certPath": "...", ... } }
 *     }
 *     ```
 *
 * `normalizeAuth` accepts either shape and returns the canonical `AuthConfig`.
 * The inverse (`serializeAuth`) writes the canonical shape only.
 *
 * `normalizeAuth` is the only path that touches the flat shape on disk; the
 * rest of the code base can assume the canonical shape.
 */
import type { AuthConfig, AuthMethodV2, CertAuthBlock, OAuthPasswordBlock, SsoAuthBlock } from './v2-types.js';
import { DEFAULT_AUTH_CONFIG } from './v2-types.js';
import { CliError } from '../output/json.js';

/** Raw v1 fields as they may appear on a stored profile. */
export interface V1AuthFields {
  authMethod?: string;
  certAuth?: { certPath: string; keyPath: string; caPath?: string };
  ssoCookieFile?: string;
  oauthPassword?: { uaaUrl: string; clientId: string; clientSecret: string; serviceKeyFile?: string };
}

/** Raw v2 field as it may appear on a stored profile. */
export interface V2AuthFields {
  auth?: AuthConfig;
}

/** Convert any stored shape to canonical `AuthConfig`. Throws on contradictory input. */
export function normalizeAuth(raw: V1AuthFields & V2AuthFields): AuthConfig {
  const v2 = raw.auth;
  const v1Method = parseV1Method(raw.authMethod);

  // If both v1 and v2 are present they must agree — silent drift is worse than
  // an explicit failure that points the user at the migration step.
  if (v2 && v1Method && v2.method !== v1Method) {
    throw new CliError(
      'CONFIG_ERROR',
      `Profile has both v1 authMethod='${v1Method}' and v2 auth.method='${v2.method}'. They disagree — re-run 'abap profile set <name> --auth-method ${v2.method}' to overwrite.`,
      { example: `abap profile set <name> --auth-method ${v2.method}` },
    );
  }

  if (v2) {
    validateV2(v2);
    return v2;
  }

  return v1ToCanonical({ authMethod: v1Method, certAuth: raw.certAuth, ssoCookieFile: raw.ssoCookieFile, oauthPassword: raw.oauthPassword });
}

function parseV1Method(raw: string | undefined): AuthMethodV2 | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (raw === 'basic' || raw === 'cert' || raw === 'browser_sso' || raw === 'oauth_password') return raw;
  throw new CliError('INVALID_ARGUMENT', `Unknown authMethod '${raw}'. Supported: basic, cert, browser_sso, oauth_password.`);
}

function v1ToCanonical(v1: V1AuthFields & { authMethod: AuthMethodV2 | undefined }): AuthConfig {
  const method: AuthMethodV2 = v1.authMethod ?? 'basic';

  if (method === 'basic') {
    if (v1.certAuth || v1.ssoCookieFile || v1.oauthPassword) {
      throw new CliError(
        'CONFIG_ERROR',
        'Profile has basic authMethod but non-empty cert/sso/oauth block. Re-run "abap profile set <name> --auth-method <type>" with the correct method, or remove the block.',
      );
    }
    return { method: 'basic' };
  }

  if (method === 'cert') {
    if (!v1.certAuth) {
      throw new CliError('CONFIG_ERROR', 'authMethod=cert requires certAuth (certPath + keyPath).', {
        example: 'abap profile set <name> --auth-method cert --cert-path /abs/cert.pem --cert-key /abs/key.pem',
      });
    }
    if (!v1.certAuth.certPath || !v1.certAuth.keyPath) {
      throw new CliError('INVALID_ARGUMENT', 'certAuth requires both certPath and keyPath.');
    }
    const cert: CertAuthBlock = {
      certPath: v1.certAuth.certPath,
      keyPath: v1.certAuth.keyPath,
      ...(v1.certAuth.caPath ? { caPath: v1.certAuth.caPath } : {}),
    };
    return { method: 'cert', cert };
  }

  if (method === 'browser_sso') {
    const sso: SsoAuthBlock = v1.ssoCookieFile ? { cookieFile: v1.ssoCookieFile } : {};
    return { method: 'browser_sso', sso };
  }

  if (method === 'oauth_password') {
    if (!v1.oauthPassword) {
      throw new CliError('CONFIG_ERROR', 'authMethod=oauth_password requires oauthPassword (uaaUrl + clientId + clientSecret).', {
        example: 'abap profile set <name> --auth-method oauth_password --service-key ~/Downloads/default_key.json',
      });
    }
    const oauth: OAuthPasswordBlock = {
      uaaUrl: v1.oauthPassword.uaaUrl,
      clientId: v1.oauthPassword.clientId,
      clientSecret: v1.oauthPassword.clientSecret,
      ...(v1.oauthPassword.serviceKeyFile ? { serviceKeyFile: v1.oauthPassword.serviceKeyFile } : {}),
    };
    return { method: 'oauth_password', oauth };
  }

  throw new CliError('INVALID_ARGUMENT', `Unknown authMethod '${method}'.`);
}

/** Type-level validation for a v2 AuthConfig; throws on missing required fields. */
function validateV2(auth: AuthConfig): void {
  if (auth.method === 'cert') {
    if (!auth.cert.certPath || !auth.cert.keyPath) {
      throw new CliError('INVALID_ARGUMENT', 'auth.cert requires both certPath and keyPath.');
    }
  } else if (auth.method === 'oauth_password') {
    if (!auth.oauth.uaaUrl || !auth.oauth.clientId || !auth.oauth.clientSecret) {
      throw new CliError('INVALID_ARGUMENT', 'auth.oauth requires uaaUrl, clientId, and clientSecret.');
    }
  }
  // browser_sso: cookieFile is optional (defaults to ~/.abap-cli/<profile>.sso.cookies.json)
}

/** Resolve the canonical auth from a fully-normalized profile (read-side). */
export function getCanonicalAuth(profile: { auth?: AuthConfig } & V1AuthFields): AuthConfig {
  return normalizeAuth(profile);
}

/** Default `auth` for new profiles that don't specify one. */
export function defaultAuth(): AuthConfig {
  return DEFAULT_AUTH_CONFIG;
}

/** Convert canonical `AuthConfig` back to v1 fields for the legacy export shape. */
export function canonicalToV1Fields(auth: AuthConfig): V1AuthFields {
  switch (auth.method) {
    case 'basic':
      return { authMethod: 'basic' };
    case 'cert':
      return { authMethod: 'cert', certAuth: { ...auth.cert } };
    case 'browser_sso':
      return { authMethod: 'browser_sso', ...(auth.sso.cookieFile ? { ssoCookieFile: auth.sso.cookieFile } : {}) };
    case 'oauth_password':
      return { authMethod: 'oauth_password', oauthPassword: { ...auth.oauth } };
  }
}
