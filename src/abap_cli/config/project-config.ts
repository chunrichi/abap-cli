import * as fs from 'fs';
import * as path from 'path';
import { getPassword } from './secrets.js';
import { getSystem } from './user-config.js';
import { readCa } from './ca-store.js';
import { assertSupportedAuth } from './validation.js';
import { CliError } from '../output/json.js';
import { userConfigPath } from './paths.js';
import { CONFIG_ERROR_REFERENCE, profileExample, profileRecovery } from './recovery.js';

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
  /** Base directory for whole-workspace scans (`push --all`, `check --all|--changed`, `status`, `diff`); falls back to cwd. */
  sourceDir: string;
  /** Optional system flavour tag (e.g. 'on-prem', 'cloud', 'btp', 'mock').
   *  When omitted the CLI treats the profile as on-prem for session reuse
   *  purposes. */
  systemType?: 'on-prem' | 'cloud' | 'btp' | 'mock';
  /** Session policy override at the profile level. Equivalent to
   *  `.abap.json#sap.sessionPolicy` and overridden by env var. */
  sessionPolicy?: 'reuse' | 'always-logout' | 'default';
}

export interface ProjectConfig {
  sap: SapConfig;
  transport: string;
  package: string;
  /** current system name (for capability reads / route decisions). */
  systemName: string;
  /** ADT text-element capability recorded at connect/init (optional). */
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

/**
 * Per-cwd cache key.
 *
 * `project-config` results are cached in a `Map<resolvedCwd, entry>` so a
 * single CLI process that walks into a sibling workspace sees the new
 * config without stale reuse. We mirror that here with `cachedByCwd`,
 * keyed by the **resolved** workspace config path (the file path) —
 * same isolation guarantee, simpler invalidation.
 */
let cachedByCwd: Map<string, LoadedConfig> | null = null;
let cachedMtimesByCwd: Map<string, { configPath: number; systemsPath: number }> | null = null;

const SYSTEMS_PATH = userConfigPath();

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
 *
 * Semantics: walk up from cwd, stop at `.git` or filesystem root,
 * nearest wins.
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

/**
 * `existingWorkspaceConfigPath(cwd)` — returns the path that
 * `writeProjectConfig` should target (the existing `.abap.json` if any, else
 * the candidate in `cwd`). Centralised so every write site agrees.
 */
export function existingWorkspaceConfigPath(cwd: string = process.cwd()): string {
  return findWorkspaceConfig(cwd) ?? path.join(path.resolve(cwd), '.abap.json');
}

function currentMtimes(configPath: string | null): { configPath: number; systemsPath: number } {
  const resolved = configPath ?? path.resolve(process.cwd(), '.abap.json');
  return {
    configPath: fileMtime(resolved),
    systemsPath: fileMtime(SYSTEMS_PATH),
  };
}

/** Internal cache key = absolute config file path (or its candidate). */
function cacheKeyFor(configPath: string | null, cwd: string): string {
  return configPath ?? path.resolve(cwd, '.abap.json');
}

/**
 * Load project configuration from .abap.json (system reference) + user-level system profile + OS keychain.
 *
 * - `cwd` parameter (defaults to `process.cwd()`) lets callers (and tests)
 *   force the search start without monkey-patching `process.cwd()`.
 * - The cache is keyed by resolved config file path, so calling
 *   `loadConfig({ cwd: '/repo-a' })` then `loadConfig({ cwd: '/repo-b' })`
 *   produces two independent loads instead of one shared cache entry.
 */
export interface LoadConfigOptions {
  /** Directory to start the upward `.abap.json` walk from (defaults to `process.cwd()`). */
  cwd?: string;
  /**
   * Resolve the OS-keychain password (default `true`). Pass `false` for code
   * that only needs non-credential config (extension loading, help/version,
   * pre-action hooks) so local commands never trigger a keychain prompt.
   */
  withSecret?: boolean;
}

export async function loadConfig(options: LoadConfigOptions | string = {}): Promise<ProjectConfig> {
  const opts: LoadConfigOptions = typeof options === 'string' ? { cwd: options } : options;
  const startCwd = opts.cwd ?? process.cwd();
  const configPath = findWorkspaceConfig(startCwd);
  const cacheKey = cacheKeyFor(configPath, startCwd);

  // Lazy-init caches on first use so test reset() can null them safely.
  if (!cachedByCwd) cachedByCwd = new Map();
  if (!cachedMtimesByCwd) cachedMtimesByCwd = new Map();

  const mtimes = currentMtimes(configPath);
  const cachedMtimes = cachedMtimesByCwd.get(cacheKey);
  const cached = cachedByCwd.get(cacheKey);
  if (!cached || !cachedMtimes || cachedMtimes.configPath !== mtimes.configPath || cachedMtimes.systemsPath !== mtimes.systemsPath) {
    const fresh = await loadFileConfig(configPath);
    cachedByCwd.set(cacheKey, fresh);
    cachedMtimesByCwd.set(cacheKey, mtimes);
  }

  const live = cachedByCwd.get(cacheKey)!;
  const password = opts.withSecret === false ? '' : (await getPassword(live.systemName)) || '';
  return {
    sap: { ...live.sap, password },
    transport: live.transport,
    package: live.package,
    systemName: live.systemName,
    adtTextpool: live.adtTextpool,
    systemVersion: live.systemVersion,
  };
}

async function loadFileConfig(configPath: string | null): Promise<LoadedConfig> {
  // Load .abap.json — workspace references a user-level system profile
  let workspace: { system?: string; transport?: string; package?: string; sourceDir?: string } = {};
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
        ? `System profile '${systemName}' not found.`
        : 'Missing "system" in .abap.json.',
      {
        nextSteps: profileRecovery(systemName || undefined),
        example: profileExample(systemName || undefined),
        references: CONFIG_ERROR_REFERENCE,
        details: systemName
          ? { missing: ['system profile'], profile: systemName }
          : { missing: ['system'] },
      },
    );
  }
  assertSupportedAuth(systemName, profile);

  // Validate required fields
  const missingFields: string[] = [];
  if (!profile.url) missingFields.push('url');
  if (!profile.username) missingFields.push('username');
  if (missingFields.length > 0) {
    throw new CliError(
      'CONFIG_ERROR',
      `Missing required profile configuration: ${missingFields.join(', ')}.`,
      {
        nextSteps: [
          `Update the profile: abap profile set ${systemName} --url <url> --username <user>`,
          `Or re-bind the workspace: abap init --profile ${systemName}`,
        ],
        example: `abap profile set ${systemName} --url https://sap.example.com --username DEV`,
        references: CONFIG_ERROR_REFERENCE,
        details: { missing: missingFields, profile: systemName },
      },
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
      systemType: profile.systemType,
      sessionPolicy: profile.sessionPolicy,
    },
    transport: workspace.transport || '',
    package: workspace.package || '',
    adtTextpool: profile.adtTextpool,
    systemVersion: profile.systemVersion,
  };
}

