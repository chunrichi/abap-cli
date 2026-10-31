import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CliError } from '../output/json.js';
import { CONFIG_ERROR_REFERENCE } from './recovery.js';

/**
 * Canonical user-level SystemProfile. Profiles created by older versions may
 * still declare a removed auth method (`cert` / `browser_sso` / `oauth_password`
 * / `sso`) plus its credential blocks; `loadUserConfig` ignores those fields
 * and records `unsupportedAuth` in memory so connection attempts can point the
 * user at the migration step. `saveUserConfig` never writes the marker.
 */
export interface SystemProfile {
  url: string;
  client: string;
  username: string;
  language: string;
  /** Skip SSL certificate verification (self-signed certs, development only). */
  insecure?: boolean;
  /** Path to a CA certificate (PEM) used for SSL verification. */
  ca?: string;
  /** ISO timestamp of when the PEM behind `ca` entered the cert store. */
  caImportedAt?: string;
  /**
   * In-memory only: the auth method a stored entry still declares but the CLI
   * no longer supports. Empty for profiles that were always basic.
   */
  unsupportedAuth?: string;
  /** SAP release recorded at connect time (diagnostics). */
  systemVersion?: string;
  /** optional system flavour tag — drives cookie reuse opt-in/out. */
  systemType?: 'on-prem' | 'cloud' | 'btp' | 'mock';
  /** session policy override at the profile level. */
  sessionPolicy?: 'reuse' | 'always-logout' | 'default';
  /** ADT text-element capability recorded once at connect/init. */
  adtTextpool?: { read: boolean; write: boolean; checkedAt: string };
  /** Cached ADT runtime tier from the last successful `probeAdtRuntime`
   *  `profile test`. Used by `deploy` to pick an ICF register
   *  strategy without re-probing the network. Refreshed by `profile test`
   *  and `init`. Absent on first use — `probeAdtRuntime` runs lazily. */
  runtime?: CachedRuntime;
}

/** Subset of RuntimeProbeResult that is safe to serialise on disk.
 *  Mirrors runtime-probe.ts fields but lives here to avoid a circular import. */
export interface CachedRuntime {
  tier: 'netweaver740' | 'netweaver750' | 'steampunk' | 'unknown';
  sapComponent?: string;
  release?: string;
  icfSetupBlocked: boolean;
  /** Endpoint where the verdict was sourced from. */
  source: 'informationsystem' | 'discovery' | 'none';
  /** Optional API capability summary (when probed via discovery). */
  apiCapabilities?: {
    icf: { available: boolean; primaryPath?: string };
    httpService: { available: boolean; acceptsMime?: string; createAuthRequired?: boolean };
    steampunkMarkers?: string[];
  };
  probedAt: string;
}

export interface UserConfig {
  systems: Record<string, SystemProfile>;
}

const CONFIG_DIR = path.join(os.homedir(), '.abap-cli');
const CONFIG_PATH = path.join(CONFIG_DIR, 'systems.json');

/** Written to `systems.json` so future migrations can branch on a version
 *  instead of sniffing individual legacy fields. Readers ignore it today. */
export const USER_CONFIG_FORMAT_VERSION = 1;

/**
 * Load user-level system profiles from ~/.abap-cli/systems.json.
 * Returns an empty config if the file does not exist; throws if it is corrupt.
 * Removed auth fields on disk are ignored (see `SystemProfile.unsupportedAuth`).
 */
export function loadUserConfig(): UserConfig {
  if (!fs.existsSync(CONFIG_PATH)) return { systems: {} };
  let parsed: unknown;
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError('CONFIG_ERROR', `Cannot parse user config ${CONFIG_PATH}: ${message}. Fix or delete the file.`, {
      file: CONFIG_PATH,
      nextSteps: [
        `Open ${CONFIG_PATH} and fix the JSON, or delete it (your system profiles will need to be re-added).`,
        'Then re-create the profile: abap profile add <name> --url <url> --username <user>',
      ],
      example: `abap profile add <name> --url <url> --username <user> --password <pwd>`,
      references: CONFIG_ERROR_REFERENCE,
    });
  }
  const raw = (parsed ?? {}) as { systems?: Record<string, unknown> };
  const systems: Record<string, SystemProfile> = {};
  for (const [name, entry] of Object.entries(raw.systems ?? {})) {
    systems[name] = normaliseStoredProfile(name, entry);
  }
  return { systems };
}

