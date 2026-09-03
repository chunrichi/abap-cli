/**
 * AFF canonical JSON schema validator.
 *
 * Loads <type>-v1.json schemas from the local AFF mirror
 * (`tmp/abap-file-formats/file-formats/<type>/<type>-v1.json`),
 * compiles them with ajv v8 (Draft 2020-12 strict), caches the
 * resulting `ValidateFunction`, and exposes per-file validation
 * with structured error reporting.
 *
 * Schemas are loaded once, lazily on first use, then cached for
 * the process lifetime (Map<type, ValidateFunction>).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import Ajv2020Import from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';
import { CliError } from '../output/json.js';
import { schemaPathFor } from './schema-paths.js';

const AFF_MIRROR_ENV = 'ABAP_CLI_AFF_MIRROR';

/** Resolve the AFF mirror root (read-only local clone). */
function resolveMirrorRoot(): string {
  if (process.env[AFF_MIRROR_ENV]) return process.env[AFF_MIRROR_ENV]!;
  // Walk up from this file: src/abap_cli/aff/schema-validator.ts → repo root.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '..', '..', '..');
  return path.join(repoRoot, 'tmp', 'abap-file-formats', 'file-formats');
}

const MIRROR_ROOT = resolveMirrorRoot();

/**
 * ajv v8 ESM default-import interop: classes live on `.default`.
 * The Ajv2020 type is narrowed to a minimal struct so we can `new` it
 * without TypeScript losing its mind over ajv's package.json shape.
 */
interface AjvLike {
  compile(schema: object): ValidateFunction;
  addSchema(schema: object, key?: string): void;
  removeSchema(key: string | { key?: string }): void;
}
type AjvCtor = new (opts: Record<string, unknown>) => AjvLike;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Ajv2020 = (Ajv2020Import as any)?.default?.default ?? (Ajv2020Import as any)?.default ?? (Ajv2020Import as any)?.Ajv2020;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const addFormats = (addFormatsImport as any)?.default ?? addFormatsImport;

interface ErrorObject {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message?: string;
  params?: Record<string, unknown>;
}
interface ValidateFunction {
  (data: unknown): boolean;
  errors?: ErrorObject[] | null;
}
/** Single shared Ajv instance; schemas are added via .addSchema() and reused. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _ajv: any | undefined;

/** Cache key by resolved file path (not by type) so STRU / TABL share the
 *  same compiled validate function. The "type" parameter is still used
 *  for diagnostics and the cache key returned in ValidateResult. */
const _compiledByFile = new Map<string, ValidateFunction>();

/** Per-type validate-function cache. */
const _validateCache = new Map<string, ValidateFunction>();

/** Raw schema cache (path → parsed JSON) — avoids re-reading the file. */
const _schemaCache = new Map<string, unknown>();

function getAjv(): InstanceType<typeof Ajv2020> {
  if (!_ajv) {
    // strict:false — the official AFF schemas include vocab keywords like
    // `enumTitles`/`enumDescriptions` which are not in Draft 2020-12 standard.
    // We still validate Draft 2020-12 core keywords (anyOf/oneOf/if-then-else/
    // prefixItems/etc.); unknown vocab terms are silently ignored.
    _ajv = new Ajv2020({
      allErrors: true,
      strict: false,
      allowUnionTypes: false,
    });
    addFormats(_ajv);
  }
  return _ajv;
}

