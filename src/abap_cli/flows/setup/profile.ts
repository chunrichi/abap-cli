import * as fs from 'fs';
import * as path from 'path';
import { text, password, confirm, isCancel } from '@clack/prompts';
import { getSystem, loadUserConfig, deleteSystem, listSystemNames, type SystemProfile } from '../../config/user-config.js';
import { getPassword, storePassword, deletePassword } from '../../config/secrets.js';
import { CliError, printResult, type OutputMode } from '../../output/json.js';
import { collectWarning } from '../../output/meta.js';
import { findWorkspaceConfig } from '../../config/project-config.js';
import { probeSystem } from '../../clients/probe.js';
import { toOutputPath } from '../../core/path-output.js';
import { probeTextpoolCapability, recordCapability } from '../../clients/textpool-capability.js';
import { getOrProbeRuntime } from '../../config/runtime-cache.js';
import { assertValidProfile } from '../../config/validation.js';
import { fingerprint, collectOrphanPems } from '../../config/ca-store.js';
import { applyPemsToProfileWithTimestamp, upsertProfileWithPems } from '../../config/profile-pems.js';

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

/** True when any profile field option (incl. password / CA) is present. */
function hasProfileOptions(opts: Record<string, string | boolean | string[]>): boolean {
  const has = (key: string) => opts[key] !== undefined;
  return has('url') || has('client') || has('username') || has('language') ||
    has('insecure') || has('ca') || has('clearCa') || has('password') || !!opts.removePassword;
}

/** Merge CLI field options into a base profile; stores/removes the password on request. */
async function applyProfileOptions(
  base: SystemProfile,
  name: string,
  opts: Record<string, string | boolean>,
): Promise<{
  updated: SystemProfile;
  passwordUpdated: boolean;
  passwordRemoved: boolean;
}> {
  const has = (key: string) => opts[key] !== undefined;
  const updatePassword = has('password');
  const removePassword = !!opts.removePassword;

  if (updatePassword && removePassword) {
    throw new CliError('INVALID_ARGUMENT', 'Cannot use --password and --remove-password together.');
  }
  if (has('ca') && has('clearCa')) {
    throw new CliError('INVALID_ARGUMENT', 'Cannot use --ca and --clear-ca together.');
  }

  // Writing a profile always produces a basic-auth entry; a legacy auth method
  // the CLI no longer supports is dropped here (the migration path).
  const updated: SystemProfile = { ...base };
  delete updated.unsupportedAuth;
  if (has('url')) updated.url = opts.url as string;
  if (has('client')) updated.client = opts.client as string;
  if (has('username')) updated.username = opts.username as string;
  if (has('language')) updated.language = opts.language as string;
  if (has('insecure')) updated.insecure = !!opts.insecure;
  // `--ca` carries the user's source path here; `applyNormalizedPems` (called
  // below) imports it into the content-addressed store and rewrites
  // `updated.ca` to the canonical store path. `caImportedAt` is set there too.
  if (has('ca')) updated.ca = opts.ca as string;
  if (has('clearCa')) {
    delete updated.ca;
    delete updated.caImportedAt;
  }

  applyNormalizedPems(updated);

  // Validate URL/client/language before persisting — anything that's missing
  // here should fail loudly via printError rather than writing a half-formed
  // profile.
  assertValidProfile(updated);

  let passwordUpdated = false;
  let passwordRemoved = false;
  if (updatePassword) {
    const passwordValue = opts.password as string;
    if (!passwordValue) throw new CliError('INVALID_ARGUMENT', 'Password is required');
    await storePassword(name, passwordValue);
    passwordUpdated = true;
  } else if (removePassword) {
    await deletePassword(name);
    passwordRemoved = true;
  }

  return { updated, passwordUpdated, passwordRemoved };
}

/**
 * Import the profile's local CA path into the content-addressed store and
 * point the profile at the stored copy. Runs before keychain side effects so a
 * bad PEM aborts the whole write. Also persists `caImportedAt` so `profile
 * show` can surface when the CA entered the store.
 */
function applyNormalizedPems(profile: SystemProfile): void {
  applyPemsToProfileWithTimestamp(profile);
}

