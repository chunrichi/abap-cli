import { getSystem, listSystemNames, upsertSystem, type SystemProfile } from './user-config.js';
import { getPassword, storePassword } from './secrets.js';
import { normalizeAuth } from '../auth/normalize.js';

/**
 * Portable profile bundle. Both v1 (flat authMethod + blocks) and v2 (canonical
 * `auth`) shapes are accepted on import; v1 entries are normalised in memory
 * before storage. On export we always emit v2 (canonical).
 */
export interface ProfileBundle {
  format: 'abap-cli-profiles';
  version: 2;
  exportedAt: string;
  systems: ProfileBundleEntry[];
}

export interface ProfileBundleEntry {
  name: string;
  url: string;
  client: string;
  username: string;
  language: string;
  insecure?: boolean;
  ca?: string;
  /** Canonical v2 auth config. v1 entries (authMethod + blocks) are also accepted. */
  auth?: SystemProfile['auth'];
  /** Legacy v1 fields — kept for back-compat reads of pre-v2 bundles. */
  authMethod?: 'basic' | 'cert' | 'browser_sso' | 'oauth_password';
  certAuth?: { certPath: string; keyPath: string; caPath?: string };
  ssoCookieFile?: string;
  oauthPassword?: { uaaUrl: string; clientId: string; clientSecret: string; serviceKeyFile?: string };
  password?: string;
}

export interface ExportOptions {
  names?: string[];
  withPasswords?: boolean;
}

export interface ImportOptions {
  /** Update profiles that already exist (default: skip them). */
  overwrite?: boolean;
}

export interface ImportResult {
  imported: { name: string; action: 'created' | 'updated' | 'skipped' }[];
}

/**
 * Export system profiles as a portable bundle. Passwords are excluded by
 * default; `--with-passwords` includes them as an explicit, warned opt-in.
 * Always emits the canonical v2 auth shape.
 */
export async function exportProfiles(opts: ExportOptions = {}): Promise<ProfileBundle> {
  const names = opts.names && opts.names.length > 0 ? opts.names : listSystemNames();
  const systems: ProfileBundleEntry[] = [];
  for (const name of names) {
    const p = getSystem(name);
    if (!p) continue;
    const entry: ProfileBundleEntry = {
      name,
      url: p.url,
      client: p.client,
      username: p.username,
      language: p.language,
      ...(p.insecure !== undefined ? { insecure: p.insecure } : {}),
      ...(p.ca ? { ca: p.ca } : {}),
      auth: p.auth,
    };
    if (opts.withPasswords) {
      const password = await getPassword(name);
      if (password) entry.password = password;
    }
    systems.push(entry);
  }
  return { format: 'abap-cli-profiles', version: 2, exportedAt: new Date().toISOString(), systems };
}

/**
 * Import a profile bundle. Accepts both v1 (legacy authMethod+blocks) and v2
 * (canonical auth) entry shapes; v1 entries are normalised to the canonical
 * form via `normalizeAuth`. Existing profiles are skipped unless `overwrite`
 * is set; any bundled password is routed into the keychain (never stored on
 * disk in plain text).
 */
export async function importProfiles(bundle: ProfileBundle, opts: ImportOptions = {}): Promise<ImportResult> {
  const imported: ImportResult['imported'] = [];
  for (const entry of bundle.systems) {
    const exists = getSystem(entry.name) !== null;
    if (exists && !opts.overwrite) {
      imported.push({ name: entry.name, action: 'skipped' });
      continue;
    }
    const auth = entry.auth ?? legacyToCanonical(entry);
    const profile: SystemProfile = {
      url: entry.url,
      client: entry.client,
      username: entry.username,
      language: entry.language,
      ...(entry.insecure !== undefined ? { insecure: entry.insecure } : {}),
      ...(entry.ca ? { ca: entry.ca } : {}),
      auth,
    };
    upsertSystem(entry.name, profile);
    if (entry.password) {
      await storePassword(entry.name, entry.password);
    }
    imported.push({ name: entry.name, action: exists ? 'updated' : 'created' });
  }
  return { imported };
}

/** Convert a legacy v1 bundle entry to canonical auth via the v1 normaliser. */
function legacyToCanonical(entry: ProfileBundleEntry): SystemProfile['auth'] {
  // Delegate to the same normaliser used for stored profiles — any inconsistency
  // throws `CONFIG_ERROR` rather than silently writing a broken profile.
  return normalizeAuth({
    ...(entry.authMethod !== undefined ? { authMethod: entry.authMethod } : {}),
    ...(entry.certAuth ? { certAuth: entry.certAuth } : {}),
    ...(entry.ssoCookieFile ? { ssoCookieFile: entry.ssoCookieFile } : {}),
    ...(entry.oauthPassword ? { oauthPassword: entry.oauthPassword } : {}),
  });
}