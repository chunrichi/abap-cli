import { text, password, confirm } from '@clack/prompts';
import { getSystem, upsertSystem, type SystemProfile } from '../config/user-config.js';
import { storePassword, deletePassword } from '../config/secrets.js';
import { CliError, printResult } from '../output/json.js';
import { assertValidProfile } from '../config/validation.js';
import { probeTextpoolCapability, recordCapability } from '../textpool/textpool-capability.js';
import { orCancel } from './connection-flow.js';

/**
 * 014: one-shot textpool capability probe, recorded onto the profile (Q1:
 * record at connect time, reuse afterwards — no runtime fallback). Never
 * blocks the calling command: on any failure the profile simply has no
 * adtTextpool record and the router applies conservative defaults.
 */
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

/** Create a new profile; refuses when the name is already taken. */
export async function runAdd(
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
  // 014: informational textpool capability probe (one-shot, non-blocking).
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
  // 014: informational textpool capability probe (one-shot, non-blocking).
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
