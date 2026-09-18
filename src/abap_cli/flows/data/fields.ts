/**
 * `abap fields <table>` — read-only field inventory for a table or view.
 *
 * This was the single most-missed capability in the field report: there was no
 * command that could answer "which fields does this table have?", so data
 * sources were chosen from memory and entire reports were built on wrong field
 * names (feedback F-25). `abap pull <table> --type TABL` was not a substitute —
 * it fails on tables with a `rawstring` column.
 *
 * Implemented on top of the existing `/data/query` channel by reading DD03L (the
 * DDIC field list). That only became possible once the bundled ICF handler
 * stopped typing numeric columns as CHAR (feedback F-10 / F-26); a dedicated
 * server endpoint is therefore not required and this command works against any
 * already-deployed service.
 */
import { CliError } from '../../output/json.js';
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
