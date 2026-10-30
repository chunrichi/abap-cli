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
 * hash). Both candidate paths (the canonical home-dir jar and the TMPDIR
 * fallback) are tried before giving up, so a stale jar on one path does not
 * hide a usable jar on the other. A `WARN session jar:` line is emitted only
 * when every candidate fails — i.e. when the caller really falls back to a
 * fresh login.
 */
/**
 * Session-jar warnings are emitted at most once per process, per kind.
 *
 * These conditions (unwritable config dir, unreadable jar) are properties of the
 * environment, not events of a single command, so warning on every invocation
 * was pure noise — and it buried the real consequence, that session reuse stops
 * working and every command performs a fresh login (feedback F-17). The first
 * occurrence is reported with an actionable hint; later ones stay silent.
 */
const jarWarningsEmitted = new Set<'read' | 'decrypt' | 'write' | 'fallback'>();

function warnJarOnce(kind: 'read' | 'decrypt' | 'write' | 'fallback', message: string): void {
  if (jarWarningsEmitted.has(kind)) return;
  jarWarningsEmitted.add(kind);
  process.stderr.write(message);
}

/**
 * Per-profile fallback jar path. Populated when the home-dir write
 * fails with a permission error; subsequent writes within the same
 * process go here without warning again. Cleared by `resetJarWarnings`
 * (test seam only) so unit tests can simulate a fresh process.
 *
 * Map keyed by `computeSystemHash(profile)` so two profiles on the same
 * machine don't collide on the fallback path.
 */
const fallbackJarPaths = new Map<string, string>();

/**
 * Compute a writable fallback path under the OS temp dir. The
 * subdirectory uses `os.tmpdir()` (respects TMPDIR on macOS/Linux,
 * falls back to /tmp) and includes the system hash so two profiles
 * do not share a fallback.
 */
function fallbackJarPath(profile: SapConfig): string {
  const hash = computeSystemHash(profile);
  // `os.tmpdir()` is async-resolved on Windows; the call is sync on every
  // supported platform, but the variable name is preserved so future ports
  // do not need to revisit this code path.
  const dir = path.join(os.tmpdir(), 'abap-cli', 'sessions');
  return path.join(dir, `${hash}.json`);
}

/** Test seam: clear the one-shot warning guard + fallback cache. */
export function resetJarWarnings(): void {
  jarWarningsEmitted.clear();
  fallbackJarPaths.clear();
}

/** Test seam: expose the current fallback path for a profile (if any). */
export function getFallbackJarPath(profile: SapConfig): string | undefined {
  return fallbackJarPaths.get(computeSystemHash(profile));
}

export async function loadJarFromDisk(profile: SapConfig, key: Buffer): Promise<SessionJar | null> {
  // S-8: try the home-dir path first; if the session was promoted to
  // the TMPDIR fallback (markJarPersisted sets it), prefer the fallback
  // so re-logins on subsequent commands keep working.
  const hash = computeSystemHash(profile);
  const primary = sessionJarPath(profile);
  const fallback = fallbackJarPaths.get(hash) ?? fallbackJarPath(profile);
  const ordered = fallbackJarPaths.has(hash) ? [fallback, primary] : [primary, fallback];
  let lastReadError: unknown = null;
  let lastDecryptError: string | null = null;
  for (const file of ordered) {
    if (!fs.existsSync(file)) continue;
    let blob: Buffer;
    try {
      blob = fs.readFileSync(file);
    } catch (error: unknown) {
      lastReadError = error;
      continue;
    }
    try {
      return decryptJar(blob, key, hash);
    } catch (error: unknown) {
      if (error instanceof CliError && error.code === 'SESSION_JAR_DECRYPT_FAILED') {
        // A jar encrypted under a rotated key must not hide a usable jar on
        // the other candidate path (e.g. the home-dir jar is stale while the
        // TMPDIR fallback still decrypts). Keep trying; warn only if none of
        // the candidates decrypts.
        lastDecryptError = error.message;
        continue;
      }
      throw error;
    }
  }
  if (lastDecryptError !== null) {
    warnJarOnce('decrypt', `WARN session jar: ${lastDecryptError}, re-logging in\n`);
    return null;
  }
  if (lastReadError !== null) {
    const msg = lastReadError instanceof Error ? lastReadError.message : String(lastReadError);
    warnJarOnce('read', `WARN session jar: cannot read jar (${msg}), re-logging in\n`);
  }
  return null;
}

/**
 * Encrypt + write a jar to disk (mkdir -p, mode 0600). Non-fatal on error.
 *
 * Resolves `true` when a copy was written to either candidate path and
 * `false` when both are unwritable — callers use that to decide whether the
 * live SAP session can be handed off to the next command or must be released
 * at command end instead of lingering as an orphan.
 */
export async function markJarPersisted(jar: SessionJar, profile: SapConfig, key: Buffer): Promise<boolean> {
  // S-8: if the home-dir write fails with a permission error, transparently
  // fall back to `$TMPDIR/abap-cli/sessions/<hash>.json` so session reuse
  // keeps working in sandboxed environments. The fallback path is cached
  // per profile so the warning fires once and later commands stay quiet.
  const hash = computeSystemHash(profile);
  const primary = sessionJarPath(profile);
  const fallback = fallbackJarPaths.get(hash) ?? fallbackJarPath(profile);
  const encrypted = encryptJar(jar, key);
  // Try the cached path first if a previous attempt promoted the fallback.
  const ordered = fallbackJarPaths.has(hash) ? [fallback, primary] : [primary, fallback];
  for (const file of ordered) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, encrypted, { mode: 0o600 });
      // Once a write succeeds on a non-primary path, surface the
      // fallback hint ONCE (per process) so the user can see why the
      // home-dir path was abandoned.
      if (file !== primary && file === fallback) {
        warnJarOnce(
          'fallback',
          `WARN session jar: home directory is not writable (${primary}). Falling back to ${file}; ` +
            'session reuse still works, but the cookie does not survive across process restarts unless ' +
            'TMPDIR is preserved. Make that directory writable to restore the default path.\n',
        );
        fallbackJarPaths.set(hash, file);
      }
      return true;
    } catch (error: unknown) {
      const code = isFsErrorCode(error);
      // Fall back when the primary path is structurally unwritable:
      //   - permission denied (EPERM / EACCES)
      //   - read-only filesystem (EROFS)
      //   - parent path is a file, not a directory (ENOTDIR) — e.g.
      //     the sandbox redirected $HOME to a regular file
      if (code === 'EPERM' || code === 'EACCES' || code === 'EROFS' || code === 'ENOTDIR') {
        if (file === primary) {
          // Promote the fallback so subsequent writes (within the same
          // process) skip the doomed primary path entirely.
          fallbackJarPaths.set(hash, fallback);
          continue;
        }
      }
      // Anything else: surface the original failure.
      const msg = error instanceof Error ? error.message : String(error);
      warnJarOnce(
        'write',
        `WARN session jar: cannot write ${file} (${msg}). ` +
          'Session reuse is disabled for this run (every command will log in again); ' +
          'inspect the current state with `abap session`.\n',
      );
      return false;
    }
  }
  return false;
}

/** Extract the `code` from an `Error` thrown by the `fs` module, when present. */
function isFsErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
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
