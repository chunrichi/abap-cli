/**
 * Throw-on-fail wrapper around the AFF canonical schema validator.
 *
 * Replaces the manual `validateAff` + `formatError` dance that ad-hoc
 * callers were repeating before T1.5 (FUGR pull) and T2.2/T2.3 (HTTP/TRAN
 * ajv) wired it in. Pull/push call sites use `assertAffMetadata(type, doc)`
 * before writing a metadata file to disk; a schema mismatch surfaces as
 * `CliError('AFF_FIXTURE_INVALID', …)` so the exit-code map can map it to
 * VALIDATION_ERROR (exit 7).
 */
import { CliError } from '../output/json.js';
import { formatError, validateAff } from './schema-validator.js';

export interface AssertOptions {
  /** Override the schema file (used for TABL/STRU settings → tabt-v1.json). */
  schemaFile?: string;
  /** Caller-supplied file path / context used in error messages. */
  context?: string;
}

/**
 * Validate `doc` against the AFF canonical schema for `type`. Throws
 * `CliError('AFF_FIXTURE_INVALID')` on any validation failure or on
 * extra-field warnings (callers may opt into warn-only by catching the
 * error).
 */
export async function assertAffMetadata(
  type: string,
  doc: unknown,
  opts: AssertOptions = {},
): Promise<void> {
  const result = await validateAff(type, doc, opts.schemaFile);
  if (result.status === 'pass') return;
  const where = opts.context ?? `<${type}>`;
  const messages: string[] = [];
  if (result.status === 'fail') {
    for (const err of result.errors) messages.push(formatError(err));
  }
  if (result.extraFields && result.extraFields.length > 0) {
    messages.push(`extra fields: ${result.extraFields.join(', ')}`);
  }
  throw new CliError(
    'AFF_FIXTURE_INVALID',
    `AFF schema validation failed for ${where}: ${messages.join('; ')}`,
    {
      type,
      filePath: opts.context,
      schemaFile: opts.schemaFile,
      errors: result.errors,
      extraFields: result.extraFields,
    },
  );
}

/**
 * Return a copy of the document with CLI-only envelope fields removed, so
 * the AFF schema (which sets `additionalProperties: false` at the top level)
 * can validate the wire-shaped core. The CLI fields stripped are:
 *   - top-level: `name`, `package`, `transportRequest`
 *
 * Shared by HTTP (`http-v1.json`) and TRAN (`tran-v1.json`) validators,
 * both of which embed the same set of CLI-only transport fields alongside
 * the AFF-shaped core.
 */
export function stripCliEnvelope(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (k === 'name' || k === 'package' || k === 'transportRequest') continue;
    out[k] = v;
  }
  return out;
}
