import * as fs from 'fs';
import * as path from 'path';
import { confirm, isCancel } from '@clack/prompts';
import { storePassword } from '../config/secrets.js';
import { getSystem, listSystemNames, upsertSystem, type SystemProfile } from '../config/user-config.js';
import { CliError, printResult } from '../output/json.js';
import { collectWarning } from '../output/meta.js';
import { assertValidProfile } from '../config/validation.js';
import type { ProbeLayerResult } from '../clients/probe.js';
import { checkIcfDeployment, ICF_SERVICE_VERSION, type IcfDeploymentInfo } from '../icf/service-version.js';
import { probeTextpoolCapability, recordCapability } from '../textpool/textpool-capability.js';

interface WorkspaceConfig {
  system: string;
  transport: string;
  package: string;
}

export interface CollectedConfig extends SystemProfile {
  password: string;
  transport: string;
  pkg: string;
}

export type CommandOpts = Record<string, string | boolean | undefined>;

/** Read a string option, falling back when absent or a non-string (boolean flag). */
export function str(v: string | boolean | undefined, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

/** Exit 130 on Ctrl+C (@clack cancel), otherwise return the value */
export function orCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    console.log('\nAborted. No files were created.');
    process.exit(130);
  }
  return value as T;
}

/** Resolve the transport flag from --tr (only canonical option since --transport was removed). */
export function transportFromOpts(opts: CommandOpts): string {
  return str(opts.tr);
}

/** Save profile to user config + password to keychain */
export async function saveProfile(name: string, profile: SystemProfile, password: string, jsonOutput: boolean): Promise<void> {
  upsertSystem(name, profile);
  await storePassword(name, password);
  // 014: one-shot textpool capability probe (Q1: record at connect, reuse later).
  await recordCapabilityIfPossible(name);
  if (!jsonOutput) console.log(`System profile '${name}' saved. Password stored securely in OS keychain.`);
}

/** 014: informational capability probe — never blocks init (degraded, non-blocking). */
async function recordCapabilityIfPossible(name: string): Promise<void> {
  try {
    const cap = await probeTextpoolCapability();
    await recordCapability(name, cap);
  } catch {
    // informational — the profile simply has no adtTextpool record
  }
}

/** Auto-derive a profile name from the system URL and username */
export function deriveSystemName(profile: SystemProfile): string {
  try {
    const host = new URL(profile.url).hostname.replace(/\./g, '-');
    return `${profile.username}-${host}`;
  } catch {
    return `${profile.username}-system`;
  }
}

/** Refuse / confirm / skip overwriting an existing .abap.json. */
export async function handleFileOverwrite(mode: 'prompt' | 'overwrite' | 'refuse'): Promise<void> {
  const configPath = path.join(process.cwd(), '.abap.json');

  if (!fs.existsSync(configPath)) return;

  if (mode === 'refuse') {
    throw new CliError(
      'FILE_EXISTS',
      `.abap.json already exists. Delete it first or run interactively:\n  rm ${configPath}`,
    );
  }

  if (mode === 'prompt') {
    const ok = orCancel(await confirm({ message: '.abap.json already exists. Overwrite?', initialValue: false }));
    if (!ok) {
      console.log('Aborted. Existing configuration preserved.');
      process.exit(0);
    }
  }
  // mode === 'overwrite': fall through and overwrite.
}

/** T012: Input validation */
export function validateInputs(config: CollectedConfig): void {
  assertValidProfile(config);
  if (!config.password) {
    throw new CliError('INVALID_ARGUMENT', 'Password is required');
  }
}

/** Write workspace config referencing a user-level system profile */
export async function writeConfig(systemName: string, config: CollectedConfig, jsonOutput: boolean): Promise<void> {
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

  if (!jsonOutput) console.log('Workspace initialized.');
}

/** T013: JSON output */
export function outputJson(
  systemName: string,
  config: CollectedConfig,
  probe?: { tls?: ProbeLayerResult; auth?: ProbeLayerResult },
  icf?: IcfDeploymentInfo,
): void {
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
    ...(probe ?? {}),
    ...(icf ? { icf } : {}),
  };
  printResult(true, data, '');
}

/**
 * Informational ICF deployment check (FR-012..FR-015).
 * Never throws or blocks init: unreachable degrades to a warning; human mode
 * prints a hint. Returns the state so JSON output can embed it in data.icf.
 */
export async function icfDeploymentCheck(jsonOutput: boolean): Promise<IcfDeploymentInfo | undefined> {
  let icf: IcfDeploymentInfo;
  try {
    icf = await checkIcfDeployment();
  } catch (error: unknown) {
    // Unreachable degraded check — never fails init.
    icf = {
      status: 'unreachable',
      expectedVersion: ICF_SERVICE_VERSION,
      error: { code: 'ICF_CHECK_DEGRADED', message: error instanceof Error ? error.message : String(error) },
    };
  }
  if (icf.status === 'unreachable') {
    collectWarning('ICF_CHECK_DEGRADED', `ICF deployment check degraded: ${icf.error?.message ?? 'unreachable'}`, {
      status: 'unreachable',
    });
    if (!jsonOutput) console.log('Warning: ICF deployment check skipped (SAP unreachable).');
    return icf;
  }
  if (!jsonOutput) {
    if (icf.status === 'not_deployed') {
      console.log('ICF service not deployed — run "abap deploy" to deploy/update it.');
    } else if (icf.status === 'current') {
      console.log(`ICF service deployed (version ${icf.remoteVersion}).`);
    } else {
      console.log(
        `ICF service version mismatch (remote ${icf.remoteVersion ?? 'unknown'} vs expected ${icf.expectedVersion}) — run "abap deploy" to upgrade.`,
      );
    }
  }
  return icf;
}
