import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createRequire } from 'module';
import { assertValidProfile } from '../../config/validation.js';
import { findWorkspaceConfig } from '../../config/project-config.js';
import { toOutputPath } from '../../core/path-output.js';
import { nodeSatisfies } from './node-runtime.js';

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
  /** False when any environment / config item is `err`. Always emitted so a
   *  gate can branch on one boolean instead of re-scanning both sections. */
  ok: boolean;
  environment: DoctorItem[];
  config: DoctorItem[];
  nextSteps: string[];
}

/** A safe, reversible fix applied by `abap doctor --fix --yes`. */
export interface DoctorFixApplied {
  /** Stable identifier the agent can branch on (e.g. `config-dir`). */
  id: string;
  /** What was done, one line. */
  action: string;
  /** What it touched — home-anchored, so not cwd-relative (`~/.abap-cli`). */
  target: string;
  /** Whether the change can be undone without data loss. */
  reversible: boolean;
}

/** An err item that is still unresolved after `--fix`. */
export interface DoctorRemaining {
  /** Check key, e.g. `config.workspace`. */
  key: string;
  message: string;
  /** The action that would clear it. */
  nextStep?: string;
}

export interface DoctorOptions {
  verbose?: boolean;
  /** Path to the user systems.json (injectable for tests). */
  configPath?: string;
  /** User home directory (injectable for tests; defaults to os.homedir()). */
  home?: string;
  /** Workspace root for .abap.json checks (defaults to cwd). */
  cwd?: string;
  /** Node.js version to evaluate (injectable for tests; defaults to process.version). */
  nodeVersion?: string;
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

/** Collapse wording differences (case / whitespace) so identical advice is
 *  emitted once in `nextSteps`. */
function normalizeSuggestion(suggestion: string): string {
  return suggestion.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** One remediation text for every "configuration is missing" finding: the
 *  missing systems.json and the missing .abap.json are cleared by the same
 *  command, so doctor reports the fix once. */
const INIT_SUGGESTION =
  'Run "abap init" (interactive wizard) to create the connection profile and .abap.json, or "abap init --profile <name>" to bind an existing profile.';
const INIT_SUGGESTION_KEY = 'init';

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

/** Read systems.json as a record — never throws; reports parse errors as items. */
function readSystems(configPath: string): {
  systems: Record<string, unknown>;
  error?: { message: string; suggestion: string; missing: boolean };
} {
  try {
    if (!fs.existsSync(configPath)) {
      return {
        systems: {},
        error: { message: `Config file not found: ${configPath}`, suggestion: INIT_SUGGESTION, missing: true },
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
        missing: false,
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
  const suggestionKeys = new Set<string>();

  /** Collect a suggestion once per remediation family. `suggestionKey` groups
   *  advice that overlaps even when the wording differs (e.g. a missing
   *  systems.json and a missing .abap.json are both repaired by `abap init`),
   *  so nextSteps does not repeat the same command twice. */
  const push = (section: DoctorItem[], item: DoctorItem, suggestionKey?: string) => {
    section.push(item);
    if (item.status !== 'err' || !item.suggestion) return;
    const key = suggestionKey ?? normalizeSuggestion(item.suggestion);
    if (suggestionKeys.has(key)) return;
    suggestionKeys.add(key);
    suggestions.push(item.suggestion);
  };

  // --- environment ---
  const nodeVersion = opts.nodeVersion ?? process.version;
  push(
    environment,
    nodeSatisfies(nodeVersion)
      ? okItem('env.node', verbose ? `node ${nodeVersion}` : undefined)
      : errItem(
          'env.node',
          `Node ${nodeVersion} is not a supported, security-patched release.`,
          'Upgrade Node.js to 22.23.4+, 24.22.1+, or 26.12.1+.',
        ),
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
    sys.error?.missing ? INIT_SUGGESTION_KEY : undefined,
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
        INIT_SUGGESTION,
      ),
      INIT_SUGGESTION_KEY,
    );
  }

  // Connection probing intentionally lives outside doctor. Use
  // `abap profile test <name>` for live connectivity diagnostics; doctor
  // stays read-only and offline.

  return { ok: isOk(environment, config), environment, config, nextSteps: suggestions };
}

/** True iff every environment / config item is `ok`. */
function isOk(environment: DoctorItem[], config: DoctorItem[]): boolean {
  return ![...environment, ...config].some((item) => item.status === 'err');
}

/** The err items a `--fix` run could not clear (post-fix re-diagnosis). */
export function remainingIssues(report: DoctorReport): DoctorRemaining[] {
  const out: DoctorRemaining[] = [];
  for (const item of [...report.environment, ...report.config]) {
    if (item.status !== 'err') continue;
    out.push({
      key: item.key,
      message: item.message,
      ...(item.suggestion ? { nextStep: item.suggestion } : {}),
    });
  }
  return out;
}

/** Safe, reversible fixes for `doctor --fix`. Returns what was applied
 *  (structured so an agent can report exactly what changed vs. what remains). */
export function applySafeFixes(home: string = os.homedir()): DoctorFixApplied[] {
  const applied: DoctorFixApplied[] = [];
  const dir = path.join(home, '.abap-cli');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    applied.push({
      id: 'config-dir',
      action: 'Created the CLI config directory with 0700 permissions.',
      target: '~/.abap-cli',
      reversible: true,
    });
  }
  return applied;
}
