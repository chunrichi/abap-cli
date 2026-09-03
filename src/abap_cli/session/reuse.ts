/**
 * Session reuse — bridge between the on-disk `SessionJar` and live
 * `ADTClient` / axios instances.
 *
 * The library (`abap-adt-api`) keeps cookies in a TS-private `Map` and
 * offers public `csrfToken` getter/setter + `ascookies()`. Injecting a
 * saved session is done in two halves:
 *   - seed the cookie map so `ascookies()` (and thus the `Cookie` header)
 *     yields the persisted `SAP_SESSIONID_*`;
 *   - set `csrfToken` to a non-`fetch` value so `loggedin` is true and the
 *     automatic `login()` round-trip is skipped.
 *
 * Because `login()` clears the cookie map, we only seed when we intend to
 * skip login; after a fresh login we *capture* the new cookie map back into
 * the jar.
 *
 * The private-map access is deliberately concentrated here (single `as`
 * cast site) so the rest of the codebase stays type-safe.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CliError } from '../output/json.js';
import type { SapConfig } from '../config/project-config.js';
import { computeSystemHash, decryptJar, encryptJar, type SessionJar } from './jar.js';

/** `~/.abap-cli/sessions/<system-hash>.json` for a profile. */
export function sessionJarPath(profile: SapConfig): string {
  const hash = computeSystemHash(profile);
  return path.join(os.homedir(), '.abap-cli', 'sessions', `${hash}.json`);
}

/** Serialize jar cookies into a `Cookie` header value (`name=value; …`). */
export function jarCookieHeader(jar: SessionJar): string {
  return jar.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Read + decrypt the jar for a profile. Returns `null` when there is no jar
 * or when it cannot be trusted (missing file, corrupt blob, wrong system
 * hash) — each failure path logs a one-line `WARN session jar:` to stderr
 * so the caller can fall back to a fresh login without surprising the user.
 */
export async function loadJarFromDisk(profile: SapConfig, key: Buffer): Promise<SessionJar | null> {
  const file = sessionJarPath(profile);
  if (!fs.existsSync(file)) return null;
  let blob: Buffer;
  try {
    blob = fs.readFileSync(file);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`WARN session jar: cannot read ${file} (${msg}), re-logging in\n`);
    return null;
  }
  try {
    return decryptJar(blob, key, computeSystemHash(profile));
  } catch (error: unknown) {
    if (error instanceof CliError && error.code === 'SESSION_JAR_DECRYPT_FAILED') {
      process.stderr.write(`WARN session jar: ${error.message}, re-logging in\n`);
      return null;
    }
    throw error;
  }
}

/** Encrypt + write a jar to disk (mkdir -p, mode 0600). Non-fatal on error. */
export async function markJarPersisted(jar: SessionJar, profile: SapConfig, key: Buffer): Promise<void> {
  const file = sessionJarPath(profile);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, encryptJar(jar, key), { mode: 0o600 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`WARN session jar: cannot write ${file} (${msg})\n`);
  }
}

/** Delete the on-disk jar for a profile (best-effort; used on logout). */
export function clearJarFromDisk(profile: SapConfig): void {
  const file = sessionJarPath(profile);
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // best-effort — nothing to surface to the caller
  }
}

/**
 * Minimal structural view of `ADTClient.httpClient` (an `AdtHTTP`). We only
 * reach for `cookie` (private at the type level) and the public csrf surface.
 */
interface AdtHttpLike {
  cookie?: Map<string, string>;
  csrfToken?: string;
  ascookies?(): string;
}

/**
 * Seed a live ADT client from a saved jar so the next request reuses the
 * SAP session instead of opening a new one. Sets `csrfToken` (public setter)
 * to the persisted value — a non-`fetch` token makes `loggedin` true, which
 * tells `AdtHTTP.request()` to skip the automatic login round-trip.
 */
export function injectSessionIntoAdt(client: { httpClient: unknown }, jar: SessionJar): void {
  const http = client.httpClient as AdtHttpLike;
  if (http.cookie) {
    http.cookie.clear();
    for (const c of jar.cookies) {
      http.cookie.set(c.name, `${c.name}=${c.value}`);
    }
  }
  if (jar.csrf.value) {
    (client.httpClient as { csrfToken?: string }).csrfToken = jar.csrf.value;
  }
}

/**
 * Pull the live cookie map + csrf back into `jar` after a fresh login (or a
 * fallback re-login). Caller persists the jar with `markJarPersisted`.
 */
export function captureSessionFromAdt(client: { httpClient: unknown }, jar: SessionJar): void {
  const http = client.httpClient as AdtHttpLike;
  const cookies: SessionJar['cookies'] = [];
  if (http.cookie) {
    for (const [name, entry] of http.cookie) {
      // entry is stored as `name=value` (path/expiry stripped by the lib).
      const eq = entry.indexOf('=');
      cookies.push({ name, value: eq >= 0 ? entry.slice(eq + 1) : entry });
    }
  }
  jar.cookies = cookies;
  const csrf = (client.httpClient as { csrfToken?: string }).csrfToken;
  if (csrf) {
    jar.csrf = { value: csrf, fetchedAt: new Date().toISOString() };
  }
}

/** Remove the `Cookie` header an axios instance would otherwise send. */
export function icfCookieHeader(jar: SessionJar): string | undefined {
  const header = jarCookieHeader(jar);
  return header.length > 0 ? header : undefined;
}
