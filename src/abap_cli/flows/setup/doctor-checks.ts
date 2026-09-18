import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { assertValidProfile } from '../../config/validation.js';
import { findWorkspaceConfig } from '../../config/project-config.js';
import { toOutputPath } from '../../core/path-output.js';

export type DoctorStatus = 'ok' | 'err';

/** One checked item across environment / config sections. */
export interface DoctorItem {
  key: string;
  status: DoctorStatus;
  message: string;
  /** Concrete action when err — aggregated into nextSteps. */
  suggestion?: string;
  /** Verbose-only detail (exact versions/paths/messages). */
  detail?: string;
}

/** The full doctor report. Sections never throw. */
export interface DoctorReport {
  environment: DoctorItem[];
  config: DoctorItem[];
  nextSteps: string[];
  fixesApplied?: string[];
}

export interface DoctorOptions {
  verbose?: boolean;
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
        error: { message: `Config file not found: ${configPath}`, suggestion: 'Run "abap init --profile <name>" or "abap profile add <name> ..." to create it.' },
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
 * Run the doctor check (environment + config). Never throws for probe or
 * config failures — findings are items in the report.
 *
 * Doctor is a read-only diagnostic — it intentionally does not probe live
 * SAP systems. Use `abap profile test <name>` for connection diagnostics;
 * probing here would risk triggering interactive credential prompts and
 * muddying the env/config signal.
 */
export async function runDoctorChecks(opts: DoctorOptions = {}): Promise<DoctorReport> {
  const verbose = opts.verbose ?? false;
  const home = opts.home ?? os.homedir();
  const configPath = opts.configPath ?? path.join(home, '.abap-cli', 'systems.json');
  const cwd = opts.cwd ?? process.cwd();

  const environment: DoctorItem[] = [];
  const config: DoctorItem[] = [];
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

  // Dependency sanity: a working OS keychain backend must be available.
  // Native backend (cmdkey / security / secret-tool) is preferred; keytar is
  // an optional fallback. The dispatcher resolves the active backend and we
  // surface its `isAvailable()` probe result so users see a clear hint when
  // their environment lacks the necessary tools (e.g. Linux without
  // libsecret-tools AND without the optional keytar dependency).
  let keychainOk = false;
  let keychainDetail = '';
  try {
    const { resolveBackend } = await import('../../config/secrets.js');
    const backend = await resolveBackend();
    if (await backend.isAvailable()) {
      keychainOk = true;
      keychainDetail = `keychain backend '${backend.name}' available`;
    } else {
      keychainDetail = `keychain backend '${backend.name}' reported unavailable`;
    }
  } catch (error: unknown) {
    keychainDetail = `no keychain backend available: ${error instanceof Error ? error.message : String(error)}`;
  }
  push(
    environment,
    keychainOk
      ? okItem('env.deps', verbose ? keychainDetail : undefined)
      : errItem('env.deps', keychainDetail,
          'Install libsecret-tools (Linux) or set ABAP_CLI_KEYCHAIN_BACKEND=keytar with the keytar dependency installed.'),
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
          `Fix the profile: abap profile set ${name} --url <url> --username <user>`,
        ),
      );
    }
  }

  // Active workspace system (.abap.json) resolves to a configured profile.
  // The search starts at cwd and walks up to the nearest .abap.json (or stops at
  // the repo root / filesystem root) — see findWorkspaceConfig.
  const workspacePath: string | null = findWorkspaceConfig(cwd);
  let activeSystem: string | undefined;
  if (workspacePath) {
    try {
      const ws = JSON.parse(fs.readFileSync(workspacePath, 'utf-8')) as { system?: string };
      activeSystem = ws.system;
      if (activeSystem && !(activeSystem in sys.systems)) {
        push(
          config,
          errItem(
            'config.active',
            `Workspace references unknown system '${activeSystem}'.`,
            `Create the profile: abap profile add ${activeSystem} --url <url> --username <user>`,
          ),
        );
      } else if (activeSystem) {
        push(
          config,
          okItem(
            'config.active',
            verbose ? `active system: ${activeSystem} (${toOutputPath(path.relative(cwd, workspacePath)) || '.abap.json'})` : undefined,
          ),
        );
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
        'No workspace config (.abap.json) found in the current directory or any ancestor.',
        'Run "abap init" (TTY wizard) or "abap init --profile <name>" to initialize the workspace.',
      ),
    );
  }

  // Connection probing intentionally lives outside doctor. Use
  // `abap profile test <name>` for live connectivity diagnostics; doctor
  // stays read-only and offline.

  return { environment, config, nextSteps: suggestions };
}

/** Safe, reversible fixes for `doctor --fix`. Returns what was applied. */
export function applySafeFixes(home: string = os.homedir()): string[] {
  const applied: string[] = [];
  const dir = path.join(home, '.abap-cli');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    applied.push(`recreated ${dir} with 0700 perms`);
  }
  return applied;
}
