import { getSystem, listSystemNames, upsertSystem, type SystemProfile } from './user-config.js';
import { getPassword, storePassword } from './secrets.js';
import { CliError } from '../output/json.js';
import { assertValidProfileName, normalizeProfileUrl } from './validation.js';
import { collectWarning } from '../output/meta.js';

/**
 * Portable profile bundle. Passwords are excluded by default; `--with-passwords`
 * includes them as an explicit, warned opt-in.
 */
export interface ProfileBundle {
  format: 'abap-cli-profiles';
  version: 3;
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
 */
export async function exportProfiles(opts: ExportOptions = {}): Promise<ProfileBundle> {
  const names = opts.names && opts.names.length > 0 ? opts.names : listSystemNames();
  const systems: ProfileBundleEntry[] = [];
  for (const name of names) {
    const p = getSystem(name);
    if (!p) continue;
    if (p.unsupportedAuth) {
      throw new CliError(
        'CONFIG_ERROR',
        `Profile '${name}' still uses the removed '${p.unsupportedAuth}' auth method; only basic auth can be exported.`,
        {
          nextSteps: [`Store a password to migrate it: abap profile set ${name} --password <password>`],
          example: `abap profile set ${name} --password <password>`,
        },
      );
    }
    const entry: ProfileBundleEntry = {
      name,
      url: p.url,
      client: p.client,
      username: p.username,
      language: p.language,
      ...(p.insecure !== undefined ? { insecure: p.insecure } : {}),
      ...(p.ca ? { ca: p.ca } : {}),
    };
    if (opts.withPasswords) {
      const password = await getPassword(name);
      if (password) entry.password = password;
    }
    systems.push(entry);
  }
  return { format: 'abap-cli-profiles', version: 3, exportedAt: new Date().toISOString(), systems };
}

/**
 * Import a profile bundle. Bundles that still carry a removed auth method are
 * rejected: the CLI only logs in with basic auth. Existing profiles are skipped
 * unless `overwrite` is set; bundled passwords go to the keychain, never to
 * disk in plain text.
 */
export async function importProfiles(bundle: ProfileBundle, opts: ImportOptions = {}): Promise<ImportResult> {
  const imported: ImportResult['imported'] = [];
  for (const entry of bundle.systems) {
    assertValidProfileName(entry.name);
    const unsupported = detectUnsupportedAuth(entry);
    if (unsupported) {
      throw new CliError(
        'CONFIG_ERROR',
        `Profile '${entry.name}' in the bundle uses the removed '${unsupported}' auth method; only basic auth is supported.`,
        {
          nextSteps: [
            `Recreate the profile on the target machine with basic auth: abap profile add ${entry.name} --url ${entry.url} --username ${entry.username} --password <password>`,
          ],
          example: `abap profile add ${entry.name} --url ${entry.url} --username ${entry.username} --password <password>`,
        },
      );
    }
    const exists = getSystem(entry.name) !== null;
    if (exists && !opts.overwrite) {
      imported.push({ name: entry.name, action: 'skipped' });
      continue;
    }
    const normalized = normalizeProfileUrl(entry.url);
    if (normalized.dropped.length > 0) {
      collectWarning(
        'URL_NORMALIZED',
        `Profile '${entry.name}': URL normalized to '${normalized.url}' — dropped ${normalized.dropped.join(', ')}.`,
      );
    }
    const profile: SystemProfile = {
      url: normalized.url,
      client: entry.client,
      username: entry.username,
      language: entry.language,
      ...(entry.insecure !== undefined ? { insecure: entry.insecure } : {}),
      ...(entry.ca ? { ca: entry.ca } : {}),
    };
    upsertSystem(entry.name, profile);
    if (entry.password) {
      await storePassword(entry.name, entry.password);
    }
    imported.push({ name: entry.name, action: exists ? 'updated' : 'created' });
  }
  return { imported };
}

/**
 * Detect the removed auth fields older bundles may still carry (v2 bundles wrote
 * a canonical `auth` block; v1 bundles wrote flat `authMethod` + credential
 * blocks). Basic auth declarations are ignored.
 */
function detectUnsupportedAuth(entry: ProfileBundleEntry): string | undefined {
  const raw = entry as unknown as Record<string, unknown>;
  const auth = raw.auth;
  if (auth && typeof auth === 'object') {
    const method = (auth as { method?: unknown }).method;
    if (typeof method === 'string' && method !== '' && method !== 'basic') return method;
  }
  const flat = raw.authMethod;
  if (typeof flat === 'string' && flat !== '' && flat !== 'basic') return flat;
  if (raw.certAuth) return 'cert';
  if (raw.oauthPassword) return 'oauth_password';
  if (raw.ssoCookieFile) return 'browser_sso';
  if (raw.negotiate) return 'sso';
  return undefined;
}
