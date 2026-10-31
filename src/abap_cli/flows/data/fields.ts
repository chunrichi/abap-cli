/**
 * `abap fields` — read-only field inventory for tables and views.
 *
 * Two modes:
 *   abap fields <table>                 list the fields of a single table (F-25)
 * abap fields --find <fields...> reverse field lookup
 *
 * Both modes share a single SAP-side helper (the existing /data/query
 * channel plus the new /data/find-tables-by-fields endpoint added in
 * 0.2.9). Reverse-lookup was the single most-missed capability in the
 * field report: before it existed, finding "which tables record the
 * last-changed user + date" required manually probing 20+ table names
 * (verified against vhcala4hci A4H).
 *
 * Reverse lookup is implemented by a single SELECT over DD03L joined to
 * DD02L (TABCLASS); the cost is O(matching DD03L rows) instead of
 * O(tables × fields). The hard cap on `limit` (5000) protects against
 * pathological fan-out — searching for `MANDT` alone would return every
 * client-dependent table.
 */
import { CliError } from '../../output/json.js';
import { IcfClient } from '../../clients/icf-client.js';
import { runSelect } from './select.js';

export interface FieldInfo {
  /** Field name (DD03L-FIELDNAME). */
  field: string;
  /** 1-based position inside the table (DD03L-POSITION). */
  position: number;
  /** Part of the primary key (DD03L-KEYFLAG). */
  key: boolean;
  /** Initial values are not allowed (DD03L-NOTNULL). */
  notNull: boolean;
  /** Underlying data element, when the field is not built-in typed. */
  rollname?: string;
  /** DDIC data type (CHAR, INT4, DATS, RAWSTRING, …). */
  dataType?: string;
  /** Field length in characters/bytes as declared in DDIC. */
  length?: number;
  /** Decimal places for packed/currency/quantity types. */
  decimals?: number;
}

export interface FieldsResult {
  table: string;
  count: number;
  fields: FieldInfo[];
  /** True when DD03L held more entries than the query returned (defensive). */
  truncated: boolean;
}

/** DDIC object names: letters, digits, underscore; must not start with a digit. */
const TABLE_NAME = /^[A-Z][A-Z0-9_]{0,29}$/;
/** DDIC field names are limited to 30 chars as well. */
const FIELD_NAME = /^[A-Z][A-Z0-9_]{0,29}$/;

/** Hard cap on --find input. Matches the SAP-side cap in lcl_fields. */
const FIND_MAX_FIELDS = 20;

/**
 * List the fields of `table` by reading DD03L.
 *
 * The table name is validated locally (and again server-side by the ICF
 * handler) before it is embedded in the DD03L filter, so the query cannot be
 * used to inject SQL.
 */
export async function runFields(table: string): Promise<FieldsResult> {
  const name = (table ?? '').trim().toUpperCase();
  if (!name) {
    throw new CliError('INVALID_ARGUMENT', 'A table or view name is required', {
      nextSteps: ['Pass the object name, e.g. `abap fields VRSD`.'],
      example: 'abap fields VRSD --json',
    });
  }
  if (!TABLE_NAME.test(name)) {
    throw new CliError('INVALID_ARGUMENT', `'${table}' is not a valid DDIC object name`, {
      details: { table: name },
      nextSteps: ['Use the technical name (letters, digits, underscore; max 30 characters).'],
      example: 'abap fields VRSD --json',
    });
  }

  const result = await runSelect('DD03L', {
    fields: 'FIELDNAME,POSITION,KEYFLAG,ROLLNAME,DATATYPE,LENG,DECIMALS,NOTNULL',
    where: `TABNAME = '${name}'`,
    orderBy: 'POSITION:ASC',
    // A table cannot have more than 10000 fields; this also makes truncation
    // detectable rather than silent.
    limit: 10000,
  });

  if (result.rows.length === 0) {
    throw new CliError('OBJECT_NOT_FOUND', `Table or view ${name} has no DDIC field list (does it exist?)`, {
      object: name,
      nextSteps: [
        `Verify the name: abap search ${name} --exact`,
        'DD03L holds fields for transparent tables, pool/cluster tables and views.',
      ],
    });
  }

  return {
    table: name,
    count: result.rows.length,
    fields: result.rows.map(toFieldInfo),
    truncated: result.truncated === true,
  };
}

