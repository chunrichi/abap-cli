/**
 * `sso` auth strategy — native SSO via SPNEGO / Kerberos / Windows SSPI.
 *
 * Differs from `browser_sso` in that no cookie jar is involved: the user
 * authenticates to the OS at session start (Windows: AD login; Linux/macOS:
 * `kinit <user>@<REALM>`) and the CLI acquires a Kerberos ticket on demand.
 *
 * The ticket is sent as `Authorization: Negotiate <base64-ticket>` on every
 * ADT request. No password or SPNEGO token is ever persisted by the CLI.
 *
 * Platforms:
 *   - **Windows** (always available): PowerShell SSPI bridge in
 *     `auth/sso-negotiate.ts` — no native dependency required.
 *   - **Linux / macOS**: requires `kinit` from MIT Kerberos. When absent,
 *     `build()` throws `AUTH_ERROR` with the install hint.
 *
 * Profile shape (v2 canonical):
 *   ```
 *   auth: { method: 'sso', negotiate: { spn?: 'HTTP/myhost' } }
 *   ```
 * `spn` is optional; defaults to `HTTP/<host>` derived from `sap.url`.
 */
import { createSSLConfig } from 'abap-adt-api';
import { readCaCertificate } from '../../config/project-config.js';
import type { SapConfig } from '../../config/project-config.js';
import { CliError } from '../../output/json.js';
import { buildSsoAuth } from '../sso-negotiate.js';
import type { AuthStrategy } from '../strategy.js';
import { registerStrategy } from '../strategy.js';
import type { SsoNegotiateBlock } from '../v2-types.js';

registerStrategy({
  method: 'sso',
  async build(sap: SapConfig, systemName: string, auth) {
    if (auth.method !== 'sso') throw new Error('Strategy mismatch');
    const negotiate = auth.negotiate ?? {};
    try {
      const parts = buildSsoAuth(sap, systemName, negotiate.spn);
      // Drop the placeholder Authorization header — the fetcher will set
      // the real per-request value.
      const { 'Authorization': _placeholder, ...rest } = parts.options.headers ?? {};
      void _placeholder;
      return { passwordOrFetcher: parts.passwordOrFetcher, options: { ...parts.options, headers: rest } };
    } catch (error: unknown) {
      if (error instanceof CliError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError('AUTH_ERROR', `sso build failed: ${message}`);
    }
  },
  hints: {
    nextSteps: [
      "SSO ticket may have expired: re-run 'kinit <user>@<REALM>' (Linux/macOS) or re-login to Windows.",
      "Verify the SAP host is reachable: 'abap profile test <name> --json'.",
      "Alternative: 'abap profile set <name> --auth-method browser_sso' to capture browser cookies.",
    ],
    example: 'kinit mysapuser@EXAMPLE.COM',
  },
  fromOptions(opts, base) {
    const existing = base.method === 'sso' ? base.negotiate : undefined;
    const spn = opts.bag.spn ?? existing?.spn;
    const reauthOnExpiryRaw = opts.bag.reauthOnExpiry ?? existing?.reauthOnExpiry;
    const block: SsoNegotiateBlock = {};
    if (spn) block.spn = spn;
    if (typeof reauthOnExpiryRaw === 'string') {
      block.reauthOnExpiry = reauthOnExpiryRaw === 'true';
    } else if (typeof reauthOnExpiryRaw === 'boolean') {
      block.reauthOnExpiry = reauthOnExpiryRaw;
    }
    return { method: 'sso', negotiate: block };
  },
});
