import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { select, text, password, confirm, isCancel } from '@clack/prompts';
import { getSystem, listSystemNames, upsertSystem, deleteSystem, type SystemProfile } from '../config/user-config.js';
import { getPassword, storePassword, deletePassword } from '../crypto/secrets.js';
import { printError, printResult, jsonFromCommand, CliError } from '../output/json.js';
import { assertValidProfile } from '../config/validation.js';

export function registerSystemCommand(program: Command): void {
  const system = program
    .command('system')
    .description('Manage global system profiles')
    .action(async (_opts, cmd) => {
      try {
        if (!process.stdin.isTTY) {
          printError(
            jsonFromCommand(cmd),
            new CliError(
              'USAGE',
              'Bare "abap system" is interactive only. Use: abap system list | show <name> | set <name> | delete <name>',
            ),
          );
          return;
        }
        await interactiveMenu(cmd);
      } catch (error: unknown) {
        handleError(jsonFromCommand(cmd), error);
      }
    });

  system
    .command('list')
    .description('List all saved system profiles')
    .action((_opts, cmd) => {
      runList(jsonFromCommand(cmd));
    });

  system
    .command('show <name>')
    .description('Show details of a system profile')
    .action(async (name: string, _opts, cmd) => {
      try {
        await runShow(name, jsonFromCommand(cmd));
      } catch (error: unknown) {
        handleError(jsonFromCommand(cmd), error);
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
    .option('--insecure', 'Skip SSL certificate verification (self-signed certs, development only)')
    .option('--ca <path>', 'Path to a CA certificate (PEM) for SSL verification')
    .option('--clear-ca', 'Remove the CA certificate setting')
    .action(async (name: string, opts, cmd) => {
      try {
        await runSet(name, opts, jsonFromCommand(cmd));
      } catch (error: unknown) {
        handleError(jsonFromCommand(cmd), error);
      }
    });

  system
    .command('delete <name>')
    .description('Delete a system profile and its stored password')
    .action(async (name: string, _opts, cmd) => {
      try {
        await runDelete(name, jsonFromCommand(cmd));
      } catch (error: unknown) {
        handleError(jsonFromCommand(cmd), error);
      }
    });
}

/** Report command errors via the unified JSON-aware handler */
function handleError(jsonOutput: boolean, error: unknown): never {
  printError(jsonOutput, error);
}

function runList(jsonOutput: boolean): void {
  const names = listSystemNames();
  if (names.length === 0) {
    printResult(jsonOutput, { systems: [] }, "No system profiles saved. Run 'abap init' to create one.");
    return;
  }
  const systems = names.map((name) => {
    const p = getSystem(name)!;
    return { name, username: p.username, url: p.url };
  });
  const human = ['System profiles:', ...names.map((name) => {
    const p = getSystem(name)!;
    return `  ${name} — ${p.username}@${p.url}`;
  })].join('\n');
  printResult(jsonOutput, { systems }, human);
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
        runList(jsonFromCommand(cmd));
        break;
      case 'show':
      case 'set':
      case 'delete': {
        const name = await pickSystemName(choice);
        if (!name) break;
        if (choice === 'show') {
          await runShow(name, jsonFromCommand(cmd));
        } else if (choice === 'set') {
          const profile = getSystem(name)!;
          await interactiveSet(name, profile, jsonFromCommand(cmd));
        } else {
          await runDelete(name, jsonFromCommand(cmd));
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
    throw new CliError('CONFIG_ERROR', `System profile '${name}' not found.`);
  }
  const password = (await getPassword(name)) ? 'stored' : 'not stored';
  const detail = {
    name,
    url: profile.url,
    client: profile.client || '100',
    username: profile.username,
    language: profile.language || 'EN',
    password,
    insecure: profile.insecure ?? false,
    ca: profile.ca || '',
  };
  const human = [
    `System profile '${name}':`,
    `  url:      ${detail.url}`,
    `  client:   ${detail.client}`,
    `  username: ${detail.username}`,
    `  language: ${detail.language}`,
    `  password: ${detail.password}`,
    `  insecure: ${detail.insecure}`,
    `  ca:       ${detail.ca || '(none)'}`,
  ].join('\n');
  printResult(jsonOutput, { system: detail }, human);
}

async function runSet(
  name: string,
  opts: Record<string, string | boolean>,
  jsonOutput: boolean,
): Promise<void> {
  const profile = getSystem(name);
  if (!profile) {
    throw new CliError('CONFIG_ERROR', `System profile '${name}' not found.`);
  }

  const has = (key: string) => opts[key] !== undefined;
  const updatePassword = has('password');
  const removePassword = !!opts.removePassword;
  if (updatePassword && removePassword) {
    throw new CliError('INVALID_ARGUMENT', 'Cannot use --password and --remove-password together.');
  }
  if (has('ca') && has('clearCa')) {
    throw new CliError('INVALID_ARGUMENT', 'Cannot use --ca and --clear-ca together.');
  }

  const hasAny = has('url') || has('client') || has('username') || has('language') ||
    has('insecure') || has('ca') || has('clearCa') || updatePassword || removePassword;
  if (!hasAny) {
    if (process.stdin.isTTY) {
      await interactiveSet(name, profile, jsonOutput);
      return;
    }
    throw new CliError(
      'USAGE',
      'Non-interactive environment detected. Provide field options:\n' +
      '  abap system set <name> --url <url> [--client <client>] [--username <user>] [--language <lang>] [--password <password>] [--insecure] [--ca <path>] [--clear-ca]',
    );
  }

  const updated: SystemProfile = { ...profile };
  if (has('url')) updated.url = opts.url as string;
  if (has('client')) updated.client = opts.client as string;
  if (has('username')) updated.username = opts.username as string;
  if (has('language')) updated.language = opts.language as string;
  if (has('insecure')) updated.insecure = !!opts.insecure;
  if (has('ca')) updated.ca = opts.ca as string;
  if (has('clearCa')) delete updated.ca;
  assertValidProfile(updated);

  let passwordUpdated = false;
  let passwordRemoved = false;
  if (updatePassword) {
    const password = opts.password as string;
    if (!password) throw new CliError('INVALID_ARGUMENT', 'Password is required');
    await storePassword(name, password);
    passwordUpdated = true;
  } else if (removePassword) {
    await deletePassword(name);
    passwordRemoved = true;
  }

  upsertSystem(name, updated);

  printResult(
    jsonOutput,
    { system: { name, ...updated }, passwordUpdated, passwordRemoved },
    `System profile '${name}' updated.`,
  );
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
  assertValidProfile(updated);

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

  printResult(
    jsonOutput,
    { system: { name, ...updated }, passwordUpdated, passwordRemoved },
    `System profile '${name}' updated.`,
  );
}

async function runDelete(name: string, jsonOutput: boolean): Promise<void> {
  if (!getSystem(name)) {
    throw new CliError('CONFIG_ERROR', `System profile '${name}' not found.`);
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

  const data: Record<string, unknown> = { deleted: name, passwordCleaned };
  if (warning) data.warning = warning;
  printResult(jsonOutput, data, `System profile '${name}' deleted.`);
}
