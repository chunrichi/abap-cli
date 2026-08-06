import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { select, text, password, confirm, isCancel } from '@clack/prompts';
import { originalArgv } from '../output/meta.js';
import { storePassword, getPassword } from '../config/secrets.js';
import {
  getSystem,
  listSystemNames,
  upsertSystem,
  type SystemProfile,
} from '../config/user-config.js';
import { CliError, printError, printResult, jsonFromCommand } from '../output/json.js';
import { collectWarning } from '../output/meta.js';
import { commonErrorsAfter } from '../output/help-text.js';
import { assertValidProfile } from '../config/validation.js';
import { probeSystem, type ProbeLayerResult } from '../clients/probe.js';
import { checkIcfDeployment, type IcfDeploymentInfo } from '../icf/service-version.js';
import { probeTextpoolCapability, recordCapability } from '../textpool/textpool-capability.js';
import type { ErrorCode } from '../output/error-codes.js';

interface WorkspaceConfig {
  system: string;
  transport: string;
  package: string;
}

interface CollectedConfig extends SystemProfile {
  password: string;
  transport: string;
  pkg: string;
}

type CommandOpts = Record<string, string | boolean | undefined>;

/** Read a string option, falling back when absent or a non-string (boolean flag). */
function str(v: string | boolean | undefined, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

/** `abap config` (parent) help: option groups, examples, connection profiles. */
function configParamHelp(): string {
  return [
    '',
    'Option groups:',
    '  Connection:      --system, --url, --client, --username, --password, --language, --insecure, --ca',
    '  Workspace:       --tr, --package  (written to .abap.json as defaults)',
    '  Test/verify:     --test-connection, --test-tls, --test-auth',
    '  Interactive:     --yes / --non-interactive',
    '',
    'Examples:',
    '  # Use an existing profile and set default transport & package',
    '  abap config --system DEV --tr DEVK900001 --package Z_MY_PACKAGE',
    '',
    '  # CI / non-interactive (profile must exist)',
    '  abap connection add CI --url https://... --username CI_USER --password ...',
    '  abap config --system CI --yes',
    '',
    '  # Run the interactive wizard instead of passing parameters',
    '  abap config init',
    '',
    'Connection profiles:',
    '  --url / --username / --password are accepted only in interactive mode.',
    '  In scripts and CI, create a profile once:',
    '    abap connection add <name> --url <url> --username <user> --password <pass>',
    '  Then reference it here:',
    '    abap config --system <name>',
    '',
  ].join('\n');
}

/** `abap config init` (wizard) help. */
function configInitHelpBlocks(): string {
  return [
    '',
    'The wizard prompts you to either select an existing system profile or create',
    'a new one, then writes .abap.json in the current directory. No flags are',
    'accepted — to pass parameters directly, use `abap config <flags>` instead.',
    '',
    'Equivalent flow:',
    '  abap config init             # interactive wizard (TTY only)',
    '  abap config --system DEV     # non-interactive write',
    '',
  ].join('\n');
}

export function registerConfigCommand(program: Command): void {
  const config = program
    .command('config')
    .description('Configure the workspace: write .abap.json from a system profile, or create one from full connection params. Run `abap config init` for the interactive wizard.')
    .addHelpText('after', commonErrorsAfter())
    .addHelpText('after', configParamHelp())
    .option('--system <name>', 'Use an existing system profile (created with `abap connection add`)')
    .option('--url <url>', 'SAP system URL (interactive mode only)')
    .option('-c, --client <client>', 'SAP client number')
    .option('-u, --username <user>', 'SAP username')
    .option('-p, --password <password>', 'SAP password')
    .option('-l, --language <language>', 'SAP language')
    .option('--insecure', 'Skip SSL certificate verification (development only)')
    .option('--ca <path>', 'Path to a CA certificate (PEM) for SSL verification')
    .option('--tr <transport>', 'Default transport number (written to .abap.json)')
    .option('--package <package>', 'Default SAP package (written to .abap.json)')
    .option('--test-connection', 'Probe TLS + auth and report results (implies --test-tls --test-auth)')
    .option('--test-tls', 'Probe the TLS handshake')
    .option('--test-auth', 'Probe authentication (after TLS)')
    .option('--yes', 'Skip all prompts; fail if required input is missing (alias: --non-interactive)')
    .option('--non-interactive', 'Alias of --yes')
    .action(async (opts, cmd) => {
      // Bare `abap config` (no flag) prints the subcommand help, like `abap connection` does.
      if (Object.keys(opts).length === 0) {
        console.log(cmd.helpInformation());
        return;
      }
      const jsonOutput = jsonFromCommand(cmd);
      try {
        await runConfigFromOpts(opts, jsonOutput);
      } catch (error: unknown) {
        printError(jsonOutput, error);
      }
    });

  config
    .command('init')
    .description('Interactive wizard: prompts to select or create a system profile, then writes .abap.json. Does not accept any flags.')
    .addHelpText('after', configInitHelpBlocks())
    .action(async (opts, cmd) => {
      // Reject config-only flags after `config init` — the wizard accepts no
      // parameters. Global flags (--json, --report-stuck, --help) are ignored.
      // commander has already mutated process.argv by now, so we read the
      // snapshot taken at module load (output/meta.ts#originalArgv).
      const configFlags = new Set([
        '--system', '--url', '-c', '--client', '-u', '--username', '-p', '--password',
        '-l', '--language', '--insecure', '--ca', '--tr', '--package',
        '--test-connection', '--test-tls', '--test-auth', '--yes', '--non-interactive',
      ]);
      const initIdx = originalArgv.indexOf('init');
      const trailing = initIdx >= 0 ? originalArgv.slice(initIdx + 1) : [];
      const userFlags: string[] = [];
      for (let i = 0; i < trailing.length; i++) {
        const a = trailing[i]!;
        if (a.startsWith('-')) {
          // Include the value of `-x value` style short flags; commander
          // doesn't know the user passed it because we didn't define it.
          if (/^-[a-z]$/i.test(a) && i + 1 < trailing.length && !trailing[i + 1]!.startsWith('-')) {
            userFlags.push(a, trailing[i + 1]!);
            i++;
          } else {
            userFlags.push(a);
          }
        }
      }
      const offending = userFlags.filter((f) => configFlags.has(f));
      if (offending.length > 0) {
        throw new CliError(
          'USAGE',
          `abap config init does not accept flags. Got: ${offending.join(' ')}. Use \`abap config <flags>\` to pass parameters directly.`,
          {
            nextSteps: [
              'Drop the flags and run `abap config init` to enter the wizard.',
              'Or run `abap config --system <name>` to write .abap.json from parameters.',
            ],
            example: 'abap config init',
          },
        );
      }
      const jsonOutput = jsonFromCommand(cmd);
      try {
        await runConfigWizard(opts, jsonOutput);
      } catch (error: unknown) {
        printError(jsonOutput, error);
      }
    });
}

/** Core parameterized write — shared by `abap config` (parent) and previously `abap config init`. */
async function runConfigFromOpts(opts: CommandOpts, jsonOutput: boolean): Promise<void> {
  const isNonTty = !process.stdin.isTTY;
  const systemName = str(opts.system) || '';
  const hasFullParams = (opts.url || process.env.SAP_URL) &&
    (opts.username || process.env.SAP_USER) &&
    (opts.password || process.env.SAP_PASSWORD);

  // FR-022: in non-interactive mode config never creates or mutates profiles.
  if (isNonTty && hasFullParams) {
    throw new CliError(
      'VALIDATION_ERROR',
      'In non-interactive mode, abap config does not create connection profiles. Use abap connection add.',
      {
        nextSteps: [
          "Create the profile: 'abap connection add <name> --url <url> --username <user> --password <pass>'.",
          "Then reference it: 'abap config --system <name>'.",
        ],
        example: 'abap connection add dev --url https://sap.example.com --username USER',
      },
    );
  }

  if (hasFullParams) {
    // Interactive (TTY) path may still create a profile from params.
    await createSystemFromParams(opts, jsonOutput);
  } else if (systemName) {
    await useExistingSystem(systemName, opts, jsonOutput);
  } else {
    throw new CliError(
      'USAGE',
      'Non-interactive environment detected. Provide --system:\n  abap config init --system <name>',
      {
        nextSteps: ["Run 'abap config --system <name>' to reference an existing profile."],
        example: 'abap config --system dev --test-connection --yes',
      },
    );
  }
}

/** `abap config init` — interactive wizard, refactored from the old interactiveInit. */
async function runConfigWizard(opts: CommandOpts, jsonOutput: boolean): Promise<void> {
  await interactiveInit(opts, jsonOutput);
}

/** Use an existing user-level system profile */
async function useExistingSystem(
  systemName: string,
  opts: CommandOpts,
  jsonOutput: boolean,
): Promise<void> {
  const profile = getSystem(systemName);
  if (!profile) {
    throw new CliError(
      'CONFIG_ERROR',
      `System profile '${systemName}' not found. Run 'abap config init' (the wizard) to create it.`,
    );
  }

  // Password: keychain (stored at profile creation) or --password/env override
  const storedPassword = (await getPassword(systemName)) || '';
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
      `No password stored for system '${systemName}'. Re-run with --password.`,
    );
  }

  validateInputs(config);
  // Probe BEFORE writing .abap.json so a failed probe leaves no workspace behind (US-5).
  const probe = await maybeProbe(systemName, opts);
  await handleFileOverwrite('refuse');
  await writeConfig(systemName, config, jsonOutput);

  // FR-021: optional per-layer probe (--test-tls / --test-auth / --test-connection).
  // FR-012..FR-015: informational ICF deployment + version check (never blocks init).
  const icf = await icfDeploymentCheck(jsonOutput);
  if (jsonOutput) outputJson(systemName, config, probe, icf);
}

