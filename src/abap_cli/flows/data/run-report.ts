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
  /**
   * S-4: ad-hoc selection-screen parameters, repeated as NAME=VALUE.
   * Forwarded to the ICF `/run/report` handler, which emits a
   * `SUBMIT ... WITH <name> = '<value>'` clause for each pair.
   *
   * Parameter NAME must match a `PARAMETERS` declaration in the report;
   * mismatched names return `REPORT_RUN_FAILED` from SAP.
   */
  params?: Array<{ name: string; value: string }>;
  /**
   * S-4: render the captured list in a machine-friendly format.
   *   - 'raw'  (default) — the SAP list output as-is (with `-----`
   *     separator bars and `|` column dividers).
   *   - 'tsv'  — tab-separated columns, one row per captured line,
   *     leading/trailing `|` stripped.
   *   - 'csv'  — same shape as TSV, comma-separated, with RFC-4180
   *     quoting for fields that contain commas / quotes / newlines.
   *
   * Server-side format stays 'raw'; the transformation is client-side
   * so callers can switch between formats without re-running the report.
   */
  format?: 'raw' | 'tsv' | 'csv';
}

export interface RunReportResult {
  report: string;
  variant?: string;
  /**
   * S-4: selection-screen parameters forwarded to SAP, in declaration
   * order. Empty when the caller did not pass `--param`.
   */
  params?: Array<{ name: string; value: string }>;
  /** Raw captured list, line by line (trailing blanks trimmed). */
  lines: string[];
  /** The same list joined with newlines — what a human would see. */
  output: string;
  /**
   * S-4: client-formatted rendering in the requested `--format`. When
   * `format` is omitted (or 'raw'), equals `output`. When 'tsv' or
   * 'csv', this is the column-extracted form and `output` keeps the
   * raw list verbatim for callers who want both.
   */
  formatted: string;
  /** The format that produced `formatted`. */
  format: 'raw' | 'tsv' | 'csv';
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

  // S-4: validate --param shape and forward to SAP.
  const paramList = normaliseParams(opts.params);
  const format = opts.format ?? 'raw';
  if (format !== 'raw' && format !== 'tsv' && format !== 'csv') {
    throw new CliError('INVALID_ARGUMENT', `--format must be 'raw', 'tsv', or 'csv' (got '${format}')`, {
      nextSteps: ['Drop --format for the default raw rendering, or pick one of raw / tsv / csv.'],
      example: 'abap run-report ZR_FOO --format tsv',
    });
  }

  const payload: Record<string, unknown> = { report: name };
  const variant = opts.variant?.trim().toUpperCase();
  if (variant) payload.variant = variant;
  if (paramList.length > 0) {
    payload.params = paramList.map((p) => ({ name: p.name, value: p.value }));
  }

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
  const output = data.output ?? lines.join('\n');
  const formatted = format === 'raw' ? output : renderListAsTable(lines, format);
  return {
    report: data.report ?? name,
    ...(data.variant ? { variant: data.variant } : {}),
    ...(paramList.length > 0 ? { params: paramList } : {}),
    lines,
    output,
    formatted,
    format,
    lineCount: data.lineCount ?? lines.length,
    truncated: data.truncated === true,
    durationMs: data.durationMs ?? 0,
  };
}

/**
 * Validate `--param` entries. Each must be NAME=VALUE with NAME matching
 * the SAP parameter name pattern and VALUE non-empty. Names are uppercased;
 * values are passed verbatim (the ABAP side is responsible for quoting).
 */
