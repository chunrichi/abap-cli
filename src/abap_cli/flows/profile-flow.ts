import * as fs from 'fs';
import * as path from 'path';
import { text, password, confirm, isCancel } from '@clack/prompts';
import { getSystem, upsertSystem, deleteSystem, listSystemNames, type SystemProfile } from '../config/user-config.js';
import { getPassword, storePassword, deletePassword, storeCertPassphrase, deleteCertPassphrase } from '../config/secrets.js';
import { clearCookieStore, defaultCookieFile } from '../auth/sso-cookie.js';
import { CliError, printResult, type OutputMode } from '../output/json.js';
import { collectWarning } from '../output/meta.js';
import { parseBtpServiceKey } from '../auth/types.js';
import { findWorkspaceConfig } from '../config/project-config.js';
import { probeSystem } from '../clients/probe.js';
import { toOutputPath } from '../core/path-output.js';
import { probeTextpoolCapability, recordCapability } from '../textpool/textpool-capability.js';
import { getOrProbeRuntime } from '../config/runtime-cache.js';
import { assertValidProfile } from '../config/validation.js';
import type { AuthConfig, AuthMethodV2 } from '../auth/v2-types.js';
import { defaultAuth, parseAuthMethodV2 } from '../auth/v2-types.js';
import { canonicalToV1Fields } from '../auth/normalize.js';
import { authOptionsFromCli, legacyFlagsToBag, resolveAuthFromOptions } from '../auth/strategy.js';

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

/** True when any profile field option (incl. password / cert / sso / oauth / authMethod / auth-option) is present. */
function hasProfileOptions(opts: Record<string, string | boolean | string[]>): boolean {
  const has = (key: string) => opts[key] !== undefined;
  return has('url') || has('client') || has('username') || has('language') ||
    has('insecure') || has('ca') || has('clearCa') || has('password') || !!opts.removePassword ||
    has('authMethod') || has('authOption') ||
    has('certPath') || has('certKey') || has('certCa') || has('certPassphrase') ||
    !!opts.removeCertPassphrase || !!opts.clearCertAuth ||
    has('ssoCookieFile') || !!opts.clearSsoCookieFile ||
    !!opts.serviceKey;
}

/**
 * Resolve the canonical `auth` config from CLI options + existing profile.
 *
 * No per-method dispatch lives in this file — the registered `AuthStrategy`
 * for `method` owns its own field parsing via `fromOptions()`. Legacy flags
 * (`--cert-path`, `--service-key`, …) are folded into the `--auth-option`
 * bag so existing scripts continue to work, but new auth methods don't need
 * any legacy flag plumbing here.
 */
function resolveAuthFromOpts(base: SystemProfile, opts: Record<string, string | boolean | string[]>): AuthConfig {
  // No method switch → keep existing auth.
  if (opts.authMethod === undefined) return base.auth;

  const method = parseAuthMethodV2(opts.authMethod);

  // Merge legacy flags + --auth-option into one bag. --auth-option wins on
  // collision so users can override the legacy sugar via the generic flag.
  const legacyBag = legacyFlagsToBag(opts);
  const fromCli = authOptionsFromCli(opts, method).bag;
  const bag: Record<string, string> = { ...legacyBag, ...fromCli };

  return resolveAuthFromOptions({ method, bag }, base.auth);
}