/** Resolve the transport flag from --tr (only canonical option since --transport was removed). */
function transportFromOpts(opts: CommandOpts): string {
  return str(opts.tr);
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
    const code = (failed.result.error?.code ?? 'SAP_ERROR') as ErrorCode;
    const example = failed.layer === 'tls'
      ? `abap connection set ${systemName} --ca ./sap-dev-ca.pem`
      : `abap connection set ${systemName} --password <new>`;
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
async function createSystemFromParams(opts: CommandOpts, jsonOutput: boolean): Promise<void> {
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

  const systemName = str(opts.system) || deriveSystemName(profile);
  await saveProfile(systemName, profile, password, jsonOutput);
  await handleFileOverwrite('refuse');
  await writeConfig(systemName, config, jsonOutput);
  const icf = await icfDeploymentCheck(jsonOutput);
  if (jsonOutput) outputJson(systemName, config, undefined, icf);
}

/** Interactive: select existing system or create a new one */
async function interactiveInit(opts: CommandOpts, jsonOutput: boolean): Promise<void> {
  const names = listSystemNames();

  let systemName = '';
  if (names.length > 0) {
    systemName = await selectSystem(names);
  }

  let config: CollectedConfig;
  if (systemName) {
    // Existing system selected
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
        if (!jsonOutput) console.log(`No stored password for '${systemName}'.`);
        config.password = orCancel(await password({ message: `Password for ${systemName}` }));
        // The user asked for a stored password — persist it so later runs find it.
        await storePassword(systemName, config.password);
      }
    } else {
      config.password = orCancel(await password({ message: `Password for ${systemName}` }));
    }
    if (!jsonOutput) console.log(`Using system profile '${systemName}' (${profile.url}).`);
  } else {
    // Create new system profile
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
    }, config.password, jsonOutput);
  }

  // Workspace-level fields
  config.transport = transportFromOpts(opts) || (orCancel(await text({ message: 'Transport request (optional)' }))) || '';
  config.pkg = str(opts.package) || (orCancel(await text({ message: 'Default package (optional)' }))) || '';

  validateInputs(config);
  await handleFileOverwrite(opts.yes === true || opts.nonInteractive === true ? 'overwrite' : 'prompt');
  await writeConfig(systemName, config, jsonOutput);
  if (jsonOutput) outputJson(systemName, config);
}

