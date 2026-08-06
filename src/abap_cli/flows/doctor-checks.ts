import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { probeSystem } from '../clients/probe.js';
import { assertValidProfile } from '../config/validation.js';

export type DoctorStatus = 'ok' | 'err';

/** One checked item across environment / config / connection sections (FR-002). */
export interface DoctorItem {
  key: string;
  status: DoctorStatus;
  message: string;
  /** Concrete action when err — aggregated into nextSteps (FR-002). */
  suggestion?: string;
  /** Verbose-only detail (exact versions/paths/messages, FR-003). */
  detail?: string;
}

/** The full doctor report. Sections never throw — connection issues are items (FR-005). */
export interface DoctorReport {
  environment: DoctorItem[];
  config: DoctorItem[];
  connection: DoctorItem[];
  nextSteps: string[];
  fixesApplied?: string[];
}

export interface DoctorOptions {
  verbose?: boolean;
  /** Named system for the connection section; defaults to every configured profile. */
  system?: string;
  /** Path to the user systems.json (injectable for tests). */
  configPath?: string;
  /** User home directory (injectable for tests; defaults to os.homedir()). */
  home?: string;
  /** Workspace root for .abap.json checks (defaults to cwd). */
  cwd?: string;
}

const okItem = (key: string, detail?: string): DoctorItem => ({ key, status: 'ok', message: '', detail });
const errItem = (key: string, message: string, suggestion?: string, detail?: string): DoctorItem => ({
  key,
  status: 'err',
  message,
  suggestion,
  detail,
});

function nodeSatisfies(nodeVersion: string, engines: { node?: string }): boolean {
  const req = engines.node ?? '';
  const m = /^>=(\d+)(?:\.(\d+))?/.exec(req);
  if (!m) return true;
  const [majorStr, minorStr] = nodeVersion.replace(/^v/, '').split('.');
  const major = Number(majorStr);
  if (Number.isNaN(major)) return true;
  const minor = Number(minorStr);
  if (major > Number(m[1])) return true;
  if (major === Number(m[1])) {
    if (m[2] === undefined) return true;
    return !Number.isNaN(minor) && minor >= Number(m[2]);
  }
  return false;
}

/** Read systems.json as a record — never throws; reports parse errors as items. */
function readSystems(configPath: string): { systems: Record<string, unknown>; error?: { message: string; suggestion: string } } {
  try {
    if (!fs.existsSync(configPath)) {
      return {
        systems: {},
        error: { message: `Config file not found: ${configPath}`, suggestion: 'Run "abap config" or "abap connection add <name> ..." to create it.' },
      };
    }
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { systems?: Record<string, unknown> };
    return { systems: parsed.systems ?? {} };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      systems: {},
      error: {
        message: `Cannot parse config file ${configPath}: ${message}`,
        suggestion: `Fix or delete ${configPath}, then re-run "abap doctor".`,
      },
    };
  }
}

/**
 * Run the three-section doctor check (FR-001..003). Never throws for probe or
 * config failures — findings are items in the report (FR-005).
 */