/**
 * Reclaim store PEMs the previous profile carried and the updated one dropped
 * (replaced `--ca`, `--clear-ca`). PEMs still referenced by another profile are
 * kept. Never throws.
 */
function reclaimReplacedPems(previous: SystemProfile | null, next: SystemProfile | undefined): number {
  if (!previous) return 0;
  try {
    return collectOrphanPems(previous, next, loadUserConfig().systems);
  } catch {
    return 0;
  }
}

/** List saved connection profiles. */
export function runList(mode: OutputMode): void {
  const names = listSystemNames();
  if (names.length === 0) {
    printResult(mode, { systems: [] }, "No connection profiles saved. Run 'abap profile add <name> --url <url> --username <user>' to create one.");
    return;
  }
  const systems = names.map((name) => {
    const p = getSystem(name)!;
    return { name, username: p.username, url: p.url, ...(p.unsupportedAuth ? { unsupportedAuth: p.unsupportedAuth } : {}) };
  });
  const human = ['Connection profiles:', ...systems.map((p) => {
    const legacy = p.unsupportedAuth ? ` [legacy auth: ${p.unsupportedAuth} — run 'abap profile set ${p.name} --password <pwd>']` : '';
    return `  ${p.name} — ${p.username}@${p.url}${legacy}`;
  })].join('\n');
  printResult(mode, { systems }, human);
}

export async function runShow(name: string, mode: OutputMode): Promise<void> {
  const profile = getSystem(name);
  if (!profile) {
    throw new CliError('CONFIG_ERROR', `Connection profile '${name}' not found.`);
  }
  const password = (await getPassword(name)) ? 'stored' : 'not stored';
  const shaMatch = profile.ca ? /\/([0-9a-f]{64})\.pem$/.exec(profile.ca) : null;
  const detail = {
    name,
    url: profile.url,
    client: profile.client || '100',
    username: profile.username,
    language: profile.language || 'EN',
    password,
    insecure: profile.insecure ?? false,
    ca: profile.ca || '',
    ...(shaMatch ? { caFingerprint: fingerprint(shaMatch[1]) } : {}),
    ...(profile.caImportedAt ? { caImportedAt: profile.caImportedAt } : {}),
    ...(profile.unsupportedAuth ? { unsupportedAuth: profile.unsupportedAuth } : {}),
  };
  const human = (() => {
    const lines = [
      `Connection profile '${name}':`,
      `  url:           ${detail.url}`,
      `  client:        ${detail.client}`,
      `  username:      ${detail.username}`,
      `  language:      ${detail.language}`,
      `  password:      ${detail.password}`,
    ];
    if (profile.unsupportedAuth) {
      lines.push(`  auth:          legacy '${profile.unsupportedAuth}' (removed — only basic auth is supported)`);
      lines.push(`                 migrate: abap profile set ${name} --password <password>`);
    }
    lines.push(`  insecure:      ${detail.insecure}`);
    lines.push(`  ca:            ${detail.ca || '(none)'}`);
    if (detail.caFingerprint) {
      lines.push(`  ca sha256:     ${detail.caFingerprint}`);
    }
    if (detail.caImportedAt) {
      lines.push(`  ca imported:   ${detail.caImportedAt}`);
    }
    return lines.join('\n');
  })();
  printResult(mode, { system: detail }, human);
}

/** Exit code for the worst failing layer: TLS→4, AUTH→5, SAP→6. */
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
export async function runTest(name: string, mode: OutputMode): Promise<void> {
  const probe = await probeSystem(name);
  // When the adt layer succeeded, refresh the runtime cache so subsequent
  // deploy / init calls can read it without a network round-trip.
  if (probe.adt.ok) {
    try {
      await getOrProbeRuntime(name, { force: true });
    } catch {
      // Cache refresh is best-effort; probe results still surface below.
    }
  }
  const human = [
    `Connection probe '${name}':`,
    ...Object.entries(probe).map(([layer, r]) => {
      const status = r.ok ? 'ok' : r.skipped ? 'skipped' : 'error';
      const detail = r.error ? ` — ${r.error.message}` : '';
      return `  ${layer}: ${status}${detail}`;
    }),
  ].join('\n');
  printResult(mode, probe, human);
  const exitCode = worstExitCode(probe);
  if (exitCode !== undefined) {
    process.exitCode = exitCode;
  }
}

