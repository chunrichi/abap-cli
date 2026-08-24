import * as fs from 'fs';
import https from 'https';
import { createSSLConfig, type ClientOptions } from 'abap-adt-api';
import type { BearerFetcher } from 'abap-adt-api/build/AdtHTTP.js';
import { readCaCertificate } from '../config/project-config.js';
import type { SapConfig } from '../config/project-config.js';
import { getCertPassphrase, getPassword, storePassword } from '../config/secrets.js';
import { CliError } from '../output/json.js';
import { buildCookieHeader, defaultCookieFile, readCookieStore } from './sso-cookie.js';
import type { AuthConfig, AuthMethodV2 } from './v2-types.js';

/**
 * In-memory JWT cache for `oauth_password` profiles. Keyed by system name.
 * Tokens are kept until ~5 minutes before expiry, then refreshed on next
 * ADT call. The cache lives only inside a single CLI invocation; every new
 * `abap` command re-reads the service key + acquires a fresh token (using the
 * password from the user's environment or interactive prompt).
 */
interface CachedToken {
  token: string;
  expiresAt: number;
  refreshPromise?: Promise<string>;
}
const tokenCache = new Map<string, CachedToken>();

/** Refresh-window margin: refresh this many seconds before actual expiry. */
const TOKEN_REFRESH_WINDOW_S = 300;

export interface BuiltAuth {
  /**
   * Password value to pass to `new ADTClient(url, user, passwordOrFetcher, …)`.
   * For `basic` / `cert` / `browser_sso` this is a literal string; for
   * `oauth_password` this is a `BearerFetcher` async function that returns
   * a user-scoped JWT (refreshed automatically within the process lifetime).
   */
  passwordOrFetcher: string | BearerFetcher;
  /** Extra `ClientOptions` (httpsAgent / headers) merged into ADTClient. */
  options: ClientOptions;
  /** Short machine-readable label for logs / doctor reports. */
  label: string;
}

/**
 * Build login artefacts for an `ADTClient` based on the chosen auth strategy.
 *
 * For `basic`: returns the existing password + standard SSL config (no behavioral
 * change vs the pre-025 code path).
 * For `cert`:   loads the X.509 cert + key from disk, wraps them in an `https.Agent`
 *               that ADTClient will use for every request, and stubs the password
 *               with the SAP-conventional `"x509-cert-auth"` placeholder.
 *
 * Errors here are deliberate: an unusable cert must NOT silently fall back to
 * basic auth, because that would send the user's stored password to a server
 * they meant to authenticate to with a certificate.
 */
export async function buildAuth(sap: SapConfig, systemName: string): Promise<BuiltAuth> {
  const ssl: ClientOptions = createSSLConfig(sap.insecure, readCaCertificate(sap.caPath));
  const auth: AuthConfig = sap.auth;

  if (auth.method === 'basic') {
    return { passwordOrFetcher: sap.password, options: ssl, label: 'basic' };
  }

  if (auth.method === 'cert') {
    return { passwordOrFetcher: 'x509-cert-auth', options: { ...ssl, httpsAgent: await buildCertAgent(sap, systemName, auth.cert) }, label: 'cert' };
  }

  if (auth.method === 'browser_sso') {
    const cookieFile = auth.sso.cookieFile || defaultCookieFile(systemName);
    // Distinguish "file missing" from "file present but expired" so the error
    // message guides the user to the right fix.
    if (!fs.existsSync(cookieFile)) {
      throw new CliError('AUTH_ERROR',
        `No SSO cookie file for '${systemName}' at '${cookieFile}'. Run: abap profile login ${systemName}`,
        {
          nextSteps: [`abap profile login ${systemName}`],
          example: `abap profile login ${systemName}`,
        });
    }
    const store = readCookieStore(cookieFile);
    if (!store) {
      throw new CliError('AUTH_ERROR',
        `SSO cookies for '${systemName}' are missing or expired (TTL 30 min). Run: abap profile login ${systemName}`,
        {
          nextSteps: [`abap profile login ${systemName}`],
          example: `abap profile login ${systemName}`,
        });
    }
    return {
      // SAP accepts a sentinel password string for SSO; the auth actually flows via Cookie header.
      passwordOrFetcher: 'browser-sso',
      options: { ...ssl, headers: { ...ssl.headers, Cookie: buildCookieHeader(store.cookies) } },
      label: 'browser_sso',
    };
  }

  if (auth.method === 'oauth_password') {
    const fetcher = buildOAuthPasswordFetcher(systemName, auth.oauth, sap.username);
    return {
      passwordOrFetcher: fetcher,
      options: ssl,
      label: 'oauth_password',
    };
  }

  // Exhaustive — TS narrows `auth` to `never` here. Defensive fallback only.
  const _exhaustive: never = auth;
  throw new CliError('CONFIG_ERROR', `Unsupported auth method '${(_exhaustive as AuthMethodV2) ?? 'unknown'}'`, {
    nextSteps: [`Run: abap profile set ${systemName} --auth-method basic`],
    example: `abap profile set ${systemName} --auth-method basic`,
  });
}