function normaliseParams(raw: RunReportOptions['params']): Array<{ name: string; value: string }> {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out: Array<{ name: string; value: string }> = [];
  for (const [i, p] of raw.entries()) {
    if (!p || typeof p.name !== 'string' || typeof p.value !== 'string') {
      throw new CliError('INVALID_ARGUMENT', `--param #${i + 1} must be { name, value }`, {
        nextSteps: ['Pass --param NAME=VALUE; the CLI parses it into the {name,value} shape.'],
        example: 'abap run-report ZR_FOO --param P_USERNAME=DEVELOPER',
      });
    }
    const name = p.name.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{0,29}$/.test(name)) {
      throw new CliError('INVALID_ARGUMENT', `--param #${i + 1} has invalid name '${p.name}'`, {
        details: { param: p },
        nextSteps: ['Parameter names: letters, digits, underscore; max 30 chars.'],
      });
    }
    if (p.value === '') {
      throw new CliError('INVALID_ARGUMENT', `--param #${i + 1} (${name}) has an empty value`, {
        nextSteps: ['Pass a non-empty value.'],
      });
    }
    out.push({ name, value: p.value });
  }
  return out;
}

/**
 * Convert the SAP list output into a tabular form.
 *
 * The SAP list is a free-form character grid: every captured line carries
 * a leading/trailing `|` and `-----` lines mark the column boundaries.
 * The simple-but-correct strategy used here:
 *
 *   1. Drop every line that starts with `|` followed by `-` characters
 *      (the horizontal separator bars).
 *   2. For each surviving line, trim the leading/trailing `|`, then split
 *      on `|` (multi-column lists have one cell per `|` segment).
 *   3. Trim each cell. If the line has exactly one cell (no `|`), the
 *      row is a single-column line and is emitted as a one-cell row.
 *
 * This handles the common ALV-rendered output (one row per captured
 * line with `|` separators) and ad-hoc WRITE:/ statements (one column
 * per line, no `|`). It does NOT try to recover nested lists or
 * mixed-width tables — those remain a `raw` rendering only.
 */
function renderListAsTable(lines: string[], format: 'tsv' | 'csv'): string {
  const sep = format === 'tsv' ? '\t' : ',';
  const out: string[] = [];
  for (const rawLine of lines) {
    const trimmed = rawLine.replace(/\s+$/g, '');
    // Drop separator bars (`|--------|...` and similar).
    if (/^\|[-\s|]+\|?$/.test(trimmed)) continue;
    let cells: string[];
    if (trimmed.startsWith('|')) {
      // Strip leading + trailing `|`, then split on `|`.
      const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
      cells = inner.split('|').map((c) => c.trim());
    } else if (trimmed.includes('|')) {
      // Some lines have `|` without the leading bar — split anyway.
      cells = trimmed.split('|').map((c) => c.trim());
    } else {
      // Single-cell row (e.g. WRITE:/ output).
      cells = [trimmed];
    }
    if (format === 'csv') {
      out.push(cells.map(escapeCsvCell).join(sep));
    } else {
      out.push(cells.join(sep));
    }
  }
  return out.join('\n');
}

/** RFC-4180 CSV cell escape. */
function escapeCsvCell(value: string): string {
  if (value === '') return '';
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Human-readable rendering: the captured list, then a one-line summary. */
export function formatRunReportHuman(result: RunReportResult): string {
  // Defensive: `formatted` and `format` are added in 0.2.9 (S-4). Older
  // tests and partial mocks may pass objects without them; treat the
  // missing fields as 'raw' / output.
  const format = (result as { format?: string }).format ?? 'raw';
  const formatted = (result as { formatted?: string }).formatted;
  const headerParts = [`Report ${result.report}`];
  if (result.variant) headerParts.push(`variant ${result.variant}`);
  if (result.params && result.params.length > 0) {
    headerParts.push(`params ${result.params.map((p) => `${p.name}=${p.value}`).join(', ')}`);
  }
  headerParts.push(`${result.lineCount} line(s)`);
  if (format !== 'raw') headerParts.push(`format=${format}`);
  const header = headerParts.join(': ');
  const body = (format === 'raw' || formatted === undefined ? result.output : formatted).replace(/\n+$/, '');
  const footer = result.truncated ? '(output truncated by the server cap)' : '';
  return [header, body, footer].filter((s) => s !== '').join('\n');
}
