import * as fs from 'fs';
import * as path from 'path';
import { confirm, isCancel, select, text, password } from '@clack/prompts';
import { getPassword, storePassword, storeCertPassphrase } from '../../config/secrets.js';
import { parseBtpServiceKey } from '../../auth/types.js';
import { getSystem, listSystemNames, upsertSystem, type SystemProfile } from '../../config/user-config.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import { collectWarning } from '../../output/meta.js';
import { toOutputPath } from '../../core/path-output.js';
import { probeSystem, type ProbeLayerResult } from '../../clients/probe.js';
import { checkIcfDeployment, ICF_SERVICE_VERSION, type IcfDeploymentInfo } from '../../clients/icf-version.js';
import { probeTextpoolCapability, recordCapability } from '../../clients/textpool-capability.js';
import type { AuthConfig, OAuthPasswordBlock, SsoAuthBlock, CertAuthBlock } from '../../auth/v2-types.js';
import { defaultAuth, parseAuthMethodV2 } from '../../auth/v2-types.js';
import { authOptionsFromCli, resolveAuthFromOptions } from '../../auth/strategy.js';

interface WorkspaceConfig {
  system: string;
  transport: string;
  package: string;
}

export interface CollectedConfig extends SystemProfile {
  password: string;
  transport: string;
  pkg: string;
}

export type CommandOpts = Record<string, string | boolean | undefined>;

/** Read a string option, falling back when absent or a non-string (boolean flag). */
export function str(v: string | boolean | undefined, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

/** Exit 130 on Ctrl+C (@clack cancel), otherwise return the value */
export function orCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    console.log('\nAborted. No files were created.');
    process.exit(130);
  }
  return value as T;
}

/** Resolve the transport flag from --tr. */
export function transportFromOpts(opts: CommandOpts): string {
  return str(opts.tr);
}

/** BTP trial endpoint host pattern. */
function isBtpTrialUrl(url: string): boolean {
  return /\.abap\..*\.hana\.ondemand\.com$/i.test(new URL(url).hostname);
}

/** SAP Note 3237141: trial development must use a sub-package under ZLOCAL or ZCUSTOM_DEVELOPMENT. */
const BTP_TRIAL_ALLOWED_PACKAGE_ROOTS = ['ZLOCAL', 'ZCUSTOM_DEVELOPMENT', '$TMP'];

/** Warn when the package is not under a BTP-allowed root, refuse to auto-create under $TMP in trial. */
function validateTrialPackage(url: string, pkg: string, auth: AuthConfig): void {
  if (!isBtpTrialUrl(url)) return;
  if (auth.method === 'oauth_password' || auth.method === 'browser_sso') {
    const upper = pkg.toUpperCase();
    const ok = BTP_TRIAL_ALLOWED_PACKAGE_ROOTS.some((root) => upper === root || upper.startsWith(`${root}/`));
    if (!ok) {
      throw new CliError(
        'VALIDATION_ERROR',
        `BTP trial only allows packages under ${BTP_TRIAL_ALLOWED_PACKAGE_ROOTS.join(' / ')} (got '${pkg}').`,
        {
          details: { url, package: pkg },
          nextSteps: [
            `Re-run with a BTP-allowed package, e.g. --package zlocal/<sub-pkg>.`,
            `Sub-package rules: see SAP Note 3237141 (CAUSE 3).`,
          ],
          example: 'abap init --profile btptrial --package zlocal/my_sub_pkg --yes',
        },
      );
    }
  }
}

/** Save profile to user config + password to keychain. */
export async function saveProfile(name: string, profile: SystemProfile, password: string, mode: OutputMode): Promise<void> {
  upsertSystem(name, profile);
  // Only persist the password when it's non-empty — an empty password (oauth_password
  // without --password) must NOT clobber whatever the wizard stored earlier.
  if (password.length > 0) {
    await storePassword(name, password);
  }
  await recordCapabilityIfPossible(name);
  if (!mode) console.log(`System profile '${name}' saved. Password stored securely in OS keychain.`);
}

/** 014: informational capability probe — never blocks init. */
async function recordCapabilityIfPossible(name: string): Promise<void> {
  try {
    const cap = await probeTextpoolCapability();
    await recordCapability(name, cap);
  } catch {
    // informational — the profile simply has no adtTextpool record
  }
}

