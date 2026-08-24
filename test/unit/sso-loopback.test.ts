import { describe, expect, it, afterEach } from 'vitest';
import { startSsoLoopback } from '../../src/abap_cli/auth/sso-loopback.js';

const activeSessions: Array<{ cancel: () => void; result: Promise<unknown> }> = [];
afterEach(() => {
  while (activeSessions.length) {
    const s = activeSessions.pop()!;
    s.cancel();
    s.result.catch(() => undefined);
  }
});

async function waitForAuthorize(session: { authorizeUrl: string }): Promise<string> {
  const start = Date.now();
  while (!session.authorizeUrl && Date.now() - start < 1000) {
    await new Promise((r) => setTimeout(r, 10));
  }
  return session.authorizeUrl;
}

async function waitForHelper(session: { helperUrl: string }): Promise<string> {
  const start = Date.now();
  while (!session.helperUrl && Date.now() - start < 1000) {
    await new Promise((r) => setTimeout(r, 10));
  }
  return session.helperUrl;
}

describe('auth/sso-loopback.startSsoLoopback', () => {
  it('binds 127.0.0.1 with a kernel-assigned port', async () => {
    const session = startSsoLoopback('https://example.com', '100', 1000);
    activeSessions.push(session);
    await waitForHelper(session);
    expect(session.helperUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(session.authorizeUrl).toContain(
      '/sap/bc/adt/core/http/reentranceticket',
    );
    expect(session.authorizeUrl).toContain('redirect-url=');
    expect(session.authorizeUrl).toContain('sap-client=100');
    expect(session.authorizeUrl).toContain('&_=');
  });

  it('URL-encodes the loopback URL into redirect-url and inlines sap-client', async () => {
    const session = startSsoLoopback(
      'https://my.host.example.com/',
      '200',
      1000,
    );
    activeSessions.push(session);
    await waitForHelper(session);
    const url = session.authorizeUrl;
    expect(url).toMatch(/redirect-url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fadt%2Fredirect/);
    expect(url).not.toContain('//sap/');
  });

  it('captures cookies attached to the GET /adt/redirect request', async () => {
    const session = startSsoLoopback('https://example.com', '100', 5000);
    activeSessions.push(session);
    const helperUrl = await waitForHelper(session);
    const redirectUrl = helperUrl.replace(/\/$/, '') + '/adt/redirect';

    const submit = fetch(redirectUrl, {
      method: 'GET',
      headers: {
        Cookie: 'MYSAPSSO2=abc%3D; SAP_SESSIONID_TRL_100=xyz; sap-XCSRF-T-123=token',
      },
    });

    const result = await session.result;
    expect(result.cookies).toEqual([
      { name: 'MYSAPSSO2', value: 'abc%3D' },
      { name: 'SAP_SESSIONID_TRL_100', value: 'xyz' },
      { name: 'sap-XCSRF-T-123', value: 'token' },
    ]);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    const res = await submit;
    expect(res.ok).toBe(true);
    expect(await res.text()).toContain('SSO login complete');
  });

  it('rejects with timeout error when no redirect lands in time', async () => {
    const session = startSsoLoopback('https://example.com', '100', 100);
    activeSessions.push(session);
    await expect(session.result).rejects.toThrow(/timed out/);
  });

  it('returns an empty cookie array (but still resolves) when the redirect lacks cookies', async () => {
    const session = startSsoLoopback('https://example.com', '100', 5000);
    activeSessions.push(session);
    const helperUrl = await waitForHelper(session);
    const redirectUrl = helperUrl.replace(/\/$/, '') + '/adt/redirect';
    await fetch(redirectUrl);
    const result = await session.result;
    expect(result.cookies).toEqual([]);
  });

  it('rejects GET/POST to any path other than /adt/redirect with 4xx', async () => {
    const session = startSsoLoopback('https://example.com', '100', 5000);
    activeSessions.push(session);
    const helperUrl = await waitForHelper(session);

    const wrongPath = await fetch(helperUrl.replace(/\/$/, '') + '/wrong');
    expect(wrongPath.status).toBe(404);

    const rootPost = await fetch(helperUrl, { method: 'POST', body: 'x' });
    expect(rootPost.status).toBeGreaterThanOrEqual(400);
    expect(rootPost.status).toBeLessThan(500);
  });

  it('cancel() rejects the result promise', async () => {
    const session = startSsoLoopback('https://example.com', '100', 60_000);
    session.cancel();
    await expect(session.result).rejects.toThrow(/cancel/);
  });
});