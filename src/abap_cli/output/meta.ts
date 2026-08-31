/**
 * Envelope meta + structured warnings (FR-003/FR-004).
 *
 * Public API:
 *  - setProgram: register the commander program once (from index.ts) so
 *    buildMeta can derive the canonical command name from argv + command tree.
 *  - collectWarning / getWarnings / resetWarnings: structured non-fatal
 *    warnings that only ever appear in meta.warnings, never in the error
 *    envelope.
 *  - buildMeta: snapshot of command, version, timestamp, durationMs, warnings.
 *  - buildSchemaMeta: reduced metadata for deterministic schema introspection.
 *  - getOriginalArgv: lazy snapshot of process.argv.slice(2) captured on first
 *    call, before commander mutates process.argv. Used to detect flags that the
 *    parser silently swallowed (e.g. unknown flags on a subcommand that doesn't
 *    define them).
 */

let _originalArgv: string[] | undefined;

/** Lazy snapshot of process.argv.slice(2) captured on first call, before
 *  commander mutates process.argv. Replaces the module-top `originalArgv`
 *  constant so we don't freeze argv at import time. */
export function getOriginalArgv(): string[] {
  if (!_originalArgv) _originalArgv = process.argv.slice(2);
  return _originalArgv;
}

import type { Command } from 'commander';
import { createRequire } from 'node:module';

export type WarningCode =
  | 'UNLOCK_WARNING'        // push succeeded but the edit lock could not be released
  | 'DEPRECATED_OPTION'     // deprecated option used (e.g. --max in search)
  | 'PASSWORD_EXPORT'       // connection export includes passwords
  | 'KEYCHAIN_WARNING'      // OS keychain store/cleanup failed (degraded continue)
  | 'FORCE_BYPASSED'        // deploy --force bypassed safety guards
  | 'PROFILE_MISMATCH'      // stored profile differs from current config
  | 'PAGINATION_LIMITED'    // search --page-all hit the page cap; result truncated
  | 'ICF_CHECK_DEGRADED'    // init ICF deployment check degraded (non-blocking)
  | 'ICF_OUTDATED_DEADLOCK' // extension status reports outdated gc_version (likely user transport holds the new source)
  | 'OAUTH_CLIENT_SECRET_ON_DISK' // oauth_password profile: client_secret stored in systems.json
  // 023-extension-mechanism
  | 'EXTENSION_DEGRADED'    // extension failed to load but CLI continues (lenient mode)
  // 030-runtime-deploy
  | 'STEAMPUNK_ICF_MANUAL'  // deploy on Steampunk: ICF node must be wired via CF route
  ;

export interface Warning {
  code: WarningCode;
  message: string;
  details?: Record<string, unknown>;
}

/** Snapshot of loaded extensions for meta.extensions (023-extension-mechanism).
 *  027-extension-trust — adds optional `lockfile` sub-object.
 *  Purely additive: consumers that ignore unknown keys are unaffected. */
export interface ExtensionMeta {
  loaded: number;
  failed?: number;
  byType: { command?: number; validation?: number; lifecycle?: number };
  names: string[];
  validationRules?: Array<{ name: string; appliesTo: string[] | '*' }>;
  /** 027 US4 — lockfile health. Omitted when no npm extensions declared
   *  or when status is `present` (token-efficient). */
  lockfile?: { status: 'present' | 'absent' | 'outdated' | 'mismatch'; lastResolved?: string };
}

export interface OutputMeta {
  /** Canonical command name, e.g. 'abap pull', 'abap profile test'. */
  command: string;
  /** CLI version from package.json. */
  version: string;
  /** ISO 8601 (UTC) timestamp. */
  timestamp: string;
  /** Milliseconds since CLI start (non-negative integer). */
  durationMs: number;
  /** Structured warnings; always present, empty when none. */
  warnings: Warning[];
  /** Loaded extension summary (only present when extensions are registered). */
  extensions?: ExtensionMeta;
}

const startTime = Date.now();

let program: Command | undefined;
const warnings: Warning[] = [];

/** Register the commander program so buildMeta can derive the command name. */
export function setProgram(cmd: Command): void {
  program = cmd;
}

/** Record a non-fatal warning (only surfaces in meta.warnings). */
export function collectWarning(
  code: WarningCode,
  message: string,
  details?: Record<string, unknown>,
): void {
  warnings.push(details ? { code, message, details } : { code, message });
}

/** Snapshot of collected warnings (copy, so callers cannot mutate the store). */
export { deriveCommand };

export function getWarnings(): Warning[] {
  return warnings.slice();
}

/** Clear collected warnings (test isolation). */
export function resetWarnings(): void {
  warnings.length = 0;
}

function deriveCommand(argv: string[]): string {
  let cmd: Command | undefined = program;
  const parts: string[] = [];
  for (const token of argv.slice(2)) {
    if (token.startsWith('-')) continue;
    const sub = cmd?.commands.find((c) => c.name() === token);
    if (sub) {
      cmd = sub;
      parts.push(sub.name());
    } else {
      break;
    }
  }
  return ['abap', ...parts].join(' ');
}

function readVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    // From dist/src/abap_cli/output/ this resolves to the repo-root package.json.
    const { version } = require('../../../../package.json') as { version?: string };
    return version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Build the envelope meta block. */
export function buildMeta(): OutputMeta {
  return {
    command: deriveCommand(process.argv),
    version: readVersion(),
    timestamp: new Date().toISOString(),
    durationMs: Math.max(0, Date.now() - startTime),
    warnings: getWarnings(),
  };
}

/** Reduced metadata used by the agent-facing `--schema` response (025 US3):
 *  excludes timestamp and warnings so the contract stays stable and minimal. */
export type SchemaOutputMeta = Pick<OutputMeta, 'command' | 'version' | 'durationMs'>;

/** Build the reduced meta block used by `--schema`. */
export function buildSchemaMeta(): SchemaOutputMeta {
  const meta = buildMeta();
  return {
    command: meta.command,
    version: meta.version,
    durationMs: meta.durationMs,
  };
}
