import { getSystem, type SystemProfile } from '../config/user-config.js';
import { getPassword } from '../config/secrets.js';
import { CliError } from '../output/json.js';
import type { ErrorCode } from '../output/error-codes.js';
import { probeSystem, type ProbeLayerResult } from '../clients/probe.js';
import {
  str,
  transportFromOpts,
  saveProfile,
  handleFileOverwrite,
  writeConfig,
  outputJson,
  validateInputs,
  icfDeploymentCheck,
  deriveSystemName,
  type CollectedConfig,
  type CommandOpts,
} from './config-write.js';
import { interactiveInit } from './config-wizard.js';

/** Core parameterized write — shared by `abap config` (parent) and previously `abap config init`. */
export async function runConfigFromOpts(opts: CommandOpts, jsonOutput: boolean): Promise<void> {
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

/** `abap config init` — interactive wizard. */
export async function runConfigWizard(opts: CommandOpts, jsonOutput: boolean): Promise<void> {
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
  // --yes/--non-interactive: skip the FILE_EXISTS refusal, like the wizard does.
  await handleFileOverwrite(opts.yes === true || opts.nonInteractive === true ? 'overwrite' : 'refuse');
  await writeConfig(systemName, config, jsonOutput);

  // FR-021: optional per-layer probe (--test-tls / --test-auth / --test-connection).
  // FR-012..FR-015: informational ICF deployment + version check (never blocks init).
  const icf = await icfDeploymentCheck(jsonOutput);
  if (jsonOutput) outputJson(systemName, config, probe, icf);
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
  // --yes/--non-interactive: skip the FILE_EXISTS refusal, like the wizard does.
  await handleFileOverwrite(opts.yes === true || opts.nonInteractive === true ? 'overwrite' : 'refuse');
  await writeConfig(systemName, config, jsonOutput);
  const icf = await icfDeploymentCheck(jsonOutput);
  if (jsonOutput) outputJson(systemName, config, undefined, icf);
}
