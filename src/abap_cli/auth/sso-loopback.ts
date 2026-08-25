/**
 * Browser-SSO loopback flow — Eclipse-equivalent auth for BTP ABAP environment.
 *
 * Why this exists
 * ---------------
 * `browser_sso` auth flow used to require users to copy a `Cookie:` header
 * from DevTools and paste it into a helper page. That works, but Eclipse
 * never does this — Eclipse opens a real browser, lets the user log in via
 * the IdP, and the SAP web-router bounces the resulting session back to a
 * 127.0.0.1 listener. This module replicates that flow end-to-end so an
 * agent or human running `abap profile login <name>` doesn't have to dig
 * through DevTools.
 *
 * The protocol (mirrors what Eclipse / SAP open-ux-tools does):
 *   1. CLI starts an HTTP server on 127.0.0.1:<random> at path
 *      `/adt/redirect` and captures the bound port.
 *   2. CLI opens the user's browser at
 *      `<profile.url>/sap/bc/adt/core/http/reentranceticket
 *       ?redirect-url=http://127.0.0.1:<port>/adt/redirect`.
 *   3. SAP web-router redirects the browser through its IdP
 *      (`accounts.sap.com` / `abap-public-trial-*.authentication.*`).
 *   4. After the user logs in, SAP redirects the browser back to
 *      `127.0.0.1:<port>/adt/redirect` with `Set-Cookie` containing the
 *      real `SAP_SESSIONID_<sid>_<client>` (and possibly a CSRF token).
 *   5. The listener reads `req.headers.cookie`, parses it, and we persist
 *      the cookies to the standard `~/.abap-cli/<profile>.sso.cookies.json`
 *      jar that `auth/adapter.ts` already knows how to read.
 *
 * What the CLI does NOT do (deliberately):
 *   - No PKCE verifier. The `code_challenge` / `code_challenge_method=S256`
 *     params you see in the BTP authorize URL are SAP web-router's own
 *     internal PKCE — they protect the web-router's OAuth code, not ours.
 *     The CLI never sees the OAuth code; SAP gives us a session cookie
 *     directly.
 *   - No OAuth2 token exchange. We are issued a session cookie, not a
 *     bearer token. This is the same `SAP_SESSIONID_<sid>_<client>` that
 *     Eclipse ends up with.
 *
 * Security notes
 * --------------
 *   - Listens on 127.0.0.1 only. Never reachable from the LAN.
 *   - Bound port is allocated by the kernel (port 0), not hardcoded, so
 *     there's no collision risk with other Eclipse instances running
 *     `abap profile login` simultaneously.
 *   - Auto-shuts down after the redirect lands (success) or after
 *     `timeoutMs` (default 5 min — enough for a human to authenticate,
 *     short of enough that a forgotten process won't linger).
 *   - Only accepts HTTP/1.1 GET on the agreed path; rejects everything
 *     else with 404 so a malicious cross-origin redirect can't reach it.
 */
import * as http from 'http';
import { AddressInfo } from 'net';
import { parseCookieHeader, type SsoCookie } from './sso-cookie.js';

const REDIRECT_PATH = '/adt/redirect';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export interface LoopbackSession {
  /** Bound 127.0.0.1 URL of the listener (`http://127.0.0.1:<port>/`). */
  helperUrl: string;
  /**
   * Full URL the CLI should hand to the browser. Already includes
   * `redirect-url=` pointing at the listener.
   */
  authorizeUrl: string;
  /** Resolves with the captured cookies once the user finishes logging in. */
  result: Promise<LoopbackResult>;
  /** Eagerly shut down the listener (e.g. on Ctrl+C / user cancel). */
  cancel: () => void;
}

export interface LoopbackResult {
  /** Bound 127.0.0.1 URL — useful for diagnostics. */
  helperUrl: string;
  /** URL the user's browser was sent to (with redirect-url already inlined). */
  authorizeUrl: string;
  /** Cookies the listener captured from the SAP redirect. */
  cookies: SsoCookie[];
  /** Wall-clock ms the user took to log in. */
  elapsedMs: number;
}

/**
 * Spin up a 127.0.0.1 listener and return the URLs needed to launch the
 * browser. The returned `result` promise resolves when SAP redirects the
 * browser back to `/adt/redirect` with session cookies attached.
 *
 * `profileUrl` is the SAP system base URL (e.g.
 * `https://cb6549d4-2ebc-4106-94c5-35da55fca11f.abap.ap21.hana.ondemand.com`).
 * `client` is the SAP client number (`100` etc) — appended to the
 * authorize URL as `sap-client=<client>` so the web-router knows which
 * tenant to redirect back to.
 */
