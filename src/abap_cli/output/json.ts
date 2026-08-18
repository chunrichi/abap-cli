/**
 * Unified output helpers.
 *
 * Public API:
 *  - CliError: the in-process error type (extended with nextSteps/example).
 *  - toErrorShape: normalises any thrown value into the error contract shape
 *    (now with an explicit `category`, FR-005/FR-006).
 *  - renderResult / renderError: pure functions returning a RenderedOutput
 *    (stdout lines, stderr lines, exitCode). No stream writes, no process.exit.
 *  - printResult / printError: thin shims that call the renderers, write to
 *    the streams, and (in printError's case) call process.exit. The `meta`
 *    argument is optional — it defaults to buildMeta().
 *
 * Contract (specs/012-unify-cli-output-contract/contracts/cli-output.md):
 *   success: { status: 'success', meta, data }
 *   failure: { status: 'error', meta, error: { code, category, message,
 *     details?, nextSteps?, example? } }.
 */

import type { Command } from 'commander';
import { categoryOf, type ErrorCode, type ErrorCategory } from './error-codes.js';
import { exitCodeFor, EXIT_GENERIC_FALLBACK } from './exit-codes.js';
import { buildMeta, deriveCommand, type OutputMeta } from './meta.js';
import type { ExtensionRegistry } from '../extensions/registry.js';

let _registry: ExtensionRegistry | undefined;
export function setExtensionRegistry(r: ExtensionRegistry | undefined): void {
  _registry = r;
}

/** Resolve the top-level --json flag from any nested subcommand (FR-027). */
export function jsonFromCommand(cmd: Command): boolean {
  return cmd.optsWithGlobals().json ?? false;
}

export interface CliErrorOptions {
  details?: Record<string, unknown>;
  /** FR-009 — concrete actions the agent should try next. */
  nextSteps?: string[];
  /** FR-009 — a single canonical invocation that would succeed. */
  example?: string;
}

export class CliError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  readonly nextSteps?: string[];
  readonly example?: string;

  constructor(code: ErrorCode, message: string, options?: CliErrorOptions | Record<string, unknown>) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    if (!options || typeof options !== 'object') {
      return;
    }
    // Detect legacy `details` object: it has no recognised options-bag keys.
    const looksLikeOptionsBag =
      'details' in options || 'nextSteps' in options || 'example' in options;
    if (looksLikeOptionsBag) {
      const opts = options as CliErrorOptions;
      this.details = opts.details;
      this.nextSteps = opts.nextSteps;
      this.example = opts.example;
    } else {
      // Legacy callers passed a raw details object as the third argument.
      this.details = options as Record<string, unknown>;
    }
  }
}

/**
 * Normalize any thrown value into the contract error shape.
 * Includes details/nextSteps/example from CliError instances and the explicit
 * `category` derived from the error code (FR-005/FR-006).
 */
export function toErrorShape(error: unknown): { code: ErrorCode; category: ErrorCategory; message: string; [key: string]: unknown } {
  if (error instanceof CliError) {
    const out: Record<string, unknown> = {
      code: error.code,
      category: categoryOf(error.code),
      message: error.message,
    };
    if (error.details) out.details = error.details;
    if (error.nextSteps) out.nextSteps = error.nextSteps;
    if (error.example) out.example = error.example;
    return out as { code: ErrorCode; category: ErrorCategory; message: string; [key: string]: unknown };
  }
  const err = error as { statusCode?: number; statusMessage?: string; message?: string };
  const status = typeof err?.statusCode === 'number' ? err.statusCode : undefined;
  const message = err?.message || String(error);
  if (status !== undefined) {
    return {
      code: 'SAP_ERROR',
      category: 'SAP_ERROR',
      message,
      httpStatus: status,
      ...(err.statusMessage ? { httpStatusText: err.statusMessage } : {}),
    };
  }
  // Unmapped exception — generic fallback (exit 1), not a fake SAP error.
  return { code: 'UNKNOWN', category: 'UNKNOWN', message };
}

