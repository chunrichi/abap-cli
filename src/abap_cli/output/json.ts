/**
 * Unified output helpers.
 *
 * Public API:
 *  - CliError: the in-process error type (extended with nextSteps/example).
 *  - toErrorShape: normalises any thrown value into the error contract shape.
 *  - renderResult / renderError: pure functions returning a RenderedOutput
 *    (stdout lines, stderr lines, exitCode). No stream writes, no process.exit.
 *  - printResult / printError: thin shims that call the renderers, write to
 *    the streams, and (in printError's case) call process.exit.
 *
 * Contract: { status: 'success', data } | { status: 'error', error: { code,
 * message, details?, nextSteps?, example? } }.
 */

import type { Command } from 'commander';
import { categoryOf, type ErrorCode } from './error-codes.js';
import { exitCodeFor, EXIT_GENERIC_FALLBACK } from './exit-codes.js';

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
 * Includes details/nextSteps/example from CliError instances.
 */
export function toErrorShape(error: unknown): { code: ErrorCode; message: string; [key: string]: unknown } {
  if (error instanceof CliError) {
    const out: Record<string, unknown> = {
      code: error.code,
      message: error.message,
    };
    if (error.details) out.details = error.details;
    if (error.nextSteps) out.nextSteps = error.nextSteps;
    if (error.example) out.example = error.example;
    return out as { code: ErrorCode; message: string; [key: string]: unknown };
  }
  const err = error as { statusCode?: number; statusMessage?: string; message?: string };
  const status = typeof err?.statusCode === 'number' ? err.statusCode : undefined;
  const message = err?.message || String(error);
  if (status !== undefined) {
    return {
      code: 'SAP_ERROR',
      message,
      httpStatus: status,
      ...(err.statusMessage ? { httpStatusText: err.statusMessage } : {}),
    };
  }
  return { code: 'SAP_ERROR', message };
}

/** Pure output payload — never writes to streams, never exits. */
export interface RenderedOutput {
  stdout: string[];
  stderr: string[];
  /** undefined ⇒ exit 0. */
  exitCode?: number;
}

/** Render a success payload. JSON goes to stdout; human text goes to stdout. */
export function renderResult(json: boolean, data: unknown, human?: string): RenderedOutput {
  if (json) {
    return {
      stdout: [JSON.stringify({ status: 'success', data }, null, 2)],
      stderr: [],
      exitCode: undefined,
    };
  }
  return { stdout: [human ?? ''], stderr: [], exitCode: undefined };
}

/** Render a failure payload. JSON goes to stderr; human text goes to stderr. */
export function renderError(json: boolean, error: unknown): RenderedOutput {
  const err = toErrorShape(error);
  const exitCode =
    'code' in err && typeof err.code === 'string'
      ? exitCodeFor(categoryOf(err.code as ErrorCode))
      : EXIT_GENERIC_FALLBACK;
  if (json) {
    return {
      stdout: [],
      stderr: [JSON.stringify({ status: 'error', error: err }, null, 2)],
      exitCode,
    };
  }
  // Non-JSON human-readable stderr line.
  const lines = [`Error: ${err.message}`];
  if (Array.isArray(err.nextSteps) && err.nextSteps.length > 0) {
    lines.push(`  Try: ${err.nextSteps.join(' / ')}`);
  }
  return { stdout: [], stderr: lines, exitCode };
}

/** Shim — writes to stdout and returns. Backward compatibility for existing call sites. */
export function printResult(json: boolean, data: unknown, human: string): void {
  const out = renderResult(json, data, human);
  for (const line of out.stdout) console.log(line);
}

/** Shim — writes to stderr and exits with the category's exit code. */
export function printError(json: boolean, error: unknown): never {
  const out = renderError(json, error);
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