import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createRequire } from 'module';
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
/** Like okItem but always carries a human-readable message (diagnostics that report facts). */
const okInfo = (key: string, message: string, detail?: string): DoctorItem => ({ key, status: 'ok', message, detail });
const errItem = (key: string, message: string, suggestion?: string, detail?: string): DoctorItem => ({
  key,
  status: 'err',
  message,
  suggestion,
  detail,
});

/** How the running CLI was loaded — diagnostics only, never used to gate behavior. */
type InstallKind = 'npm-install' | 'source-checkout' | 'linked-checkout' | 'unknown';

const INSTALL_KIND_LABELS: Record<InstallKind, string> = {
  'npm-install': 'npm install',
  'source-checkout': 'source checkout',
  'linked-checkout': 'linked dev checkout',
  unknown: 'unknown layout',
};

interface InstallInfo {
  version: string;
  /** package.json the version was read from, or '' when it could not be located. */
  packageJson: string;
  /** Directory containing package.json. */
  packageDir: string;
  /** packageDir after resolving symlinks. */
  realPath: string;
  /** Detected install layout. */
  kind: InstallKind;
}

/**
 * Locate the package.json the running CLI was loaded from. Reuses the same
 * createRequire(import.meta.url) technique as output/meta.ts, which resolves a
 * fixed relative path to the package root. This module sits one directory
 * deeper than meta.ts (`flows/setup` vs `output`) and also runs straight from
 * `src/` under vitest, so both plausible depths are attempted.
 */
function resolvePackageJson(): string | undefined {
  const require = createRequire(import.meta.url);
  for (const rel of ['../../../../package.json', '../../../../../package.json']) {
    try {
      return require.resolve(rel);
    } catch {
      // Not this layout — try the next candidate depth.
    }
  }
  return undefined;
}

/**
 * Read install provenance for `abap doctor`: the version the process actually
 * loaded, the directory it came from, and whether that is a published npm
 * install, a source checkout, or a symlinked dev checkout. Feedback F-20 was a
 * reported "version change" that was really an install/branch switch, so the
 * doctor surfaces identity instead of trusting `--version` alone. Never throws.
 */
function readInstallInfo(): InstallInfo {
  const unknown: InstallInfo = {
    version: 'unknown',
    packageJson: '',
    packageDir: '',
    realPath: '',
    kind: 'unknown',
  };
  try {
    const packageJson = resolvePackageJson();
    if (!packageJson) return unknown;
    const packageDir = path.dirname(packageJson);

    let version = 'unknown';
    try {
      const parsed = JSON.parse(fs.readFileSync(packageJson, 'utf-8')) as { version?: string };
      version = parsed.version ?? 'unknown';
    } catch {
      // Unreadable/corrupt package.json: still report where the CLI was loaded from.
    }

    // A realpath that differs from the loaded path means the package directory
    // is reached through a symlink (npm link / dev checkout). A path inside
    // node_modules is a regular install; .git or src next to package.json is a
    // checkout used in place.
    let realPath = packageDir;
    try {
      realPath = fs.realpathSync(packageDir);
    } catch {
      // keep the unresolved path
    }
    const linked = realPath !== packageDir;
    const inNodeModules = packageDir.split(path.sep).includes('node_modules');
    const looksLikeSource =
      fs.existsSync(path.join(packageDir, '.git')) || fs.existsSync(path.join(packageDir, 'src'));

    const kind: InstallKind = inNodeModules
      ? 'npm-install'
      : linked
        ? 'linked-checkout'
        : looksLikeSource
          ? 'source-checkout'
          : 'unknown';

    return { version, packageJson, packageDir, realPath, kind };
  } catch {
    return unknown;
  }
}

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

  // Install provenance (F-20): report which build this process is actually
  // running so a version that looks "wrong" can be traced to an install or
  // branch switch. Purely diagnostic — always ok, never fails the doctor run.
  const install = readInstallInfo();
  const installLabel = INSTALL_KIND_LABELS[install.kind];
  push(
    environment,
    okInfo(
      'env.install',
      install.packageJson
        ? `abap-cli ${install.version} loaded from ${install.packageDir} (${installLabel})`
        : `abap-cli ${install.version} — install location could not be resolved`,
      verbose
        ? [
            `version ${install.version}`,
            `package.json ${install.packageJson || 'unresolved'}`,
            `dir ${install.packageDir || 'unresolved'}`,
            `realpath ${install.realPath || 'unresolved'}`,
            `layout ${installLabel}`,
          ].join('; ')
        : undefined,
    ),
  );

  const sys = readSystems(configPath);
  push(
    environment,
    sys.error
      ? errItem('env.config', sys.error.message, sys.error.suggestion)
      : okItem('env.config', verbose ? configPath : undefined),
  );

  // Dependency sanity, part 1: packages that the shipped `dist` imports
  // statically. `aff/schema-validator.ts` does a top-level ESM import of `ajv`
  // and `ajv-formats`, so a missing copy aborts the process before commander
  // even parses `--help`, and the failure used to be masked by the top-level
  // error handler (feedback F-01). Probing here turns that into an actionable
  // doctor item. These are declared in `dependencies` now; the check guards
  // against broken/partial installs and third-party repackaging.
  const requiredDeps = ['ajv', 'ajv-formats'];
  const depProblems: string[] = [];
  const depDetails: string[] = [];
  for (const dep of requiredDeps) {
    try {
      await import(dep);
      depDetails.push(`${dep} ok`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      depProblems.push(`${dep} unavailable (${message})`);
    }
  }

  // Dependency sanity, part 2: a working OS keychain backend should be
  // available. Native backend (cmdkey / security / secret-tool) is preferred;
  // keytar is an optional fallback. The dispatcher resolves the active backend
  // and we surface its `isAvailable()` probe result so users see a clear hint
  // when their environment lacks the necessary tools (e.g. Linux without
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

  const depsOk = depProblems.length === 0 && keychainOk;
  const depsDetail = [keychainDetail, ...depDetails].join('; ');
  push(
    environment,
    depsOk
      ? okItem('env.deps', verbose ? depsDetail : undefined)
      : errItem(
          'env.deps',
          [...depProblems, keychainOk ? '' : keychainDetail].filter(Boolean).join('; '),
          depProblems.length > 0
            ? 'Reinstall the CLI so its runtime dependencies are present: `npm i -g abap-cli` (or `npm install` in a checkout).'
            : 'Install libsecret-tools (Linux) or set ABAP_CLI_KEYCHAIN_BACKEND=keytar with the keytar dependency installed.',
          verbose ? depsDetail : undefined,
        ),
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