export async function runDoctorChecks(opts: DoctorOptions = {}): Promise<DoctorReport> {
  const verbose = opts.verbose ?? false;
  const home = opts.home ?? os.homedir();
  const configPath = opts.configPath ?? path.join(home, '.abap-cli', 'systems.json');
  const cwd = opts.cwd ?? process.cwd();

  const environment: DoctorItem[] = [];
  const config: DoctorItem[] = [];
  const connection: DoctorItem[] = [];
  const suggestions: string[] = [];

  const push = (section: DoctorItem[], item: DoctorItem) => {
    section.push(item);
    if (item.status === 'err' && item.suggestion && !suggestions.includes(item.suggestion)) {
      suggestions.push(item.suggestion);
    }
  };

  // --- environment ---
  const nodeVersion = process.version;
  push(
    environment,
    nodeSatisfies(nodeVersion, { node: '>=18' })
      ? okItem('env.node', verbose ? `node ${nodeVersion}` : undefined)
      : errItem('env.node', `Node ${nodeVersion} does not meet the >=18 requirement.`, 'Upgrade Node.js to v18 or newer.'),
  );
  push(
    environment,
    process.versions.openssl
      ? okItem('env.tls', verbose ? `openssl ${process.versions.openssl}` : undefined)
      : errItem('env.tls', 'No OpenSSL runtime detected.', 'Reinstall Node.js with OpenSSL support.'),
  );

  const sys = readSystems(configPath);
  push(
    environment,
    sys.error
      ? errItem('env.config', sys.error.message, sys.error.suggestion)
      : okItem('env.config', verbose ? configPath : undefined),
  );

  // Dependency sanity: keytar must be importable (Constitution VI credential store).
  let keytarOk = false;
  let keytarDetail = '';
  try {
    const mod = (await import('keytar')) as { default?: unknown; setPassword?: unknown };
    // CJS namespace: the API may sit on `default` (esModuleInterop) or be
    // re-exported as named exports — accept either shape.
    const keytar = (mod.default ?? mod) as { setPassword?: unknown };
    keytarOk = typeof keytar.setPassword === 'function';
    keytarDetail = 'keytar (OS keychain) importable';
  } catch (error: unknown) {
    keytarDetail = `keytar import failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  push(
    environment,
    keytarOk
      ? okItem('env.deps', verbose ? keytarDetail : undefined)
      : errItem('env.deps', keytarDetail, 'Run "npm install" to restore the keytar dependency.'),
  );

  // --- config ---
  for (const [name, profile] of Object.entries(sys.systems)) {
    const p = profile as { url?: string; client?: string; username?: string; language?: string };
    try {
      assertValidProfile({ url: p.url ?? '', client: p.client, username: p.username ?? '', language: p.language });
      push(config, okItem(`config.profile.${name}`, verbose ? `profile '${name}' valid` : undefined));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      push(
        config,
        errItem(
          `config.profile.${name}`,
          `Profile '${name}' is invalid: ${message}`,
          `Fix the profile: abap connection set ${name} --url <url> --username <user>`,
        ),
      );
    }
  }

  // Active workspace system (.abap.json) resolves to a configured profile.
  const workspacePath = path.join(cwd, '.abap.json');
  let activeSystem: string | undefined;
  if (fs.existsSync(workspacePath)) {
    try {
      const ws = JSON.parse(fs.readFileSync(workspacePath, 'utf-8')) as { system?: string };
      activeSystem = ws.system;
      if (activeSystem && !(activeSystem in sys.systems)) {
        push(
          config,
          errItem(
            'config.active',
            `Workspace references unknown system '${activeSystem}'.`,
            `Create the profile: abap connection set ${activeSystem} --url <url> --username <user>`,
          ),
        );
      } else if (activeSystem) {
        push(config, okItem('config.active', verbose ? `active system: ${activeSystem}` : undefined));
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      push(
        config,
        errItem('config.active', `Cannot parse workspace config: ${message}`, 'Fix or delete .abap.json, then re-run abap doctor.'),
      );
    }
  } else {
    push(
      config,
      errItem(
        'config.workspace',
        'No workspace config (.abap.json) found in the current directory.',
        'Run "abap config init" or "abap config --system <name>" to initialize the workspace.',
      ),
    );
  }

  // --- connection ---
  const systemsToProbe = opts.system ? [opts.system] : Object.keys(sys.systems);
  if (systemsToProbe.length === 0) {
    push(
      connection,
      errItem('conn.none', 'No systems configured.', 'Run "abap connection add <name> --url <url> --username <user>" to add a connection profile.'),
    );
  } else {
    for (const name of systemsToProbe) {
      if (!(name in sys.systems)) {
        push(
          connection,
          errItem(
            `conn.${name}`,
            `System profile '${name}' not found.`,
            `List profiles: abap connection list — create one: abap connection add ${name} --url <url> --username <user>`,
          ),
        );
        continue;
      }
      try {
        const probe = await probeSystem(name);
        const layers = Object.entries(probe).map(([layer, r]) => `${layer}=${r.ok ? 'ok' : 'err'}`);
        if (Object.values(probe).every((r) => r.ok)) {
          push(connection, okItem(`conn.${name}`, verbose ? `all layers ok (${layers.join(', ')})` : undefined));
        } else {
          const failing = Object.entries(probe).filter(([, r]) => !r.ok && !r.skipped);
          const layerMsg = failing.map(([layer, r]) => `${layer}: ${r.error?.message ?? 'failed'}`).join('; ');
          push(
            connection,
            errItem(
              `conn.${name}`,
              `System '${name}' unreachable: ${layerMsg}`,
              `Diagnose per layer: abap connection test ${name}`,
              verbose ? layers.join(', ') : undefined,
            ),
          );
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        push(
          connection,
          errItem(`conn.${name}`, `Probe of '${name}' failed: ${message}`, `Diagnose per layer: abap connection test ${name}`),
        );
      }
    }
  }

  return { environment, config, connection, nextSteps: suggestions };
}

/** Safe, reversible fixes for `doctor --fix` (FR-004). Returns what was applied. */
export function applySafeFixes(home: string = os.homedir()): string[] {
  const applied: string[] = [];
  const dir = path.join(home, '.abap-cli');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    applied.push(`recreated ${dir} with 0700 perms`);
  }
  return applied;
}
