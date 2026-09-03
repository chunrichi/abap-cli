/**
 * `browser_sso` auth strategy — captured SSO cookies replayed as a `Cookie`
 * header on every ADT request.
 *
 * Cookie jar location: `~/.abap-cli/<profile>.sso.cookies.json` (TTL 30 min).
 * The user acquires cookies by running `abap profile login <profile>` (see
 * `flows/setup/sso.ts`), which opens a browser, listens on a loopback port,
 * and writes the returned cookies to disk.
 *
 * Distinguishes "file missing" from "file present but expired" so the error
 * message guides the user to the right fix.
 */
import * as fs from 'fs';
import { createSSLConfig } from 'abap-adt-api';
import { readCaCertificate } from '../../config/project-config.js';
import type { SapConfig } from '../../config/project-config.js';
import { CliError } from '../../output/json.js';
import { buildCookieHeader, defaultCookieFile, readCookieStore } from '../sso-cookie.js';
import type { AuthStrategy } from '../strategy.js';
import { registerStrategy } from '../strategy.js';

registerStrategy({
  method: 'browser_sso',
  async build(sap: SapConfig, systemName: string, auth) {
    if (auth.method !== 'browser_sso') throw new Error('Strategy mismatch');
    const cookieFile = auth.sso.cookieFile || defaultCookieFile(systemName);
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
    const ssl = createSSLConfig(sap.insecure, readCaCertificate(sap.caPath));
    return {
      // SAP accepts a sentinel password string for SSO; the auth actually flows via Cookie header.
      passwordOrFetcher: 'browser-sso',
      options: { ...ssl, headers: { ...ssl.headers, Cookie: buildCookieHeader(store.cookies) } },
    };
  },
  hints: {
    nextSteps: [
      "SSO cookies expire (TTL 30 min). Re-run: 'abap profile login <name>' to capture fresh cookies.",
      "If you changed IdP credentials, run login again immediately.",
      "Run 'abap profile test <name> --json' to see the cookie file path.",
    ],
    example: 'abap profile login <name>',
  },
  fromOptions(opts, base) {
    const existingSso = base.method === 'browser_sso' ? base.sso : undefined;
    const cookieFile = opts.bag.cookieFile ?? existingSso?.cookieFile;
    return { method: 'browser_sso', sso: cookieFile ? { cookieFile } : {} };
  },
});
