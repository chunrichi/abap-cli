import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface SystemProfile {
  url: string;
  client: string;
  username: string;
  language: string;
  /** Skip SSL certificate verification (self-signed certs, development only). */
  insecure?: boolean;
  /** Path to a CA certificate (PEM) used for SSL verification. */
  ca?: string;
}

export interface UserConfig {
  systems: Record<string, SystemProfile>;
}

const CONFIG_DIR = path.join(os.homedir(), '.abap-cli');
const CONFIG_PATH = path.join(CONFIG_DIR, 'systems.json');

/**
 * Load user-level system profiles from ~/.abap-cli/systems.json.
 * Returns an empty config if the file does not exist; throws if it is corrupt.
 */
export function loadUserConfig(): UserConfig {
  if (!fs.existsSync(CONFIG_PATH)) return { systems: {} };
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return { systems: parsed.systems ?? {}, ...parsed };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot parse user config ${CONFIG_PATH}: ${message}. Fix or delete the file.`);
  }
}

/**
 * Save user-level system profiles to ~/.abap-cli/systems.json.
 * Creates the directory with 700 permissions if needed.
 */
export function saveUserConfig(config: UserConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
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