/** Load (and cache) the parsed schema JSON for a given type. */
export async function loadSchema(type: string): Promise<unknown> {
  const schemaPath = schemaPathFor(type, MIRROR_ROOT);
  const cached = _schemaCache.get(type);
  if (cached !== undefined) return cached;
  let raw: string;
  try {
    raw = await fs.readFile(schemaPath, 'utf8');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CliError(
      'AFF_SCHEMA_MISSING',
      `AFF schema not found for type "${type}"`,
      {
        details: { schemaPath, cause: msg },
        nextSteps: [
          `Verify that ${schemaPath} exists`,
          'If the AFF mirror is in a different location, set ABAP_CLI_AFF_MIRROR',
        ],
      },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CliError(
      'AFF_SCHEMA_INVALID',
      `AFF schema for type "${type}" is not valid JSON`,
      {
        details: { schemaPath, cause: msg },
        nextSteps: [`Inspect ${schemaPath} for syntax errors`],
      },
    );
  }
  _schemaCache.set(type, parsed);
  return parsed;
}

/** Compile (and cache) a validate function for the given type. */
export async function getValidate(type: string): Promise<ValidateFunction> {
  const cached = _validateCache.get(type);
  if (cached) return cached;
  const ajv = getAjv();
  const schema = await loadSchema(type);
  const schemaPathStr = schemaPathFor(type);
  const byFile = _compiledByFile.get(schemaPathStr);
  if (byFile) {
    _validateCache.set(type, byFile);
    return byFile;
  }
  let fn: ValidateFunction;
  try {
    fn = ajv.compile(schema as object);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CliError(
      'AFF_SCHEMA_COMPILE_ERROR',
      `Failed to compile AFF schema for type "${type}"`,
      { details: { cause: msg } },
    );
  }
  _validateCache.set(type, fn);
  _compiledByFile.set(schemaPathStr, fn);
  return fn;
}

export type ValidateStatus = 'pass' | 'fail' | 'warn';

export interface ValidateError {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message: string;
  params?: Record<string, unknown>;
}

export interface ValidateResult {
  type: string;
  filePath?: string;
  status: ValidateStatus;
  errors: ValidateError[];
  /** Schema-declared field names (set if the schema is an object with properties). */
  declaredFields?: string[];
  /** Extra top-level keys present in the document but not declared by the schema. */
  extraFields?: string[];
  /** Compile / load errors surface here with throwOnError=false callers. */
  fatal?: { code: string; message: string };
}

/** Collect top-level declared field names from an object schema (for WARN detection). */
function declaredTopLevel(schema: unknown): string[] | undefined {
  if (!schema || typeof schema !== 'object') return undefined;
  const props = (schema as Record<string, unknown>)['properties'];
  if (!props || typeof props !== 'object') return undefined;
  return Object.keys(props);
}

/** Convert ajv ErrorObject[] to our flat shape. */
function normalizeErrors(errs: ErrorObject[] | null | undefined): ValidateError[] {
  if (!errs) return [];
  return errs.map((e) => ({
    instancePath: e.instancePath,
    schemaPath: e.schemaPath,
    keyword: e.keyword,
    message: e.message ?? '',
    params: e.params,
  }));
}

/** Find top-level keys in the document that the schema did not declare. */
function findExtraFields(doc: unknown, declared: string[] | undefined): string[] | undefined {
  if (!declared || typeof doc !== 'object' || doc === null) return undefined;
  const obj = doc as Record<string, unknown>;
  const declaredSet = new Set(declared);
  const extras = Object.keys(obj).filter((k) => !declaredSet.has(k));
  return extras;
}

/** Detect whether the schema permits extra top-level fields. */
function schemaAllowsExtras(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') return false;
  const s = schema as Record<string, unknown>;
  if (s['additionalProperties'] === true) return true;
  if (typeof s['additionalProperties'] === 'object') return true;
  return false;
}

/**
 * Validate an in-memory document against the AFF schema for the given type.
 * Returns a structured ValidateResult; throws only on schema-load / compile
 * failures.
 */
export async function validateAff(type: string, doc: unknown): Promise<ValidateResult> {
  const schema = await loadSchema(type);
  const fn = await getValidate(type);
  const ok = fn(doc);
  const declared = declaredTopLevel(schema);
  const allowExtra = schemaAllowsExtras(schema);
  const result: ValidateResult = {
    type,
    status: ok ? 'pass' : 'fail',
    errors: ok ? [] : normalizeErrors(fn.errors),
    declaredFields: declared,
  };
  const extras = findExtraFields(doc, declared);
  if (extras && extras.length > 0) {
    result.extraFields = extras;
    if (allowExtra && result.status === 'pass') {
      result.status = 'warn';
    }
  }
  return result;
}

/**
 * Validate a JSON file against the AFF schema resolved for its filename.
 * `routeType` is the type-code inferred from the filename (router responsibility).
 */
export async function validateFile(
  filePath: string,
  routeType: string,
): Promise<ValidateResult> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      type: routeType,
      filePath,
      status: 'fail',
      errors: [
        {
          instancePath: '',
          schemaPath: '#/',
          keyword: 'file-read',
          message: `cannot read file: ${msg}`,
        },
      ],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      type: routeType,
      filePath,
      status: 'fail',
      errors: [
        {
          instancePath: '',
          schemaPath: '#/',
          keyword: 'json-parse',
          message: `invalid JSON: ${msg}`,
        },
      ],
    };
  }
  const result = await validateAff(routeType, parsed);
  return { ...result, filePath };
}

/** Format an error to a one-line `path/keyword: message` shape. */
export function formatError(e: ValidateError): string {
  const path = e.instancePath || '/';
  return `${path} ${e.keyword}: ${e.message}`;
}

/** Format a result for the human PASS/FAIL/WARN line. */
export function formatLine(r: ValidateResult): string {
  const where = r.filePath ?? `<${r.type}>`;
  if (r.status === 'pass') return `PASS ${where}`;
  if (r.status === 'warn')
    return `WARN ${where}: extra fields: ${(r.extraFields ?? []).join(', ')}`;
  const head = r.errors[0] ? formatError(r.errors[0]) : 'unspecified';
  const more = r.errors.length > 1 ? ` (+${r.errors.length - 1} more)` : '';
  return `FAIL ${where}: ${head}${more}`;
}

/** Reset all caches (used in tests). */
export function resetSchemaCache(): void {
  _validateCache.clear();
  _schemaCache.clear();
  _ajv = undefined;
}

export const __testing = { MIRROR_ROOT };
