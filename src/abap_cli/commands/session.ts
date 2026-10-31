/**
 * `abap session info` — inspect the on-disk session jar for the current
 * (or named) profile. Reads header metadata only; does not perform any
 * network call. Outputs the unified JSON envelope (with the
 * `--pretty-json` variant) and a human summary.
 *
 * Cloud / BTP profiles still produce a useful response — `policy` and
 * `systemHash` are computed, but `cookieCount` is 0, `csrfPresent` is
 * false, and `lastLoginAt` is null (the cookie jar path is never touched
 * in the unsupported path).
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CliError, printResult, printSchema, jsonFromCommand, type OutputMode, type CommandSchema } from '../output/json.js';
import { loadConfig, findWorkspaceConfig, type ProjectConfig } from '../config/project-config.js';
import { getSystem } from '../config/user-config.js';
import { computeSystemHash, decryptJar } from '../session/jar.js';
import { resolveSessionPolicy, effectivePolicy } from '../session/policy.js';
import { SESSION_KEYCHAIN_ACCOUNT } from '../config/secrets.js';
import { CONFIG_ERROR_REFERENCE } from '../config/recovery.js';
import { schemaOption } from './schema-helpers.js';
import { failMissingInvocation } from '../output/usage.js';

export const SCHEMA: CommandSchema = {
  schemaVersion: 1,
  command: 'session',
  description: 'Inspect the session cookie reuse state for the active profile (no SAP call).',
  usage: 'abap session info [--profile <name>]',
  scope: 'local',
  arguments: [],
  options: [
    { name: '--profile', type: 'string', valuePlaceholder: '<name>', description: 'Override the active profile (defaults to .abap.json#system).' },
    schemaOption(),
  ],
  globalOptions: ['--json', '--pretty-json'],
  examples: [
    { description: 'Show session jar state for the active profile', command: 'abap session info --json' },
  ],
  errors: [
    { code: 'CONFIG_ERROR', category: 'CONFIG_ERROR', exitCode: 3 },
    { code: 'SESSION_JAR_DECRYPT_FAILED', category: 'VALIDATION_ERROR', exitCode: 7 },
  ],
};

interface SessionInfoOptions {
  profile?: string;
}

interface SessionInfoData {
  policy: 'reuse' | 'always-logout';
  systemHash: string;
  lastLoginAt: string | null;
  cookieCount: number;
  csrfPresent: boolean;
  jarPath: string;
  keychainAccount: string;
}

export function registerSessionCommand(program: Command): void {
  const session = program
    .command('session')
    .description('Inspect / manage session cookie reuse state')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (_opts, cmd) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema) {
        printSchema(SCHEMA, mode);
        return;
      }
      // Bare `abap session` is a USAGE failure; help is only printed by
      // `abap session --help`.
      failMissingInvocation(
        cmd,
        "Missing subcommand: use 'session info'.",
        'abap session info --json',
      );
    });

  session
    .command('info')
    .description('Show the session cookie jar summary for the active profile (no SAP call)')
    .option('--profile <name>', 'Override the active profile (defaults to .abap.json#system)')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (opts: SessionInfoOptions, cmd) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema) {
        printSchema(SCHEMA, mode);
        return;
      }
      try {
        await runSessionInfo(opts, mode);
      } catch (error: unknown) {
        if (error instanceof CliError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new CliError('CONFIG_ERROR', `session info failed: ${message}`, {
          nextSteps: [
            'Check the bound profile: abap profile list --json',
            'Re-bind the workspace: abap init --profile <name>',
          ],
          example: 'abap session info --json',
          references: CONFIG_ERROR_REFERENCE,
        });
      }
    });
}

function loadConfigForProfile(profileName: string): ProjectConfig {
  const profile = getSystem(profileName);
  if (!profile) {
    throw new CliError('CONFIG_ERROR', `System profile '${profileName}' not found.`, {
      nextSteps: [`Run 'abap profile add ${profileName} ...' to create it.`],
      example: `abap profile add ${profileName} --url <url> --username <user>`,
    });
  }
  const configPath = findWorkspaceConfig() ?? path.join(process.cwd(), '.abap.json');
  let workspace: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      workspace = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      // ignore — fall back to defaults
    }
  }
  const ws = workspace as { package?: string; transport?: string; sourceDir?: string };
  return {
    sap: {
      url: profile.url,
      client: profile.client || '100',
      username: profile.username,
      password: '',
      language: profile.language || 'EN',
      insecure: profile.insecure ?? (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0'),
      caPath: profile.ca || '',
      sourceDir: ws.sourceDir || process.cwd(),
      systemType: profile.systemType,
      sessionPolicy: profile.sessionPolicy,
    },
    transport: ws.transport || '',
    package: ws.package || '',
    systemName: profileName,
    adtTextpool: profile.adtTextpool,
    systemVersion: profile.systemVersion,
  };
}

function getJarPath(systemHash: string): string {
  return path.join(os.homedir(), '.abap-cli', 'sessions', `${systemHash}.json`);
}

function humanize(d: SessionInfoData): string {
  const lastLogin = d.lastLoginAt ?? '(none — no successful login yet)';
  const csrf = d.csrfPresent ? 'yes' : 'no';
  return [
    `policy:           ${d.policy}`,
    `systemHash:       ${d.systemHash}`,
    `jarPath:          ${d.jarPath}`,
    `keychainAccount:  ${d.keychainAccount}`,
    `lastLoginAt:      ${lastLogin}`,
    `cookieCount:      ${d.cookieCount}`,
    `csrfPresent:      ${csrf}`,
  ].join('\n');
}

async function runSessionInfo(opts: SessionInfoOptions, mode: OutputMode): Promise<void> {
  const config = opts.profile ? loadConfigForProfile(opts.profile) : await loadConfig();
  const policy = effectivePolicy(resolveSessionPolicy(config));
  const systemHash = computeSystemHash(config.sap);
  const jarPath = getJarPath(systemHash);

  let lastLoginAt: string | null = null;
  let cookieCount = 0;
  let csrfPresent = false;

  if (fs.existsSync(jarPath)) {
    try {
      const blob = fs.readFileSync(jarPath);
      if (blob.length > 0) {
        const { loadOrCreateSessionKey } = await import('../session/key.js');
        const { key } = await loadOrCreateSessionKey(config.sap);
        const jar = decryptJar(blob, key, systemHash);
        lastLoginAt = jar.header.lastLoginAt;
        cookieCount = jar.cookies.length;
        csrfPresent = jar.csrf.value.length > 0;
      }
    } catch (error: unknown) {
      if (error instanceof CliError && error.code === 'SESSION_JAR_DECRYPT_FAILED') {
        // Treat as "jar exists but is unreadable" — surface as null in output
        // but keep the command exit 0 (informational).
        lastLoginAt = null;
      } else {
        throw error;
      }
    }
  }

  const data: SessionInfoData = {
    policy,
    systemHash,
    lastLoginAt,
    cookieCount,
    csrfPresent,
    jarPath,
    keychainAccount: SESSION_KEYCHAIN_ACCOUNT,
  };
  printResult(mode, data, humanize(data));
}