/**
 * Read the user password for OAuth password grant. Lookup order:
 *   1. OS keychain via getPassword(systemName)        (default — set by wizard)
 *   2. process.env.BTP_PASSWORD_<systemName>           (per-profile CI override)
 *   3. process.env.BTP_PASSWORD                         (generic CI fallback)
 *   4. Interactive @clack/prompts prompt (TTY only — silently skipped if non-TTY)
 * The keychain-first order mirrors the `basic` auth lookup (`SAP_PASSWORD` →
 * keychain) so the CLI behaves the same way for every profile — the env vars
 * remain a CI/agent override for runners that don't have access to the user's
 * keychain (containers, remote shells, headless agents).
 */
async function readPasswordFromEnv(systemName: string): Promise<string> {
  const stored = await getPassword(systemName);
  if (stored) return stored;
  const perProfile = process.env[`BTP_PASSWORD_${systemName.toUpperCase()}`];
  if (perProfile) return perProfile;
  const generic = process.env.BTP_PASSWORD;
  if (generic) return generic;
  if (process.stdin.isTTY) {
    const { password } = await import('@clack/prompts');
    const entered = await password({
      message: `BTP password for '${systemName}' (OAuth password grant; write to keychain so future calls don't ask again)`,
    });
    if (typeof entered === 'string' && entered.length > 0) {
      await storePassword(systemName, entered);
      return entered;
    }
  }
  throw new CliError(
    'AUTH_ERROR',
    `Missing BTP password for OAuth token grant (profile '${systemName}').`,
    {
      nextSteps: [
        `Store once via init: abap init --profile ${systemName} (wizard prompts and stores in OS keychain).`,
        `Or store explicitly: abap profile set ${systemName} --password <your SAP ID password> (writes to keychain, never to disk).`,
        `Or, for headless agents without a TTY: export BTP_PASSWORD_${systemName.toUpperCase()}='<your SAP ID password>'`,
        `Or generic: export BTP_PASSWORD='<your SAP ID password>'`,
      ],
      example: `abap profile set ${systemName} --password <your SAP ID password>  # then abap profile test ${systemName} --json`,
    },
  );
}

/**
 * Acquire a fresh access token from the BTP subaccount UAA via OAuth2
 * password grant. Service key credentials (clientid + clientsecret) are read
 * from `cfg`; the user's SAP ID password comes from `process.env.BTP_PASSWORD*`
 * (never persisted).
 *
 * The token endpoint is derived from `cfg.uaaUrl` (typically the per-tenant
 * `<subaccount>.authentication.<region>.hana.ondemand.com`).
 */