/** Auto-derive a profile name from the system URL and username */
export function deriveSystemName(profile: SystemProfile): string {
  try {
    const host = new URL(profile.url).hostname.replace(/\./g, '-');
    return `${profile.username}-${host}`;
  } catch {
    return `${profile.username}-system`;
  }
}

/** Refuse / confirm / skip overwriting an existing .abap.json. */
export async function handleFileOverwrite(mode: 'prompt' | 'overwrite' | 'refuse'): Promise<void> {
  const configPath = path.join(process.cwd(), '.abap.json');

  if (!fs.existsSync(configPath)) return;

  if (mode === 'refuse') {
    throw new CliError(
      'FILE_EXISTS',
      `.abap.json already exists. Delete it first or run interactively:\n  rm ${toOutputPath(configPath)}`,
    );
  }

  if (mode === 'prompt') {
    const ok = orCancel(await confirm({ message: '.abap.json already exists. Overwrite?', initialValue: false }));
    if (!ok) {
      console.log('Aborted. Existing configuration preserved.');
      process.exit(0);
    }
  }
  // mode === 'overwrite': fall through and overwrite.
}

/** Input validation. */
export function validateInputs(config: CollectedConfig): void {
  // Only `basic` requires a stored password — cert / browser_sso / oauth_password
  // supply credentials via different storage (cert files, cookie jar, env).
  if (!config.password && config.auth.method === 'basic') {
    throw new CliError('INVALID_ARGUMENT', 'Password is required for basic auth');
  }
}

/** Write workspace config referencing a user-level system profile */
export async function writeConfig(systemName: string, config: CollectedConfig, mode: OutputMode): Promise<void> {
  const cwd = process.cwd();

  const workspaceConfig: WorkspaceConfig = {
    system: systemName,
    transport: config.transport,
    package: config.pkg,
  };
  const configPath = path.join(cwd, '.abap.json');
  fs.writeFileSync(configPath, JSON.stringify(workspaceConfig, null, 2) + '\n', 'utf-8');
  if (!mode) console.log(`Created ${toOutputPath(configPath)}`);

  if (!mode) console.log('Workspace initialized.');
}

/** JSON output */
export function outputJson(
  systemName: string,
  config: CollectedConfig,
  probe?: { tls?: ProbeLayerResult; auth?: ProbeLayerResult },
  icf?: IcfDeploymentInfo,
): void {
  const data = {
    configPath: '.abap.json',
    system: systemName,
    sap: {
      url: config.url,
      client: config.client,
      username: config.username,
      language: config.language,
      auth: config.auth,
    },
    transport: config.transport,
    package: config.pkg,
    ...(probe ?? {}),
    ...(icf ? { icf } : {}),
  };
  printResult('json', data, '');
}

/**
 * Informational ICF deployment check.
 * Never throws or blocks init: unreachable degrades to a warning.
 */
export async function icfDeploymentCheck(mode: OutputMode, profileName?: string): Promise<IcfDeploymentInfo | undefined> {
  let icf: IcfDeploymentInfo;
  try {
    icf = await checkIcfDeployment(profileName);
  } catch (error: unknown) {
    icf = {
      status: 'unreachable',
      expectedVersion: ICF_SERVICE_VERSION,
      error: { code: 'ICF_CHECK_DEGRADED', message: error instanceof Error ? error.message : String(error) },
    };
  }
  if (icf.status === 'unreachable') {
    collectWarning('ICF_CHECK_DEGRADED', `ICF deployment check degraded: ${icf.error?.message ?? 'unreachable'}`, {
      status: 'unreachable',
    });
    if (!mode) console.log('Warning: ICF deployment check skipped (SAP unreachable).');
    return icf;
  }
  if (!mode) {
    if (icf.status === 'not_deployed') {
      console.log('ICF service not deployed — run "abap extension deploy" to deploy/update it.');
    } else if (icf.status === 'current') {
      console.log(`ICF service deployed (version ${icf.remoteVersion}).`);
    } else {
      console.log(
        `ICF service version mismatch (remote ${icf.remoteVersion ?? 'unknown'} vs expected ${icf.expectedVersion}) — run "abap extension deploy" to upgrade.`,
      );
    }
  }
  return icf;
}

/**
 * Core parameterized write for `abap init`. `--profile <name>` references an
 * existing global profile. Full connection params still create a new profile
 * in TTY mode.
 */