/**
 * Read a CA certificate (PEM) from disk. Returns undefined when no path is
 * configured; throws CONFIG_ERROR if the file cannot be read. Reads through
 * the cert store so a missing file maps to a re-import hint rather than a
 * raw ENOENT.
 */
export function readCaCertificate(caPath: string): string | undefined {
  if (!caPath) return undefined;
  // Delegate to the store so error messages and permissions stay consistent.
  return readCa(caPath);
}

/**
 * Write the workspace config (.abap.json) to disk.
 * Merges with existing content, only overwriting the keys provided.
 *
 * `cwd` parameter (defaults to `process.cwd()`) so callers can target a
 * sibling workspace without mutating `process.cwd()`.
 */
export async function writeProjectConfig(
  updates: {
    systemName?: string;
    package?: string;
    transport?: string;
    sourceDir?: string;
  },
  options: { cwd?: string } = {},
): Promise<void> {
  const startCwd = options.cwd ?? process.cwd();
  const configPath = existingWorkspaceConfigPath(startCwd);
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
  };
  fs.writeFileSync(configPath, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
  // Invalidate cache
  resetConfig();
}

/**
 * Reset cached config (for testing).
 */
export function resetConfig(): void {
  cachedByCwd = null;
  cachedMtimesByCwd = null;
}
