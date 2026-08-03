import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { select, text, password, confirm, isCancel } from '@clack/prompts';
import { storePassword, getPassword } from '../crypto/secrets.js';
import {
  getSystem,
  listSystemNames,
  upsertSystem,
  type SystemProfile,
} from '../config/user-config.js';
import { CliError, printError, printResult, jsonFromCommand } from '../output/json.js';
import { assertValidProfile } from '../config/validation.js';

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

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize workspace configuration for SAP connection')
    .option('--system <name>', 'Name of an existing system profile (see user config)')
    .option('--url <url>', 'SAP system URL (creates/updates a system profile)')
    .option('-c, --client <client>', 'SAP client number')
    .option('-u, --username <user>', 'SAP username')
    .option('-p, --password <password>', 'SAP password')
    .option('-l, --language <language>', 'SAP language')
    .option('-t, --transport <transport>', 'Default transport number')
    .option('--package <package>', 'Default SAP package')
    .option('--insecure', 'Skip SSL certificate verification (self-signed certs, development only)')
    .option('--ca <path>', 'Path to a CA certificate (PEM) for SSL verification')
    .action(async (opts, cmd) => {
      const jsonOutput = jsonFromCommand(cmd);
      try {
        await runInit(opts, jsonOutput);
      } catch (error: unknown) {
        printError(jsonOutput, error);
      }
    });
}

async function runInit(opts: CommandOpts, jsonOutput: boolean): Promise<void> {
  const systemName = str(opts.system) || '';
  const hasFullParams = (opts.url || process.env.SAP_URL) &&
    (opts.username || process.env.SAP_USER) &&
    (opts.password || process.env.SAP_PASSWORD);

  if (hasFullParams) {
    // Create/update a system profile (named by --system if given) and reference it
    await createSystemFromParams(opts, jsonOutput);
  } else if (systemName) {
    // Reference an existing system profile directly
    await useExistingSystem(systemName, opts, jsonOutput);
  } else if (process.stdin.isTTY) {
    // Interactive: select existing system or create new
    await interactiveInit(opts, jsonOutput);
  } else {
    throw new CliError(
      'USAGE',
      'Non-interactive environment detected. Provide required options:\n' +
        '  abap init --system <name>\n' +
        '  abap init --url <url> --username <user> --password <password>',
    );
  }
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
      `System profile '${systemName}' not found. Run 'abap init' interactively to create it.`,
    );
  }

  // Password: keychain (stored at profile creation) or --password/env override
  const storedPassword = (await getPassword(systemName)) || '';
  const password = str(opts.password) || process.env.SAP_PASSWORD || storedPassword;

  const config: CollectedConfig = {
    ...profile,
    password,
    transport: str(opts.transport) || '',
    pkg: str(opts.package) || '',
  };

  if (!config.password) {
    throw new CliError(
      'CONFIG_ERROR',
      `No password stored for system '${systemName}'. Re-run with --password.`,
    );
  }

  validateInputs(config);
  await handleFileOverwrite(false);
  await writeConfig(systemName, config, jsonOutput);
  if (jsonOutput) outputJson(systemName, config);
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
    transport: str(opts.transport) || process.env.SAP_TRANSPORT || '',
    pkg: str(opts.package) || process.env.SAP_PACKAGE || '',
  };
  validateInputs(config);

  const systemName = str(opts.system) || deriveSystemName(profile);
  await saveProfile(systemName, profile, password, jsonOutput);
  await handleFileOverwrite(false);
  await writeConfig(systemName, config, jsonOutput);
  if (jsonOutput) outputJson(systemName, config);
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
  config.transport = str(opts.transport) || (orCancel(await text({ message: 'Transport request (optional)' }))) || '';
  config.pkg = str(opts.package) || (orCancel(await text({ message: 'Default package (optional)' }))) || '';

  validateInputs(config);
  await handleFileOverwrite(true);
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
  if (!jsonOutput) console.log(`System profile '${name}' saved. Password stored securely in OS keychain.`);
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

/** T008: File overwrite confirmation */
async function handleFileOverwrite(isInteractive: boolean): Promise<void> {
  const configPath = path.join(process.cwd(), '.abap.json');

  if (!fs.existsSync(configPath)) return;

  if (!isInteractive) {
    throw new CliError(
      'FILE_EXISTS',
      `.abap.json already exists. Delete it first or run interactively:\n  rm ${configPath}`,
    );
  }

  const ok = orCancel(await confirm({ message: '.abap.json already exists. Overwrite?', initialValue: false }));
  if (!ok) {
    console.log('Aborted. Existing configuration preserved.');
    process.exit(0);
  }
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

  // Create local work directories
  for (const dir of ['src', 'ddic']) {
    const dirPath = path.join(cwd, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      if (!jsonOutput) console.log(`Created directory ${dirPath}`);
    }
  }

  if (!jsonOutput) console.log('Workspace initialized.');
}

/** T013: JSON output */
function outputJson(systemName: string, config: CollectedConfig): void {
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
  };
  printResult(true, data, '');
}
