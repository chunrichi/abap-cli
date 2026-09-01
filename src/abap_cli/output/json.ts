/**
 * Unified output helpers.
 *
 * Public API:
 *  - CliError: the in-process error type (extended with nextSteps/example).
 *  - toErrorShape: normalises any thrown value into the error contract shape
 *    (with an explicit `category`).
 *  - renderResult / renderError: pure functions returning a RenderedOutput
 *    (stdout lines, stderr lines, exitCode). No stream writes, no process.exit.
 *  - printResult / printError: thin shims that call the renderers, write to
 *    the streams, and (in printError's case) call process.exit. The `meta`
 *    argument is optional — it defaults to buildMeta().
 *
 * Output envelope contract:
 *   success: { status: 'success', meta, data }
 *   failure: { status: 'error', meta, error: { code, category, message,
 *     details?, nextSteps?, example? } }.
 */

import type { Command } from 'commander';
import { categoryOf, type ErrorCode, type ErrorCategory } from './error-codes.js';
import { exitCodeFor, EXIT_GENERIC_FALLBACK } from './exit-codes.js';
import { buildMeta, buildSchemaMeta, deriveCommand, type OutputMeta } from './meta.js';
import type { ExtensionRegistry } from '../extensions/registry.js';

let _registry: ExtensionRegistry | undefined;
export function setExtensionRegistry(r: ExtensionRegistry | undefined): void {
  _registry = r;
}

/** Three-state output mode. */
export type OutputMode = 'human' | 'json' | 'pretty-json';

/** True when `mode` emits a JSON envelope rather than human text. */
export function isJsonMode(mode: OutputMode): boolean {
  return mode !== 'human';
}

/** Resolve the top-level output flags from any nested subcommand.
 *  `--pretty-json` wins over `--json` when both are set. */
export function jsonFromCommand(cmd: Command): OutputMode {
  const opts = cmd.optsWithGlobals<{ json?: boolean; prettyJson?: boolean }>();
  if (opts.prettyJson) return 'pretty-json';
  if (opts.json) return 'json';
  return 'human';
}

export interface CliErrorOptions {
  details?: Record<string, unknown>;
  /** Concrete actions the agent should try next. */
  nextSteps?: string[];
  /** A single canonical invocation that would succeed. */
  example?: string;
  /** Repo-relative path to a skill reference doc that lists this error's
*   meaning, category and recovery steps (e.g. 'skills/abap-cli-edit/references/errors.md#lock_failed'). */
  references?: string;
}

export class CliError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  readonly nextSteps?: string[];
  readonly example?: string;
  readonly references?: string;

  constructor(code: ErrorCode, message: string, options?: CliErrorOptions | Record<string, unknown>) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    if (!options || typeof options !== 'object') {
      return;
    }
    // Detect legacy `details` object: it has no recognised options-bag keys.
    const looksLikeOptionsBag =
      'details' in options || 'nextSteps' in options || 'example' in options || 'references' in options;
    if (looksLikeOptionsBag) {
      const opts = options as CliErrorOptions;
      this.details = opts.details;
      this.nextSteps = opts.nextSteps;
      this.example = opts.example;
      this.references = opts.references;
    } else {
      // Legacy callers passed a raw details object as the third argument.
      this.details = options as Record<string, unknown>;
    }
  }
}

/**
 * Normalize any thrown value into the contract error shape.
 * Includes details/nextSteps/example from CliError instances and the explicit
 * `category` derived from the error code.
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
    if (error.references) out.references = error.references;
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
 *  to stdout with any warnings as `Warning:` lines on stderr.
 *
 *  Token-efficient design:
 *   - Compact JSON (`null`) by default for `json` mode; indent 2 only for `pretty-json`.
 *   - Recursively strip empty `{}`/`[]` from `data` to save LM agent tokens.
 *   - Top-level `data` object is always preserved, even if it becomes `{}`. */
export function renderResult(mode: OutputMode, data: unknown, human: string, meta: OutputMeta): RenderedOutput {
  // Merge extension meta if registry is present
  const extMeta = _registry?.metaFragment(deriveCommand(process.argv));
  if (extMeta) {
    meta = { ...meta, extensions: extMeta };
  }
  if (isJsonMode(mode)) {
    return {
      stdout: [JSON.stringify({ status: 'success', meta, data: stripEmpty(data) }, null, mode === 'pretty-json' ? 2 : undefined)],
      stderr: [],
      exitCode: undefined,
    };
  }
  const warningLines = meta.warnings.map((w) => `Warning: ${w.message}`);
  return { stdout: [human], stderr: warningLines, exitCode: undefined };
}

/** Render a failure payload. JSON (with meta) goes to stderr; human text goes
 *  to stderr with `Warning:` lines first, then `Error:` + `Try:`. */
export function renderError(mode: OutputMode, error: unknown, meta: OutputMeta): RenderedOutput {
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
  if (isJsonMode(mode)) {
    return {
      stdout: [],
      stderr: [JSON.stringify({ status: 'error', meta, error: err }, null, mode === 'pretty-json' ? 2 : undefined)],
      exitCode,
    };
  }
  const lines = [...meta.warnings.map((w) => `Warning: ${w.message}`), `Error: ${err.message}`];
  if (Array.isArray(err.nextSteps) && err.nextSteps.length > 0) {
    lines.push(`  Try: ${err.nextSteps.join(' / ')}`);
  if (typeof err.references === 'string' && err.references.length > 0) {
    lines.push(`  See:  ${err.references}`);
  }
  }
  return { stdout: [], stderr: lines, exitCode };
}

