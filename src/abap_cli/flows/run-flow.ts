/**
 * `abap run` flow — execute ABAP classrun or static method via wrapper (015).
 *
 * Two routes:
 *   1. **classrun** (`opts.method` absent) — direct ADT classrun via
 *      `AdtClientWrapper.runClass(className)`; output is the classrun's
 *      stdout verbatim.
 *   2. **wrapper** (`opts.method` given) — ADT classrun of the bundled
 *      `ZCL_ABAP_VIBE_RUNNER` with body params (IV_TARGET_CLASS,
 *      IV_METHOD_NAME, IV_ARGS_JSON, IV_TIMEOUT_MS); SAP-side wrapper
 *      reflects + calls + JSON-serialises the result.
 *
 * Output parsing + error mapping is centralised in `parseClassrunOutput`
 * (src/abap_cli/core/classrun-output.ts). The flow here:
 *   - chooses the route based on `opts.method`
 *   - times the classrun via `performance.now()` deltas
 *   - maps JSON `code` to `ErrorCode` per data-model §5 / spec FR-008
 *   - constructs a `RunResult` that `printResult` / `printError` consume
 */

import { CliError } from '../output/json.js';
import type { ErrorCode } from '../output/error-codes.js';
import {
  looksLikeException,
  parseClassrunOutput,
  type ClassrunOutput,
} from '../core/classrun-output.js';
import { AdtClientWrapper } from '../clients/adt-client.js';

export interface RunOptions {
  /** Method name (empty → direct classrun). */
  method?: string;
  /** JSON-string args (parsed by `parseArgs` here. */
  args?: string;
  /** Timeout in ms; commander passes string. `validateTimeout` normalises. */
  timeout?: number | string;
  /** Dry-run flag — never invoked by `runRun`, but consumed by `commands/run.ts` before this layer. */
  dryRun?: boolean;
}

export interface RunResult {
  className: string;
  method: string | null;
  args: Record<string, unknown>;
  timeout: number;
  dryRun: boolean;
  route: 'classrun' | 'wrapper';
  /** Raw classrun stdout (trimmed). Empty in dry-run. */
  output: string;
  /** Parsed JSON object when output is JSON, otherwise null. */
  parsed: Record<string, unknown> | null;
  /** Business exit code from classrun JSON (default 0). */
  exitCode: number;
  /** Wall-clock ms between request start and response. */
  durationMs: number;
  /** true when dry-run path was used (no SAP call). */
  wouldRun?: boolean;
}

/** 015: bundled wrapper class name (single source of truth). */
export const RUNNER_CLASS = 'ZCL_ABAP_VIBE_RUNNER';

/** Class name regex — SAP class names (allow `~` for syntax check; rejected at runtime). */
const CLASS_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_~]{0,29}$/;

/** Method name regex (stricter — must start with letter/underscore). */
const METHOD_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Timeout bounds (per FR-002). */
const TIMEOUT_MIN = 100;
const TIMEOUT_MAX = 600_000;
const TIMEOUT_DEFAULT = 30_000;

/** Parse + validate `--args` JSON. Returns object (or empty object for `{}`). */
export function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined || raw === null || raw === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new CliError('INVALID_ARGUMENT', `--args is not parse: ${msg}`, {
      nextSteps: [
        'Provide a JSON object, e.g. --args \'{"x":3,"y":5}\'',
        'Check JSON syntax (commas, quotes, braces)',
      ],
    });
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed)
  ) {
    throw new CliError('INVALID_ARGUMENT', '--args must be a JSON object, not array/null', {
      nextSteps: ['Provide a JSON object, e.g. --args \'{"x":3}\''],
    });
  }
  return parsed as Record<string, unknown>;
}

/** Validate + normalise class name. Throws INVALID_ARGUMENT on bad input. */
export function validateClassName(name: string): string {
  if (!CLASS_NAME_REGEX.test(name)) {
    throw new CliError('INVALID_ARGUMENT', `class name '${name}' is invalid`, {
      nextSteps: [
        'ABAP class names start with Z/Y or a namespace, up to 30 chars',
        'Pattern: ^[A-Za-z][A-Za-z0-9_~]{0,29}$',
      ],
    });
  }
  return name;
}

/** Validate method name. Throws INVALID_ARGUMENT. */
export function validateMethodName(method: string): string {
  if (!METHOD_NAME_REGEX.test(method)) {
    throw new CliError('INVALID_ARGUMENT', `method name '${method}' is invalid`, {
      nextSteps: [
        'Method names: start with letter/underscore, then letters/digits/underscores',
        'Pattern: ^[A-Za-z_][A-Za-z0-9_]*$',
      ],
    });
  }
  return method;
}

/** Validate + clamp timeout. Throws INVALID_ARGUMENT. */
export function validateTimeout(raw: number | string | undefined): number {
  if (raw === undefined || raw === null || raw === '') return TIMEOUT_DEFAULT;
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < TIMEOUT_MIN || n > TIMEOUT_MAX) {
    throw new CliError(
      'INVALID_ARGUMENT',
      `--timeout must be an integer in [${TIMEOUT_MIN}, ${TIMEOUT_MAX}] ms (got '${String(raw)}')`,
      {
        nextSteps: [
          `Provide a value between ${TIMEOUT_MIN} and ${TIMEOUT_MAX} ms`,
          `Default is ${TIMEOUT_DEFAULT} ms when --timeout is omitted`,
        ],
      },
    );
  }
  return n;
}