export async function runInitFromOpts(opts: CommandOpts, mode: OutputMode): Promise<void> {
  const isNonTty = !process.stdin.isTTY;
  const profileName = str(opts.profile) || str(opts.system) || '';
  const hasFullParams = (opts.url || process.env.SAP_URL) &&
    (opts.username || process.env.SAP_USER) &&
    !!opts.password;

  // Non-interactive mode: init never creates or mutates profiles.
  if (isNonTty && hasFullParams) {
    throw new CliError(
      'VALIDATION_ERROR',
      'In non-interactive mode, abap init does not create connection profiles. Use abap profile add.',
      {
        nextSteps: [
          "Create the profile: 'abap profile add <name> --url <url> --username <user> --password <pass>'.",
          "Then reference it: 'abap init --profile <name>'.",
        ],
        example: 'abap profile add dev --url https://sap.example.com --username USER',
      },
    );
  }

  if (hasFullParams) {
    await createSystemFromParams(opts, mode);
  } else if (profileName) {
    await useExistingSystem(profileName, opts, mode);
  } else {
    throw new CliError(
      'USAGE',
      'Non-interactive environment detected. Provide --profile:\n  abap init --profile <name>',
      {
        nextSteps: ["Run 'abap init --profile <name>' to reference an existing profile."],
        example: 'abap init --profile dev --yes',
      },
    );
  }
}

/** `abap init` (TTY wizard). Replaces the legacy `runConfigWizard`. */
export async function runInitWizard(opts: CommandOpts, mode: OutputMode): Promise<void> {
  const names = listSystemNames();

  let systemName = '';
  if (names.length > 0) {
    systemName = await selectSystem(names);
  }

  let config: CollectedConfig;
  if (systemName) {
    const profile = getSystem(systemName)!;
    config = {
      ...profile,
      password: '',
      transport: '',
      pkg: '',
    };
    // Prompt for a password when the profile actually needs one (basic or
    // oauth_password — both need a user password; cert/sso don't).
    if (config.auth.method === 'basic' || config.auth.method === 'oauth_password') {
      const useStored = orCancel(await confirm({ message: 'Use stored password?', initialValue: true }));
      if (useStored) {
        config.password = (await getPassword(systemName)) || '';
        if (!config.password) {
          if (!mode) console.log(`No stored password for '${systemName}'.`);
          config.password = orCancel(await password({ message: `Password for ${systemName}` }));
          await storePassword(systemName, config.password);
        }
      } else {
        config.password = orCancel(await password({ message: `Password for ${systemName}` }));
      }
    }
    if (!mode) console.log(`Using system profile '${systemName}' (${profile.url}).`);
  } else {
    systemName = orCancel(
      await text({
        message: 'System name',
        placeholder: 'e.g. dev',
        validate: (value) => ((value ?? '').trim() ? undefined : 'System name is required'),
      }),
    );
    config = await collectNewSystem(opts);
    await saveProfile(systemName, {
      url: config.url,
      client: config.client,
      username: config.username,
      language: config.language,
      insecure: config.insecure,
      ca: config.ca,
      auth: config.auth,
    }, config.password, mode);
  }

  config.transport = transportFromOpts(opts) || (orCancel(await text({ message: 'Transport request (optional)' }))) || '';
  config.pkg = str(opts.package) || (orCancel(await text({ message: 'Default package (optional)' }))) || '';

  validateTrialPackage(config.url, config.pkg, config.auth);
  validateInputs(config);
  await handleFileOverwrite(opts.yes === true || opts.nonInteractive === true ? 'overwrite' : 'prompt');
  await writeConfig(systemName, config, mode);
  if (mode) outputJson(systemName, config);
}

/** Select an existing system profile, or signal creating a new one (returns ''). */
async function selectSystem(names: string[]): Promise<string> {
  const choice = orCancel(
    await select({
      message: 'Select a system profile',
      options: [
        ...names.map((name) => {
          const p = getSystem(name)!;
          return { value: name, label: name, hint: `${p.username}@${p.url}` };
        }),
        { value: '__new__', label: 'Create a new system profile' },
      ],
    }),
  );
  return choice === '__new__' ? '' : choice;
}

