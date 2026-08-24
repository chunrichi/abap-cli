import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getPassword } from './secrets.js';
import { getSystem } from './user-config.js';
import { CliError } from '../output/json.js';
import type { ExtensionManifest } from '../extensions/types.js';
import type { AuthConfig } from '../auth/v2-types.js';

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
  /** Canonical v2 auth config (discriminated union). */
  auth: AuthConfig;
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
  /** 023: registered extension manifests from .abap.json */
  extensions?: ExtensionManifest[];
}

/** Cached profile data minus the password, which is re-read on every load. */
interface LoadedConfig {
  systemName: string;
  sap: Omit<SapConfig, 'password'>;
  transport: string;
  package: string;
  adtTextpool?: { read: boolean; write: boolean; checkedAt: string };
  systemVersion?: string;
  extensions?: ExtensionManifest[];
}

let cached: LoadedConfig | null = null;
let cachedMtimes: { configPath: number; systemsPath: number } | null = null;
let cachedConfigPath: string | null = null;

const SYSTEMS_PATH = path.join(os.homedir(), '.abap-cli', 'systems.json');

function fileMtime(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Walk up the directory tree from `startDir` looking for the nearest `.abap.json`.
 * - Returns the absolute path of the first `.abap.json` found.
 * - Stops at the first ancestor that contains a `.git` directory (treats it as the
 *   repository root — searching past it would risk picking up an unrelated workspace).
 * - Stops at the filesystem root.
 *
 * This makes a parent `.abap.json` apply to nested subdirectories by default, while
 * a child directory's own `.abap.json` always wins because the search starts there.
 */
export function findWorkspaceConfig(startDir: string = process.cwd()): string | null {
  let dir = path.resolve(startDir);
  const seen = new Set<string>();
  while (!seen.has(dir)) {
    seen.add(dir);
    const candidate = path.join(dir, '.abap.json');
    if (fs.existsSync(candidate)) return candidate;
    // Treat the repo root as a hard boundary: do not search past .git/.
    if (fs.existsSync(path.join(dir, '.git'))) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null; // reached filesystem root
    dir = parent;
  }
  return null;
}

function currentMtimes(): { configPath: number; systemsPath: number } {
  const configPath = findWorkspaceConfig() ?? path.resolve(process.cwd(), '.abap.json');
  return {
    configPath: fileMtime(configPath),
    systemsPath: fileMtime(SYSTEMS_PATH),
  };
}

/**
 * Load project configuration from .abap.json (system reference) + user-level system profile + OS keychain.
 * The search starts at the current directory and walks up to the nearest `.abap.json`
 * (or stops at the repository root / filesystem root). The file cache auto-invalidates
 * on mtime change (abap init / profile set); the password is re-read from the keychain
 * every call so updates apply immediately.
 */
export async function loadConfig(): Promise<ProjectConfig> {
  const mtimes = currentMtimes();
  if (
    !cached ||
    !cachedMtimes ||
    !cachedConfigPath ||
    cachedMtimes.configPath !== mtimes.configPath ||
    cachedMtimes.systemsPath !== mtimes.systemsPath
  ) {
    const configPath = findWorkspaceConfig();
    cached = await loadFileConfig(configPath);
    cachedConfigPath = configPath;
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
    extensions: cached.extensions,
  };
}

async function loadFileConfig(configPath: string | null): Promise<LoadedConfig> {
  // Load .abap.json — workspace references a user-level system profile
  let workspace: { system?: string; transport?: string; package?: string; sourceDir?: string; extensions?: ExtensionManifest[] } = {};
  if (configPath && fs.existsSync(configPath)) {
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
        ? `System profile '${systemName}' not found. Run 'abap init --profile <name>' to configure it.`
        : 'Missing "system" in .abap.json. Run \'abap init --profile <name>\' to set up.',
    );
  }

  // Validate required fields
  const missing: string[] = [];
  if (!profile.url) missing.push('url in system profile');
  if (!profile.username) missing.push('username in system profile');
  if (missing.length > 0) {
    throw new CliError(
      'CONFIG_ERROR',
      `Missing required configuration: ${missing.join(', ')}. Run 'abap init --profile <name>' to set up.`,
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
      auth: profile.auth,
      sourceDir: workspace.sourceDir || process.cwd(),
    },
    transport: workspace.transport || '',
    package: workspace.package || '',
    adtTextpool: profile.adtTextpool,
    systemVersion: profile.systemVersion,
    extensions: workspace.extensions,
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
 * Write the workspace config (.abap.json) to disk.
 * Merges with existing content, only overwriting the keys provided.
 */
export async function writeProjectConfig(updates: {
  systemName?: string;
  package?: string;
  transport?: string;
  sourceDir?: string;
  extensions?: ExtensionManifest[];
}): Promise<void> {
  const configPath = findWorkspaceConfig() ?? path.join(process.cwd(), '.abap.json');
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      // ignore parse errors, start fresh
    }
  }
  const updated: Record<string, unknown> = {
    ...existing,
    ...(updates.systemName !== undefined ? { system: updates.systemName } : {}),
    ...(updates.package !== undefined ? { package: updates.package } : {}),
    ...(updates.transport !== undefined ? { transport: updates.transport } : {}),
    ...(updates.sourceDir !== undefined ? { sourceDir: updates.sourceDir } : {}),
    ...(updates.extensions !== undefined ? { extensions: updates.extensions } : {}),
  };
  fs.writeFileSync(configPath, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
  // Invalidate cache
  resetConfig();
}

/**
 * Reset cached config (for testing).
 */
export function resetConfig(): void {
  cached = null;
  cachedMtimes = null;
  cachedConfigPath = null;
}
