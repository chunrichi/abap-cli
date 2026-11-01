/**
 * `abap session info` / `abap session reset` — inspect and reset the session
 * store for the active (or named) profile. Both are local: no SAP call.
 *
 * `info` reports the store the session layer would actually use, every
 * candidate it considered, the key source, and the real jar state — the old
 * implementation only looked at `~/.abap-cli/sessions/<hash>.json`, so a
 * fallback jar (or a workspace store) was invisible and reuse looked broken
 * when it was not.
 *
 * `reset` deletes the persisted jars (including quarantined corrupt copies)
 * for the profile. It is the recovery path when reuse has been paused after
 * repeated auth failures, and it takes `--yes` because it discards a live
 * session.
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { CliError, printResult, printSchema, jsonFromCommand, type OutputMode, type CommandSchema } from '../output/json.js';
import { loadConfig, findWorkspaceConfig, type ProjectConfig } from '../config/project-config.js';
import { getSystem } from '../config/user-config.js';
import { SESSION_KEYCHAIN_ACCOUNT } from '../config/secrets.js';
import { CONFIG_ERROR_REFERENCE } from '../config/recovery.js';
import { computeSystemHash, hasStatefulSessionCookie, type SessionJar } from '../session/jar.js';
import { effectivePolicy, resolveSessionPolicy, sessionPolicySource } from '../session/policy.js';
import { peekSessionKey } from '../session/key.js';
import {
  clearSessionJars,
  displayPath,
  readSessionJars,
  resolveStoreCandidates,
  writableHint,
  type StoreCandidate,
  type StoreKind,
} from '../session/store.js';
import { reuseIsBlocked } from '../session/manager.js';
import { schemaOption } from './schema-helpers.js';
import { failMissingInvocation } from '../output/usage.js';

export const SCHEMA: CommandSchema = {
  schemaVersion: 1,
  command: 'session',
  description: 'Inspect or reset the SAP session store for the active profile (no SAP call).',
  usage: 'abap session info [--profile <name>] | abap session reset [--profile <name>] --yes',
  scope: 'local',
  arguments: [],
  options: [
    { name: '--profile', type: 'string', valuePlaceholder: '<name>', description: 'Override the active profile (defaults to .abap.json#system).' },
    { name: '--yes', type: 'boolean', description: 'Confirm `session reset` (required; discards the persisted session).' },
    schemaOption(),
  ],
  globalOptions: ['--json', '--pretty-json'],
  examples: [
    { description: 'Show the effective session store and jar state', command: 'abap session info --json' },
    { description: 'Forget the persisted session (e.g. after reuse was paused)', command: 'abap session reset --yes' },
  ],
  errors: [
    { code: 'CONFIG_ERROR', category: 'CONFIG_ERROR', exitCode: 3 },
    { code: 'USAGE', category: 'USAGE', exitCode: 2 },
    { code: 'SESSION_JAR_DECRYPT_FAILED', category: 'VALIDATION_ERROR', exitCode: 7 },
  ],
};

interface SessionOptions {
  profile?: string;
  yes?: boolean;
}

/** One candidate store plus everything the session layer knows about it. */
interface CandidateReport {
  kind: StoreKind;
  path: string;
  durability: 'durable';
  writable: boolean;
  jarExists: boolean;
  status: 'ok' | 'unset' | 'unreadable' | 'corrupt' | 'unwritable';
  error?: string;
  cookieCount?: number;
  lastLoginAt?: string;
}

interface JarReport {
  path: string;
  lastLoginAt: string | null;
  lastUsedAt?: string;
  cookieCount: number;
  csrfPresent: boolean;
  stateful: boolean;
  reuseFailures: number;
  blocked: boolean;
}

interface SessionInfoData {
  policy: 'reuse' | 'always-logout';
  policySource: 'env' | 'profile' | 'default';
  systemHash: string;
  keyMode: 'keychain' | 'derived' | 'missing' | 'ephemeral' | 'disabled';
  keychainAccount: string;
  reuseEnabled: boolean;
  reuseReason:
    | 'cloud-btp'
    | 'always-logout'
    | 'key-store-ephemeral'
    | 'no-durable-store'
    | 'reuse-unstable'
    | 'corrupt-jar'
    | null;
  store: { kind: StoreKind; path: string } | null;
  candidates: CandidateReport[];
  jar: JarReport | null;
}

interface SessionResetData {
  systemHash: string;
  removed: string[];
  storeCandidates: string[];
}