/** Resolve the canonical auth from CLI options (init wizard). */
function resolveAuthFromOpts(opts: CommandOpts): AuthConfig {
  if (!opts.authMethod) return defaultAuth();
  const method = parseAuthMethodV2(opts.authMethod);
  const bag = {
    ...(opts.certPath ? { certPath: str(opts.certPath) } : {}),
    ...(opts.certKey ? { keyPath: str(opts.certKey) } : {}),
    ...(opts.certCa ? { caPath: str(opts.certCa) } : {}),
    ...(opts.ssoCookieFile ? { cookieFile: str(opts.ssoCookieFile) } : {}),
    ...(opts.serviceKey ? { serviceKey: str(opts.serviceKey) } : {}),
    ...(authOptionsFromCli(opts, method).bag),
  };
  return resolveAuthFromOptions({ method, bag }, defaultAuth());
}

/**
 * Prompt for a brand-new system profile.
 *
 * Order rationale (UX): identity first (URL → Client → Username → Language),
 * credentials last (insecure / ca → password). Asking for a password before
 * the user has named the system feels backwards and forces them to juggle
 * password-manager + paste + URL simultaneously.
 */
async function collectNewSystem(opts: CommandOpts): Promise<CollectedConfig> {
  const auth = resolveAuthFromOpts(opts);
  const wantPassword = auth.method === 'basic' || auth.method === 'oauth_password';

  const url = str(opts.url) || orCancel(await text({
    message: 'SAP URL',
    placeholder: 'https://sap.example.com',
    validate: (value) => ((value ?? '').trim() ? undefined : 'URL is required'),
  }));
  const client = str(opts.client) || orCancel(await text({ message: 'Client', initialValue: '100' }));
  const username = str(opts.username) || orCancel(await text({
    message: 'Username',
    validate: (value) => ((value ?? '').trim() ? undefined : 'Username is required'),
  }));
  const language = str(opts.language) || orCancel(await text({ message: 'Language', initialValue: 'EN' }));

  const insecure = opts.insecure === true
    ? true
    : orCancel(await confirm({
        message: 'Skip SSL certificate verification? (development only)',
        initialValue: false,
      }));
  const ca = insecure
    ? undefined
    : str(opts.ca) || undefined;

  // Local name shadows the imported `@clack/prompts` `password` — rename so the
  // ESM/TypeScript output doesn't trip on the inner `await password(...)` below.
  let resolvedPassword = '';
  if (wantPassword) {
    const fromFlag = str(opts.password);
    if (fromFlag) {
      resolvedPassword = fromFlag;
    } else {
      resolvedPassword = orCancel(await password({ message: 'Password (stored in OS keychain)' }));
    }
  }

  return {
    url,
    client,
    username,
    password: resolvedPassword,
    language,
    insecure: insecure ? true : undefined,
    ca,
    auth,
    transport: '',
    pkg: '',
  };
}

/**
 * Resolve the user password by auth method. Lookup order (matches
 * `auth/adapter.ts` so every profile type behaves identically):
 *   - basic:         keychain > --password > TTY prompt (and store)
 *   - oauth_password: keychain > --password > TTY prompt (and store)
 *   - cert / browser_sso: never asked (their auth supplies credentials)
 */
async function resolvePassword(profileName: string, auth: AuthConfig, explicit: string | undefined): Promise<string> {
  if (auth.method === 'cert' || auth.method === 'browser_sso') return '';
  const stored = (await getPassword(profileName)) || '';
  if (stored) return stored;
  if (explicit) return explicit;
  if (process.stdin.isTTY) {
    const { password } = await import('@clack/prompts');
    const entered = await password({
      message: `Password for '${profileName}' (auth=${auth.method}) — will be stored in OS keychain`,
    });
    if (typeof entered === 'string' && entered.length > 0) {
      await storePassword(profileName, entered);
      return entered;
    }
  }
  return '';
}