/** Merge CLI field options into a base profile; stores/removes password on request. */
async function applyProfileOptions(
  base: SystemProfile,
  name: string,
  opts: Record<string, string | boolean>,
): Promise<{
  updated: SystemProfile;
  passwordUpdated: boolean;
  passwordRemoved: boolean;
  certPassphraseUpdated: boolean;
  certPassphraseRemoved: boolean;
}> {
  const has = (key: string) => opts[key] !== undefined;
  const updatePassword = has('password');
  const removePassword = !!opts.removePassword;
  const updateCertPassphrase = has('certPassphrase');
  const removeCertPassphrase = !!opts.removeCertPassphrase;

  if (updatePassword && removePassword) {
    throw new CliError('INVALID_ARGUMENT', 'Cannot use --password and --remove-password together.');
  }
  if (has('ca') && has('clearCa')) {
    throw new CliError('INVALID_ARGUMENT', 'Cannot use --ca and --clear-ca together.');
  }
  if (updateCertPassphrase && removeCertPassphrase) {
    throw new CliError('INVALID_ARGUMENT', 'Cannot use --cert-passphrase and --remove-cert-passphrase together.');
  }

  const updated: SystemProfile = { ...base, auth: base.auth };
  if (has('url')) updated.url = opts.url as string;
  if (has('client')) updated.client = opts.client as string;
  if (has('username')) updated.username = opts.username as string;
  if (has('language')) updated.language = opts.language as string;
  if (has('insecure')) updated.insecure = !!opts.insecure;
  if (has('ca')) updated.ca = opts.ca as string;
  if (has('clearCa')) delete updated.ca;

  updated.auth = resolveAuthFromOpts(base, opts);

  // Side-effect: warn on every write that the oauth service-key secret lives
  // on disk (so users don't forget it).
  if (updated.auth.method === 'oauth_password') {
    collectWarning(
      'OAUTH_CLIENT_SECRET_ON_DISK',
      `Service-key client_secret is stored in ~/.abap-cli/systems.json (mode 0600). ` +
      `If this machine is shared or backed up, rotate the key in BTP Cockpit.`,
    );
  }

  // Validate URL/client/language/auth shape before persisting — anything that's
  // missing here should fail loudly via printError rather than writing a half-
  // formed profile.
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

  let certPassphraseUpdated = false;
  let certPassphraseRemoved = false;
  if (updateCertPassphrase) {
    const pp = opts.certPassphrase as string;
    if (!pp) throw new CliError('INVALID_ARGUMENT', 'cert-passphrase cannot be empty when provided');
    await storeCertPassphrase(name, pp);
    certPassphraseUpdated = true;
  } else if (removeCertPassphrase) {
    await deleteCertPassphrase(name);
    certPassphraseRemoved = true;
  }

  return { updated, passwordUpdated, passwordRemoved, certPassphraseUpdated, certPassphraseRemoved };
}

/** Redact `clientSecret` for display (JSON + human). */
function redactOAuth(auth: AuthConfig): AuthConfig {
  if (auth.method !== 'oauth_password') return auth;
  return { method: 'oauth_password', oauth: { ...auth.oauth, clientSecret: '[redacted]' } };
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
    return { name, username: p.username, url: p.url };
  });
  const human = ['Connection profiles:', ...names.map((name) => {
    const p = getSystem(name)!;
    return `  ${name} — ${p.username}@${p.url}`;
  })].join('\n');
  printResult(mode, { systems }, human);
}

