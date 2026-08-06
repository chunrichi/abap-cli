import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getPassword } from '../crypto/secrets.js';
import { getSystem } from './user-config.js';
import { CliError } from '../output/json.js';

export interface SapConfig {
  url: string;
  client: string;
  username: string;
  password: string;
  language: string;
  /** Skip SSL certificate verification (self-signed certs, development only). */
  insecure: boolean;
  /** Path to a CA certificate (PEM) used for SSL verification. */
  caPath: string;
  /** Base directory for `push --all` / `check --all`; falls back to cwd. */
  sourceDir: string;
}

export interface ProjectConfig {
  sap: SapConfig;
  transport: string;
  package: string;
  /** 014: current system name (for capability reads / route decisions). */
  systemName: string;
  /** 014: ADT text-element capability recorded at connect/init (Q1, optional). */
  adtTextpool?: { read: boolean; write: boolean; checkedAt: string };
  systemVersion?: string;
}

/** Cached profile data minus the password, which is re-read on every load. */
interface LoadedConfig {
  systemName: string;
  sap: Omit<SapConfig, 'password'>;
  transport: string;
  package: string;
  adtTextpool?: { read: boolean; write: boolean; checkedAt: string };
  systemVersion?: string;
}

let cached: LoadedConfig | null = null;
let cachedMtimes: { configPath: number; systemsPath: number } | null = null;

const SYSTEMS_PATH = path.join(os.homedir(), '.abap-cli', 'systems.json');

function fileMtime(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

function currentMtimes(): { configPath: number; systemsPath: number } {
  return {
    configPath: fileMtime(path.resolve(process.cwd(), '.abap.json')),
    systemsPath: fileMtime(SYSTEMS_PATH),
  };
}

/**
 * Load project configuration from .abap.json (system reference) + user-level system profile + OS keychain.
 * The file cache auto-invalidates on mtime change (abap config / connection set); the
 * password is re-read from the keychain every call so updates apply immediately.
 */
export async function loadConfig(): Promise<ProjectConfig> {
  const mtimes = currentMtimes();
  if (!cached || !cachedMtimes || cachedMtimes.configPath !== mtimes.configPath || cachedMtimes.systemsPath !== mtimes.systemsPath) {
    cached = await loadFileConfig();
    cachedMtimes = mtimes;
  }

  const password = (await getPassword(cached.systemName)) || process.env.SAP_PASSWORD || '';
  return {
    sap: { ...cached.sap, password },
    transport: cached.transport,
    package: cached.package,
    systemName: cached.systemName,
    adtTextpool: cached.adtTextpool,
    systemVersion: cached.systemVersion,
  };
}

async function loadFileConfig(): Promise<LoadedConfig> {
  // Load .abap.json — workspace references a user-level system profile
  let workspace: { system?: string; transport?: string; package?: string; sourceDir?: string } = {};
  const configPath = path.resolve(process.cwd(), '.abap.json');
  if (fs.existsSync(configPath)) {
    try {
      workspace = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      // ignore parse errors
    }
  }

  const systemName = workspace.system || '';
  const profile = systemName ? getSystem(systemName) : null;
  if (!profile) {
    throw new CliError(
      'CONFIG_ERROR',
      systemName
        ? `System profile '${systemName}' not found. Run 'abap config' to configure it.`
        : 'Missing "system" in .abap.json. Run \'abap config\' to set up.',
    );
  }

  // Validate required fields
  const missing: string[] = [];
  if (!profile.url) missing.push('url in system profile');
  if (!profile.username) missing.push('username in system profile');
  if (missing.length > 0) {
    throw new CliError(
      'CONFIG_ERROR',
      `Missing required configuration: ${missing.join(', ')}. Run 'abap config' to set up.`,
    );
  }

  return {
    systemName,
    sap: {
      url: profile.url,
      client: profile.client || '100',
      username: profile.username,
      language: profile.language || 'EN',
      insecure: profile.insecure ?? (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0'),
      caPath: profile.ca || '',
      sourceDir: workspace.sourceDir || process.cwd(),
    },
    transport: workspace.transport || '',
    package: workspace.package || '',
    adtTextpool: profile.adtTextpool,
    systemVersion: profile.systemVersion,
  };
}

/**
 * Read a CA certificate (PEM) from disk. Returns undefined when no path is
 * configured; throws CONFIG_ERROR if the file cannot be read.
 */
export function readCaCertificate(caPath: string): string | undefined {
  if (!caPath) return undefined;
  try {
    return fs.readFileSync(caPath, 'utf-8');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError('CONFIG_ERROR', `Cannot read CA certificate '${caPath}': ${message}`);
  }
}

/**
 * Reset cached config (for testing).
 */
export function resetConfig(): void {
  cached = null;
  cachedMtimes = null;
}