/** Shim — writes to stdout/stderr and returns. `meta` defaults to buildMeta(). */
export function printResult(mode: OutputMode, data: unknown, human: string, meta?: OutputMeta): void {
  const out = renderResult(mode, data, human, meta ?? buildMeta());
  for (const line of out.stdout) console.log(line);
  for (const line of out.stderr) console.error(line);
}

/** Shim — writes to stderr and exits with the category's exit code. */
export function printError(mode: OutputMode, error: unknown, meta?: OutputMeta): never {
  const out = renderError(mode, error, meta ?? buildMeta());
  for (const line of out.stderr) console.error(line);
  process.exit(out.exitCode ?? EXIT_GENERIC_FALLBACK);
}

// --- Command parameter schema (`--schema` introspection, P0.1) ---
// Machine-readable description of a command's arguments/options so an agent
// can discover the exact invocation contract before calling it.

/** A schema field can be string-typed (covers int/number/json as well).
 *  The type union stays narrow for readability; richer shapes (--args as
 *  JSON, --timeout as number) surface through dedicated fields below. */
export interface CommandSchemaArgument {
  name: string;
  /** Argument value type. Defaults to 'string' when omitted. */
  type?: 'string' | 'int' | 'number' | 'json';
  required: boolean;
  description: string;
  /** Restrict to a fixed enum, e.g. object type (CLAS/INTF/PROG/FUGR). */
  allowedValues?: string[];
  /** Regex pattern for string values; rejected by Agent before calling. */
  pattern?: string;
  /** Maximum string length (chars). */
  maxLength?: number;
}

export interface CommandSchemaOption {
  name: string;
  type: 'string' | 'int' | 'number' | 'boolean' | 'json';
  /** Placeholder text shown in usage, e.g. `<n>` for --limit <n>. */
  valuePlaceholder?: string;
  description: string;
  required?: boolean;
  default?: string | number | boolean;
  deprecated?: boolean;
  allowedValues?: string[];
  /** Regex pattern for string values. */
  pattern?: string;
  /** Numeric lower bound (int/number only). */
  minimum?: number;
  /** Numeric upper bound (int/number only). */
  maximum?: number;
  /** True if the option is a global flag inherited from the root program. */
  global?: boolean;
}

/** Per-example block for richer command docs (run/select/tcode/where-used). */
export interface CommandSchemaExample {
  description?: string;
  command: string;
}

export interface CommandSchemaError {
  code: string;
  category: string;
  exitCode: number;
}

export interface CommandSchema {
  schemaVersion: 1;
  command: string;
  description: string;
  usage?: string;
  /** Optional command scope tag (sap / local) used for grouping in docs. */
  scope?: 'sap' | 'local' | string;
  arguments: CommandSchemaArgument[];
  options: CommandSchemaOption[];
  /** Option sets that must not be combined, e.g. [['--exact', '--fuzzy']].
   *  An empty array `[]` means "no explicit mutex groups" — render nothing. */
  exclusiveGroups?: string[][];
  /** Global options inherited from the root program (always `--json`). */
  globalOptions?: string[];
  examples?: (string | CommandSchemaExample)[];
  /** Command-scoped error codes (subset of the global ErrorCode enum). */
  errors?: CommandSchemaError[];
  /** Free-form notes (design, contract, runtime hints) for the docs page. */
  notes?: string[];
}

/** Print a command schema. Always a JSON envelope — it is a machine-readable
 *  contract. Uses the reduced `buildSchemaMeta()` (no timestamp/warnings) so
 *  schema introspection stays deterministic across runs. `--pretty-json`
 *  indents; human mode still emits compact JSON (a schema is JSON by nature).
 *  The payload may be the base `CommandSchema` or a richer command-specific
 *  shape (scope/errors/examples) — it is never read, only wrapped. */
export function printSchema(schema: object, mode: OutputMode = 'json'): void {
  const jsonMode = mode === 'pretty-json' ? 'pretty-json' : 'json';
  printResult(jsonMode, schema, '', buildSchemaMeta() as OutputMeta);
}

// --- Token-efficient output helpers (025 US2) ---

/** Recursively strip empty arrays and empty objects from `value` to save LM-agent
 *  tokens. Agent consumers rarely need `"skipped": []` or `"warnings": []` when
 *  there are none. `null` is preserved (not the same as empty). */
function stripEmpty(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map(stripEmpty);
  }

  if (typeof value !== 'object') return value;

  const obj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const cleaned = stripEmpty(v);
    if (cleaned !== null && typeof cleaned === 'object') {
      if (Array.isArray(cleaned)) {
        if (cleaned.length === 0) continue; // skip empty array
        result[k] = cleaned;
      } else if (Object.keys(cleaned).length === 0) {
        continue; // skip empty object
      } else {
        result[k] = cleaned;
      }
    } else {
      result[k] = cleaned;
    }
  }
  return result;
}