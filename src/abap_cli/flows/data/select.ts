/**
 * `abap select` flow — read-only table data query.
 *
 * Consumes the `IcfClient.postDataQuery` HTTP method (which targets the
 * `/sap/zabap_vibe/data/query` endpoint on the deployed ICF service) and
 * shapes the response into a structured `SelectResult`. The SAP-side handler
 * owns query validation, where-clause parsing, and dynamic SQL execution; this
 * flow is responsible only for transport, error mapping, and CLI-friendly
 * shaping.
 *
 * Design conventions follow the established 015 `run-flow.ts` pattern:
 *   - `parseArgs`-style normalisers for option strings (with `CliError` on bad input)
 *   - `runSelect` is the main entry; pure `interpret` is exported for tests
 *   - Errors are mapped via a single table to `ErrorCode`
 *   - All side-effect-free paths (dry-run, build) are exported for the command layer
 */

import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { IcfClient } from '../../clients/icf-client.js';
import { getExtensionRegistry } from '../../extensions/registry.js';

/** SAP-side default for the wire protocol; capped at 10000 by the server. */
export const DEFAULT_LIMIT = 100;
/** SAP-side hard cap on row count; upper bound enforced by both CLI and server. */
export const LIMIT_MAX = 10000;
/** Maximum number of rows that can be skipped via --offset. */
export const OFFSET_MAX = 100000;
/** Maximum character length for the raw --where clause (server-side re-validated). */
export const WHERE_MAX_LENGTH = 2000;

/** Field-name regex reused by validateFields and validateOrderBy. */
const FIELD_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** ASC/DESC detector for order-by pairs. */
const DIRECTION_REGEX = /^(ASC|DESC)$/;

/**
 * Command-line request — what the user asked for on the CLI.
 * Used by both `runSelect` (when the response is unwrapped) and `buildDryRun`.
 */
export interface SelectRequest {
  table: string;
  fields?: string[];
  where?: string;
  limit: number;
  offset: number;
  orderBy?: { field: string; direction: 'ASC' | 'DESC' }[];
  countOnly: boolean;
  dryRun: boolean;
}

/**
 * Mid-flow options bag — what the commander layer hands to `runSelect`.
 * Bound by the CLI action before any SAP call is made.
 */
export interface SelectOptions {
  fields?: string;
  where?: string;
  limit?: number | string;
  offset?: number | string;
  orderBy?: string;
  countOnly?: boolean;
  dryRun?: boolean;
}

/** Rounded outcome from the SAP ICF `/data/query` endpoint. */
export interface SelectResult {
  table: string;
  objectType: 'TABL' | 'VIEW';
  fields: string[];
  /** Native typed cell values (string | number | boolean | null) — 017 Q1 B. */
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  count?: number;
  excludedFields: string[];
  orderBy?: { field: string; direction: 'ASC' | 'DESC' }[];
  offset: number;
  limit: number;
  countOnly: boolean;
  dryRun: boolean;
  durationMs: number;
  wouldRun?: boolean;
}

/** Wire shape that the ICF endpoint returns on success. */
interface DataQuerySuccess {
  table: string;
  objectType: 'TABL' | 'VIEW';
  fields?: string[];
  rows?: Record<string, unknown>[];
  rowCount?: number;
  truncated?: boolean;
  count?: number;
  excludedFields?: string[];
  durationMs?: number;
}

/** Wire shape that the ICF endpoint returns on failure. */
interface DataQueryError {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Parse the `--limit` commander value, applying the SAP-side cap. Used by
 * the commander layer for fail-fast validation; the SAP endpoint re-validates
 * and reports `LIMIT_EXCEEDED` if the CLI ever bypasses this check.
 */
export function validateLimit(raw: number | string | undefined): number {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_LIMIT;
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > LIMIT_MAX) {
    throw new CliError(
      'INVALID_ARGUMENT',
      `--limit must be an integer in [1, ${LIMIT_MAX}] (got '${String(raw)}')`,
      {
        nextSteps: [
          `Provide a value between 1 and ${LIMIT_MAX}`,
          `Default is ${DEFAULT_LIMIT} when --limit is omitted`,
        ],
      },
    );
  }
  return n;
}

