/**
 * `oauth_password` auth strategy — BTP OAuth2 password grant against a UAA
 * subaccount token endpoint. Service-key credentials (clientid + clientsecret)
 * come from the profile; the user's SAP ID password is resolved at runtime
 * from keychain → interactive prompt (see `readPassword`).
 *
 * Tokens are kept in a process-local cache (`tokenCache`) keyed by system
 * name and refreshed ~5 minutes before actual expiry. Concurrent refreshes
 * are coalesced so multiple parallel ADT calls produce only one token
 * request.
 */
import * as fs from 'fs';
import { createSSLConfig } from 'abap-adt-api';
import type { BearerFetcher } from 'abap-adt-api/build/AdtHTTP.js';
import { readCaCertificate } from '../../config/project-config.js';
import type { SapConfig } from '../../config/project-config.js';
import { getPassword, storePassword } from '../../config/secrets.js';
import { parseBtpServiceKey } from '../types.js';
import { CliError } from '../../output/json.js';
import type { AuthStrategy } from '../strategy.js';
import { registerStrategy } from '../strategy.js';

interface CachedToken {
  token: string;
  expiresAt: number;
  refreshPromise?: Promise<string>;
}
const tokenCache = new Map<string, CachedToken>();

const TOKEN_REFRESH_WINDOW_S = 300;

/** Keychain first, then interactive prompt (stored back to keychain). */
async function readPassword(systemName: string): Promise<string> {
  const stored = await getPassword(systemName);
  if (stored) return stored;
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
      ],
      example: `abap profile set ${systemName} --password <your SAP ID password>  # then abap profile test ${systemName} --json`,
    },
  );
}

async function fetchOAuthPasswordToken(
  systemName: string,
  cfg: { uaaUrl: string; clientId: string; clientSecret: string },
  username: string,
  password: string,
): Promise<{ token: string; expiresAt: number }> {
  const tokenUrl = `${cfg.uaaUrl.replace(/\/+$/, '')}/oauth/token`;
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    username,
    password,
  });
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
          `Verify the stored password is current (abap profile set ${systemName} --password <new>).`,
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
  const expiresAt = Date.now() + (json.expires_in ?? 3600) * 1000 - TOKEN_REFRESH_WINDOW_S * 1000;
  return { token: json.access_token, expiresAt };
}

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
    // token, only one of them issues the token network request.
    if (cached?.refreshPromise) return cached.refreshPromise;

    const password = await readPassword(systemName);
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

registerStrategy({
  method: 'oauth_password',
  async build(sap: SapConfig, systemName: string, auth) {
    if (auth.method !== 'oauth_password') throw new Error('Strategy mismatch');
    const fetcher = buildOAuthPasswordFetcher(systemName, auth.oauth, sap.username);
    return {
      passwordOrFetcher: fetcher,
      options: createSSLConfig(sap.insecure, readCaCertificate(sap.caPath)),
    };
  },
  hints: {
    nextSteps: [
      "Verify BTP_USERNAME (or the username in your service key) is correct.",
      "Verify the stored password is current (abap profile set <name> --password <new>).",
      "If token grant fails repeatedly, regenerate the service key in BTP Cockpit.",
      "Run 'abap profile test <name> --json' to see the OAuth flow detail.",
    ],
    example: 'abap profile set <name> --password <new>  # then abap profile test <name> --json',
  },
  fromOptions(opts, base) {
    // oauth_password can either be configured from a service-key file
    // (--auth-option serviceKey=/path/to/key.json) OR carry an explicit
    // uaaUrl/clientId/clientSecret triplet. Both shapes are accepted.
    const existing = base.method === 'oauth_password' ? base.oauth : undefined;
    const serviceKeyFile = opts.bag.serviceKey ?? existing?.serviceKeyFile;
    const uaaUrl = opts.bag.uaaUrl ?? existing?.uaaUrl;
    const clientId = opts.bag.clientId ?? existing?.clientId;
    const clientSecret = opts.bag.clientSecret ?? existing?.clientSecret;

    if (serviceKeyFile) {
      if (!fs.existsSync(serviceKeyFile)) {
        throw new CliError('CONFIG_ERROR', `Service key file not found: '${serviceKeyFile}'.`);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(fs.readFileSync(serviceKeyFile, 'utf-8'));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new CliError('CONFIG_ERROR', `Failed to parse service key JSON: ${msg}`);
      }
      const sk = parseBtpServiceKey(parsed);
      return { method: 'oauth_password', oauth: { uaaUrl: sk.uaaUrl, clientId: sk.clientId, clientSecret: sk.clientSecret, serviceKeyFile } };
    }
    if (uaaUrl && clientId && clientSecret) {
      return { method: 'oauth_password', oauth: { uaaUrl, clientId, clientSecret } };
    }
    if (existing) return base;
    throw new CliError('INVALID_ARGUMENT',
      'oauth_password requires --auth-option serviceKey=/path/to/key.json ' +
      '(or --auth-option uaaUrl=… --auth-option clientId=… --auth-option clientSecret=…).',
      { example: 'abap profile add <name> --auth-method oauth_password --auth-option serviceKey=~/Downloads/default_key.json' });
  },
});
