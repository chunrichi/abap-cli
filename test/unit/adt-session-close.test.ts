/**
 * ADT session close — the logoff replacement.
 *
 * The legacy `/sap/public/bc/icf/logoff` service may answer 403 (disabled on
 * the target system). The CLI must terminate the stateful context through the
 * ADT sessions resource instead, fall back to the NW 7.50 discovery exchange,
 * and only then to the legacy logoff. A failed cleanup must surface the HTTP
 * status, never disappear into an empty catch block.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ADTClient } from 'abap-adt-api';
import {
  adtSessionCloseWarning,
  closeAdtSession,
  type AdtSessionCloseResult,
} from '../../src/abap_cli/clients/adt-session-close.js';

interface FakeResponse {
  status?: number;
  /** New `sap-contextid` set by the response (the close request resets it to 0). */
  context?: string;
}

interface FakeOptions {
  cookies?: string;
  /** Responses consumed in order by `httpClient.request`. */
  responses?: Array<FakeResponse | Error>;
  logout?: () => Promise<void>;
}

function fakeClient(options: FakeOptions = {}) {
  let cookies = options.cookies ?? 'SAP_SESSIONID=s1; sap-contextid=CTX1';
  let stateful: string = 'stateful';
  const responses = [...(options.responses ?? [])];
  const requests: Array<{ path: string; options: { method?: string; headers?: Record<string, string> } }> = [];
  const logout = vi.fn(options.logout ?? (async () => undefined));

  const client = {
    get stateful(): string {
      return stateful;
    },
    set stateful(value: string) {
      stateful = value;
    },
    session: {
      cookieHeader: () => cookies,
      clearCookies: () => {
        cookies = '';
      },
    },
    httpClient: {
      csrfToken: 'TOKEN',
      request: async (path: string, requestOptions: { method?: string; headers?: Record<string, string> }) => {
        requests.push({ path, options: requestOptions });
        const response = responses.shift();
        if (response instanceof Error) throw response;
        if (response?.context !== undefined) cookies = `sap-contextid=${response.context}`;
        if (response?.status !== undefined && response.status >= 400) {
          throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
        }
        return { status: 200, headers: {}, body: '' };
      },
    },
    logout,
  };

  return { client: client as unknown as ADTClient, requests, logout };
}

describe('closeAdtSession', () => {
  it('closes the context through the ADT sessions resource', async () => {
    const fake = fakeClient();

    const result = await closeAdtSession(fake.client);

    expect(result).toEqual({ outcome: 'closed' });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({
      path: '/sap/bc/adt/core/http/sessions',
      options: {
        method: 'GET',
        headers: {
          Accept: '*/*',
          'sap-adt-purpose': 'close-session',
          'sap-contextid': 'CTX1',
        },
      },
    });
    expect(fake.client.stateful).toBe('stateless');
    expect(fake.client.session.cookieHeader()).toBe('');
    expect(fake.client.httpClient.csrfToken).toBe('fetch');
    expect(fake.logout).not.toHaveBeenCalled();
  });

  it('falls back to stateless discovery when the close resource is missing (NW 7.50)', async () => {
    const fake = fakeClient({ responses: [{ status: 404 }, {}] });

    const result = await closeAdtSession(fake.client);

    expect(result).toEqual({ outcome: 'closed-discovery' });
    expect(fake.requests.map((r) => r.path)).toEqual([
      '/sap/bc/adt/core/http/sessions',
      '/sap/bc/adt/core/discovery',
    ]);
    expect(fake.requests[1]?.options).toMatchObject({ method: 'HEAD', headers: { Accept: '*/*' } });
    expect(fake.logout).not.toHaveBeenCalled();
  });

  it('treats a 400 with a reset context cookie as a successful close', async () => {
    const fake = fakeClient({ responses: [{ status: 400, context: '0' }] });

    const result = await closeAdtSession(fake.client);

    expect(result).toEqual({ outcome: 'closed' });
    expect(fake.logout).not.toHaveBeenCalled();
  });

  it('falls back to legacy logoff when the close resource is forbidden', async () => {
    const fake = fakeClient({ responses: [{ status: 403 }] });

    const result = await closeAdtSession(fake.client);

    expect(result).toEqual({ outcome: 'logged-off' });
    expect(fake.logout).toHaveBeenCalledTimes(1);
  });

  it('reports a failed close with its HTTP status instead of swallowing it', async () => {
    const fake = fakeClient({
      responses: [{ status: 403 }],
      logout: async () => {
        throw Object.assign(new Error('HTTP 403'), { status: 403 });
      },
    });

    const result = await closeAdtSession(fake.client);

    expect(result).toEqual({ outcome: 'failed', status: 403 });
    expect(adtSessionCloseWarning(result, 'after the command')).toContain('HTTP 403');
  });

  it('does nothing when no stateful context cookie is present', async () => {
    const fake = fakeClient({ cookies: 'SAP_SESSIONID=s1' });

    const result = await closeAdtSession(fake.client);

    expect(result).toEqual({ outcome: 'not-needed' });
    expect(fake.requests).toHaveLength(0);
    expect(fake.logout).not.toHaveBeenCalled();
  });

  it('uses the legacy logoff for clients without the cookie API', async () => {
    const logout = vi.fn(async () => undefined);
    const client = { logout } as unknown as ADTClient;

    const result = await closeAdtSession(client);

    expect(result).toEqual({ outcome: 'logged-off' });
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('has no warning for a successful close', () => {
    const result: AdtSessionCloseResult = { outcome: 'closed' };
    expect(adtSessionCloseWarning(result, 'after the command')).toBeUndefined();
  });
});