export async function runDelete(name: string, yes: boolean, mode: OutputMode): Promise<void> {
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

  // Snapshot the profile before delete so its CA can be reclaimed afterwards.
  const profileBeforeDelete = getSystem(name);
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

  const configPath = findWorkspaceConfig();
  let warning: string | undefined;
  if (configPath && fs.existsSync(configPath)) {
    try {
      const workspace = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (workspace.system === name) {
        warning = `workspace .abap.json (${toOutputPath(path.relative(process.cwd(), configPath)) || '.abap.json'}) references '${name}'`;
      }
    } catch {
      // ignore parse errors
    }
  }
  if (warning) {
    collectWarning('PROFILE_MISMATCH', `${warning}. Update it with 'abap init --profile <name>' if needed.`);
  }

  // Report success first: the profile is already gone, so a *cleanup* failure
  // (or an unreadable systems.json) must never turn this into a reported error.
  // Files another profile still references are kept.
  const caOrphanRemoved = reclaimReplacedPems(profileBeforeDelete, undefined) > 0;
  const data: Record<string, unknown> = { deleted: name, passwordCleaned, caOrphanRemoved };
  printResult(mode, data, `Connection profile '${name}' deleted.`);
}

/** Create a new profile; refuses when the name is already taken. */
export async function runAdd(
  name: string,
  opts: Record<string, string | boolean>,
  mode: OutputMode,
): Promise<void> {
  if (getSystem(name)) {
    throw new CliError('CONFIG_ERROR', `Connection profile '${name}' already exists.`, {
      nextSteps: [`Modify it: abap profile set ${name} --url <url>`, `Or delete it first: abap profile delete ${name}`],
      example: `abap profile set ${name} --url https://sap.example.com`,
    });
  }
  if (!hasProfileOptions(opts)) {
    if (process.stdin.isTTY) {
      await interactiveSet(name, { url: '', client: '100', username: '', language: 'EN' }, mode);
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
  // Funnel through the same PEM-aware writer as `set` / `delete`.
  upsertProfileWithPems(name, null, updated);
  await recordTextpoolCapabilityIfPossible(name);

  printResult(
    mode,
    { system: { name, ...updated }, passwordUpdated, passwordRemoved },
    `Connection profile '${name}' created.`,
  );
}

export async function runSet(
  name: string,
  opts: Record<string, string | boolean>,
  mode: OutputMode,
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
      await interactiveSet(name, profile, mode);
      return;
    }
    throw new CliError(
      'USAGE',
      'Non-interactive environment detected. Provide field options:\n' +
      '  abap profile set <name> --url <url> [--client <client>] [--username <user>] [--language <lang>] [--password <password>] [--insecure] [--ca <path>] [--clear-ca]',
    );
  }

  const { updated, passwordUpdated, passwordRemoved } = await applyProfileOptions(profile, name, opts);
  // Import the CA before the write (a bad PEM aborts without touching
  // systems.json) and reclaim replaced ones after it.
  upsertProfileWithPems(name, profile, updated);
  await recordTextpoolCapabilityIfPossible(name);

  printResult(
    mode,
    { system: { name, ...updated }, passwordUpdated, passwordRemoved },
    `Connection profile '${name}' updated.`,
  );
}

/** Interactive set wizard: show current values, Enter keeps them */
async function interactiveSet(
  name: string,
  profile: SystemProfile,
  mode: OutputMode,
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

  let passwordUpdated = false;
  const passwordRemoved = false;
  const changePassword = orCancel(await confirm({ message: 'Update password?', initialValue: false }));
  if (changePassword) {
    const pwd = orCancel(await password({ message: `New password for '${name}'` }));
    if (pwd) {
      await storePassword(name, pwd);
      passwordUpdated = true;
    }
  }

  upsertProfileWithPems(name, profile, updated);

  printResult(
    mode,
    { system: { name, ...updated }, passwordUpdated, passwordRemoved },
    `Connection profile '${name}' updated.`,
  );
}
