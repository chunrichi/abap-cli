/**
 * Session cookie handling — the transport-level bridge between the persisted
 * `SessionJar` and the live ADT HTTP client.
 *
 * Why this exists: on S/4HANA the `sap-contextid` cookie is part of the
 * stateful session identity. A request that carries `SAP_SESSIONID_*` but not
 * its `sap-contextid` is silently routed into a **new** SAP session (HTTP 200,
 * no error) — one orphan per command in SM04. The old code deliberately
 * dropped every `sap-contextid` (to avoid replaying a poisoned anonymous
 * context), which is what caused the session leak. The rule now:
 *
 *   - capture/inject `sap-contextid` **iff** the cookie set contains a
 *     stateful `SAP_SESSIONID_*` cookie (they are one identity — never split);
 *   - in stateless/degraded mode (no session cookie) drop context cookies:
 *     replaying those *does* make the server answer `400 Session not found`.
 *
 * The controller is the single owner of the live cookie set: the HTTP wrapper
 * injects it on every request and feeds every `Set-Cookie` back here, so the
 * jar never has to touch `abap-adt-api`'s private cookie map.
 */

import {
  hasStatefulSessionCookie,
  isContextCookieName,
  isStatefulCookieName,
  type SessionJarCookie,
} from './jar.js';

/** `Set-Cookie` header values as exposed by the ADT HTTP client. */
type SetCookieHeaders = unknown;

/** RFC 6265 cookie date parsing (best effort — only used for diagnostics). */
function parseExpires(value: string): string | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

/**
 * Parse one `Set-Cookie` header value into a jar cookie. Returns `null` for
 * malformed values; the caller simply skips them.
 */
export function parseSetCookie(header: string): SessionJarCookie | null {
  const parts = header.split(';');
  const pair = parts.shift()?.trim() ?? '';
  const eq = pair.indexOf('=');
  if (eq <= 0) return null;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  if (!name) return null;
  const cookie: SessionJarCookie = { name, value };
  let maxAge: number | undefined;
  let expires: string | undefined;
  for (const rawAttr of parts) {
    const attr = rawAttr.trim();
    const idx = attr.indexOf('=');
    const key = (idx >= 0 ? attr.slice(0, idx) : attr).trim().toLowerCase();
    const attrValue = idx >= 0 ? attr.slice(idx + 1).trim() : '';
    if (key === 'path') cookie.path = attrValue;
    else if (key === 'domain') cookie.domain = attrValue;
    else if (key === 'httponly') cookie.httpOnly = true;
    else if (key === 'max-age') {
      const n = Number(attrValue);
      if (Number.isFinite(n)) maxAge = n;
    } else if (key === 'expires') expires = parseExpires(attrValue);
  }
  if (maxAge !== undefined) cookie.expiresAt = new Date(Date.now() + maxAge * 1000).toISOString();
  else if (expires !== undefined) cookie.expiresAt = expires;
  return cookie;
}

/** Serialize cookies into a `Cookie` header value. */
export function cookieHeaderValue(cookies: readonly SessionJarCookie[]): string | undefined {
  if (cookies.length === 0) return undefined;
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Drop `sap-contextid` when the set has no stateful session cookie. A context
 * without its session is the poison case that makes SAP answer 400, while a
 * context *with* its session is required for the request to join the session.
 */
export function sanitizeCookies(cookies: readonly SessionJarCookie[]): SessionJarCookie[] {
  if (hasStatefulSessionCookie(cookies)) return [...cookies];
  return cookies.filter((c) => !isContextCookieName(c.name));
}

/** Normalise the `set-cookie` response header into header strings. */
function setCookieValues(headers: SetCookieHeaders): string[] {
  if (!headers || typeof headers !== 'object') return [];
  const raw = (headers as Record<string, unknown>)['set-cookie'];
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string');
  return [];
}

/**
 * Live cookie set of one ADT client. Created empty; seeded from a persisted
 * jar when the session is reused; fed by every HTTP response when this
 * process logs in itself.
 */
export class SessionCookieController {
  private cookies = new Map<string, SessionJarCookie>();
  private injecting = false;

  /** Replace the live set (reuse path). Injection starts immediately. */
  seed(cookies: readonly SessionJarCookie[]): void {
    this.cookies.clear();
    for (const cookie of sanitizeCookies(cookies)) this.cookies.set(cookie.name, cookie);
    this.injecting = true;
  }

  /** Forget the live set; used before a fresh login and on release. */
  clear(): void {
    this.cookies.clear();
    this.injecting = false;
  }

  /** Start sending the live set on every request (after capture/persist). */
  enableInjection(): void {
    this.injecting = true;
  }

  get injectingCookies(): boolean {
    return this.injecting;
  }

  /** Snapshot for persistence. */
  snapshot(): SessionJarCookie[] {
    return sanitizeCookies([...this.cookies.values()]);
  }

  /** True when the live set carries a stateful SAP session cookie. */
  hasStatefulSession(): boolean {
    return hasStatefulSessionCookie([...this.cookies.values()]);
  }

  /** `SAP_SESSIONID_*` value, for diagnostics. */
  sessionId(): string | undefined {
    return [...this.cookies.values()].find((c) => isStatefulCookieName(c.name))?.value;
  }

  /** `Cookie` header value to send (undefined when not injecting). */
  headerValue(): string | undefined {
    if (!this.injecting) return undefined;
    return cookieHeaderValue([...this.cookies.values()]);
  }

  /**
   * Apply the live cookies to an outgoing request's headers. A `Cookie` header
   * already present is only overridden when we are injecting (the ADT library
   * seeds one from its own map; ours is authoritative once seeded).
   */
  applyToHeaders(headers: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    const header = this.headerValue();
    if (!header) return headers;
    return { ...(headers ?? {}), Cookie: header };
  }

  /**
   * Absorb `Set-Cookie` values from a response. Only stateful responses may
   * update the persisted identity: stateless responses hand out anonymous
   * contexts that must never be paired with a stateful session.
   */
  observeResponse(headers: SetCookieHeaders, stateful: boolean): void {
    if (!stateful) return;
    for (const raw of setCookieValues(headers)) {
      const cookie = parseSetCookie(raw);
      if (!cookie) continue;
      const existing = this.cookies.get(cookie.name);
      this.cookies.set(cookie.name, { ...existing, ...cookie });
    }
    // A stateful response can rotate the session id; never keep a context
    // cookie next to a session-less set.
    if (!hasStatefulSessionCookie([...this.cookies.values()])) {
      for (const [name] of this.cookies) {
        if (isContextCookieName(name)) this.cookies.delete(name);
      }
    }
  }
}