export function startSsoLoopback(
  profileUrl: string,
  client: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): LoopbackSession {
  let resolveFn: (r: LoopbackResult) => void = () => undefined;
  let rejectFn: (e: Error) => void = () => undefined;
  const result = new Promise<LoopbackResult>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  let helperUrl = '';
  // Populated synchronously by `server.listen` once the kernel picks a
  // port. The authorize URL embeds the redirect-url, so we need to wait
  // for the bind before constructing it.
  let authorizeUrl = '';
  const startedAt = Date.now();

  const server = http.createServer((req, res) => {
    if (!req.url || !req.method) {
      res.writeHead(400);
      res.end();
      return;
    }
    // Only accept GET on the agreed path. The SAP redirect lands here with
    // the user's session cookies in `req.headers.cookie` — that's the
    // payload we capture. Everything else gets a 404 so a stray
    // cross-origin POST can't reach us.
    if (req.method === 'GET' && req.url === REDIRECT_PATH) {
      const cookieHeader = req.headers.cookie ?? '';
      const cookies = parseCookieHeader(cookieHeader);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><html><body style="font-family:system-ui;max-width:480px;margin:48px auto">' +
          '<h2>abap-cli SSO login complete</h2>' +
          '<p>You can close this tab and return to the terminal.</p>' +
          (cookies.length === 0
            ? '<p style="color:#a00"><strong>No cookies were attached.</strong> ' +
              'If login failed, re-run <code>abap profile login &lt;name&gt;</code> ' +
              'and try again.</p>'
            : `<p>Captured ${cookies.length} cookie(s): <code>${cookies.map((c) => c.name).join(', ')}</code></p>`) +
          '</body></html>',
      );
      setImmediate(() => {
        server.close();
        resolveFn({
          helperUrl,
          authorizeUrl,
          cookies,
          elapsedMs: Date.now() - startedAt,
        });
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });

  let timer: NodeJS.Timeout | undefined;
  server.on('error', (err) => {
    if (timer) clearTimeout(timer);
    server.close();
    rejectFn(err instanceof Error ? err : new Error(String(err)));
  });

  server.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      server.close();
      rejectFn(new Error('SSO loopback listener did not bind to a TCP port'));
      return;
    }
    const port = (addr as AddressInfo).port;
    helperUrl = `http://127.0.0.1:${port}/`;
    const redirectUrl = `${helperUrl.slice(0, -1)}${REDIRECT_PATH}`;
    // Cache-buster (`_`) — Eclipse adds it too. Mirrors what ADT clients do
    // so SAP doesn't serve us a cached redirect chain.
    const cacheBuster = String(Date.now() % 1_000_000_000);
    const base = profileUrl.replace(/\/+$/, '');
    authorizeUrl =
      `${base}/sap/bc/adt/core/http/reentranceticket` +
      `?redirect-url=${encodeURIComponent(redirectUrl)}` +
      `&sap-client=${encodeURIComponent(client)}` +
      `&_=${cacheBuster}`;

    timer = setTimeout(() => {
      server.close();
      rejectFn(
        new Error(
          `SSO loopback timed out after ${Math.round(timeoutMs / 1000)}s ` +
            `(no redirect landed at ${redirectUrl})`,
        ),
      );
    }, timeoutMs);
    timer.unref?.();
  });

  return {
    get helperUrl() {
      return helperUrl;
    },
    get authorizeUrl() {
      return authorizeUrl;
    },
    result,
    cancel: () => {
      if (timer) clearTimeout(timer);
      server.close();
      try {
        rejectFn(new Error('SSO loopback cancelled'));
      } catch {
        // ignore double-cancel
      }
    },
  };
}

/**
 * Best-effort open of a URL in the user's default browser. Cross-platform
 * without adding the `open` npm package (we already import `child_process`).
 * Failures to spawn the browser are surfaced but non-fatal — the user can
 * paste it from the stderr log line printed by `sso-flow`.
 */
export async function openBrowser(url: string): Promise<boolean> {
  const { spawn } = await import('child_process');
  let cmd: string;
  let args: string[];
  if (process.platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => { /* swallow — caller treats as non-fatal */ });
    child.unref();
    return true;
  } catch {
    return false;
  }
}