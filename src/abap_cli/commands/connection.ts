import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { text, password, confirm, isCancel } from '@clack/prompts';
import { getSystem, listSystemNames, upsertSystem, deleteSystem, type SystemProfile } from '../config/user-config.js';
import { getPassword, storePassword, deletePassword } from '../crypto/secrets.js';
import { printError, printResult, jsonFromCommand, CliError } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';
import { assertValidProfile } from '../config/validation.js';
import { probeSystem } from '../clients/probe.js';
import { exportProfiles, importProfiles, type ProfileBundle } from '../sync/profiles.js';

export function registerConnectionCommand(program: Command): void {
  const connection = program
    .command('connection')
    .description('Manage global connection profiles')
    .addHelpText('after', commonErrorsAfter())
    .action((_opts, cmd) => {
      // Bare `abap connection` prints the subcommand help (exit 0), like bare `abap`.
      console.log(cmd.helpInformation());
    });

  connection
    .command('list')
    .description('List all saved connection profiles')
    .action((_opts, cmd) => {
      runList(jsonFromCommand(cmd));
    });

  connection
    .command('show <name>')
    .description('Show details of a connection profile')
    .action(async (name: string, _opts, cmd) => {
      try {
        await runShow(name, jsonFromCommand(cmd));
      } catch (error: unknown) {
        handleError(jsonFromCommand(cmd), error);
      }
    });

  connection
    .command('add <name>')
    .description('Create a new connection profile')
    .option('--url <url>', 'SAP system URL')
    .option('-c, --client <client>', 'SAP client number')
    .option('-u, --username <user>', 'SAP username')
    .option('-l, --language <lang>', 'SAP language')
    .option('-p, --password <password>', 'Password (stores credential in keychain)')
    .option('--insecure', 'Skip SSL certificate verification (self-signed certs, development only)')
    .option('--ca <path>', 'Path to a CA certificate (PEM) for SSL verification')
    .action(async (name: string, opts, cmd) => {
      try {
        await runAdd(name, opts, jsonFromCommand(cmd));
      } catch (error: unknown) {
        handleError(jsonFromCommand(cmd), error);
      }
    });

  connection
    .command('set <name>')
    .description('Modify an existing connection profile (fields or password)')
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

  connection
    .command('use <name>')
    .description('Switch the current workspace to a connection profile')
    .action(async (name: string, _opts, cmd) => {
      try {
        await runUse(name, jsonFromCommand(cmd));
      } catch (error: unknown) {
        handleError(jsonFromCommand(cmd), error);
      }
    });

  connection
    .command('test <name>')
    .description('Probe a connection profile: tls → auth → adt → icf')
    .action(async (name: string, _opts, cmd) => {
      try {
        await runTest(name, jsonFromCommand(cmd));
      } catch (error: unknown) {
        handleError(jsonFromCommand(cmd), error);
      }
    });

  connection
    .command('delete <name>')
    .description('Delete a connection profile and its stored password')
    .action(async (name: string, _opts, cmd) => {
      try {
        await runDelete(name, jsonFromCommand(cmd));
      } catch (error: unknown) {
        handleError(jsonFromCommand(cmd), error);
      }
    });

  connection
    .command('export [names...]')
    .description('Export connection profiles to a portable bundle (passwords excluded by default)')
    .option('--file <path>', 'Write the bundle to a file (default: stdout)')
    .option('--with-passwords', 'Include passwords in the bundle (warned opt-in)')
    .action(async (names: string[], opts: { file?: string; withPasswords?: boolean }, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        if (opts.withPasswords) {
          console.error('Warning: exporting profiles WITH passwords. Keep the bundle secure.');
        }
        const bundle = await exportProfiles({ names, withPasswords: opts.withPasswords });
        const human = `Exported ${bundle.systems.length} profile(s)${opts.withPasswords ? ' (with passwords)' : ''}.`;
        if (opts.file) {
          fs.writeFileSync(path.resolve(opts.file), JSON.stringify(bundle, null, 2) + '\n', 'utf-8');
          printResult(json, { file: opts.file, count: bundle.systems.length }, `${human} → ${opts.file}`);
        } else {
          printResult(json, bundle, human);
        }
      } catch (error: unknown) {
        handleError(json, error);
      }
    });

  connection
    .command('import <file>')
    .description('Import connection profiles from a bundle')
    .option('--overwrite', 'Update profiles that already exist')
    .action(async (file: string, opts: { overwrite?: boolean }, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        const raw = JSON.parse(fs.readFileSync(path.resolve(file), 'utf-8'));
        const bundle = validateBundle(raw);
        const result = await importProfiles(bundle);
        const human = result.imported
          .map((i) => `  ${i.name} — ${i.action}`)
          .join('\n');
        printResult(json, result, `Imported ${result.imported.length} profile(s):\n${human}`);
      } catch (error: unknown) {
        handleError(json, error);
      }
    });
}