/** Pure output payload — never writes to streams, never exits. */
export interface RenderedOutput {
  stdout: string[];
  stderr: string[];
  /** undefined ⇒ exit 0. */
  exitCode?: number;
}

/** Render a success payload. JSON (with meta) goes to stdout; human text goes
 *  to stdout with any warnings as `Warning:` lines on stderr (FR-016). */
export function renderResult(json: boolean, data: unknown, human: string, meta: OutputMeta): RenderedOutput {
  // Merge extension meta if registry is present
  const extMeta = _registry?.metaFragment(deriveCommand(process.argv));
  if (extMeta) {
    meta = { ...meta, extensions: extMeta };
  }
  if (json) {
    return {
      stdout: [JSON.stringify({ status: 'success', meta, data }, null, 2)],
      stderr: [],
      exitCode: undefined,
    };
  }
  const warningLines = meta.warnings.map((w) => `Warning: ${w.message}`);
  return { stdout: [human], stderr: warningLines, exitCode: undefined };
}

/** Render a failure payload. JSON (with meta) goes to stderr; human text goes
 *  to stderr with `Warning:` lines first, then `Error:` + `Try:` (FR-016). */
export function renderError(json: boolean, error: unknown, meta: OutputMeta): RenderedOutput {
  // Merge extension meta if registry is present
  const extMeta = _registry?.metaFragment(deriveCommand(process.argv));
  if (extMeta) {
    meta = { ...meta, extensions: extMeta };
  }
  const err = toErrorShape(error);
  const exitCode =
    'code' in err && typeof err.code === 'string'
      ? exitCodeFor(categoryOf(err.code as ErrorCode))
      : EXIT_GENERIC_FALLBACK;
  if (json) {
    return {
      stdout: [],
      stderr: [JSON.stringify({ status: 'error', meta, error: err }, null, 2)],
      exitCode,
    };
  }
  const lines = [...meta.warnings.map((w) => `Warning: ${w.message}`), `Error: ${err.message}`];
  if (Array.isArray(err.nextSteps) && err.nextSteps.length > 0) {
    lines.push(`  Try: ${err.nextSteps.join(' / ')}`);
  }
  return { stdout: [], stderr: lines, exitCode };
}

/** Shim — writes to stdout/stderr and returns. `meta` defaults to buildMeta(). */
export function printResult(json: boolean, data: unknown, human: string, meta?: OutputMeta): void {
  const out = renderResult(json, data, human, meta ?? buildMeta());
  for (const line of out.stdout) console.log(line);
  for (const line of out.stderr) console.error(line);
}

/** Shim — writes to stderr and exits with the category's exit code. */
export function printError(json: boolean, error: unknown, meta?: OutputMeta): never {
  const out = renderError(json, error, meta ?? buildMeta());
  for (const line of out.stderr) console.error(line);
  process.exit(out.exitCode ?? EXIT_GENERIC_FALLBACK);
}

// --- Command parameter schema (`--schema` introspection, P0.1) ---
// Machine-readable description of a command's arguments/options so an agent
// can discover the exact invocation contract before calling it.

export interface CommandSchemaArgument {
  name: string;
  required: boolean;
  description: string;
  allowedValues?: string[];
}

export interface CommandSchemaOption {
  name: string;
  type: 'string' | 'int' | 'boolean';
  /** Placeholder text shown in usage, e.g. `<n>` for --limit <n>. */
  valuePlaceholder?: string;
  description: string;
  required?: boolean;
  default?: string | number | boolean;
  deprecated?: boolean;
  allowedValues?: string[];
}

export interface CommandSchema {
  schemaVersion: 1;
  command: string;
  description: string;
  usage: string;
  arguments: CommandSchemaArgument[];
  options: CommandSchemaOption[];
  /** Option sets that must not be combined, e.g. [['--exact', '--fuzzy']]. */
  exclusiveGroups?: string[][];
  globalOptions: string[];
  examples?: string[];
}

/** Print a command schema. Always JSON — it is a machine-readable contract. */
export function printSchema(schema: CommandSchema): void {
  printResult(true, schema, '');
}