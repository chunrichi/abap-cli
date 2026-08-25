import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CliError } from '../output/json.js';

/** Default TTL for SSO cookies (matches SAP_SESSIONID lifetime). */
export const SSO_COOKIE_TTL_MS = 30 * 60 * 1000;

/** One cookie parsed from a browser header (CR/LF stripped — header injection guard). */
export interface SsoCookie {
  name: string;
  value: string;
}

/** On-disk shape (timestamp + cookie list). Versioned for future migrations. */
export interface SsoCookieStore {
  format: 'abap-cli-sso-cookies';
  version: 1;
  /** ms since epoch when cookies were last refreshed. */
  capturedAt: number;
  cookies: SsoCookie[];
}

const STORE_DIR = path.join(os.homedir(), '.abap-cli');

/** Default cookie jar location for a profile — `~/.abap-cli/<profile>.sso.cookies.json` */
export function defaultCookieFile(profileName: string): string {
  return path.join(STORE_DIR, `${profileName}.sso.cookies.json`);
}

/** Strip CR/LF and surrounding whitespace — prevents HTTP header injection. */
export function sanitizeCookieNameOrValue(raw: string): string {
  return raw.replace(/[\r\n\t]/g, '').trim();
}

/**
 * Parse a raw `Cookie:` header (e.g. from `Copy as cURL` or browser DevTools)
 * into a list of `{name, value}` pairs. Order preserved; duplicate names kept
 * (SAP sometimes sets multiple cookies with the same name across subdomains).
 */
export function parseCookieHeader(header: string): SsoCookie[] {
  const pairs = header.split(/;\s*/).filter(Boolean);
  return pairs.map((p) => {
    const idx = p.indexOf('=');
    if (idx === -1) return { name: sanitizeCookieNameOrValue(p), value: '' };
    return {
      name: sanitizeCookieNameOrValue(p.slice(0, idx)),
      value: sanitizeCookieNameOrValue(p.slice(idx + 1)),
    };
  });
}

/** Reassemble a `Cookie:` header from a cookie list. */
export function buildCookieHeader(cookies: SsoCookie[]): string {
  return cookies
    .filter((c) => c.name.length > 0)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

/** Persist a fresh cookie set; overwrites any existing file. */
export async function writeCookieStore(file: string, cookies: SsoCookie[]): Promise<void> {
  if (cookies.length === 0) {
    throw new CliError('INVALID_ARGUMENT', 'No cookies to save.');
  }
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const store: SsoCookieStore = {
    format: 'abap-cli-sso-cookies',
    version: 1,
    capturedAt: Date.now(),
    cookies,
  };
  fs.writeFileSync(file, JSON.stringify(store, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
}

/** Read a cookie store. Returns null when missing, corrupt, or expired (per TTL). */
export function readCookieStore(file: string, now: number = Date.now()): SsoCookieStore | null {
  if (!file) return null;
  if (!fs.existsSync(file)) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError('CONFIG_ERROR', `Cannot read SSO cookie file '${file}': ${message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as Partial<SsoCookieStore>).format !== 'abap-cli-sso-cookies' ||
    !Array.isArray((parsed as Partial<SsoCookieStore>).cookies) ||
    typeof (parsed as Partial<SsoCookieStore>).capturedAt !== 'number'
  ) {
    return null;
  }
  const store = parsed as SsoCookieStore;
  if (now - store.capturedAt > SSO_COOKIE_TTL_MS) return null;
  return store;
}

/** Delete a cookie jar (silent when missing). Used by `profile delete`. */
export function clearCookieStore(file: string): boolean {
  try {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}