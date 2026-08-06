import { getSystem, listSystemNames, upsertSystem } from './user-config.js';
import { getPassword, storePassword } from './secrets.js';

/** Portable profile bundle. Passwords excluded by default (Constitution VI). */
export interface ProfileBundle {
  format: 'abap-cli-profiles';
  version: 1;
  exportedAt: string;
  systems: {
    name: string;
    url: string;
    client: string;
    username: string;
    language: string;
    insecure?: boolean;
    ca?: string;
    password?: string;
  }[];
}

export interface ExportOptions {
  names?: string[];
  withPasswords?: boolean;
}

export interface ImportResult {
  imported: { name: string; action: 'created' | 'updated' | 'skipped' }[];
}

/**
 * Export system profiles as a portable bundle. Passwords are excluded by
 * default; `--with-passwords` includes them as an explicit, warned opt-in
 * (FR-026, Constitution VI).
 */
export async function exportProfiles(opts: ExportOptions = {}): Promise<ProfileBundle> {
  const names = opts.names && opts.names.length > 0 ? opts.names : listSystemNames();
  const systems = [];
  for (const name of names) {
    const p = getSystem(name);
    if (!p) continue;
    const entry: ProfileBundle['systems'][number] = {
      name,
      url: p.url,
      client: p.client,
      username: p.username,
      language: p.language,
      insecure: p.insecure,
      ca: p.ca,
    };
    if (opts.withPasswords) {
      const password = await getPassword(name);
      if (password) entry.password = password;
    }
    systems.push(entry);
  }
  return { format: 'abap-cli-profiles', version: 1, exportedAt: new Date().toISOString(), systems };
}

/**
 * Import a profile bundle: upsert each profile into the user config and route
 * any bundled password into the keychain (never into systems.json).
 */
export async function importProfiles(bundle: ProfileBundle): Promise<ImportResult> {
  const imported: ImportResult['imported'] = [];
  for (const entry of bundle.systems) {
    const exists = getSystem(entry.name) !== null;
    upsertSystem(entry.name, {
      url: entry.url,
      client: entry.client,
      username: entry.username,
      language: entry.language,
      insecure: entry.insecure,
      ca: entry.ca,
    });
    if (entry.password) {
      await storePassword(entry.name, entry.password);
    }
    imported.push({ name: entry.name, action: exists ? 'updated' : 'created' });
  }
  return { imported };
}
