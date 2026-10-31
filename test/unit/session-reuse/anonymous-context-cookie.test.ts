/**
 * Anonymous ICM context cookies must never be replayed.
 *
 * The ICM answers stateless requests with `sap-contextid=SID:ANON:…`; sending
 * that cookie back on a stateful ADT request makes the server return
 * `400 Session not found` (observed on S/4HANA 8.134). The session helpers
 * therefore drop anonymous contexts both when persisting a freshly captured
 * session and when seeding a client from a saved jar.
 */
import { describe, expect, it } from 'vitest';
import {
  captureSessionFromAdt,
  dropAnonymousContextCookies,
  injectSessionIntoAdt,
  shouldDegradeToStateless,
} from '../../../src/abap_cli/session/reuse.js';
import { makeEmptyJar } from '../../../src/abap_cli/session/jar.js';
import type { SapConfig } from '../../../src/abap_cli/config/project-config.js';

const ANON = 'SID%3aANON%3avhcalhdbdb_S4H_00%3asE-Uxxxx-ATT';
const REAL = 'SID%3aabc123%3avhcalhdbdb_S4H_00%3asE-Ureal-ATT';

function profile(): SapConfig {
  return {
    url: 'https://sap.example:44300',
    client: '100',
    username: 'DEVELOPER',
    password: 'x',
    language: 'EN',
    insecure: true,
    caPath: '',
    auth: { method: 'basic' },
    sourceDir: '.',
  };
}

function makeJar() {
  return makeEmptyJar(profile(), 'on-prem', 'test');
}

/** Minimal ADT client shape the session helpers touch. */
function fakeClient(entries: Array<[string, string]>) {
  const map = new Map<string, string>(entries.map(([name, value]) => [name, `${name}=${value}`]));
  return { httpClient: { cookie: map, csrfToken: 'csrf-1' } } as unknown as { httpClient: unknown };
}

function cookieNames(client: { httpClient: unknown }): string[] {
  return [...((client.httpClient as { cookie: Map<string, string> }).cookie.keys())];
}

describe('anonymous ICM context cookies', () => {

  it('keeps stateful mode when SAP also returned a stateful session cookie', () => {
    // S/4HANA 8.134 returns an anonymous context AND SAP_SESSIONID on login.
    const client = fakeClient([
      ['SAP_SESSIONID_S4H_100', 'session-id'],
      ['sap-contextid', ANON],
      ['MYSAPSSO2', 'sso-ticket'],
    ]);
    expect(shouldDegradeToStateless(client)).toBe(false);
    expect(cookieNames(client)).not.toContain('sap-contextid');
  });

  it('degrades to stateless only when no stateful session cookie exists', () => {
    const client = fakeClient([
      ['sap-contextid', ANON],
      ['MYSAPSSO2', 'sso-ticket'],
    ]);
    expect(shouldDegradeToStateless(client)).toBe(true);
  });

  it('does not degrade when the login produced a real context', () => {
    const client = fakeClient([['sap-contextid', REAL]]);
    expect(shouldDegradeToStateless(client)).toBe(false);
    expect(cookieNames(client)).toContain('sap-contextid');
  });

  it('captureSessionFromAdt keeps real context cookies but drops ANON ones', () => {
    const client = fakeClient([
      ['sap-contextid', ANON],
      ['sap-usercontext', 'sap-client=100'],
      ['MYSAPSSO2', 'sso-ticket'],
    ]);
    const jar = makeJar();
    captureSessionFromAdt(client, jar);
    expect(jar.cookies.map((c) => c.name)).toEqual(['sap-usercontext', 'MYSAPSSO2']);
  });

  it('captureSessionFromAdt keeps a non-anonymous sap-contextid', () => {
    const client = fakeClient([
      ['sap-contextid', REAL],
      ['sap-usercontext', 'sap-client=100'],
    ]);
    const jar = makeJar();
    captureSessionFromAdt(client, jar);
    expect(jar.cookies.map((c) => c.name)).toEqual(['sap-contextid', 'sap-usercontext']);
  });

  it('injectSessionIntoAdt skips anonymous contexts from a stale jar', () => {
    const jar = makeJar();
    jar.cookies = [
      { name: 'sap-contextid', value: ANON },
      { name: 'sap-usercontext', value: 'sap-client=100' },
    ];
    const client = fakeClient([]);
    injectSessionIntoAdt(client, jar);
    expect(cookieNames(client)).toEqual(['sap-usercontext']);
  });

  it('dropAnonymousContextCookies clears the live ANON cookie only', () => {
    const client = fakeClient([
      ['sap-contextid', ANON],
      ['sap-usercontext', 'sap-client=100'],
      ['sap-XSRF_S4H_100', 'xsrf'],
    ]);
    expect(dropAnonymousContextCookies(client)).toBe(true);
    expect(cookieNames(client)).toEqual(['sap-usercontext', 'sap-XSRF_S4H_100']);
  });

  it('dropAnonymousContextCookies reports false when only a real context is present', () => {
    const client = fakeClient([['sap-contextid', REAL]]);
    expect(dropAnonymousContextCookies(client)).toBe(false);
    expect(cookieNames(client)).toEqual(['sap-contextid']);
  });
});