/** Convert an arbitrary stored entry to the canonical SystemProfile. */
function normaliseStoredProfile(name: string, raw: unknown): SystemProfile {
  if (!raw || typeof raw !== 'object') {
    throw new CliError('CONFIG_ERROR', `Profile '${name}' in ${CONFIG_PATH} is not an object.`, {
      file: CONFIG_PATH,
      nextSteps: [`Delete or re-add the profile: abap profile add ${name} --url <url> --username <user>`],
      example: `abap profile add ${name} --url https://sap.example.com --username DEV`,
      references: CONFIG_ERROR_REFERENCE,
    });
  }
  const r = raw as Record<string, unknown>;
  const url = typeof r.url === 'string' ? r.url : '';
  const username = typeof r.username === 'string' ? r.username : '';
  if (!url) {
    throw new CliError('CONFIG_ERROR', `Profile '${name}' is missing required 'url'.`, {
      file: CONFIG_PATH,
      nextSteps: [`Re-add the profile: abap profile set ${name} --url <url>`],
      example: `abap profile set ${name} --url https://sap.example.com`,
      references: CONFIG_ERROR_REFERENCE,
      details: { missing: ['url'], profile: name },
    });
  }
  if (!username) {
    throw new CliError('CONFIG_ERROR', `Profile '${name}' is missing required 'username'.`, {
      file: CONFIG_PATH,
      nextSteps: [`Re-add the profile: abap profile set ${name} --username <user>`],
      example: `abap profile set ${name} --username DEV`,
      references: CONFIG_ERROR_REFERENCE,
      details: { missing: ['username'], profile: name },
    });
  }
  const unsupportedAuth = detectUnsupportedAuth(r);
  return {
    url,
    client: typeof r.client === 'string' ? r.client : '100',
    username,
    language: typeof r.language === 'string' ? r.language : 'EN',
    ...(typeof r.insecure === 'boolean' ? { insecure: r.insecure } : {}),
    ...(typeof r.ca === 'string' && r.ca ? { ca: r.ca } : {}),
    ...(typeof r.caImportedAt === 'string' && r.caImportedAt ? { caImportedAt: r.caImportedAt } : {}),
    ...(unsupportedAuth ? { unsupportedAuth } : {}),
    ...(typeof r.systemVersion === 'string' ? { systemVersion: r.systemVersion } : {}),
    ...(r.adtTextpool && typeof r.adtTextpool === 'object' ? { adtTextpool: r.adtTextpool as SystemProfile['adtTextpool'] } : {}),
    ...(r.runtime && typeof r.runtime === 'object' ? { runtime: r.runtime as SystemProfile['runtime'] } : {}),
  };
}

/**
 * Detect auth methods the CLI no longer supports on a stored profile entry.
 * Both the canonical `auth` block and the flat pre-canonical fields are read so
 * profiles written by every earlier version surface the same migration hint.
 */
function detectUnsupportedAuth(r: Record<string, unknown>): string | undefined {
  const auth = r.auth;
  if (auth && typeof auth === 'object') {
    const method = (auth as { method?: unknown }).method;
    if (typeof method === 'string' && method !== 'basic' && method !== '') return method;
  }
  const flat = r.authMethod;
  if (typeof flat === 'string' && flat !== '' && flat !== 'basic') return flat;
  if (r.certAuth) return 'cert';
  if (r.oauthPassword) return 'oauth_password';
  if (r.ssoCookieFile) return 'browser_sso';
  if (r.negotiate) return 'sso';
  return undefined;
}

/**
 * Save user-level system profiles to ~/.abap-cli/systems.json.
 * Creates the directory with 700 permissions if needed. The in-memory
 * `unsupportedAuth` marker is never persisted.
 */
export function saveUserConfig(config: UserConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const out: Record<string, unknown> = {};
  for (const [name, profile] of Object.entries(config.systems)) {
    const { unsupportedAuth: _unsupported, ...canonical } = profile;
    void _unsupported;
    out[name] = canonical;
  }
  fs.writeFileSync(
    CONFIG_PATH,
    JSON.stringify({ formatVersion: USER_CONFIG_FORMAT_VERSION, systems: out }, null, 2) + '\n',
    { encoding: 'utf-8', mode: 0o600 },
  );
}

/**
 * Add or update a system profile by name.
 */
export function upsertSystem(name: string, profile: SystemProfile): void {
  const config = loadUserConfig();
  config.systems[name] = profile;
  saveUserConfig(config);
}

/**
 * Get a system profile by name, or null if not found.
 */
export function getSystem(name: string): SystemProfile | null {
  return loadUserConfig().systems[name] ?? null;
}

/**
 * List all system profile names sorted alphabetically.
 */
export function listSystemNames(): string[] {
  return Object.keys(loadUserConfig().systems).sort();
}

/**
 * Delete a system profile by name.
 * Returns true if it existed and was removed, false if it did not exist.
 */
export function deleteSystem(name: string): boolean {
  const config = loadUserConfig();
  if (!(name in config.systems)) return false;
  delete config.systems[name];
  saveUserConfig(config);
  return true;
}
