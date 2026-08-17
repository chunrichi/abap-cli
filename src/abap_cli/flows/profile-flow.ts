import * as fs from 'fs';
import * as path from 'path';
import { text, password, confirm, isCancel } from '@clack/prompts';
import { getSystem, upsertSystem, deleteSystem, listSystemNames, type SystemProfile } from '../config/user-config.js';
import { getPassword, storePassword, deletePassword } from '../config/secrets.js';
import { CliError, printResult } from '../output/json.js';
import { collectWarning } from '../output/meta.js';
import { assertValidProfile } from '../config/validation.js';
import { probeSystem } from '../clients/probe.js';
import { probeTextpoolCapability, recordCapability } from '../textpool/textpool-capability.js';

/** Exit 130 on Ctrl+C (@clack cancel), otherwise return the value */
export function orCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    console.log('\nAborted.');
    process.exit(130);
  }
  return value as T;
}

/** 014: informational textpool capability probe (one-shot, non-blocking). */
async function recordTextpoolCapabilityIfPossible(name: string): Promise<void> {
  try {
    const cap = await probeTextpoolCapability();
    await recordCapability(name, cap);
  } catch {
    // informational — degraded, non-blocking
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

/** List saved connection profiles. */
export function runList(jsonOutput: boolean): void {
  const names = listSystemNames();
  if (names.length === 0) {
    printResult(jsonOutput, { systems: [] }, "No connection profiles saved. Run 'abap profile add <name> --url <url> --username <user>' to create one.");
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
  printResult(jsonOutput, { systems }, human);
}

export async function runShow(name: string, jsonOutput: boolean): Promise<void> {
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
  printResult(jsonOutput, { system: detail }, human);
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
export async function runTest(name: string, jsonOutput: boolean): Promise<void> {
  const probe = await probeSystem(name);
  const human = [
    `Connection probe '${name}':`,
    ...Object.entries(probe).map(([layer, r]) => {
      const status = r.ok ? 'ok' : r.skipped ? 'skipped' : 'error';
      const detail = r.error ? ` — ${r.error.message}` : '';
      return `  ${layer}: ${status}${detail}`;
    }),
  ].join('\n');
  printResult(jsonOutput, probe, human);
  const exitCode = worstExitCode(probe);
  if (exitCode !== undefined) {
    process.exitCode = exitCode;
  }
}

export async function runDelete(name: string, yes: boolean, jsonOutput: boolean): Promise<void> {
  if (!getSystem(name)) {
    throw new CliError('CONFIG_ERROR', `Connection profile '${name}' not found.`);
  }

  if (!yes) {
    if (process.stdin.isTTY) {
      const ok = orCancel(await confirm({ message: `Delete connection profile '${name}'?`, initialValue: false }));
      if (!ok) {
        console.log('Aborted. Connection profile kept.');
        process.exit(0);
      }
    } else {
      throw new CliError('VALIDATION_ERROR', 'Deleting a connection profile is a write operation; confirm with --yes.', {
        nextSteps: ['Re-run with --yes to delete without prompting.', 'Or run interactively in a TTY.'],
        example: `abap profile delete ${name} --yes`,
      });
    }
  }

  deleteSystem(name);

  let passwordCleaned = true;
  try {
    await deletePassword(name);
  } catch {
    passwordCleaned = false;
    collectWarning(
      'KEYCHAIN_WARNING',
      `Could not remove the stored password for '${name}'. Remove it manually in your OS keychain.`,
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
    collectWarning('PROFILE_MISMATCH', `${warning}. Update it with 'abap init --profile <name>' if needed.`);
  }

  const data: Record<string, unknown> = { deleted: name, passwordCleaned };
  printResult(jsonOutput, data, `Connection profile '${name}' deleted.`);
}

/** Create a new profile; refuses when the name is already taken. */
export async function runAdd(
  name: string,
  opts: Record<string, string | boolean>,
  jsonOutput: boolean,
): Promise<void> {
  if (getSystem(name)) {
    throw new CliError('CONFIG_ERROR', `Connection profile '${name}' already exists.`, {
      nextSteps: [`Modify it: abap profile set ${name} --url <url>`, `Or delete it first: abap profile delete ${name}`],
      example: `abap profile set ${name} --url https://sap.example.com`,
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
      '  abap profile add <name> --url <url> [--client <client>] [--username <user>] [--language <lang>] [--password <password>] [--insecure] [--ca <path>]',
    );
  }

  const { updated, passwordUpdated, passwordRemoved } =
    await applyProfileOptions({ url: '', client: '100', username: '', language: 'EN' }, name, opts);
  upsertSystem(name, updated);
  await recordTextpoolCapabilityIfPossible(name);

  printResult(
    jsonOutput,
    { system: { name, ...updated }, passwordUpdated, passwordRemoved },
    `Connection profile '${name}' created.`,
  );
}

export async function runSet(
  name: string,
  opts: Record<string, string | boolean>,
  jsonOutput: boolean,
): Promise<void> {
  const profile = getSystem(name);
  if (!profile) {
    throw new CliError('CONFIG_ERROR', `Connection profile '${name}' not found.`, {
      nextSteps: [`Create it: abap profile add ${name} --url <url> --username <user> --password <pass>`],
      example: `abap profile add ${name} --url https://sap.example.com --username USER`,
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
      '  abap profile set <name> --url <url> [--client <client>] [--username <user>] [--language <lang>] [--password <password>] [--insecure] [--ca <path>] [--clear-ca]',
    );
  }

  const { updated, passwordUpdated, passwordRemoved } = await applyProfileOptions(profile, name, opts);
  upsertSystem(name, updated);
  await recordTextpoolCapabilityIfPossible(name);

  printResult(
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

  printResult(
    jsonOutput,
    { system: { name, ...updated }, passwordUpdated, passwordRemoved },
    `Connection profile '${name}' updated.`,
  );
}