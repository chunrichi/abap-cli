import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { select, text, password, confirm, isCancel } from '@clack/prompts';
import { getSystem, listSystemNames, upsertSystem, deleteSystem, type SystemProfile } from '../config/user-config.js';
import { getPassword, storePassword, deletePassword } from '../crypto/secrets.js';

export function registerSystemCommand(program: Command): void {
  const system = program
    .command('system')
    .description('Manage global system profiles')
    .action(async (opts, cmd) => {
      try {
        if (!process.stdin.isTTY) {
          cmd.help();
          return;
        }
        await interactiveMenu(cmd);
      } catch (error: unknown) {
        handleError(error);
      }
    });

  system
    .command('list')
    .description('List all saved system profiles')
    .action((opts, cmd) => {
      runList(jsonFrom(cmd));
    });

  system
    .command('show <name>')
    .description('Show details of a system profile')
    .action(async (name: string, _opts, cmd) => {
      try {
        await runShow(name, jsonFrom(cmd));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  system
    .command('set <name>')
    .description('Modify a system profile (fields or password)')
    .option('--url <url>', 'New SAP system URL')
    .option('-c, --client <client>', 'New SAP client number')
    .option('-u, --username <user>', 'New SAP username')
    .option('-l, --language <lang>', 'New SAP language')
    .option('-p, --password <password>', 'New password (updates keychain credential)')
    .option('--remove-password', 'Remove the stored password from keychain')
    .action(async (name: string, opts, cmd) => {
      try {
        await runSet(name, opts, jsonFrom(cmd));
      } catch (error: unknown) {
        handleError(error);
      }
    });

  system
    .command('delete <name>')
    .description('Delete a system profile and its stored password')
    .action(async (name: string, _opts, cmd) => {
      try {
        await runDelete(name, jsonFrom(cmd));
      } catch (error: unknown) {
        handleError(error);
      }
    });
}

/** Resolve the top-level --json flag from any nested subcommand */
function jsonFrom(cmd: Command): boolean {
  let c: Command | undefined = cmd;
  while (c.parent) c = c.parent;
  return c.opts().json ?? false;
}

/** Report command errors; Ctrl+C during interactive prompts exits 130 without changes */
function handleError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('Aborted with Ctrl+C')) {
    console.log('\nAborted. No changes were made.');
    process.exit(130);
  }
  console.error(`Error: ${message}`);
  process.exit(1);
}

function runList(jsonOutput: boolean): void {
  const names = listSystemNames();
  if (jsonOutput) {
    console.log(JSON.stringify({ status: 'success', systems: names }, null, 2));
    return;
  }
  if (names.length === 0) {
    console.log("No system profiles saved. Run 'abap init' to create one.");
    return;
  }
  console.log('System profiles:');
  for (const name of names) {
    const profile = getSystem(name)!;
    console.log(`  ${name} — ${profile.username}@${profile.url}`);
  }
}

/** Guided menu: reachable via bare `abap system` on a TTY */
async function interactiveMenu(cmd: Command): Promise<void> {
  while (true) {
    const names = listSystemNames();
    if (names.length === 0) {
      const action = await select({
        message: 'No system profiles saved yet',
        options: [
          { value: 'init', label: 'Create a system profile', hint: 'abap init' },
          { value: 'exit', label: 'Exit' },
        ],
      });
      if (orCancel(action) === 'exit') return;
      console.log("Run 'abap init' to create a system profile.");
      return;
    }

    const action = await select({
      message: 'System configuration manager',
      options: [
        { value: 'list', label: 'List system profiles' },
        { value: 'show', label: 'Show system profile' },
        { value: 'set', label: 'Modify system profile' },
        { value: 'delete', label: 'Delete system profile' },
        { value: 'exit', label: 'Exit' },
      ],
    });
    const choice = orCancel(action);
    switch (choice) {
      case 'exit':
        return;
      case 'list':
        runList(jsonFrom(cmd));
        break;
      case 'show':
      case 'set':
      case 'delete': {
        const name = await pickSystemName(choice);
        if (!name) break;
        if (choice === 'show') {
          await runShow(name, jsonFrom(cmd));
        } else if (choice === 'set') {
          const profile = getSystem(name)!;
          await interactiveSet(name, profile, jsonFrom(cmd));
        } else {
          await runDelete(name, jsonFrom(cmd));
        }
        break;
      }
    }
  }
}

/** Let the user pick one of the existing system profiles */
async function pickSystemName(verb: string): Promise<string | null> {
  const names = listSystemNames();
  if (names.length === 0) return null;
  const name = await select({
    message: `Select system to ${verb}`,
    options: names.map((n) => ({ value: n, label: n })),
  });
  return orCancel(name);
}

/** Exit 130 on Ctrl+C (@clack cancel), otherwise return the value */
function orCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    console.log('\nAborted.');
    process.exit(130);
  }
  return value as T;
}

async function runShow(name: string, jsonOutput: boolean): Promise<void> {
  const profile = getSystem(name);
  if (!profile) {
    throw new Error(`System profile '${name}' not found.`);
  }
  const password = (await getPassword(name)) ? 'stored' : 'not stored';
  const detail = {
    name,
    url: profile.url,
    client: profile.client || '100',
    username: profile.username,
    language: profile.language || 'EN',
    password,
  };
  if (jsonOutput) {
    console.log(JSON.stringify({ status: 'success', system: detail }, null, 2));
    return;
  }
  console.log(`System profile '${name}':`);
  console.log(`  url:      ${detail.url}`);
  console.log(`  client:   ${detail.client}`);
  console.log(`  username: ${detail.username}`);
  console.log(`  language: ${detail.language}`);
  console.log(`  password: ${detail.password}`);
}

