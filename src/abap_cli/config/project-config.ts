import * as fs from 'fs';
import * as path from 'path';
import { getPassword } from '../crypto/secrets.js';
import { getSystem } from './user-config.js';

export interface SapConfig {
  url: string;
  client: string;
  username: string;
  password: string;
  language: string;
}

export interface ProjectConfig {
  sap: SapConfig;
  transport: string;
  package: string;
}

let cachedConfig: ProjectConfig | null = null;

/**
 * Load project configuration from .abap.json (system reference) + user-level system profile + OS keychain.
 */
export async function loadConfig(): Promise<ProjectConfig> {
  if (cachedConfig) return cachedConfig;

  // Load .abap.json — workspace references a user-level system profile
  let workspace: { system?: string; transport?: string; package?: string } = {};
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
    throw new Error(
      systemName
        ? `System profile '${systemName}' not found. Run 'abap init' to configure it.`
        : 'Missing "system" in .abap.json. Run \'abap init\' to set up.',
    );
  }

  // Password from OS keychain, keyed by system name
  const password = (await getPassword(systemName)) || process.env.SAP_PASSWORD || '';

  const sap: SapConfig = {
    url: profile.url,
    client: profile.client || '100',
    username: profile.username,
    password,
    language: profile.language || 'EN',
  };

  const transport = workspace.transport || '';
  const pkg = workspace.package || '';

  // Validate required fields
  const missing: string[] = [];
  if (!sap.url) missing.push('url in system profile');
  if (!sap.username) missing.push('username in system profile');
  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}. Run 'abap init' to set up.`);
  }

  cachedConfig = { sap, transport, package: pkg };
  return cachedConfig;
}

/**
 * Reset cached config (for testing).
 */
export function resetConfig(): void {
  cachedConfig = null;
}
