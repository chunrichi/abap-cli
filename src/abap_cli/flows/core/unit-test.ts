/**
 * `abap test` flow — run ABAP Unit tests for one object.
 *
 * Resolves the object through the shared resolver, posts one ABAP Unit run
 * configuration to the ADT ABAP Unit endpoint
 * (`POST /sap/bc/adt/abapunit/testruns`, wrapped by
 * `AdtClientWrapper.unitTestRun`), then projects the raw `UnitTestClass[]`
 * into the agent-first shape printed by `commands/test.ts`.
 *
 * Output contract (token economy): the payload carries the run summary plus
 * the failure entries only — passing test methods are never listed one by
 * one. A failed assertion, an exception, or (under `--strict`) a warning
 * makes the run fail with `CliError('TEST_FAILED')`, keeping the exit channel
 * consistent with `abap check`.
 */
import type { UnitTestAlert, UnitTestClass, UnitTestRunFlags } from 'abap-adt-api';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { resolveObject } from '../../core/resolve.js';
import { CliError } from '../../output/json.js';

export type RiskLevel = 'harmless' | 'dangerous' | 'critical';
export type DurationLevel = 'short' | 'medium' | 'long';

/** Allowed risk levels, in the canonical order used for output. */
export const RISK_LEVELS: readonly RiskLevel[] = ['harmless', 'dangerous', 'critical'];
/** Allowed duration levels, in the canonical order used for output. */
export const DURATION_LEVELS: readonly DurationLevel[] = ['short', 'medium', 'long'];

const DEFAULT_RISK: readonly RiskLevel[] = ['harmless'];
const DEFAULT_DURATION: readonly DurationLevel[] = ['short'];

/**
 * ADT reports per-method `executionTime` in seconds (decimal). The output
 * contract exposes milliseconds, so values are scaled here.
 */
const SECONDS_TO_MS = 1000;

export interface UnitTestOptions {
  /** Optional ADT/TADIR type filter passed to object resolution (e.g. CLAS, PROG). */
  type?: string;
  /** Comma-separated risk levels. Defaults to `harmless`. */
  risk?: string;
  /** Comma-separated duration levels. Defaults to `short`. */
  duration?: string;
  /** Run every risk + duration level (instead of the defaults). */
  all?: boolean;
  /** Treat warning alerts as failures. */
  strict?: boolean;
}

/** One failing alert, flattened to the fields an agent acts on. */
export interface UnitTestFailure {
  /** Test class that owns the alert. */
  class: string;
  /** Test method; empty for class-level alerts. */
  method: string;
  /** Alert kind: failedAssertion | exception | warning. */
  kind: string;
  /** Alert severity as reported by SAP (critical / fatal / tolerable / tolerant). */
  severity: string;
  /** Short SAP alert title. */
  title: string;
  /** SAP detail lines (assertion message, exception text, …). */
  details: string[];
}

export interface UnitTestSummary {
  classes: number;
  methods: number;
  passed: number;
  failed: number;
  errored: number;
  durationMs: number;
}

export interface UnitTestData {
  object: { name: string; type: string };
  riskLevels: RiskLevel[];
  durations: DurationLevel[];
  summary: UnitTestSummary;
  failures: UnitTestFailure[];
}

/** Flow outcome: JSON envelope data + human summary, printed by the command layer. */
export interface UnitTestResult {
  data: UnitTestData;
  human: string;
}

/** Resolved level sets for one run. */
export interface ResolvedLevels {
  risk: RiskLevel[];
  duration: DurationLevel[];
}

/** Parse + validate the object positional (missing/blank → USAGE). */
export function validateObjectName(raw: string | undefined): string {
  const name = (raw ?? '').trim();
  if (name === '') {
    throw new CliError('USAGE', 'Object name is required', {
      nextSteps: ['Pass a class or program name, e.g. abap test ZCL_MY_THING.'],
      example: 'abap test ZCL_MY_THING --json',
    });
  }
  return name;
}