export interface FindFieldsOptions {
  fields: string[];
  /** Default true — every field must be present in the table. */
  requireAll?: boolean;
  /** Filter to a specific DDIC tabclass (TRANSP / VIEW / INTTAB / ...). */
  tabclass?: string;
  /** Default 'A' — only active DDIC version. */
  as4local?: string;
  /** Default 200, hard cap 5000. */
  limit?: number;
  /** when true, server joins DD03T/DD04T to populate field/element
   *  short text on each match. Default false (one-shot opt-in; the join
   *  adds ~2 left-queries per match set and most callers only want names). */
  withText?: boolean;
}

export interface FindMatchField {
  name: string;
  rollname?: string;
  position: number;
  /** DD03T — per-table field short text (only when --with-text is set). */
  fieldText?: string;
  /** DD04T — data element short text (only when --with-text is set). */
  elementText?: string;
}

export interface FindMatchTable {
  table: string;
  tabclass?: string;
  /** Number of requested fields this table contains (≤ requested count). */
  hitCount: number;
  /** Field info for the matched fields. */
  fields: FindMatchField[];
}

export interface FindTablesResult {
  /** Total matching tables (after mode filtering, before truncation). */
  total: number;
  /** True when result was truncated by `limit`. */
  truncated: boolean;
  /** 'all' (every requested field present) or 'any' (at least one). */
  mode: 'all' | 'any';
  /** Number of fields the user asked for. */
  requestedCount: number;
  matches: FindMatchTable[];
}

/**
 * Reverse field lookup — "which tables contain <fields>?".
 *
 * Validates inputs locally, then delegates to the dedicated SAP-side
 * endpoint /data/find-tables-by-fields (lcl_fields in the ICF handler).
 *
 * The mode flag controls whether the table must contain ALL requested
 * fields (`requireAll: true`, default) or ANY (`requireAll: false`).
 */
export async function runFindTablesByFields(opts: FindFieldsOptions): Promise<FindTablesResult> {
  if (!Array.isArray(opts.fields) || opts.fields.length === 0) {
    throw new CliError('INVALID_ARGUMENT', 'At least one field name is required for --find', {
      nextSteps: ['Pass the field names as positional arguments or `--find <name1>,<name2>,...`.'],
      examples: ['abap fields --find CHANGED_BY,CHANGED_ON', 'abap fields --find UNAM UDAT UTIME'],
    });
  }

  // Normalize: uppercase, strip blanks. Reject anything that is not a
  // legal DDIC field name so the SAP-side parser does not reject a
  // caller-side typo with a misleading INVALID_ARGUMENT.
  const cleaned: string[] = [];
  for (const raw of opts.fields) {
    const upper = String(raw ?? '').trim().toUpperCase();
    if (!upper) continue;
    if (!FIELD_NAME.test(upper)) {
      throw new CliError('INVALID_ARGUMENT', `Field name '${raw}' is not a valid DDIC identifier`, {
        details: { field: raw },
        nextSteps: ['Use the technical name (letters, digits, underscore; max 30 characters).'],
        example: 'abap fields --find CHANGED_BY,CHANGED_ON',
      });
    }
    cleaned.push(upper);
  }
  if (cleaned.length === 0) {
    throw new CliError('INVALID_ARGUMENT', '--find must contain at least one valid field name', {
      example: 'abap fields --find CHANGED_BY,CHANGED_ON',
    });
  }
  if (cleaned.length > FIND_MAX_FIELDS) {
    throw new CliError('LIMIT_EXCEEDED', `At most ${FIND_MAX_FIELDS} fields per --find request`, {
      details: { requested: cleaned.length, max: FIND_MAX_FIELDS },
      nextSteps: ['Split into multiple narrower requests.'],
    });
  }

  const limit = clampLimit(opts.limit);
  const client = await IcfClient.create();
  // `IcfClient.post*` resolves with the full envelope `{status,data,error}`.
  // The data payload is the inner `{total,truncated,mode,matches}` object the
  // SAP-side lcl_fields returns. We type the generic accordingly so the
  // compiler enforces the shape.
  const response = await client.postFindTablesByFields<{
    total: number;
    truncated: boolean;
    mode: 'all' | 'any';
    matches: Array<{
      table: string;
      tabclass?: string;
      hitCount: number;
      fields: Array<{
        name: string;
        rollname?: string;
        position: number;
        fieldText?: string;
        elementText?: string;
      }>;
    }>;
  }>({
    fields: cleaned,
    requireAll: opts.requireAll !== false, // default true
    ...(opts.tabclass ? { tabclass: opts.tabclass } : {}),
    as4local: opts.as4local ?? 'A',
    limit,
    includeText: opts.withText === true,
  });

  if (!response.data) {
    // The ICF wrapper already converts non-2xx responses to a thrown CliError,
    // so a missing payload means the endpoint returned 2xx with no body —
    // surface as a query failure rather than swallowing silently.
    throw new CliError('QUERY_FAILED', 'SAP returned an empty payload for /data/find-tables-by-fields', {
      details: { fields: cleaned, limit },
    });
  }

  const payload = response.data;
  return {
    total: payload.total ?? 0,
    truncated: payload.truncated ?? false,
    mode: (payload.mode ?? 'all') as 'all' | 'any',
    requestedCount: cleaned.length,
    matches: (payload.matches ?? []).map((m) => ({
      table: m.table,
      tabclass: m.tabclass,
      hitCount: m.hitCount,
      fields: (m.fields ?? []).map((f) => {
        const out: FindMatchField = { name: f.name, position: f.position };
        if (typeof f.rollname === 'string' && f.rollname.trim() !== '') out.rollname = f.rollname;
        if (typeof f.fieldText === 'string' && f.fieldText.trim() !== '') out.fieldText = f.fieldText;
        if (typeof f.elementText === 'string' && f.elementText.trim() !== '') out.elementText = f.elementText;
        return out;
      }),
    })),
  };
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return 200;
  if (!Number.isFinite(limit) || limit < 1) return 1;
  if (limit > 5000) return 5000;
  return Math.floor(limit);
}

