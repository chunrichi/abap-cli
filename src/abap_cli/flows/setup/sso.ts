import { printResult, CliError, type OutputMode } from '../../output/json.js';
import { getSystem } from '../../config/user-config.js';
import { defaultCookieFile, writeCookieStore } from '../../auth/sso-cookie.js';
import { openBrowser, startSsoLoopback } from '../../auth/sso-loopback.js';

/**
 * Capture fresh SSO cookies for a profile and write them to the cookie jar.
 *
 * Flow (Eclipse-equivalent):
 *  1. Look up the profile; require `auth.method === 'browser_sso'`.
 *  2. Start a 127.0.0.1 listener on `/adt/redirect` and capture the bound port.
 *  3. Open the user's default browser at
 *     `<profile.url>/sap/bc/adt/core/http/reentranceticket
 *      ?redirect-url=http://127.0.0.1:<port>/adt/redirect&sap-client=<c>&_=<bust>`.
 *     SAP web-router chains through its IdP (accounts.sap.com / BTP auth).
 *  4. After IdP login, SAP web-router 302s the user back to the loopback
 *     with `SAP_SESSIONID_<sid>_<client>` (and possibly X-CSRF) in the
 *     `Cookie:` header.
 *  5. Listener parses `req.headers.cookie`, writes the cookie jar.
 *
 * SIGINT/Ctrl+C cancels the loopback listener immediately so the port is
 * released before the process exits.
 */
export async function runLogin(name: string, mode: OutputMode): Promise<void> {
  const profile = getSystem(name);
  if (!profile) {
    throw new CliError('CONFIG_ERROR', `Connection profile '${name}' not found.`, {
      nextSteps: [`Create it first: abap profile add ${name} --url <url> --auth-method browser_sso`],
      example: `abap profile add ${name} --url https://cb6549d4-2ebc-4106-94c5-35da55fca11f.abap.ap21.hana.ondemand.com --username me --auth-method browser_sso --client 100`,
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
  const client = profile.client || '100';
  const cookieFile = profile.auth.sso.cookieFile || defaultCookieFile(name);

  // Start the loopback listener first so the bound port is stable when we
  // launch the browser. `startSsoLoopback` resolves `authorizeUrl` lazily
  // inside `server.listen`; we wait synchronously (max 1s) to avoid a race
  // where the browser opens before the listener has bound.
  const session = startSsoLoopback(profile.url, client, 5 * 60 * 1000);

  const startDeadline = Date.now() + 1000;
  while (!session.authorizeUrl && Date.now() < startDeadline) {
    await new Promise((r) => setTimeout(r, 20));
  }
  if (!session.authorizeUrl) {
    session.cancel();
    throw new CliError('CONFIG_ERROR', 'SSO loopback listener did not bind within 1s.');
  }
  console.error(`[sso-flow] authorize URL: ${session.authorizeUrl}`);

  // Cancel the loopback listener on Ctrl+C so the port is released.
  const onSigInt = () => {
    session.cancel();
    console.error('[sso-flow] cancelled by signal.');
  };
  process.once('SIGINT', onSigInt);

  try {
    const browserOpened = await openBrowser(session.authorizeUrl);
    console.error(`[sso-flow] browser opened: ${browserOpened}`);

    if (!browserOpened) {
      console.log(`[abap-cli] SSO authorize URL (open this in your browser):`);
      console.log(`  ${session.authorizeUrl}`);
    }

    const result = await session.result;
    await writeCookieStore(cookieFile, result.cookies);

    const data = {
      profile: name,
      cookieFile,
      openedBrowser: browserOpened,
      helperUrl: result.helperUrl,
      authorizeUrl: result.authorizeUrl,
      capturedCookies: result.cookies.length,
      cookieNames: result.cookies.map((c) => c.name),
      elapsedMs: result.elapsedMs,
    };
    const human = [
      `SSO cookies captured for '${name}'.`,
      `  cookieFile:    ${cookieFile}`,
      `  captured:      ${result.cookies.length} cookie(s) (${result.cookies.map((c) => c.name).join(', ')})`,
      `  elapsed:       ${(result.elapsedMs / 1000).toFixed(1)}s`,
      browserOpened
        ? `  browser:       opened at ${session.authorizeUrl}`
        : `  authorizeUrl:  ${session.authorizeUrl} (browser did not launch — open this URL manually)`,
      `Next: abap init --profile ${name} --yes`,
    ].join('\n');
    printResult(mode, data, human);
  } finally {
    process.off('SIGINT', onSigInt);
  }
}