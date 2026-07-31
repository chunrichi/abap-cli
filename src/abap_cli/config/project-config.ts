import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

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
 * Load project configuration from .abap.json + environment variables.
 * Environment variables take precedence over .abap.json values.
 */
export function loadConfig(): ProjectConfig {
  if (cachedConfig) return cachedConfig;

  // Load .env if present
  dotenv.config();

  // Load .abap.json if present
  let fileConfig: Partial<ProjectConfig> = {};
  const configPath = findConfigFile();
  if (configPath) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      fileConfig = JSON.parse(raw);
    } catch {
      // ignore parse errors
    }
  }

  const sap: SapConfig = {
    url: envOrFile('SAP_URL', fileConfig.sap?.url),
    client: envOrFile('SAP_CLIENT', fileConfig.sap?.client) || '100',
    username: envOrFile('SAP_USER', fileConfig.sap?.username),
    password: envOrFile('SAP_PASSWORD', fileConfig.sap?.password) || '',
    language: envOrFile('SAP_LANGUAGE', fileConfig.sap?.language) || 'EN',
  };

  const transport = envOrFile('SAP_TRANSPORT', fileConfig.transport) || '';
  const pkg = envOrFile('SAP_PACKAGE', fileConfig.package) || '';

  // Validate required fields
  const missing: string[] = [];
  if (!sap.url) missing.push('SAP_URL (or sap.url in .abap.json)');
  if (!sap.username) missing.push('SAP_USER (or sap.username in .abap.json)');
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

function envOrFile(envKey: string, fileValue: string | undefined): string {
  return process.env[envKey] || fileValue || '';
}

function findConfigFile(): string | null {
  const candidates = ['.abap.json'];
  for (const name of candidates) {
    const p = path.resolve(process.cwd(), name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