/** Parse one comma-separated level list against the allowed vocabulary. */
function parseLevels<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  fallback: readonly T[],
  flag: '--risk' | '--duration',
): T[] {
  if (raw === undefined) return [...fallback];
  const tokens = raw
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
  const example =
    flag === '--risk'
      ? 'abap test ZCL_MY_THING --risk harmless,dangerous --json'
      : 'abap test ZCL_MY_THING --duration short,medium --json';
  if (tokens.length === 0) {
    throw new CliError('INVALID_ARGUMENT', `${flag} requires at least one level`, {
      details: { allowedValues: [...allowed] },
      nextSteps: [`Pass one or more of: ${allowed.join(', ')}.`],
      example,
    });
  }
  const unknown = tokens.filter((token) => !(allowed as readonly string[]).includes(token));
  if (unknown.length > 0) {
    throw new CliError('INVALID_ARGUMENT', `${flag} has unknown level(s): ${unknown.join(', ')}`, {
      details: { allowedValues: [...allowed], unknown },
      nextSteps: [`Allowed levels: ${allowed.join(', ')}.`],
      example,
    });
  }
  return allowed.filter((level) => tokens.includes(level));
}

/** Parse `--risk` (comma-separated, case-insensitive). */
export function parseRiskLevels(raw: string | undefined): RiskLevel[] {
  return parseLevels(raw, RISK_LEVELS, DEFAULT_RISK, '--risk');
}

/** Parse `--duration` (comma-separated, case-insensitive). */
export function parseDurationLevels(raw: string | undefined): DurationLevel[] {
  return parseLevels(raw, DURATION_LEVELS, DEFAULT_DURATION, '--duration');
}

/**
 * Resolve the effective risk + duration levels: `--all` expands to the full
 * vocabulary, otherwise the per-flag selections apply. `--all` combined with
 * an explicit level flag is rejected so the run configuration stays
 * predictable.
 */
export function resolveLevels(
  opts: Pick<UnitTestOptions, 'risk' | 'duration' | 'all'> = {},
): ResolvedLevels {
  if (opts.all) {
    if (opts.risk !== undefined || opts.duration !== undefined) {
      throw new CliError('INVALID_ARGUMENT', '--all cannot be combined with --risk or --duration', {
        nextSteps: ['Use --all on its own to run every risk and duration level.'],
        example: 'abap test ZCL_MY_THING --all --json',
      });
    }
    return { risk: [...RISK_LEVELS], duration: [...DURATION_LEVELS] };
  }
  return { risk: parseRiskLevels(opts.risk), duration: parseDurationLevels(opts.duration) };
}

/** Map resolved level lists to the `abap-adt-api` run-configuration flags. */
export function buildRunFlags(risk: RiskLevel[], duration: DurationLevel[]): UnitTestRunFlags {
  return {
    harmless: risk.includes('harmless'),
    dangerous: risk.includes('dangerous'),
    critical: risk.includes('critical'),
    short: duration.includes('short'),
    medium: duration.includes('medium'),
    long: duration.includes('long'),
  };
}

/** True when the alert marks the run as failed (warnings only under `--strict`). */
function isFailureAlert(alert: UnitTestAlert, strict: boolean): boolean {
  if (alert.kind === 'failedAssertion' || alert.kind === 'exception') return true;
  return strict && alert.kind === 'warning';
}

function toFailure(className: string, methodName: string, alert: UnitTestAlert): UnitTestFailure {
  return {
    class: className,
    method: methodName,
    kind: String(alert.kind ?? ''),
    severity: String(alert.severity ?? ''),
    title: alert.title ?? '',
    details: Array.isArray(alert.details) ? alert.details : [],
  };
}

/**
 * Project the raw ABAP Unit result into the summary + failure list.
 *
 * Class-level alerts (no test method of their own) are counted once — as
 * errored when they carry an exception, otherwise as failed — and surface in
 * `failures` with an empty `method`.
 */
export function summarizeUnitTests(
  classes: readonly UnitTestClass[],
  strict: boolean,
): { summary: UnitTestSummary; failures: UnitTestFailure[] } {
  const failures: UnitTestFailure[] = [];
  let methods = 0;
  let passed = 0;
  let failed = 0;
  let errored = 0;
  let durationMs = 0;

  for (const testClass of classes) {
    const className = String(testClass['adtcore:name'] ?? '');
    const classAlerts = Array.isArray(testClass.alerts) ? testClass.alerts : [];
    const classFailures = classAlerts.filter((alert) => isFailureAlert(alert, strict));
    if (classFailures.length > 0) {
      if (classFailures.some((alert) => alert.kind === 'exception')) errored += 1;
      else failed += 1;
      for (const alert of classFailures) failures.push(toFailure(className, '', alert));
    }

    for (const testMethod of testClass.testmethods ?? []) {
      methods += 1;
      const methodName = String(testMethod['adtcore:name'] ?? '');
      const executionTime = Number(testMethod.executionTime);
      if (Number.isFinite(executionTime)) durationMs += executionTime * SECONDS_TO_MS;
      const alerts = Array.isArray(testMethod.alerts) ? testMethod.alerts : [];
      const methodFailures = alerts.filter((alert) => isFailureAlert(alert, strict));
      if (methodFailures.length === 0) {
        passed += 1;
        continue;
      }
      if (methodFailures.some((alert) => alert.kind === 'exception')) errored += 1;
      else failed += 1;
      for (const alert of methodFailures) failures.push(toFailure(className, methodName, alert));
    }
  }

  return {
    summary: { classes: classes.length, methods, passed, failed, errored, durationMs: Math.round(durationMs) },
    failures,
  };
}