/** Use an existing user-level system profile */
async function useExistingSystem(
  profileName: string,
  opts: CommandOpts,
  mode: OutputMode,
): Promise<void> {
  const profile = getSystem(profileName);
  if (!profile) {
    throw new CliError(
      'NOT_FOUND',
      `Profile '${profileName}' not found.`,
      {
        nextSteps: [
          `Create it: 'abap profile add ${profileName} --url <url> --username <user> --password <pass>'.`,
          'Then re-run: abap init --profile <name>',
        ],
        example: `abap profile add ${profileName} --url https://sap.example.com --username USER`,
      },
    );
  }

  const password = await resolvePassword(profileName, profile.auth, str(opts.password) || undefined);

  const config: CollectedConfig = {
    ...profile,
    password,
    transport: transportFromOpts(opts),
    pkg: str(opts.package) || '',
  };

  if (!config.password && profile.auth.method === 'basic') {
    throw new CliError(
      'CONFIG_ERROR',
      `No password stored for profile '${profileName}'. Re-run with --password or update the profile: abap profile set ${profileName} --password <new>.`,
    );
  }
  if (!config.password && profile.auth.method === 'oauth_password') {
    throw new CliError(
      'CONFIG_ERROR',
      `No BTP password available for oauth_password profile '${profileName}'. Store it via abap profile set --password, or re-run with --password.`,
      {
        nextSteps: [
          `Store once: abap profile set ${profileName} --password <your SAP ID password> (writes to keychain, never to disk).`,
        ],
        example: `abap profile set ${profileName} --password <your SAP ID password>  # then abap init --profile ${profileName}`,
      },
    );
  }

  validateTrialPackage(config.url, config.pkg, config.auth);
  validateInputs(config);
  const probe = await maybeProbe(profileName, opts);
  await handleFileOverwrite(opts.yes === true || opts.nonInteractive === true ? 'overwrite' : 'refuse');
  await writeConfig(profileName, config, mode);

  const icf = await icfDeploymentCheck(mode);
  if (mode) outputJson(profileName, config, probe, icf);
}

/** Run the requested probe layers; throw a structured error if one fails. */
async function maybeProbe(
  systemName: string,
  opts: CommandOpts,
): Promise<{ tls?: ProbeLayerResult; auth?: ProbeLayerResult } | undefined> {
  const wantTls = opts.testTls === true || opts.testConnection === true;
  const wantAuth = opts.testAuth === true || opts.testConnection === true;
  if (!wantTls && !wantAuth) return undefined;

  const probe = await probeSystem(systemName);
  const payload: { tls?: ProbeLayerResult; auth?: ProbeLayerResult } = {};
  if (wantTls) payload.tls = probe.tls;
  if (wantAuth) payload.auth = probe.auth;

  const failed = wantTls && !probe.tls.ok && !probe.tls.skipped
    ? { layer: 'tls' as const, result: probe.tls }
    : wantAuth && !probe.auth.ok && !probe.auth.skipped
      ? { layer: 'auth' as const, result: probe.auth }
      : undefined;
  if (failed) {
    const code = (failed.result.error?.code ?? 'SAP_ERROR') as import('../../output/error-codes.js').ErrorCode;
    const example = failed.layer === 'tls'
      ? `abap profile set ${systemName} --ca ./sap-dev-ca.pem`
      : `abap profile set ${systemName} --password <new>`;
    throw new CliError(
      code,
      `Probe failed at ${failed.layer}: ${failed.result.error?.message ?? 'unknown error'}`,
      {
        details: { layer: failed.layer, system: systemName },
        nextSteps: failed.result.nextSteps,
        example,
      },
    );
  }
  return payload;
}

/** Create/update a system profile from CLI params */
async function createSystemFromParams(opts: CommandOpts, mode: OutputMode): Promise<void> {
  const url = str(opts.url) || process.env.SAP_URL || '';
  const auth = resolveAuthFromOpts(opts);
  const profile: SystemProfile = {
    url,
    client: str(opts.client) || process.env.SAP_CLIENT || '100',
    username: str(opts.username) || process.env.SAP_USER || '',
    language: str(opts.language) || process.env.SAP_LANGUAGE || 'EN',
    insecure: opts.insecure === true ? true : undefined,
    ca: str(opts.ca) || undefined,
    auth,
  };
  const password = str(opts.password) || '';

  const config: CollectedConfig = {
    ...profile,
    password,
    transport: transportFromOpts(opts) || process.env.SAP_TRANSPORT || '',
    pkg: str(opts.package) || process.env.SAP_PACKAGE || '',
  };
  validateTrialPackage(config.url, config.pkg, config.auth);
  validateInputs(config);

  const systemName = str(opts.profile) || str(opts.system) || deriveSystemName(profile);
  await saveProfile(systemName, profile, password, mode);
  // If the user supplied a cert passphrase, persist it in keychain too.
  if (str(opts.certPassphrase)) await storeCertPassphrase(systemName, str(opts.certPassphrase)!);
  await handleFileOverwrite(opts.yes === true || opts.nonInteractive === true ? 'overwrite' : 'refuse');
  await writeConfig(systemName, config, mode);
  const icf = await icfDeploymentCheck(mode, systemName);
  if (mode) outputJson(systemName, config, undefined, icf);
}