/** Report command errors via the unified JSON-aware handler */
function handleError(jsonOutput: boolean, error: unknown): never {
  printError(jsonOutput, error);
}

/** Validate that a raw import payload is a ProfileBundle. */
function validateBundle(raw: unknown): ProfileBundle {
  const bundle = raw as Partial<ProfileBundle> | null;
  if (!bundle || bundle.format !== 'abap-cli-profiles' || !Array.isArray(bundle.systems)) {
    throw new CliError('INVALID_ARGUMENT', 'Not a valid abap-cli profiles bundle', {
      nextSteps: ['Export a bundle first: abap connection export --file profiles.json'],
      example: 'abap connection export --file profiles.json',
    });
  }
  return bundle as ProfileBundle;
}

/** Output results: JSON always via stdout, human text via console.log. */
function output(jsonOutput: boolean, data: unknown, human: string): void {
  if (jsonOutput) {
    console.log(JSON.stringify({ status: 'success', data }, null, 2));
  } else {
    console.log(human);
  }
}

function runList(jsonOutput: boolean): void {
  const names = listSystemNames();
  if (names.length === 0) {
    printResult(jsonOutput, { systems: [] }, "No connection profiles saved. Run 'abap init' to create one.");
    return;
  }
  const systems = names.map((name) => {
    const p = getSystem(name)!;
    return { name, username: p.username, url: p.url };
  });
  const human = ['Connection profiles:', ...names.map((name) => {
    const p = getSystem(name)!;
    return `  ${name} — ${p.username}@${p.url}`;
  })].join('\n');
  output(jsonOutput, { systems }, human);
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
    throw new CliError('CONFIG_ERROR', `Connection profile '${name}' not found.`);
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
    `Connection profile '${name}':`,
    `  url:      ${detail.url}`,
    `  client:   ${detail.client}`,
    `  username: ${detail.username}`,
    `  language: ${detail.language}`,
    `  password: ${detail.password}`,
    `  insecure: ${detail.insecure}`,
    `  ca:       ${detail.ca || '(none)'}`,
  ].join('\n');
  output(jsonOutput, { system: detail }, human);
}

/** Switch the workspace .abap.json to reference <name>, preserving other fields. */
async function runUse(name: string, jsonOutput: boolean): Promise<void> {
  if (!getSystem(name)) {
    throw new CliError('CONFIG_ERROR', `Connection profile '${name}' not found.`, {
      nextSteps: [`Run 'abap connection add ${name} --url <url> --username <user>' to create the profile first.`],
      example: `abap connection set ${name} --url <url> --username <user> --password <pass>`,
    });
  }

  const configPath = path.resolve(process.cwd(), '.abap.json');
  let workspace: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      workspace = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      // ignore parse errors — a fresh object is written below
    }
  }
  workspace.system = name;
  fs.writeFileSync(configPath, JSON.stringify(workspace, null, 2) + '\n', 'utf-8');

  output(
    jsonOutput,
    { configPath: '.abap.json', system: name },
    `Workspace now uses connection profile '${name}'.`,
  );
}

/** Exit code for the worst failing layer (FR-008): TLS→4, AUTH→5, SAP→6. */
function worstExitCode(probe: { tls: { ok: boolean }; auth: { ok: boolean }; adt: { ok: boolean }; icf: { ok: boolean } }): number | undefined {
  const codes: Record<string, number> = { tls: 4, auth: 5, adt: 6, icf: 6 };
  let worst: number | undefined;
  for (const layer of ['tls', 'auth', 'adt', 'icf'] as const) {
    if (!probe[layer].ok) {
      const code = codes[layer]!;
      if (worst === undefined || code < worst) worst = code;
    }
  }
  return worst;
}

/** Probe a profile across tls → auth → adt → icf and report per-layer results. */
async function runTest(name: string, jsonOutput: boolean): Promise<void> {
  const probe = await probeSystem(name);
  const human = [
    `Connection probe '${name}':`,
    ...Object.entries(probe).map(([layer, r]) => {
      const status = r.ok ? 'ok' : r.skipped ? 'skipped' : 'error';
      const detail = r.error ? ` — ${r.error.message}` : '';
      return `  ${layer}: ${status}${detail}`;
    }),
  ].join('\n');
  output(jsonOutput, probe, human);
  // The four-layer payload IS the result (success envelope); a failing layer
  // drives a non-zero exit code per FR-008 (partial results, not a crash).
  const exitCode = worstExitCode(probe);
  if (exitCode !== undefined) {
    process.exitCode = exitCode;
  }
}