function toFieldInfo(row: Record<string, unknown>): FieldInfo {
  const info: FieldInfo = {
    field: String(row['FIELDNAME'] ?? ''),
    position: Number(row['POSITION'] ?? 0),
    key: String(row['KEYFLAG'] ?? '') === 'X',
    notNull: String(row['NOTNULL'] ?? '') === 'X',
  };
  const rollname = row['ROLLNAME'];
  if (typeof rollname === 'string' && rollname.trim() !== '') info.rollname = rollname;
  const dataType = row['DATATYPE'];
  if (typeof dataType === 'string' && dataType.trim() !== '') info.dataType = dataType;
  const length = Number(row['LENG']);
  if (Number.isFinite(length)) info.length = length;
  const decimals = Number(row['DECIMALS']);
  if (Number.isFinite(decimals) && decimals > 0) info.decimals = decimals;
  return info;
}

/** Human-readable rendering of a field inventory. */
export function formatFieldsHuman(result: FieldsResult): string {
  const lines = [`${result.table} — ${result.count} field(s)`];
  for (const f of result.fields) {
    const type = [f.dataType, f.length !== undefined ? `(${f.length}${f.decimals ? `,${f.decimals}` : ''})` : '']
      .filter(Boolean)
      .join('');
    lines.push(
      `  ${String(f.position).padStart(4)} ${f.key ? 'K' : ' '} ${f.field.padEnd(30)} ${type}` +
        (f.rollname ? `  ${f.rollname}` : ''),
    );
  }
  return lines.join('\n');
}

/** Human-readable rendering of a --find result. */
export function formatFindHuman(result: FindTablesResult): string {
  if (result.matches.length === 0) {
    return `No tables contain ${result.requestedCount === 1 ? 'this field' : 'these fields'} (mode=${result.mode}).`;
  }
  const header = [
    `${result.matches.length} matching table(s)`,
    `mode=${result.mode}`,
    `requested=${result.requestedCount}`,
    result.truncated ? `[truncated — total ${result.total}]` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const lines = [header];
  for (const m of result.matches) {
    lines.push(`  ${(m.tabclass ?? '?').padEnd(8)} ${m.table.padEnd(34)} ${m.hitCount}/${result.requestedCount} hit(s)`);
    for (const f of m.fields) {
      // When --with-text is set, surface the fieldText (preferred) or
      // elementText as a trailing annotation. The data element name
      // (rollname) is omitted in that case to keep lines compact; the
      // text describes the field directly.
      const text = f.fieldText ?? f.elementText;
      if (text) {
        lines.push(`      ${String(f.position).padStart(4)} ${f.name.padEnd(30)}  ${text}`);
      } else {
        lines.push(`      ${String(f.position).padStart(4)} ${f.name.padEnd(30)}${f.rollname ? '  ' + f.rollname : ''}`);
      }
    }
  }
  return lines.join('\n');
}