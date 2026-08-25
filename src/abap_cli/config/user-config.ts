import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CliError } from '../output/json.js';
import type { AuthConfig } from '../auth/v2-types.js';
import { normalizeAuth } from '../auth/normalize.js';

/**
 * Canonical SystemProfile (v2). The on-disk shape may still be v1 (flat
 * `authMethod` + optional blocks); `loadUserConfig` always normalises to v2
 * before returning. `upsertSystem` always writes v2.
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
  /** Canonical auth config (v2 discriminated union). Replaces flat authMethod + blocks. */
  auth: AuthConfig;
  /** SAP release recorded at connect time (diagnostics). */
  systemVersion?: string;
  /** ADT text-element capability recorded once at connect/init (Q1). */
  adtTextpool?: { read: boolean; write: boolean; checkedAt: string };
  /** 034: Cached ADT runtime tier from the last successful `probeAdtRuntime` /
   *  `profile test`. Used by `extension deploy` to pick an ICF register
   *  strategy without re-probing the network. Refreshed by `profile test`
   *  and `init`. Absent on first use — `probeAdtRuntime` runs lazily. */
  runtime?: CachedRuntime;
}

/** Subset of RuntimeProbeResult that is safe to serialise on disk (034).
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

/** Marker field — set when a profile has been written in v2 shape. */
const MIGRATION_FLAG = '__abapCliAuthShape';
const MIGRATED_TO_V2 = 'v2';

/**
 * Load user-level system profiles from ~/.abap-cli/systems.json.
 * Returns an empty config if the file does not exist; throws if it is corrupt.
 * Accepts both v1 and v2 on-disk shapes — v1 entries are normalised in memory.
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
      ],
      example: `abap profile add <name> --url <url> --username <user> --password <pwd>`,
    });
  }
  const raw = (parsed ?? {}) as { systems?: Record<string, unknown> };
  const systems: Record<string, SystemProfile> = {};
  for (const [name, entry] of Object.entries(raw.systems ?? {})) {
    systems[name] = normaliseStoredProfile(name, entry);
  }
  return { systems };
}

/** Convert an arbitrary stored entry (v1 or v2) to a canonical v2 SystemProfile. */
function normaliseStoredProfile(name: string, raw: unknown): SystemProfile {
  if (!raw || typeof raw !== 'object') {
    throw new CliError('CONFIG_ERROR', `Profile '${name}' in ${CONFIG_PATH} is not an object.`, {
      file: CONFIG_PATH,
      nextSteps: [`Delete or re-add the profile: abap profile add ${name} --url <url> --username <user>`],
    });
  }
  const r = raw as Record<string, unknown>;
  const url = typeof r.url === 'string' ? r.url : '';
  const username = typeof r.username === 'string' ? r.username : '';
  if (!url) {
    throw new CliError('CONFIG_ERROR', `Profile '${name}' is missing required 'url'.`, {
      file: CONFIG_PATH,
      nextSteps: [`Re-add the profile: abap profile set ${name} --url <url>`],
    });
  }
  if (!username) {
    throw new CliError('CONFIG_ERROR', `Profile '${name}' is missing required 'username'.`, {
      file: CONFIG_PATH,
      nextSteps: [`Re-add the profile: abap profile set ${name} --username <user>`],
    });
  }
  const auth = normaliseAuthField(r);
  return {
    url,
    client: typeof r.client === 'string' ? r.client : '100',
    username,
    language: typeof r.language === 'string' ? r.language : 'EN',
    ...(typeof r.insecure === 'boolean' ? { insecure: r.insecure } : {}),
    ...(typeof r.ca === 'string' && r.ca ? { ca: r.ca } : {}),
    auth,
    ...(typeof r.systemVersion === 'string' ? { systemVersion: r.systemVersion } : {}),
    ...(r.adtTextpool && typeof r.adtTextpool === 'object' ? { adtTextpool: r.adtTextpool as SystemProfile['adtTextpool'] } : {}),
    ...(r.runtime && typeof r.runtime === 'object' ? { runtime: r.runtime as SystemProfile['runtime'] } : {}),
  };
}

function normaliseAuthField(r: Record<string, unknown>) {
  // Strip the migration flag before passing to the type-driven normalizer.
  const { [MIGRATION_FLAG]: _flag, ...rest } = r;
  return normalizeAuth(rest as Parameters<typeof normalizeAuth>[0]);
}

/**
 * Save user-level system profiles to ~/.abap-cli/systems.json.
 * Creates the directory with 700 permissions if needed.
 * Always writes v2 (canonical) shape.
 */
export function saveUserConfig(config: UserConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const out: Record<string, unknown> = {};
  for (const [name, profile] of Object.entries(config.systems)) {
    out[name] = { ...profile, [MIGRATION_FLAG]: MIGRATED_TO_V2 };
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ systems: out }, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
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
 * Returns the canonical v2 shape (v1 entries on disk are normalised in memory).
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