export function registerSessionCommand(program: Command): void {
  const session = program
    .command('session')
    .description('Inspect / reset session cookie reuse state')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (_opts, cmd) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema) {
        printSchema(SCHEMA, mode);
        return;
      }
      // Bare `abap session` is a USAGE failure; help is only printed by
      // `abap session --help`.
      failMissingInvocation(cmd, "Missing subcommand: use 'session info' or 'session reset'.", 'abap session info --json');
    });

  session
    .command('info')
    .description('Show the effective session store and jar state for the active profile (no SAP call)')
    .option('--profile <name>', 'Override the active profile (defaults to .abap.json#system)')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (opts: SessionOptions, cmd) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema) {
        printSchema(SCHEMA, mode);
        return;
      }
      await runSessionCommand('info', opts, mode);
    });

  session
    .command('reset')
    .description('Delete the persisted session jar(s) for the active profile (requires --yes)')
    .option('--profile <name>', 'Override the active profile (defaults to .abap.json#system)')
    .option('--yes', 'Confirm the reset (required; discards the persisted session)')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (opts: SessionOptions, cmd) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema) {
        printSchema(SCHEMA, mode);
        return;
      }
      await runSessionCommand('reset', opts, mode);
    });
}

async function runSessionCommand(sub: 'info' | 'reset', opts: SessionOptions, mode: OutputMode): Promise<void> {
  try {
    const config = opts.profile ? loadConfigForProfile(opts.profile) : await loadConfig();
    if (sub === 'info') {
      const data = await collectInfo(config);
      printResult(mode, data, humanizeInfo(data));
      return;
    }
    if (!opts.yes) {
      throw new CliError('USAGE', 'session reset discards the persisted SAP session; pass --yes to confirm.', {
        nextSteps: ["Run 'abap session reset --yes' to delete the persisted session jar."],
        example: 'abap session reset --yes',
      });
    }
    const candidates = resolveStoreCandidates(config.sap, { workspaceRoot: config.workspaceRoot });
    const removed = clearSessionJars(config.sap, candidates);
    const data: SessionResetData = {
      systemHash: computeSystemHash(config.sap),
      removed,
      storeCandidates: candidates.map((c) => c.displayDir),
    };
    printResult(
      mode,
      data,
      removed.length === 0
        ? 'No persisted session jar found; nothing to reset.'
        : `Removed ${removed.length} session jar file(s):\n${removed.map((p) => `  - ${p}`).join('\n')}`,
    );
  } catch (error: unknown) {
    if (error instanceof CliError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError('CONFIG_ERROR', `session ${sub} failed: ${message}`, {
      nextSteps: [
        'Check the bound profile: abap profile list --json',
        'Re-bind the workspace: abap init --profile <name>',
      ],
      example: `abap session ${sub} --json`,
      references: CONFIG_ERROR_REFERENCE,
    });
  }
}

/** Read-only description of the store and jar the session layer would use. */
async function collectInfo(config: ProjectConfig): Promise<SessionInfoData> {
  const policy = effectivePolicy(resolveSessionPolicy(config));
  const policySource = sessionPolicySource(config);
  const systemHash = computeSystemHash(config.sap);
  const candidates = resolveStoreCandidates(config.sap, { workspaceRoot: config.workspaceRoot });

  const peek = await peekSessionKey(config.sap);
  const read = readSessionJars(config.sap, peek.key ?? null, candidates);

  const reports: CandidateReport[] = candidates.map((candidate, idx) => {
    const status = read.statuses[idx];
    const jar = status?.jar;
    const report: CandidateReport = {
      kind: candidate.kind,
      path: status?.displayPath ?? displayPath(path.join(candidate.dir, `${systemHash}.json`)),
      durability: 'durable',
      writable: writableHint(candidate.dir),
      jarExists: status?.jarExists ?? false,
      status:
        status?.status === 'ok'
          ? 'ok'
          : status?.status === 'corrupt'
            ? 'corrupt'
            : status?.status === 'unreadable'
              ? 'unreadable'
              : status?.jarExists
                ? 'unreadable'
                : reportWritableFallback(candidate),
    };
    if (status?.error) report.error = status.error;
    if (jar) {
      report.cookieCount = jar.cookies.length;
      report.lastLoginAt = jar.header.lastLoginAt;
    }
    return report;
  });
  // Effective store = highest-priority candidate that is writable.
  const effectiveStore: { kind: StoreKind; path: string } | null =
    (() => {
      for (let i = 0; i < candidates.length; i += 1) {
        if (reports[i]?.writable) return { kind: candidates[i]!.kind, path: candidates[i]!.displayDir };
      }
      return null;
    })();

  const best = read.best;
  const jar: JarReport | null = best
    ? {
        path: displayPath(
          path.join(
            candidates.find((c) => c.kind === best.candidate.kind)?.dir ?? best.candidate.dir,
            `${systemHash}.json`,
          ),
        ),
        lastLoginAt: best.jar.header.lastLoginAt,
        ...(best.jar.header.lastUsedAt ? { lastUsedAt: best.jar.header.lastUsedAt } : {}),
        cookieCount: best.jar.cookies.length,
        csrfPresent: best.jar.csrf.value.length > 0,
        stateful: hasStatefulSessionCookie(best.jar.cookies),
        reuseFailures: best.jar.header.reuseFailures,
        blocked: reuseIsBlocked(best.jar),
      }
    : null;

  const { reuseEnabled, reuseReason } = evaluateReuse(config, policy, peek.mode, effectiveStore, best?.jar, read.corrupt);

  const data: SessionInfoData = {
    policy,
    policySource,
    systemHash,
    keyMode: peek.mode,
    keychainAccount: SESSION_KEYCHAIN_ACCOUNT,
    reuseEnabled,
    reuseReason,
    store: effectiveStore,
    candidates: reports,
    jar,
  };
  return data;
}

/** Status for a candidate that exists but has no jar: `ok` when writable. */
function reportWritableFallback(candidate: StoreCandidate): CandidateReport['status'] {
  return writableHint(candidate.dir) ? 'unset' : 'unwritable';
}

function evaluateReuse(
  config: ProjectConfig,
  policy: 'reuse' | 'always-logout',
  keyMode: SessionInfoData['keyMode'],
  store: { kind: StoreKind; path: string } | null,
  jar: SessionJar | undefined,
  corrupt: boolean,
): { reuseEnabled: boolean; reuseReason: SessionInfoData['reuseReason'] } {
  if (config.sap.systemType === 'cloud' || config.sap.systemType === 'btp') {
    return { reuseEnabled: false, reuseReason: 'cloud-btp' };
  }
  if (policy === 'always-logout') return { reuseEnabled: false, reuseReason: 'always-logout' };
  if (keyMode === 'ephemeral') return { reuseEnabled: false, reuseReason: 'key-store-ephemeral' };
  if (jar) {
    if (reuseIsBlocked(jar)) return { reuseEnabled: true, reuseReason: 'reuse-unstable' };
    return { reuseEnabled: true, reuseReason: null };
  }
  if (corrupt) return { reuseEnabled: store !== null, reuseReason: 'corrupt-jar' };
  if (store === null) return { reuseEnabled: false, reuseReason: 'no-durable-store' };
  return { reuseEnabled: true, reuseReason: null };
}

function humanizeInfo(d: SessionInfoData): string {
  const lines = [
    `policy:           ${d.policy} (${d.policySource})`,
    `reuseEnabled:     ${d.reuseEnabled}${d.reuseReason ? ` (${d.reuseReason})` : ''}`,
    `keyMode:          ${d.keyMode}`,
    `systemHash:       ${d.systemHash}`,
    `store:            ${d.store ? `${d.store.kind} — ${d.store.path}` : '(none — no durable directory is writable)'}`,
    'candidates:',
    ...d.candidates.map(
      (c) =>
        `  ${c.kind.padEnd(10)} ${c.path} — ${c.status}` +
        (c.jarExists ? `, ${c.cookieCount ?? 0} cookie(s), last login ${c.lastLoginAt ?? '?'}` : '') +
        (c.writable ? '' : ', not writable'),
    ),
    d.jar
      ? `jar:              ${d.jar.path} — ${d.jar.cookieCount} cookie(s), stateful=${d.jar.stateful}, ` +
        `csrf=${d.jar.csrfPresent}, reuseFailures=${d.jar.reuseFailures}${d.jar.blocked ? ' (reuse paused)' : ''}`
      : 'jar:              (none)',
  ];
  return lines.join('\n');
}

/** Build a minimal ProjectConfig from a named profile (no SAP call). */
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
    configPath: fs.existsSync(configPath) ? configPath : null,
    workspaceRoot: fs.existsSync(configPath) ? path.dirname(configPath) : null,
  };
}