async function fetchOAuthPasswordToken(
  systemName: string,
  cfg: { uaaUrl: string; clientId: string; clientSecret: string },
  username: string,
  password: string,
): Promise<{ token: string; expiresAt: number }> {
  // Build token URL: <uaaUrl>/oauth/token. uaaUrl may end with / or not.
  const tokenUrl = `${cfg.uaaUrl.replace(/\/+$/, '')}/oauth/token`;
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
      username,
      password,
    },
  );
  let resp: Response;
  try {
    resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new CliError('AUTH_ERROR', `OAuth token request failed for '${systemName}': ${msg}`, {
      nextSteps: [`Check the network reachability of '${cfg.uaaUrl}'.`],
    });
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new CliError('AUTH_ERROR',
      `OAuth token grant failed for '${systemName}': HTTP ${resp.status} — ${text.slice(0, 200)}`,
      {
        nextSteps: [
          `Verify BTP_USERNAME (or the username in your service key) is correct.`,
          `Verify BTP_PASSWORD is current.`,
          `Check that the service key matches the trial instance.`,
        ],
      });
  }
  const json = await resp.json() as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new CliError('AUTH_ERROR',
      `OAuth token response for '${systemName}' did not contain access_token: ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  // expires_in is in seconds; subtract safety margin to avoid races.
  const expiresAt = Date.now() + (json.expires_in ?? 3600) * 1000 - TOKEN_REFRESH_WINDOW_S * 1000;
  return { token: json.access_token, expiresAt };
}

/**
 * Build the ADTClient `BearerFetcher` callback. The adapter library calls this
 * before every ADT request, so we cache aggressively and refresh only when
 * the cached token is within the refresh window or expired.
 */
function buildOAuthPasswordFetcher(
  systemName: string,
  cfg: { uaaUrl: string; clientId: string; clientSecret: string },
  username: string,
): BearerFetcher {
  return async () => {
    const cached = tokenCache.get(systemName);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.token;

    // Coalesce concurrent refreshes — if many parallel calls hit a stale
    // token, only one of the request network request.
    if (cached?.refreshPromise) return cached.refreshPromise;

    const password = await readPasswordFromEnv(systemName);
    const promise = (async () => {
      const { token, expiresAt } = await fetchOAuthPasswordToken(systemName, cfg, username, password);
      tokenCache.set(systemName, { token, expiresAt });
      return token;
    })().finally(() => {
      const c = tokenCache.get(systemName);
      if (c) c.refreshPromise = undefined;
    });

    const entry = tokenCache.get(systemName);
    tokenCache.set(systemName, { ...(entry ?? { token: '', expiresAt: 0 }), refreshPromise: promise } as CachedToken);
    return promise;
  };
}

/**
 * Wrap an X.509 client certificate in a custom `https.Agent` so axios (under
 * `abap-adt-api`) sends it on every ADT request.
 *
 * SAP accepts either:
 *   - PEM cert + PEM key (passphrase optional), or
 *   - pkcs12 / pfx bundle (passphrase required).
 *
 * We do NOT try to parse or pre-validate the file contents — Node will raise
 * a clear error at TLS handshake time. We only enforce "the path resolves" and
 * "the passphrase (if any) is obtainable from the keychain".
 */
async function buildCertAgent(sap: SapConfig, systemName: string, cfg: { certPath: string; keyPath: string; caPath?: string }): Promise<https.Agent> {
  if (!cfg.certPath || !cfg.keyPath) {
    throw new CliError('CONFIG_ERROR',
      `Profile '${systemName}' has incomplete cert auth (need certPath AND keyPath).`,
      { example: `abap profile set ${systemName} --auth-method cert --cert-path <cert> --cert-key <key>` });
  }
  if (!fs.existsSync(cfg.certPath)) {
    throw new CliError('CONFIG_ERROR', `X.509 certificate not found at '${cfg.certPath}'.`, {
      nextSteps: [`Re-run: abap profile set ${systemName} --auth-method cert --cert-path <correct-path>`],
      example: `abap profile set ${systemName} --auth-method cert --cert-path /abs/cert.pem --cert-key /abs/key.pem`,
    });
  }
  if (!fs.existsSync(cfg.keyPath)) {
    throw new CliError('CONFIG_ERROR', `X.509 private key not found at '${cfg.keyPath}'.`, {
      nextSteps: [`Re-run: abap profile set ${systemName} --auth-method cert --cert-key <correct-path>`],
    });
  }
  const passphrase = await getCertPassphrase(systemName);

  // Cert-level CA overrides the profile-level `ca` for the mTLS handshake.
  // Falls back to the global CA so a cert-only profile still trusts the server
  // (cert auth still requires server-cert verification unless `--insecure`).
  const ca = (cfg.caPath ? readCaCertificate(cfg.caPath) : undefined) ?? readCaCertificate(sap.caPath);

  return new https.Agent({
    cert: fs.readFileSync(cfg.certPath),
    key: fs.readFileSync(cfg.keyPath),
    passphrase: passphrase ?? '',
    ca,
    rejectUnauthorized: !sap.insecure && Boolean(ca),
  });
}