/** Build classrun body params for the wrapper route. */
function buildWrapperParams(
  targetClass: string,
  method: string,
  argsJson: string,
  timeoutMs: number,
): Array<{ name: string; value: string }> {
  return [
    { name: 'IV_TARGET_CLASS', value: targetClass.toUpperCase() },
    { name: 'IV_METHOD_NAME', value: method },
    { name: 'IV_ARGS_JSON', value: argsJson },
    { name: 'IV_TIMEOUT_MS', value: String(timeoutMs) },
  ];
}

/** Local-class detection: class names with `~` (e.g. `ZCL_FOO~LCL_BAR`). */
function isLocalClass(name: string): boolean {
  return name.includes('~');
}

/**
 * Map a classrun JSON `code` (data-model §5) to an `ErrorCode`.
 * Unknown codes fall back to `SAP_ERROR` per spec.
 */
function mapClassrunCode(code: string | undefined): ErrorCode {
  if (!code) return 'SAP_ERROR';
  // 015 new codes
  switch (code) {
    case 'METHOD_FAILED':
    case 'METHOD_NOT_SUPPORTED':
    case 'CLASS_NOT_RUNNABLE':
      return code;
    case 'OBJECT_NOT_ACTIVE':
    case 'LOCAL_CLASS_NOT_RUNNABLE':
    case 'TIMEOUT':
    case 'WRAPPER_INPUT_UNAVAILABLE':
      return code;
    case 'WRAPPER_NOT_DEPLOYED':
      return code;
    case 'ACCESS_DENIED':
      // PRIVATE/PROTECTED methods → AUTH_ERROR semantics.
      return 'AUTH_ERROR';
    case 'INSTANCE_METHOD_NOT_SUPPORTED':
      return 'METHOD_NOT_SUPPORTED';
    case 'LOCAL_CLASS_NOT_FOUND':
      return 'LOCAL_CLASS_NOT_RUNNABLE';
    // 015 implicitly reuses these existing codes
    case 'AUTH_ERROR':
    case 'OBJECT_NOT_FOUND':
    case 'LOCKED':
      return code;
    default:
      return 'SAP_ERROR';
  }
}

/** Build the dry-run envelope (called from `commands/run.ts`). */
export function buildDryRun(
  className: string,
  opts: RunOptions,
): RunResult {
  const method = opts.method ?? null;
  return {
    className,
    method,
    args: parseArgs(opts.args),
    timeout: validateTimeout(opts.timeout),
    dryRun: true,
    route: method ? 'wrapper' : 'classrun',
    output: '',
    parsed: null,
    exitCode: 0,
    durationMs: 0,
    wouldRun: true,
  };
}

/**
 * The main entry. Invokes ADT classrun (classrun or wrapper route), parses
 * the output, and returns a `RunResult` or throws a structured `CliError`.
 */
export async function runRun(
  className: string,
  opts: RunOptions,
  client?: AdtClientWrapper,
): Promise<RunResult> {
  validateClassName(className);

  const method = opts.method ? validateMethodName(opts.method) : undefined;
  const timeout = validateTimeout(opts.timeout);
  const args = parseArgs(opts.args);
  const route: 'classrun' | 'wrapper' = method ? 'wrapper' : 'classrun';

  // Local classes cannot be invoked via ADT classrun — reject early.
  if (isLocalClass(className)) {
    throw new CliError(
      'LOCAL_CLASS_NOT_RUNNABLE',
      `class '${className}' is a local class (contains '~'); only global classes can be invoked via classrun`,
      {
        nextSteps: [
          'abap run must target a global class (no ~ in name)',
          `Use 'abap search ${className.split('~')[0]}' to find the global class`,
        ],
      },
    );
  }

  const adt = client ?? (await AdtClientWrapper.create());

  const t0 = performance.now();
  let raw: string;
  if (route === 'wrapper') {
    raw = await withTimeout(
      adt.runClass(
        RUNNER_CLASS,
        buildWrapperParams(className, method!, JSON.stringify(args), timeout),
      ),
      // CLI fallback = --timeout + 5s (SAP-side wrapper checks first).
      timeout + 5000,
      { className, method: method! },
    );
  } else {
    // classrun path: ADT endpoint enforces its own server timeout (~5min);
    // CLI-side fallback keeps the process from hanging.
    raw = await withTimeout(adt.runClass(className), timeout + 5000, { className });
  }
  const t1 = performance.now();

  return interpret(className, method ?? null, args, timeout, route, raw, t1 - t0);
}