async function runSet(
  name: string,
  opts: Record<string, string | boolean>,
  jsonOutput: boolean,
): Promise<void> {
  const profile = getSystem(name);
  if (!profile) {
    throw new Error(`System profile '${name}' not found.`);
  }

  const has = (key: string) => opts[key] !== undefined;
  const updatePassword = has('password');
  const removePassword = !!opts.removePassword;
  if (updatePassword && removePassword) {
    throw new Error('Cannot use --password and --remove-password together.');
  }

  const hasAny = has('url') || has('client') || has('username') || has('language') || updatePassword || removePassword;
  if (!hasAny) {
    if (process.stdin.isTTY) {
      await interactiveSet(name, profile, jsonOutput);
      return;
    }
    throw new Error(
      'Non-interactive environment detected. Provide field options:\n' +
      '  abap system set <name> --url <url> [--client <client>] [--username <user>] [--language <lang>] [--password <password>]',
    );
  }

  const updated: SystemProfile = { ...profile };
  if (has('url')) updated.url = opts.url as string;
  if (has('client')) updated.client = opts.client as string;
  if (has('username')) updated.username = opts.username as string;
  if (has('language')) updated.language = opts.language as string;
  validateProfile(updated);

  let passwordUpdated = false;
  let passwordRemoved = false;
  if (updatePassword) {
    const password = opts.password as string;
    if (!password) throw new Error('Password is required');
    await storePassword(name, password);
    passwordUpdated = true;
  } else if (removePassword) {
    await deletePassword(name);
    passwordRemoved = true;
  }

  upsertSystem(name, updated);

  if (jsonOutput) {
    console.log(
      JSON.stringify(
        { status: 'success', system: { name, ...updated }, passwordUpdated, passwordRemoved },
        null,
        2,
      ),
    );
  } else {
    console.log(`System profile '${name}' updated.`);
  }
}

/** Interactive set wizard: show current values, Enter keeps them */
async function interactiveSet(
  name: string,
  profile: SystemProfile,
  jsonOutput: boolean,
): Promise<void> {
  const updated: SystemProfile = { ...profile };
  const url = orCancel(await text({ message: 'URL', initialValue: updated.url }));
  if (url) updated.url = url;
  const client = orCancel(await text({ message: 'Client', initialValue: updated.client || '100' }));
  if (client) updated.client = client;
  const username = orCancel(await text({ message: 'Username', initialValue: updated.username }));
  if (username) updated.username = username;
  const language = orCancel(await text({ message: 'Language', initialValue: updated.language || 'EN' }));
  if (language) updated.language = language;
  validateProfile(updated);

  let passwordUpdated = false;
  let passwordRemoved = false;
  const changePassword = orCancel(await confirm({ message: 'Update password?', initialValue: false }));
  if (changePassword) {
    const pwd = orCancel(await password({ message: `New password for '${name}'` }));
    if (pwd) {
      await storePassword(name, pwd);
      passwordUpdated = true;
    }
  }

  upsertSystem(name, updated);

  if (jsonOutput) {
    console.log(
      JSON.stringify(
        { status: 'success', system: { name, ...updated }, passwordUpdated, passwordRemoved },
        null,
        2,
      ),
    );
  } else {
    console.log(`System profile '${name}' updated.`);
  }
}

/** Shared field validation, consistent with the init command's rules */
function validateProfile(profile: SystemProfile): void {
  if (!profile.url) throw new Error('URL is required');
  if (!/^https?:\/\//i.test(profile.url)) {
    throw new Error('Invalid URL format — must start with http:// or https://');
  }
  if (!profile.username) throw new Error('Username is required');
  if (profile.client && !/^\d{3}$/.test(profile.client)) {
    throw new Error('Client must be a 3-digit number');
  }
  if (profile.language && !/^[a-zA-Z]{2}$/.test(profile.language)) {
    throw new Error('Language must be a 2-character code');
  }
}

async function runDelete(name: string, jsonOutput: boolean): Promise<void> {
  if (!getSystem(name)) {
    throw new Error(`System profile '${name}' not found.`);
  }

  if (process.stdin.isTTY) {
    const ok = orCancel(await confirm({ message: `Delete system profile '${name}'?`, initialValue: false }));
    if (!ok) {
      console.log('Aborted. System profile kept.');
      process.exit(0);
    }
  }

  deleteSystem(name);

  let passwordCleaned = true;
  try {
    await deletePassword(name);
  } catch {
    passwordCleaned = false;
    console.error(
      `Warning: could not remove the stored password for '${name}'. Remove it manually in your OS keychain.`,
    );
  }

  const configPath = path.resolve(process.cwd(), '.abap.json');
  let warning: string | undefined;
  if (fs.existsSync(configPath)) {
    try {
      const workspace = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (workspace.system === name) {
        warning = `workspace .abap.json references '${name}'`;
      }
    } catch {
      // ignore parse errors
    }
  }
  if (warning) {
    console.warn(`Warning: ${warning}. Update it with 'abap init' if needed.`);
  }

  if (jsonOutput) {
    const result: Record<string, unknown> = {
      status: 'success',
      deleted: name,
      passwordCleaned,
    };
    if (warning) result.warning = warning;
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`System profile '${name}' deleted.`);
  }
}
