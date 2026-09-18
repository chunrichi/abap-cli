/**
 * Cookie import — paste a raw `Cookie:` header (from DevTools "Copy as cURL"
 * or the SAP web-router response) into the CLI and persist it to the
 * browser_sso cookie jar.
 *
 * Joyabap equivalent: `joyabap profile cookie <name>`.
 *
 * Why a separate command from `profile login`:
 *   - `profile login` opens the user's browser at the SAP IdP redirect URL
 *     (BTP trial / SAML) and waits for the loopback listener. It needs an
 *     interactive TTY and a browser session.
 *   - `profile cookie` is the headless alternative for users who already
 *     have a cookie jar captured (e.g. via a browser extension, an
 *     enterprise SSO portal, or by sharing across machines) and just want
 *     to import the raw `Cookie:` header.
 *
 * The command refuses non-`browser_sso` profiles and validates that the
 * pasted cookies contain at least one `SAP_SESSIONID_<sid>_<client>`
 * (or any session-shaped) entry so we don't write empty jars.
 */
import * as fs from 'fs';
import { printResult, CliError, type OutputMode } from '../../output/json.js';
import { getSystem } from '../../config/user-config.js';
import { defaultCookieFile, parseCookieHeader, writeCookieStore } from '../../auth/sso-cookie.js';

/**
 * Cookie import entry point.
 *
 * @param name        Profile name (must already exist with auth.method === 'browser_sso')
 * @param rawHeader   Raw `Cookie:` header value, e.g. `SAP_SESSIONID_001_100=AbC...; route=...`
 * @param opts        Optional overrides (`{ cookieFile?: string }`)
 * @param mode        Output mode (json | pretty-json | human)
 */
export async function runCookieImport(
  name: string,
  rawHeader: string,
  opts: { cookieFile?: string },
  mode: OutputMode,
): Promise<void> {
  const profile = getSystem(name);
  if (!profile) {
    throw new CliError('CONFIG_ERROR', `Connection profile '${name}' not found.`, {
      nextSteps: [`Create it first: abap profile add ${name} --url <url> --auth-method browser_sso`],
      example: `abap profile add ${name} --url https://sap.example.com --username me --auth-method browser_sso`,
    });
  }
  if (profile.auth.method !== 'browser_sso') {
    throw new CliError('VALIDATION_ERROR',
      `Profile '${name}' uses auth.method='${profile.auth.method}', not 'browser_sso'.`,
      {
        nextSteps: [`abap profile set ${name} --auth-method browser_sso`],
        example: `abap profile set ${name} --auth-method browser_sso`,
      });
  }

  const cookies = parseCookieHeader(rawHeader);
  if (cookies.length === 0) {
    throw new CliError('INVALID_ARGUMENT',
      'No cookies parsed from the supplied header. Expected at least one `name=value` pair.',
      {
        nextSteps: [
          'Copy a fresh Cookie header from browser DevTools → Network → click the failing request → Headers → Cookie.',
        ],
        example: 'abap profile cookie <name> --header "SAP_SESSIONID_001_100=AbCdEf; route=R/..."',
      });
  }

  const hasSessionCookie = cookies.some((c) => c.name.toUpperCase().startsWith('SAP_SESSIONID_'));
  if (!hasSessionCookie) {
    throw new CliError('VALIDATION_ERROR',
      "Pasted cookies do not contain any `SAP_SESSIONID_*` entry. SAP will reject these.",
      {
        nextSteps: [
          'Confirm you captured the Cookie header from a logged-in SAP session, not from a redirect page.',
        ],
        example: 'abap profile cookie <name> --header "SAP_SESSIONID_001_100=AbCdEf; route=R/..."',
      });
  }

  const cookieFile = opts.cookieFile ?? profile.auth.sso.cookieFile ?? defaultCookieFile(name);
  await writeCookieStore(cookieFile, cookies);

  // Trim the values before echoing back — printed cookies should never leak
  // in plain text, even on a local terminal.
  const redacted = cookies.map((c) => ({ name: c.name, valueLength: c.value.length }));
  printResult(mode, { profile: name, cookieFile, cookieCount: cookies.length, cookies: redacted },
    `Imported ${cookies.length} cookie(s) for profile '${name}' → ${cookieFile}`);
}

/** True when a cookie jar exists at `file` and contains at least one entry. */
export function cookieJarIsPopulated(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return false;
    const cookies = (parsed as { cookies?: unknown }).cookies;
    return Array.isArray(cookies) && cookies.length > 0;
  } catch {
    return false;
  }
}