/**
 * Parse the `--offset` commander value. Server-side cap is 100000.
 */
export function validateOffset(raw: number | string | undefined): number {
  if (raw === undefined || raw === null || raw === '') return 0;
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > OFFSET_MAX) {
    throw new CliError(
      'INVALID_ARGUMENT',
      `--offset must be an integer in [0, ${OFFSET_MAX}] (got '${String(raw)}')`,
      {
        nextSteps: [
          `Provide a value between 0 and ${OFFSET_MAX}`,
          'Default is 0 when --offset is omitted',
        ],
      },
    );
  }
  return n;
}

/**
 * Cheap length pre-check on the raw where clause so the CLI can fail fast
 * before any SAP call. The SAP endpoint re-validates syntax/field/types.
 */
export function validateWhere(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (raw.length > WHERE_MAX_LENGTH) {
    throw new CliError(
      'INVALID_ARGUMENT',
      `--where is too long (${raw.length} chars, max ${WHERE_MAX_LENGTH})`,
      {
        nextSteps: [`Shorten the where clause to ${WHERE_MAX_LENGTH} chars or less`],
      },
    );
  }
  return raw;
}

/**
 * Parse the `--fields` CSV. Each entry must match `^[A-Za-z_][A-Za-z0-9_]*$`.
 * Empty entries are rejected. Duplicates are dropped (preserving first occurrence).
 * The handler-side re-validates against the table's DDIC field list.
 */
export function validateFields(raw: string | undefined): string[] | undefined {
  if (raw === undefined || raw === null || raw.trim() === '') return undefined;
  const parts = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (!FIELD_NAME_REGEX.test(p)) {
      throw new CliError(
        'INVALID_ARGUMENT',
        `--fields entry '${p}' is invalid (must match ${FIELD_NAME_REGEX})`,
        {
          nextSteps: [
            'Field names start with a letter or underscore, then letters/digits/underscores',
            'Use `--fields "ID,AMOUNT"` for multiple fields',
          ],
        },
      );
    }
    const upper = p.toUpperCase();
    if (!seen.has(upper)) {
      seen.add(upper);
      out.push(upper);
    }
  }
  return out;
}

/**
 * Parse `--order-by` CSV of `FIELD:DIRECTION` pairs. Direction is normalised
 * to uppercase; anything other than ASC/DESC is rejected with INVALID_ARGUMENT.
 */
export function validateOrderBy(
  raw: string | undefined,
): { field: string; direction: 'ASC' | 'DESC' }[] | undefined {
  if (raw === undefined || raw === null || raw.trim() === '') return undefined;
  const parts = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0) return undefined;
  const out: { field: string; direction: 'ASC' | 'DESC' }[] = [];
  for (const p of parts) {
    const ix = p.indexOf(':');
    if (ix === -1) {
      throw new CliError(
        'INVALID_ARGUMENT',
        `--order-by pair '${p}' is missing ':' (expected FIELD:ASC or FIELD:DESC)`,
        { nextSteps: ['Use --order-by "ID:ASC,AMOUNT:DESC"'] },
      );
    }
    const field = p.slice(0, ix).trim();
    const direction = p.slice(ix + 1).trim().toUpperCase();
    if (!FIELD_NAME_REGEX.test(field)) {
      throw new CliError(
        'INVALID_ARGUMENT',
        `--order-by field '${field}' is invalid (must match ${FIELD_NAME_REGEX})`,
        { nextSteps: ['Field names start with a letter or underscore, then letters/digits/underscores'] },
      );
    }
    if (!DIRECTION_REGEX.test(direction)) {
      throw new CliError(
        'INVALID_ARGUMENT',
        `--order-by direction '${direction}' is invalid (expected ASC or DESC)`,
        { nextSteps: ['Use --order-by "FIELD:ASC" or "FIELD:DESC"'] },
      );
    }
    out.push({ field: field.toUpperCase(), direction: direction as 'ASC' | 'DESC' });
  }
  return out;
}

