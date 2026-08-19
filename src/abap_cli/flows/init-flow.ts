import * as fs from 'fs';
import * as path from 'path';
import { confirm, isCancel, select, text, password } from '@clack/prompts';
import { getPassword, storePassword } from '../config/secrets.js';
import { getSystem, listSystemNames, upsertSystem, type SystemProfile } from '../config/user-config.js';
import { CliError, printResult, type OutputMode } from '../output/json.js';
import { collectWarning } from '../output/meta.js';
import { assertValidProfile } from '../config/validation.js';
import { probeSystem, type ProbeLayerResult } from '../clients/probe.js';
import { checkIcfDeployment, ICF_SERVICE_VERSION, type IcfDeploymentInfo } from '../icf/service-version.js';
import { probeTextpoolCapability, recordCapability } from '../textpool/textpool-capability.js';

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

/** Save profile to user config + password to keychain */
export async function saveProfile(name: string, profile: SystemProfile, password: string, mode: OutputMode): Promise<void> {
  upsertSystem(name, profile);
  await storePassword(name, password);
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
      `.abap.json already exists. Delete it first or run interactively:\n  rm ${configPath}`,
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

/** T012: Input validation */
export function validateInputs(config: CollectedConfig): void {
  assertValidProfile(config);
  if (!config.password) {
    throw new CliError('INVALID_ARGUMENT', 'Password is required');
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
  if (!mode) console.log(`Created ${configPath}`);

  if (!mode) console.log('Workspace initialized.');
}

/** T013: JSON output */
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
    },
    transport: config.transport,
    package: config.pkg,
    ...(probe ?? {}),
    ...(icf ? { icf } : {}),
  };
  printResult('json', data, '');
}

/**
 * Informational ICF deployment check (FR-012..FR-015).
 * Never throws or blocks init: unreachable degrades to a warning.
 */
export async function icfDeploymentCheck(mode: OutputMode): Promise<IcfDeploymentInfo | undefined> {
  let icf: IcfDeploymentInfo;
  try {
    icf = await checkIcfDeployment();
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
 * Core parameterized write for `abap init`. Replaces the legacy
 * `runConfigFromOpts`. `--profile <name>` references an existing global
 * profile (formerly `--system`). Full connection params still create a
 * new profile in TTY mode (FR-022 unchanged).
 */
export async function runInitFromOpts(opts: CommandOpts, mode: OutputMode): Promise<void> {
  const isNonTty = !process.stdin.isTTY;
  const profileName = str(opts.profile) || str(opts.system) || '';
  const hasFullParams = (opts.url || process.env.SAP_URL) &&
    (opts.username || process.env.SAP_USER) &&
    (opts.password || process.env.SAP_PASSWORD);

  // FR-022: in non-interactive mode init never creates or mutates profiles.
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
    }, config.password, mode);
  }

  config.transport = transportFromOpts(opts) || (orCancel(await text({ message: 'Transport request (optional)' }))) || '';
  config.pkg = str(opts.package) || (orCancel(await text({ message: 'Default package (optional)' }))) || '';

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

/** Prompt for a brand-new system profile. */
async function collectNewSystem(opts: CommandOpts): Promise<CollectedConfig> {
  return {
    url: str(opts.url) || orCancel(await text({
      message: 'SAP URL',
      placeholder: 'https://sap.example.com',
      validate: (value) => ((value ?? '').trim() ? undefined : 'URL is required'),
    })),
    client: str(opts.client) || orCancel(await text({ message: 'Client', initialValue: '100' })),
    username: str(opts.username) || orCancel(await text({
      message: 'Username',
      validate: (value) => ((value ?? '').trim() ? undefined : 'Username is required'),
    })),
    password: str(opts.password) || orCancel(await password({ message: 'Password' })),
    language: str(opts.language) || orCancel(await text({ message: 'Language', initialValue: 'EN' })),
    insecure: opts.insecure === true ? true : undefined,
    ca: str(opts.ca) || undefined,
    transport: '',
    pkg: '',
  };
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

  const storedPassword = (await getPassword(profileName)) || '';
  const password = str(opts.password) || process.env.SAP_PASSWORD || storedPassword;

  const config: CollectedConfig = {
    ...profile,
    password,
    transport: transportFromOpts(opts),
    pkg: str(opts.package) || '',
  };

  if (!config.password) {
    throw new CliError(
      'CONFIG_ERROR',
      `No password stored for profile '${profileName}'. Re-run with --password or update the profile: abap profile set ${profileName} --password <new>.`,
    );
  }

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
    const code = (failed.result.error?.code ?? 'SAP_ERROR') as import('../output/error-codes.js').ErrorCode;
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
  const profile: SystemProfile = {
    url: str(opts.url) || process.env.SAP_URL || '',
    client: str(opts.client) || process.env.SAP_CLIENT || '100',
    username: str(opts.username) || process.env.SAP_USER || '',
    language: str(opts.language) || process.env.SAP_LANGUAGE || 'EN',
    insecure: opts.insecure === true ? true : undefined,
    ca: str(opts.ca) || undefined,
  };
  const password = str(opts.password) || process.env.SAP_PASSWORD || '';

  const config: CollectedConfig = {
    ...profile,
    password,
    transport: transportFromOpts(opts) || process.env.SAP_TRANSPORT || '',
    pkg: str(opts.package) || process.env.SAP_PACKAGE || '',
  };
  validateInputs(config);

  const systemName = str(opts.profile) || str(opts.system) || deriveSystemName(profile);
  await saveProfile(systemName, profile, password, mode);
  await handleFileOverwrite(opts.yes === true || opts.nonInteractive === true ? 'overwrite' : 'refuse');
  await writeConfig(systemName, config, mode);
  const icf = await icfDeploymentCheck(mode);
  if (mode) outputJson(systemName, config, undefined, icf);
}