/**
 * CLI-side timeout fallback. SAP-side (wrapper route) already enforces
 * `--timeout` via cl_abap_runtime; this guards against the wrapper not
 * returning at all. Exported for tests (T038 spies on abort()).
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  ctx: { className: string; method?: string },
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, ms);
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(
            new CliError(
              'TIMEOUT',
              `classrun exceeded ${ms}ms (CLI-side timeout guard)`,
              {
                nextSteps: [
                  `Increase --timeout (current limit ${ms}ms)`,
                  'Check SAP SM51 for runaway processes',
                ],
              },
            ),
          );
        });
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Interpret the classrun response and shape a `RunResult` or throw a
 * structured `CliError`. Pure function (no IO) — exported for testing.
 */
export function interpret(
  className: string,
  method: string | null,
  args: Record<string, unknown>,
  timeout: number,
  route: 'classrun' | 'wrapper',
  raw: string,
  durationMs: number,
): RunResult {
  const parsed = parseClassrunOutput(raw);
  if (parsed.kind === 'empty') {
    throw new CliError('SAP_ERROR', 'classrun produced no output', {
      nextSteps: [
        'Verify the target class exists and is active: abap search <query>',
        'Inspect the class: abap pull <class>',
      ],
    });
  }

  if (parsed.kind === 'error') {
    const code = mapClassrunCode(parsed.code);
    const message = parsed.message ?? `classrun error (code=${parsed.code ?? 'UNKNOWN'})`;
    const details =
      route === 'wrapper'
        ? extractDetails(parsed.parsed, className, method ?? '')
        : undefined;
    const nextSteps = nextStepsFor(code, className, method);
    throw new CliError(code, message, details ? { details, nextSteps } : { nextSteps });
  }

  // kind === 'ok'
  // Wrapper route that came back with a heartbeat (no `method` field) while
  // the caller requested `--method` — the SAP classrun endpoint did not
  // inject the parameters (system limitation). Surface it clearly instead
  // of silently reporting the heartbeat as the method result.
  if (route === 'wrapper' && method && parsed.parsed && parsed.parsed.method === undefined) {
    throw new CliError('WRAPPER_INPUT_UNAVAILABLE', 'classrun parameter injection is not supported on this system', {
      details: { className, method },
      nextSteps: [
        'The target SAP system does not support classrun parameter injection',
        'Use `abap run <class>` (direct classrun, no --method) instead',
      ],
    });
  }

  // Non-JSON text with exception markers → treat as SAP_ERROR (US-4 acceptance 2)
  if (parsed.parsed === null && looksLikeException(parsed.raw)) {
    const message = `classrun output looks like an exception (truncated): ${parsed.raw.slice(0, 200)}`;
    throw new CliError('SAP_ERROR', message, {
      nextSteps: [
        'Check SAP SM21 / ST22 for the full stack trace',
        'abap inspect <class> to verify the method signature',
      ],
    });
  }

  return {
    className,
    method,
    args,
    timeout,
    dryRun: false,
    route,
    output: parsed.raw,
    parsed: parsed.parsed,
    exitCode: parsed.exitCode,
    durationMs: Math.max(0, Math.round(durationMs)),
  };
}

function extractDetails(
  parsed: Record<string, unknown> | null | undefined,
  className: string,
  method: string,
): Record<string, unknown> | undefined {
  if (!parsed) return undefined;
  const details: Record<string, unknown> = {};
  if (parsed.class) details.class = parsed.class;
  else details.class = className;
  if (parsed.method) details.method = parsed.method;
  else if (method) details.method = method;
  if (parsed.signature) details.signature = parsed.signature;
  return Object.keys(details).length > 0 ? details : undefined;
}

function nextStepsFor(code: ErrorCode, className: string, method: string | null): string[] {
  switch (code) {
    case 'METHOD_NOT_SUPPORTED':
      return [
        'Use `abap run <class>` (classrun) instead of --method',
        'Or rewrite the method signature to IMPORTING + RETURNING only',
      ];
    case 'CLASS_NOT_RUNNABLE':
      return [`abap pull ${className} to verify it implements if_oo_adt_classrun`];
    case 'OBJECT_NOT_ACTIVE':
      return [`abap activate ${className}`, `abap inspect ${className} --activation`];
    case 'LOCAL_CLASS_NOT_RUNNABLE':
      return ['abap run must target a global class (no ~ in name)'];
    case 'WRAPPER_NOT_DEPLOYED':
      return ['abap deploy (installs ZCL_ABAP_VIBE_RUNNER)'];
    case 'WRAPPER_INPUT_UNAVAILABLE':
      return [
        'The target SAP system does not support classrun parameter injection',
        'Use `abap run <class>` (direct classrun, no --method) instead',
      ];
    case 'METHOD_FAILED':
      return [`abap inspect ${className} for signature`];
    case 'TIMEOUT':
      return [
        `Increase --timeout (current ${className ? 'value' : 'default'})`,
        'Check SAP SM51 for runaway processes',
      ];
    case 'OBJECT_NOT_FOUND':
      return [`abap search ${method ?? className}`];
    case 'AUTH_ERROR':
      return ['abap connection set <name> --password <new>'];
    case 'LOCKED':
      return ['abap activate <class> (releases locks after activation)', 'release manually in SE03'];
    default:
      return [`abap inspect ${className}`];
  }
}