/** Human-readable summary: one header line + one line per failure. */
export function humanUnitTestSummary(data: UnitTestData): string {
  const { summary } = data;
  const lines = [
    `ABAP Unit ${data.object.name} (${data.object.type}): ` +
      `${summary.classes} class(es), ${summary.methods} method(s), ` +
      `${summary.passed} passed, ${summary.failed} failed, ${summary.errored} errored; ` +
      `${summary.durationMs} ms`,
  ];
  for (const failure of data.failures) {
    const target = failure.method === '' ? failure.class : `${failure.class} > ${failure.method}`;
    const label = [failure.kind, failure.severity].filter((part) => part !== '').join('/');
    const title = failure.title === '' ? '' : ` ${failure.title}`;
    const detail = failure.details[0] ? `: ${failure.details[0]}` : '';
    lines.push(`  ${target} [${label}]${title}${detail}`);
  }
  return lines.join('\n');
}

/** Guidance for an ADT-side failure of the ABAP Unit endpoint. */
const ADT_NEXT_STEPS = [
  "Verify the system connection: 'abap doctor' (or 'abap profile test <name>').",
  'ABAP Unit uses the ADT endpoint /sap/bc/adt/abapunit/testruns; systems that do not expose it answer with SAP_ERROR.',
];

/**
 * Enrich a transport/endpoint failure of the ABAP Unit call with next steps.
 * Every other CliError (AUTH_ERROR, …) already carries its own guidance and
 * passes through untouched.
 */
function enrichUnitTestError(error: unknown, objectName: string): never {
  if (error instanceof CliError) {
    if (error.code !== 'SAP_ERROR') throw error;
    throw new CliError('SAP_ERROR', error.message, {
      details: { ...(error.details ?? {}), object: objectName },
      nextSteps: error.nextSteps ?? ADT_NEXT_STEPS,
      example: `abap test ${objectName} --json`,
      references: error.references,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  throw new CliError('SAP_ERROR', message, {
    details: { object: objectName },
    nextSteps: ADT_NEXT_STEPS,
    example: `abap test ${objectName} --json`,
  });
}

async function invokeUnitTestRun(
  adt: AdtClientWrapper,
  objectUrl: string,
  flags: UnitTestRunFlags,
  objectName: string,
): Promise<UnitTestClass[]> {
  try {
    return await adt.unitTestRun(objectUrl, flags);
  } catch (error: unknown) {
    enrichUnitTestError(error, objectName);
  }
}

/**
 * Run ABAP Unit for `objectName` and project the result.
 *
 * Pass a custom `client` for unit tests; production callers omit it and let
 * the wrapper create the ADT connection lazily.
 */
export async function runUnitTest(
  objectName: string | undefined,
  opts: UnitTestOptions = {},
  client?: AdtClientWrapper,
): Promise<UnitTestResult> {
  const name = validateObjectName(objectName);
  const { risk, duration } = resolveLevels(opts);
  const flags = buildRunFlags(risk, duration);

  const adt = client ?? (await AdtClientWrapper.create());
  const object = await resolveObject(adt, name, opts.type);
  const classes = await invokeUnitTestRun(adt, object.objectUrl, flags, name);

  const { summary, failures } = summarizeUnitTests(classes, Boolean(opts.strict));
  const data: UnitTestData = {
    object: { name: object.name, type: object.type },
    riskLevels: risk,
    durations: duration,
    summary,
    failures,
  };

  const failing = summary.failed + summary.errored;
  if (failing > 0) {
    throw new CliError(
      'TEST_FAILED',
      `${failing} failing test(s) for ${object.name} (${summary.classes} class(es), ${summary.methods} method(s))`,
      {
        details: { ...data },
        nextSteps: [
          'Read error.details.failures for the assertion / exception details.',
          'Run `abap test <object> --strict` to also treat warnings as failures.',
        ],
        example: `abap test ${object.name} --json`,
      },
    );
  }

  return { data, human: humanUnitTestSummary(data) };
}
