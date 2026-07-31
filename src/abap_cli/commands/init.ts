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
    .action(async (opts, cmd) => {
      try {
        const jsonOutput = cmd.parent?.opts()?.json ?? false;
        await runInit(opts, jsonOutput);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}

async function runInit(opts: Record<string, string>, jsonOutput: boolean): Promise<void> {
  const systemName = opts.system || '';
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
    console.error('Error: Non-interactive environment detected. Provide required options:');
    console.error('  abap init --system <name>');
    console.error('  abap init --url <url> --username <user> --password <password>');
    process.exit(1);
  }
}

/** Use an existing user-level system profile */
async function useExistingSystem(
  systemName: string,
  opts: Record<string, string>,
  jsonOutput: boolean,
): Promise<void> {
  const profile = getSystem(systemName);
  if (!profile) {
    console.error(`Error: System profile '${systemName}' not found. Run 'abap init' interactively to create it.`);
    process.exit(1);
  }

  // Password: keychain (stored at profile creation) or --password/env override
  const storedPassword = (await getPassword(systemName)) || '';
  const password = opts.password || process.env.SAP_PASSWORD || storedPassword;

  const config: CollectedConfig = {
    ...profile,
    password,
    transport: opts.transport || '',
    pkg: opts.package || '',
  };

  if (!config.password) {
    console.error(`Error: No password stored for system '${systemName}'. Re-run with --password.`);
    process.exit(1);
  }

  validateInputs(config);
  await handleFileOverwrite(false);
  await writeConfig(systemName, config);
  if (jsonOutput) outputJson(systemName, config);
}

/** Create/update a system profile from CLI params */
async function createSystemFromParams(opts: Record<string, string>, jsonOutput: boolean): Promise<void> {
  const profile: SystemProfile = {
    url: opts.url || process.env.SAP_URL || '',
    client: opts.client || process.env.SAP_CLIENT || '100',
    username: opts.username || process.env.SAP_USER || '',
    language: opts.language || process.env.SAP_LANGUAGE || 'EN',
  };
  const password = opts.password || process.env.SAP_PASSWORD || '';

  const config: CollectedConfig = {
    ...profile,
    password,
    transport: opts.transport || process.env.SAP_TRANSPORT || '',
    pkg: opts.package || process.env.SAP_PACKAGE || '',
  };
  validateInputs(config);

  const systemName = opts.system || deriveSystemName(profile);
  await saveProfile(systemName, profile, password);
  await handleFileOverwrite(false);
  await writeConfig(systemName, config);
  if (jsonOutput) outputJson(systemName, config);
}

/** Interactive: select existing system or create a new one */
async function interactiveInit(opts: Record<string, string>, jsonOutput: boolean): Promise<void> {
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
        console.log(`No stored password for '${systemName}'.`);
        config.password = orCancel(await password({ message: `Password for ${systemName}` }));
      }
    } else {
      config.password = orCancel(await password({ message: `Password for ${systemName}` }));
    }
    console.log(`Using system profile '${systemName}' (${profile.url}).`);
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
    }, config.password);
  }

  // Workspace-level fields
  config.transport = opts.transport || (orCancel(await text({ message: 'Transport request (optional)' }))) || '';
  config.pkg = opts.package || (orCancel(await text({ message: 'Default package (optional)' }))) || '';

  validateInputs(config);
  await handleFileOverwrite(true);
  await writeConfig(systemName, config);
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
async function collectNewSystem(opts: Record<string, string>): Promise<CollectedConfig> {
  return {
    url: opts.url || orCancel(await text({
      message: 'SAP URL',
      placeholder: 'https://sap.example.com',
      validate: (value) => ((value ?? '').trim() ? undefined : 'URL is required'),
    })),
    client: opts.client || orCancel(await text({ message: 'Client', initialValue: '100' })),
    username: opts.username || orCancel(await text({
      message: 'Username',
      validate: (value) => ((value ?? '').trim() ? undefined : 'Username is required'),
    })),
    password: opts.password || orCancel(await password({ message: 'Password' })),
    language: opts.language || orCancel(await text({ message: 'Language', initialValue: 'EN' })),
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
async function saveProfile(name: string, profile: SystemProfile, password: string): Promise<void> {
  upsertSystem(name, profile);
  await storePassword(name, password);
  console.log(`System profile '${name}' saved. Password stored securely in OS keychain.`);
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
    console.error('Error: .abap.json already exists. Please delete it first or run interactively:');
    console.error(`  rm ${configPath}`);
    process.exit(1);
  }

  const ok = orCancel(await confirm({ message: '.abap.json already exists. Overwrite?', initialValue: false }));
  if (!ok) {
    console.log('Aborted. Existing configuration preserved.');
    process.exit(0);
  }
}

/** T012: Input validation */
function validateInputs(config: CollectedConfig): void {
  // URL: non-empty and has protocol prefix
  if (!config.url) {
    console.error('Error: URL is required');
    process.exit(1);
  }
  if (!config.url.match(/^https?:\/\//i)) {
    console.error('Error: Invalid URL format — must start with http:// or https://');
    process.exit(1);
  }

  // Username: non-empty
  if (!config.username) {
    console.error('Error: Username is required');
    process.exit(1);
  }

  // Password: non-empty
  if (!config.password) {
    console.error('Error: Password is required');
    process.exit(1);
  }

  // Client: 3-digit numeric or empty
  if (config.client && !/^\d{3}$/.test(config.client)) {
    console.error('Error: Client must be a 3-digit number');
    process.exit(1);
  }

  // Language: 2-char alpha or empty
  if (config.language && !/^[a-zA-Z]{2}$/.test(config.language)) {
    console.error('Error: Language must be a 2-character code');
    process.exit(1);
  }
}

/** Write workspace config referencing a user-level system profile */
async function writeConfig(systemName: string, config: CollectedConfig): Promise<void> {
  const cwd = process.cwd();

  // .abap.json — references user-level system profile + workspace-specific fields
  const workspaceConfig: WorkspaceConfig = {
    system: systemName,
    transport: config.transport,
    package: config.pkg,
  };
  const configPath = path.join(cwd, '.abap.json');
  fs.writeFileSync(configPath, JSON.stringify(workspaceConfig, null, 2) + '\n', 'utf-8');
  console.log(`Created ${configPath}`);

  // Create local work directories
  for (const dir of ['src', 'ddic']) {
    const dirPath = path.join(cwd, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`Created directory ${dirPath}`);
    }
  }

  console.log('Workspace initialized.');
}

/** T013: JSON output */
function outputJson(systemName: string, config: CollectedConfig): void {
  const result = {
    status: 'success',
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
  console.log(JSON.stringify(result, null, 2));
}