/** True when any profile field option (incl. password) is present. */
function hasProfileOptions(opts: Record<string, string | boolean>): boolean {
  const has = (key: string) => opts[key] !== undefined;
  return has('url') || has('client') || has('username') || has('language') ||
    has('insecure') || has('ca') || has('clearCa') || has('password') || !!opts.removePassword;
}

/** Merge CLI field options into a base profile; stores/removes password on request. */
async function applyProfileOptions(
  base: SystemProfile,
  name: string,
  opts: Record<string, string | boolean>,
): Promise<{ updated: SystemProfile; passwordUpdated: boolean; passwordRemoved: boolean }> {
  const has = (key: string) => opts[key] !== undefined;
  const updatePassword = has('password');
  const removePassword = !!opts.removePassword;
  if (updatePassword && removePassword) {
    throw new CliError('INVALID_ARGUMENT', 'Cannot use --password and --remove-password together.');
  }
  if (has('ca') && has('clearCa')) {
    throw new CliError('INVALID_ARGUMENT', 'Cannot use --ca and --clear-ca together.');
  }

  const updated: SystemProfile = { ...base };
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
  return { updated, passwordUpdated, passwordRemoved };
}

/** Create a new profile; refuses when the name is already taken. */
async function runAdd(
  name: string,
  opts: Record<string, string | boolean>,
  jsonOutput: boolean,
): Promise<void> {
  if (getSystem(name)) {
    throw new CliError('CONFIG_ERROR', `Connection profile '${name}' already exists.`, {
      nextSteps: [`Modify it: abap connection set ${name} --url <url>`, `Or delete it first: abap connection delete ${name}`],
      example: `abap connection set ${name} --url https://sap.example.com`,
    });
  }
  if (!hasProfileOptions(opts)) {
    if (process.stdin.isTTY) {
      await interactiveSet(name, { url: '', client: '100', username: '', language: 'EN' }, jsonOutput);
      return;
    }
    throw new CliError(
      'USAGE',
      'Non-interactive environment detected. Provide field options:\n' +
      '  abap connection add <name> --url <url> [--client <client>] [--username <user>] [--language <lang>] [--password <password>] [--insecure] [--ca <path>]',
    );
  }

  const { updated, passwordUpdated, passwordRemoved } =
    await applyProfileOptions({ url: '', client: '100', username: '', language: 'EN' }, name, opts);
  upsertSystem(name, updated);

  output(
    jsonOutput,
    { system: { name, ...updated }, passwordUpdated, passwordRemoved },
    `Connection profile '${name}' created.`,
  );
}

async function runSet(
  name: string,
  opts: Record<string, string | boolean>,
  jsonOutput: boolean,
): Promise<void> {
  const profile = getSystem(name);
  if (!profile) {
    throw new CliError('CONFIG_ERROR', `Connection profile '${name}' not found.`, {
      nextSteps: [`Create it: abap connection add ${name} --url <url> --username <user> --password <pass>`],
      example: `abap connection add ${name} --url https://sap.example.com --username USER`,
    });
  }

  if (!hasProfileOptions(opts)) {
    if (process.stdin.isTTY) {
      await interactiveSet(name, profile, jsonOutput);
      return;
    }
    throw new CliError(
      'USAGE',
      'Non-interactive environment detected. Provide field options:\n' +
      '  abap connection set <name> --url <url> [--client <client>] [--username <user>] [--language <lang>] [--password <password>] [--insecure] [--ca <path>] [--clear-ca]',
    );
  }

  const { updated, passwordUpdated, passwordRemoved } = await applyProfileOptions(profile, name, opts);
  upsertSystem(name, updated);

  output(
    jsonOutput,
    { system: { name, ...updated }, passwordUpdated, passwordRemoved },
    `Connection profile '${name}' updated.`,
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

  output(
    jsonOutput,
    { system: { name, ...updated }, passwordUpdated, passwordRemoved },
    `Connection profile '${name}' updated.`,
  );
}

async function runDelete(name: string, jsonOutput: boolean): Promise<void> {
  if (!getSystem(name)) {
    throw new CliError('CONFIG_ERROR', `Connection profile '${name}' not found.`);
  }

  if (process.stdin.isTTY) {
    const ok = orCancel(await confirm({ message: `Delete connection profile '${name}'?`, initialValue: false }));
    if (!ok) {
      console.log('Aborted. Connection profile kept.');
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
  output(jsonOutput, data, `Connection profile '${name}' deleted.`);
}