export async function runShow(name: string, mode: OutputMode): Promise<void> {
  const profile = getSystem(name);
  if (!profile) {
    throw new CliError('CONFIG_ERROR', `Connection profile '${name}' not found.`);
  }
  const password = (await getPassword(name)) ? 'stored' : 'not stored';
  // Redact the client secret so `profile show --json` never leaks it to agents.
  const auth = redactOAuth(profile.auth);
  const detail = {
    name,
    url: profile.url,
    client: profile.client || '100',
    username: profile.username,
    language: profile.language || 'EN',
    password,
    auth,
    insecure: profile.insecure ?? false,
    ca: profile.ca || '',
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
    switch (auth.method) {
      case 'basic':
        lines.push(`  auth:          basic`);
        break;
      case 'cert':
        lines.push(`  auth:          cert (certPath=${auth.cert.certPath}, keyPath=${auth.cert.keyPath}${auth.cert.caPath ? `, caPath=${auth.cert.caPath}` : ''})`);
        break;
      case 'browser_sso':
        lines.push(`  auth:          browser_sso (cookieFile=${auth.sso.cookieFile ?? `~/.abap-cli/${name}.sso.cookies.json (default)`})`);
        break;
      case 'oauth_password':
        lines.push(`  auth:          oauth_password (uaaUrl=${auth.oauth.uaaUrl}, clientId=${auth.oauth.clientId.slice(0, 40)}..., clientSecret=${auth.oauth.clientSecret})`);
        break;
    }
    lines.push(`  insecure:      ${detail.insecure}`);
    lines.push(`  ca:            ${detail.ca || '(none)'}`);
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

  // Snapshot the profile before delete so we can honour a custom sso cookieFile
  // when clearing the cookie jar.
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

  let certPassphraseCleaned = true;
  try {
    await deleteCertPassphrase(name);
  } catch {
    certPassphraseCleaned = false;
  }

  let cookieJarCleaned = true;
  const cookieFile = profileBeforeDelete?.auth.method === 'browser_sso'
    ? (profileBeforeDelete.auth.sso.cookieFile || defaultCookieFile(name))
    : defaultCookieFile(name);
  try {
    clearCookieStore(cookieFile);
  } catch {
    cookieJarCleaned = false;
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

  const data: Record<string, unknown> = { deleted: name, passwordCleaned, certPassphraseCleaned, cookieJarCleaned };
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
      await interactiveSet(name, { url: '', client: '100', username: '', language: 'EN', auth: defaultAuth() }, mode);
      return;
    }
    throw new CliError(
      'USAGE',
      'Non-interactive environment detected. Provide field options:\n' +
      '  abap profile add <name> --url <url> [--client <client>] [--username <user>] [--language <lang>] [--password <password>] [--insecure] [--ca <path>]\n' +
      '  --auth-method <basic|cert|browser_sso|oauth_password> --cert-path <cert.pem> --cert-key <key.pem> [--cert-ca <ca.pem>] [--cert-passphrase <pwd>] [--sso-cookie-file <path>] --service-key <default_key.json>',
    );
  }

  const { updated, passwordUpdated, passwordRemoved, certPassphraseUpdated, certPassphraseRemoved } =
    await applyProfileOptions({ url: '', client: '100', username: '', language: 'EN', auth: defaultAuth() }, name, opts);
  upsertSystem(name, updated);
  await recordTextpoolCapabilityIfPossible(name);

  printResult(
    mode,
    { system: { name, ...updated, auth: redactOAuth(updated.auth) }, passwordUpdated, passwordRemoved, certPassphraseUpdated, certPassphraseRemoved },
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
      '  abap profile set <name> --url <url> [--client <client>] [--username <user>] [--language <lang>] [--password <password>] [--insecure] [--ca <path>] [--clear-ca]\n' +
      '  --auth-method <basic|cert|browser_sso|oauth_password> --cert-path <cert.pem> --cert-key <key.pem> [--cert-ca <ca.pem>] [--cert-passphrase <pwd>] [--remove-cert-passphrase]\n' +
      '  --sso-cookie-file <path> [--clear-sso-cookie-file] --service-key <default_key.json>',
    );
  }

  const { updated, passwordUpdated, passwordRemoved, certPassphraseUpdated, certPassphraseRemoved } = await applyProfileOptions(profile, name, opts);
  upsertSystem(name, updated);
  await recordTextpoolCapabilityIfPossible(name);

  printResult(
    mode,
    { system: { name, ...updated, auth: redactOAuth(updated.auth) }, passwordUpdated, passwordRemoved, certPassphraseUpdated, certPassphraseRemoved },
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
    mode,
    { system: { name, ...updated, auth: redactOAuth(updated.auth) }, passwordUpdated, passwordRemoved },
    `Connection profile '${name}' updated.`,
  );
}

// Re-exports for callers (commands/profile.ts) — keep these stable.
export { canonicalToV1Fields };