/** Compose a SelectRequest from the CLI options. Pure (no IO). */
export function buildSelectRequest(opts: SelectOptions): SelectRequest {
  const request: SelectRequest = {
    table: '', // filled by commander layer
    limit: validateLimit(opts.limit),
    offset: validateOffset(opts.offset),
    countOnly: opts.countOnly ?? false,
    dryRun: opts.dryRun ?? false,
  };
  const fields = validateFields(opts.fields);
  if (fields) request.fields = fields;
  const where = validateWhere(opts.where);
  if (where) request.where = where;
  const orderBy = validateOrderBy(opts.orderBy);
  if (orderBy) request.orderBy = orderBy;
  return request;
}

/** Translate the SelectRequest into the wire payload (camelCase). */
export function buildDataQueryRequest(req: SelectRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    table: req.table,
  };
  if (req.fields && req.fields.length > 0) payload.fields = req.fields;
  if (req.where) payload.where = req.where;
  if (req.orderBy && req.orderBy.length > 0) payload.orderBy = req.orderBy;
  if (req.countOnly) payload.countOnly = true;
  // limit and offset are always sent so the server doesn't have to default.
  payload.limit = req.limit;
  payload.offset = req.offset;
  return payload;
}

/** Compose the dry-run envelope (pure — no SAP call). */
export function buildDryRun(table: string, opts: SelectOptions): SelectResult {
  const req = buildSelectRequest(opts);
  req.table = table;
  return {
    table: req.table,
    objectType: 'TABL',
    fields: req.fields ?? [],
    rows: [],
    rowCount: 0,
    truncated: false,
    excludedFields: [],
    orderBy: req.orderBy,
    offset: req.offset,
    limit: req.limit,
    countOnly: req.countOnly,
    dryRun: true,
    durationMs: 0,
    wouldRun: true,
  };
}

/**
 * Map a wire error code to the CLI `ErrorCode` category. Unknown codes fall
 * back to `SAP_ERROR` per the spec.
 *
 * The endpoint's codes are the canonical ones (TABLE_NOT_FOUND, etc.).
 * Additional codes (INVALID_WHERE, LIMIT_EXCEEDED, OFFSET_EXCEEDED,
 * QUERY_FAILED) use the same mapping.
 */
function mapDataQueryCode(code: string | undefined): ErrorCode {
  switch (code) {
    case 'TABLE_NOT_FOUND':
      return 'TABLE_NOT_FOUND';
    case 'TABLE_TYPE_NOT_SUPPORTED':
    case 'INVALID_FIELD':
    case 'INVALID_WHERE':
    case 'LIMIT_EXCEEDED':
    case 'OFFSET_EXCEEDED':
      return code;
    case 'QUERY_FAILED':
      return 'QUERY_FAILED';
    case 'AUTH_ERROR':
      return 'AUTH_ERROR';
    case 'INVALID_ARGUMENT':
      return 'INVALID_ARGUMENT';
    default:
      return 'SAP_ERROR';
  }
}

/**
 * Format a nextSteps helper for the given error code. Centralised so the
 * command layer can keep its help text aligned with the wire contract.
 */