/**
 * Read the nearest .abap.json (walking up from cwd, stopping at .git) and print
 * it as JSON. Replaces the legacy `abap config show`. Never connects to SAP.
 */
export async function runInitShowConfig(_opts: CommandOpts, mode: OutputMode): Promise<void> {
  const configPath = findNearestWorkspaceConfig();
  if (!configPath) {
    throw new CliError(
      'CONFIG_ERROR',
      'No .abap.json found (searched cwd and parent directories up to the git boundary).',
      {
        nextSteps: ["Run 'abap init --profile <name> --yes' to create one."],
        example: 'abap init --profile dev --yes',
      },
    );
  }
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const outPath = toOutputPath(configPath);
    throw new CliError('CONFIG_ERROR', `Cannot parse ${outPath}: ${message}.`, {
      file: outPath,
      nextSteps: [`Fix or delete ${outPath} and re-run 'abap init'.`],
    });
  }
  const display = {
    configPath: toOutputPath(path.relative(process.cwd(), configPath)) || '.abap.json',
    ...parsed,
  };
  const human = Object.entries(parsed)
    .map(([k, v]) => `  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n');
  printResult(mode, display, human ? `Workspace config (${display.configPath}):\n${human}` : `Workspace config (${display.configPath}) is empty.`);
}

/**
 * Remove the listed top-level keys from the nearest .abap.json. Refuses without
 * `--yes` in non-TTY. Replaces the legacy `abap config set` (which could only
 * set values, never clear them).
 */
export async function runInitUnset(keys: string[], yes: boolean, mode: OutputMode): Promise<void> {
  if (!yes && !process.stdin.isTTY) {
    throw new CliError(
      'VALIDATION_ERROR',
      '--unset-* is a write operation; confirm with --yes.',
      {
        nextSteps: ["Re-run with --yes, or run interactively in a TTY."],
        example: `abap init --unset-${keys[0] === 'transport' ? 'tr' : keys[0] === 'sourceDir' ? 'source-dir' : keys[0]} --yes`,
      },
    );
  }
  const configPath = findNearestWorkspaceConfig();
  if (!configPath) {
    throw new CliError(
      'CONFIG_ERROR',
      'No .abap.json found (searched cwd and parent directories up to the git boundary).',
      {
        nextSteps: ["Nothing to clear. Run 'abap init --profile <name> --yes' to create one."],
        example: 'abap init --profile dev --yes',
      },
    );
  }
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const outPath = toOutputPath(configPath);
    throw new CliError('CONFIG_ERROR', `Cannot parse ${outPath}: ${message}.`, {
      file: outPath,
    });
  }
  const removed: string[] = [];
  const missing: string[] = [];
  for (const k of keys) {
    if (k in parsed) {
      delete parsed[k];
      removed.push(k);
    } else {
      missing.push(k);
    }
  }
  fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
  // Invalidate cached config so the next loadConfig sees the change.
  try {
    const { resetConfig } = await import('../../config/project-config.js');
    resetConfig();
  } catch {
    // best-effort: tests that don't load project-config still work
  }
  const display = { configPath: toOutputPath(path.relative(process.cwd(), configPath)) || '.abap.json', removed, missing };
  const human = removed.length > 0
    ? `Removed from ${display.configPath}: ${removed.join(', ')}${missing.length > 0 ? ` (not present: ${missing.join(', ')})` : ''}.`
    : `No changes to ${display.configPath} (keys not present: ${missing.join(', ')}).`;
  printResult(mode, display, human);
}

/** Find the nearest .abap.json by walking up from cwd, stopping at .git/ or fs root. */
function findNearestWorkspaceConfig(): string | null {
  let dir = path.resolve(process.cwd());
  const seen = new Set<string>();
  while (!seen.has(dir)) {
    seen.add(dir);
    const candidate = path.join(dir, '.abap.json');
    if (fs.existsSync(candidate)) return candidate;
    if (fs.existsSync(path.join(dir, '.git'))) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}