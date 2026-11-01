/**
 * Cookie policy — the actual root cause of the SM04 session leak.
 *
 * On S/4HANA, `sap-contextid` is part of the stateful session identity: a
 * request carrying `SAP_SESSIONID_*` without its context cookie is silently
 * routed into a NEW SAP session. The controller therefore keeps the context
 * cookie whenever a stateful session cookie is present, and drops it only when
 * there is no session at all (the poison case that makes SAP answer 400).
 */
import { describe, expect, it } from 'vitest';
import {
  SessionCookieController,
  cookieHeaderValue,
  parseSetCookie,
  sanitizeCookies,
} from '../../../src/abap_cli/session/cookies.js';
import type { SessionJarCookie } from '../../../src/abap_cli/session/jar.js';

const SESSION: SessionJarCookie = { name: 'SAP_SESSIONID_S4H_100', value: 'sid-1' };
const CONTEXT: SessionJarCookie = { name: 'sap-contextid', value: 'SID%3aANON%3ahost%3actx-ATT' };
const USERCONTEXT: SessionJarCookie = { name: 'sap-usercontext', value: 'sap-client=100' };

describe('sanitizeCookies', () => {
  it('keeps the context cookie when the stateful session cookie is present', () => {
    const out = sanitizeCookies([SESSION, CONTEXT, USERCONTEXT]);
    expect(out.map((c) => c.name)).toContain('sap-contextid');
  });

  it('drops a context cookie with no stateful session (stateless / poison)', () => {
    const out = sanitizeCookies([CONTEXT, USERCONTEXT]);
    expect(out.map((c) => c.name)).toEqual(['sap-usercontext']);
  });
});

describe('parseSetCookie', () => {
  it('parses name/value and attributes', () => {
    const cookie = parseSetCookie(
      'SAP_SESSIONID_S4H_100=abc%3d; Path=/; Secure; HttpOnly; Expires=Wed, 21 Oct 2026 07:28:00 GMT',
    );
    expect(cookie).toMatchObject({
      name: 'SAP_SESSIONID_S4H_100',
      value: 'abc%3d',
      path: '/',
      httpOnly: true,
    });
    expect(cookie?.expiresAt).toBe('2026-10-21T07:28:00.000Z');
  });

  it('honours Max-Age over Expires', () => {
    const cookie = parseSetCookie('a=b; Max-Age=60; Expires=Wed, 21 Oct 2026 07:28:00 GMT');
    expect(cookie?.expiresAt).toBeDefined();
    const delta = new Date(cookie!.expiresAt!).getTime() - Date.now();
    expect(delta).toBeGreaterThan(50_000);
    expect(delta).toBeLessThan(70_000);
  });

  it('ignores malformed values', () => {
    expect(parseSetCookie('novalue')).toBeNull();
    expect(parseSetCookie('=value')).toBeNull();
  });
});

describe('SessionCookieController', () => {
  it('serializes seeded cookies into a Cookie header', () => {
    const controller = new SessionCookieController();
    controller.seed([SESSION, CONTEXT, USERCONTEXT]);
    expect(controller.injectingCookies).toBe(true);
    expect(controller.headerValue()).toContain('SAP_SESSIONID_S4H_100=sid-1');
    expect(controller.headerValue()).toContain('sap-contextid=');
    expect(cookieHeaderValue(controller.snapshot())).toContain('sap-usercontext=');
    expect(controller.hasStatefulSession()).toBe(true);
  });

  it('does not inject before a seed and after clear', () => {
    const controller = new SessionCookieController();
    expect(controller.headerValue()).toBeUndefined();
    controller.seed([SESSION]);
    controller.clear();
    expect(controller.headerValue()).toBeUndefined();
    expect(controller.snapshot()).toEqual([]);
  });

  it('captures stateful Set-Cookie responses including the context cookie', () => {
    const controller = new SessionCookieController();
    controller.observeResponse(
      {
        'set-cookie': [
          'SAP_SESSIONID_S4H_100=sid-2; Path=/; HttpOnly',
          'sap-contextid=SID%3aANON%3ahost%3actx2-ATT; Path=/sap/bc/adt',
        ],
      },
      true,
    );
    expect(controller.snapshot().map((c) => c.name).sort()).toEqual(['SAP_SESSIONID_S4H_100', 'sap-contextid']);
    expect(controller.sessionId()).toBe('sid-2');
  });

  it('ignores stateless responses (anonymous contexts must not be paired)', () => {
    const controller = new SessionCookieController();
    controller.observeResponse({ 'set-cookie': ['sap-contextid=SID%3aANON%3ahost%3actx-ATT'] }, false);
    expect(controller.snapshot()).toEqual([]);
  });

  it('drops a stale context when a later response rotates the session away', () => {
    const controller = new SessionCookieController();
    controller.seed([SESSION, CONTEXT]);
    // A stateful response that only clears the session cookie (logout-like).
    controller.observeResponse(
      { 'set-cookie': ['SAP_SESSIONID_S4H_100=; Path=/; Max-Age=0'] },
      true,
    );
    // The session cookie is still present (empty value) → context stays paired.
    expect(controller.hasStatefulSession()).toBe(true);
  });

  it('overrides an existing Cookie header only while injecting', () => {
    const controller = new SessionCookieController();
    const headers = { Cookie: 'from-library=1' };
    expect(controller.applyToHeaders(headers)).toEqual(headers);
    controller.seed([SESSION]);
    const merged = controller.applyToHeaders(headers) as Record<string, string>;
    expect(merged.Cookie).toContain('SAP_SESSIONID_S4H_100=sid-1');
  });
});