function nextStepsFor(code: ErrorCode): string[] {
  switch (code) {
    case 'TABLE_NOT_FOUND':
      return [
        'abap search <table> to verify the name exists',
        'abap pull <table> --type TABL to inspect the object',
      ];
    case 'TABLE_TYPE_NOT_SUPPORTED':
      return ['abap select only supports TABL (transparent) and VIEW (DDIC view)'];
    case 'INVALID_FIELD':
      return [
        'Use one of the fields listed in error.details.validFields',
        'Large-object fields (STRG/RSTR/LCHR/LRAW) are not supported for projection in v1',
      ];
    case 'INVALID_WHERE':
      return [
        'Where grammar: FIELD OP VALUE joined by AND',
        'Operators: = <> > >= < <= LIKE',
        'Numeric values for numeric fields; string literals in single quotes; dates as YYYYMMDD',
      ];
    case 'LIMIT_EXCEEDED':
      return [`--limit must be in [1, ${LIMIT_MAX}]`];
    case 'OFFSET_EXCEEDED':
      return [`--offset must be in [0, ${OFFSET_MAX}]`];
    case 'QUERY_FAILED':
      return [
        'The SAP side rejected the query at runtime',
        'Check the table is active: abap activate <table>',
      ];
    case 'AUTH_ERROR':
      return ['abap profile set <name> --password <new>'];
    default:
      return ['abap select --help for usage'];
  }
}

/**
 * Pure interpreter — translates a wire response into a SelectResult or
 * throws a CliError. Exported for unit testing.
 */
export function interpret(
  table: string,
  req: SelectRequest,
  wire: { status: 'success' | 'error'; data?: DataQuerySuccess | null; error?: DataQueryError | null },
  durationMs: number,
): SelectResult {
  if (wire.status === 'error' || !wire.data) {
    const err = wire.error ?? { code: 'UNKNOWN', message: 'ICF response missing data' };
    const code = mapDataQueryCode(err.code);
    const details: Record<string, unknown> = {
      table,
      ...(err.details && typeof err.details === 'object' && !Array.isArray(err.details)
        ? (err.details as Record<string, unknown>)
        : {}),
    };
    throw new CliError(code, err.message || `ICF ${code} response`, {
      details,
      nextSteps: nextStepsFor(code),
    });
  }
  const data = wire.data;
  if (req.countOnly) {
    // Count-only responses carry only the count (plus
    // table echo) — no rows / fields / truncated.
    return {
      table,
      objectType: data.objectType ?? 'TABL',
      count: data.count ?? 0,
      countOnly: true,
      dryRun: false,
      durationMs: Math.max(0, Math.round(durationMs)),
    } as SelectResult;
  }
  return {
    table,
    objectType: data.objectType ?? 'TABL',
    fields: data.fields ?? [],
    rows: data.rows ?? [],
    rowCount: data.rowCount ?? (data.rows ?? []).length,
    truncated: data.truncated ?? false,
    excludedFields: data.excludedFields ?? [],
    orderBy: req.orderBy,
    offset: req.offset,
    limit: req.limit,
    countOnly: false,
    dryRun: false,
    durationMs: Math.max(0, Math.round(durationMs)),
  };
}

/**
 * Main entry — invoke the ICF `/data/query` endpoint and shape the result.
 * Throws `INVALID_ARGUMENT` for CLI-side validation failures (limit/offset
 * bounds, where length, CSV structure).
 */
export async function runSelect(
  table: string,
  opts: SelectOptions,
  client?: IcfClient,
): Promise<SelectResult> {
  if (!table || table.trim() === '') {
    throw new CliError('INVALID_ARGUMENT', '--table is required', {
      nextSteps: ['Specify a table or view name, e.g. --table ZTAB_FIXTURE'],
    });
  }
  const req = buildSelectRequest(opts);
  req.table = table.toUpperCase();
  const wire = buildDataQueryRequest(req);
  const icf = client ?? (await IcfClient.create());

  // ValidationRule hook
  await getExtensionRegistry().runValidation('select', {
    command: 'select',
    argv: process.argv.slice(2),
    payload: req,
  });

  const t0 = performance.now();
  const resp = await icf.postDataQuery<{
    table: string;
    objectType: 'TABL' | 'VIEW';
    fields?: string[];
    rows?: Record<string, string>[];
    rowCount?: number;
    truncated?: boolean;
    count?: number;
    excludedFields?: string[];
    durationMs?: number;
  }>(wire);
  const t1 = performance.now();
  return interpret(req.table, req, resp, t1 - t0);
}