/** Select an existing system profile, or signal creating a new one (returns '') */
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

/** Prompt for a brand-new system profile */
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

/** Exit 130 on Ctrl+C (@clack cancel), otherwise return the value */
function orCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    console.log('\nAborted. No files were created.');
    process.exit(130);
  }
  return value as T;
}

/** Save profile to user config + password to keychain */
async function saveProfile(name: string, profile: SystemProfile, password: string, jsonOutput: boolean): Promise<void> {
  upsertSystem(name, profile);
  await storePassword(name, password);
  // 014: one-shot textpool capability probe (Q1: record at connect, reuse later).
  await recordCapabilityIfPossible(name);
  if (!jsonOutput) console.log(`System profile '${name}' saved. Password stored securely in OS keychain.`);
}

/** 014: informational capability probe — never blocks init (degraded, non-blocking). */
async function recordCapabilityIfPossible(name: string): Promise<void> {
  try {
    const cap = await probeTextpoolCapability();
    await recordCapability(name, cap);
  } catch {
    // informational — the profile simply has no adtTextpool record
  }
}

/** Auto-derive a profile name from the system URL and username */
function deriveSystemName(profile: SystemProfile): string {
  try {
    const host = new URL(profile.url).hostname.replace(/\./g, '-');
    return `${profile.username}-${host}`;
  } catch {
    return `${profile.username}-system`;
  }
}

