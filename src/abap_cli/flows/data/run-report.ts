/**
 * `abap run-report <report>` — execute an activated REPORT and return its list
 * output (feedback F-16).
 *
 * ADT has no classrun equivalent for reports, so this goes through the bundled
 * ICF service (`POST /run/report`), which SUBMITs the report with default
 * selection values (`EXPORTING LIST TO MEMORY AND RETURN`) and converts the
 * captured list to text. That means:
 *   - the report runs with DEFAULT parameter values (no selection screen);
 *   - only list output is captured — a report that produces none (or that uses
 *     a GUI container control) fails with `REPORT_NO_LIST_OUTPUT`.
 *
 * Before this existed, verifying a delivered report meant copying its logic into
 * a throwaway `IF_OO_ADT_CLASSRUN` class, which drifts from the real report.
 */
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { IcfClient } from '../../clients/icf-client.js';

export interface RunReportOptions {
  /** Selection variant to use instead of plain defaults. */
  variant?: string;
}

export interface RunReportResult {
  report: string;
  variant?: string;
  /** Raw captured list, line by line (trailing blanks trimmed). */
  lines: string[];
  /** The same list joined with newlines — what a human would see. */
  output: string;
  lineCount: number;
  /** True when the capture hit the server-side line/character cap. */
  truncated: boolean;
  durationMs: number;
}

/** Response envelope of `POST /run/report`. */
interface RunReportWire {
  report: string;
  variant?: string;
  lines?: string[];
  output?: string;
  lineCount?: number;
  truncated?: boolean;
  durationMs?: number;
}

const KNOWN_CODES: ReadonlySet<string> = new Set([
  'REPORT_NOT_FOUND',
  'REPORT_NOT_EXECUTABLE',
  'REPORT_RUN_FAILED',
  'REPORT_NO_LIST_OUTPUT',
  'INVALID_ARGUMENT',
]);

function nextStepsFor(code: string, report: string): string[] {
  switch (code) {
    case 'REPORT_NOT_FOUND':
      return [
        `Verify the name: abap search ${report} --exact`,
        'The report must exist on the connected system and be activated.',
      ];
    case 'REPORT_NOT_EXECUTABLE':
      return [
        'Only executable programs (TRDIR subc = 1, i.e. an SE38 "report") can be run.',
        'Includes, module pools, class pools and function groups are not runnable.',
      ];
    case 'REPORT_NO_LIST_OUTPUT':
      return [
        'The report wrote no classic list output, or it uses an ALV/container control.',
        'Wrap the logic in a testable global class and use `abap run` instead.',
      ];
    default:
      return [
        'A report that needs mandatory selection parameters must be given a variant:',
        `abap run-report ${report} --variant <variant>`,
      ];
  }
}

/**
 * Run one report and shape the result. Throws `CliError` on a failed run.
 */
export async function runReport(
  report: string,
  opts: RunReportOptions = {},
  client?: IcfClient,
): Promise<RunReportResult> {
  const name = (report ?? '').trim().toUpperCase();
  if (!name) {
    throw new CliError('INVALID_ARGUMENT', 'A report name is required', {
      nextSteps: ['Pass the report name, e.g. `abap run-report ZR_MY_REPORT`.'],
      example: 'abap run-report ZR_MY_REPORT --json',
    });
  }
  if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(name)) {
    throw new CliError('INVALID_ARGUMENT', `'${report}' is not a valid report name`, {
      details: { report: name },
      nextSteps: ['Use the technical program name (letters, digits, underscore).'],
    });
  }

  const payload: Record<string, unknown> = { report: name };
  const variant = opts.variant?.trim().toUpperCase();
  if (variant) payload.variant = variant;

  const icf = client ?? (await IcfClient.create());
  const resp = await icf.post<RunReportWire>('/run/report', payload);

  if (resp.status === 'error' || !resp.data) {
    const rawCode = resp.error?.code ?? 'REPORT_RUN_FAILED';
    const code = (KNOWN_CODES.has(rawCode) ? rawCode : 'SAP_ERROR') as ErrorCode;
    throw new CliError(code, resp.error?.message ?? 'report run failed', {
      details: { report: name, ...(variant ? { variant } : {}), sapCode: rawCode },
      nextSteps: nextStepsFor(rawCode, name),
    });
  }

  const data = resp.data;
  const lines = Array.isArray(data.lines) ? data.lines : [];
  return {
    report: data.report ?? name,
    ...(data.variant ? { variant: data.variant } : {}),
    lines,
    output: data.output ?? lines.join('\n'),
    lineCount: data.lineCount ?? lines.length,
    truncated: data.truncated === true,
    durationMs: data.durationMs ?? 0,
  };
}

/** Human-readable rendering: the captured list, then a one-line summary. */
export function formatRunReportHuman(result: RunReportResult): string {
  const header = `Report ${result.report}${result.variant ? ` (variant ${result.variant})` : ''}: ${result.lineCount} line(s)`;
  const body = result.output.replace(/\n+$/, '');
  const footer = result.truncated ? '(output truncated by the server cap)' : '';
  return [header, body, footer].filter((s) => s !== '').join('\n');
}
