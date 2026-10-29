/**
 * AFF canonical JSON schema validator.
 *
 * Loads `<type>-v1.json` schemas (see `src/abap_cli/schema/`) and
 * compiles them with ajv v8 (Draft 2020-12 strict). The schema root
 * is resolved by `schema-paths.ts#resolveMirrorRoot` with priority
 * env → bundled → legacy `tmp/` mirror.
 *
 * Schemas are loaded once, lazily on first use, then cached for
 * the process lifetime in a single `Map<resolvedSchemaPath, ValidateFunction>`.
 * The cache key is the absolute schema file path (not the type code), so
 * types that share a schema file (e.g. TABL / STRU both use `tabl-v1.json`)
 * automatically share the compiled validator.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import Ajv2020Import from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';
import { CliError } from '../output/json.js';
import { schemaPathFor, resolveMirrorRoot } from './schema-paths.js';

const MIRROR_ROOT = resolveMirrorRoot().root;

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

/**
 * Single compiled-validator cache, keyed by the absolute resolved schema path.
 *
 * Why one Map instead of three:
 *  - The cache key is the *file path* (not the type code), so types sharing a
 *    schema file (TABL/STRU → `tabl-v1.json`) automatically share the compiled
 *    function. A separate per-type cache would double-compile in that case.
 *  - The raw parsed schema is derivable from the compiled validator when needed
 *    (and only `loadSchema` callers need the raw shape), so we store the raw
 *    schema + compiled function as a small entry — but the entry is keyed by
 *    the same single path key, so there is exactly one Map.
 *  - The mirror-resolution priority (env → bundled → legacy) lives in
 *    `schema-paths.ts` and is unchanged; we just stop caching in three places.
 */
interface CompiledEntry {
  /** Raw parsed schema (kept so loadSchema callers do not re-read the file). */
  schema: unknown;
  /** Compiled ajv validator. */
  fn: ValidateFunction;
}
const _compiled = new Map<string, CompiledEntry>();

/** In-flight compile promises keyed by file path. Prevents two concurrent
 *  callers from racing the same compile. Resolves with the CompiledEntry. */
const _inflight = new Map<string, Promise<CompiledEntry>>();

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

/** Resolve + load + compile the schema for a type, returning the cached entry.
 *  All read paths funnel through this so the single Map stays consistent. */
async function ensureCompiled(type: string, schemaFileOverride?: string): Promise<CompiledEntry> {
  // The cache key is the resolved schema path. Resolving it here (instead of
  // inside loadSchema) lets us serve the cache without going through the
  // mirror-resolution priority chain twice.
  const schemaPath = schemaPathFor(type, MIRROR_ROOT, schemaFileOverride);
  const cached = _compiled.get(schemaPath);
  if (cached) return cached;

  // Coalesce concurrent compiles of the same schema.
  const pending = _inflight.get(schemaPath);
  if (pending) return pending;

  const promise = (async (): Promise<CompiledEntry> => {
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
    const ajv = getAjv();
    let fn: ValidateFunction;
    try {
      fn = ajv.compile(parsed as object);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new CliError(
        'AFF_SCHEMA_COMPILE_ERROR',
        `Failed to compile AFF schema for type "${type}"`,
        { details: { cause: msg } },
      );
    }
    const entry: CompiledEntry = { schema: parsed, fn };
    _compiled.set(schemaPath, entry);
    return entry;
  })();
  _inflight.set(schemaPath, promise);
  try {
    return await promise;
  } finally {
    _inflight.delete(schemaPath);
  }
}

/** Load (and cache) the parsed schema JSON for a given type. */
export async function loadSchema(type: string, schemaFileOverride?: string): Promise<unknown> {
  const entry = await ensureCompiled(type, schemaFileOverride);
  return entry.schema;
}

/** Compile (and cache) a validate function for the given type. */
export async function getValidate(type: string, schemaFileOverride?: string): Promise<ValidateFunction> {
  const entry = await ensureCompiled(type, schemaFileOverride);
  return entry.fn;
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
export async function validateAff(
  type: string,
  doc: unknown,
  schemaFileOverride?: string,
): Promise<ValidateResult> {
  const schema = await loadSchema(type, schemaFileOverride);
  const fn = await getValidate(type, schemaFileOverride);
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
 * `schemaFile` overrides the default schema filename when set (used for
 * TABL/STRU `.settings.json` → `tabt-v1.json`).
 */
export async function validateFile(
  filePath: string,
  routeType: string,
  schemaFile?: string,
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
  const result = await validateAff(routeType, parsed, schemaFile);
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
  _compiled.clear();
  _inflight.clear();
  _ajv = undefined;
}

/**
 * Synchronous AFF metadata validator.
 *
 * Returns a flat array of human-readable error strings (empty when valid).
 * HTTP/TRAN metadata callers can use the validator from sync hot paths
 * (e.g. `writeHttpService` before writing to disk) without going through
 * `validateAff`'s async / result-object shape.
 *
 * Lazy-compiles the schema on first call via synchronous `fs.readFileSync` +
 * `ajv.compile`, then caches in the same single Map used by `validateAff`.
 *
 * Concurrency note: this function and the async `ensureCompiled` both write
 * to `_compiled`. In Node.js the event-loop model makes the overlap narrow
 * (the sync path cannot interleave with itself, and a sync compile runs
 * to completion before any pending microtask resumes), so the worst-case
 * outcome is "schema is compiled twice on first use" — a one-time cost,
 * not a correctness issue. Tests can `resetSchemaCache()` to force a clean
 * re-compile.
 */
export function validateAffMetadata(type: string, value: unknown): string[] {
  const schemaPath = schemaPathFor(type, MIRROR_ROOT);
  let entry = _compiled.get(schemaPath);
  if (!entry) {
    // Sync compile path. Read the schema file synchronously and compile.
    // This path is rare (cold start); the typical case hits the cache.
    let raw: string;
    try {
      raw = fsSync.readFileSync(schemaPath, 'utf8');
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
    const ajv = getAjv();
    let fn: ValidateFunction;
    try {
      fn = ajv.compile(parsed as object);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new CliError(
        'AFF_SCHEMA_COMPILE_ERROR',
        `Failed to compile AFF schema for type "${type}"`,
        { details: { cause: msg } },
      );
    }
    entry = { schema: parsed, fn };
    _compiled.set(schemaPath, entry);
  }
  const ok = entry.fn(value);
  if (ok) return [];
  return (entry.fn.errors ?? []).map((e) => {
    const location = e.instancePath || '$';
    if (e.keyword === 'additionalProperties' && typeof e.params?.additionalProperty === 'string') {
      return `${location}: additional property '${e.params.additionalProperty}' is not allowed`;
    }
    return `${location}: ${e.message ?? e.keyword}`;
  });
}

export const __testing = { MIRROR_ROOT };