/** Refuse / confirm / skip overwriting an existing .abap.json. */
async function handleFileOverwrite(mode: 'prompt' | 'overwrite' | 'refuse'): Promise<void> {
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
function validateInputs(config: CollectedConfig): void {
  assertValidProfile(config);
  if (!config.password) {
    throw new CliError('INVALID_ARGUMENT', 'Password is required');
  }
}

/** Write workspace config referencing a user-level system profile */
async function writeConfig(systemName: string, config: CollectedConfig, jsonOutput: boolean): Promise<void> {
  const cwd = process.cwd();

  // .abap.json — references user-level system profile + workspace-specific fields
  const workspaceConfig: WorkspaceConfig = {
    system: systemName,
    transport: config.transport,
    package: config.pkg,
  };
  const configPath = path.join(cwd, '.abap.json');
  fs.writeFileSync(configPath, JSON.stringify(workspaceConfig, null, 2) + '\n', 'utf-8');
  if (!jsonOutput) console.log(`Created ${configPath}`);

  if (!jsonOutput) console.log('Workspace initialized.');
}

/** T013: JSON output */
function outputJson(
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
  printResult(true, data, '');
}

/**
 * Informational ICF deployment check (FR-012..FR-015).
 * Never throws or blocks init: unreachable degrades to a warning; human mode
 * prints a hint. Returns the state so JSON output can embed it in data.icf.
 */
async function icfDeploymentCheck(jsonOutput: boolean): Promise<IcfDeploymentInfo | undefined> {
  let icf: IcfDeploymentInfo;
  try {
    icf = await checkIcfDeployment();
  } catch (error: unknown) {
    // Unreachable degraded check — never fails init.
    icf = {
      status: 'unreachable',
      expectedVersion: '0.1.0',
      error: { code: 'ICF_CHECK_DEGRADED', message: error instanceof Error ? error.message : String(error) },
    };
  }
  if (icf.status === 'unreachable') {
    collectWarning('ICF_CHECK_DEGRADED', `ICF deployment check degraded: ${icf.error?.message ?? 'unreachable'}`, {
      status: 'unreachable',
    });
    if (!jsonOutput) console.log('Warning: ICF deployment check skipped (SAP unreachable).');
    return icf;
  }
  if (!jsonOutput) {
    if (icf.status === 'not_deployed') {
      console.log('ICF service not deployed — run "abap deploy" to deploy/update it.');
    } else if (icf.status === 'current') {
      console.log(`ICF service deployed (version ${icf.remoteVersion}).`);
    } else {
      console.log(
        `ICF service version mismatch (remote ${icf.remoteVersion ?? 'unknown'} vs expected ${icf.expectedVersion}) — run "abap deploy" to upgrade.`,
      );
    }
  }
  return icf;
}
