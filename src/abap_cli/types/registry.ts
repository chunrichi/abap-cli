/**
 * Single source of truth for supported object types.
 *
 * Replaces three legacy registries:
 *   - formats/type-folder.ts#TYPE_FOLDER (type → subdirectory)
 *   - flows/create-types.ts#TYPE_MAP (type → ADT objtype for source objects)
 *   - formats/{ddic,http,transport}/json.ts#*_SUPPORTED_TYPES (DDIC/ICF type sets)
 *
 * Principle V: Refactor Fearlessly — older modules are migrated to re-export
 * from this registry (T046-T050) before deletion, leaving no compatibility
 * wrapper behind.
 */

export type ObjectSource = 'ADT' | 'ICF';

export interface ObjectTypeEntry {
  /** User-facing type code (uppercase, e.g. "CLAS", "TABL"). */
  type: string;
  /** Subdirectory under rootDir for local artifacts. */
  folder: string;
  /** Routing strategy for SAP communication. */
  source: ObjectSource;
  /** ADT objtype for source objects (CLAS/INTF/PROG/FUGR); undefined for DDIC/HTTP/TRAN. */
  createObjtype?: string;
  /**
   * AFF schema filename (relative to mirror root/<type>/). Default: `<type>-v1.json`.
   * STRU records `tabl-v1.json` to share the TABL schema (spec 018 / spec 033).
   * Optional here because the registry predates the validator; populated lazily.
   */
  affSchemaFile?: string;
}

/** Single registry; iterated in `allSupportedTypes()` for deterministic order. */
export const TYPE_REGISTRY: readonly ObjectTypeEntry[] = [
  // Source objects (ADT)
  { type: 'CLAS', folder: 'clas', source: 'ADT', createObjtype: 'CLAS/OC', affSchemaFile: 'clas-v1.json' },
  { type: 'INTF', folder: 'intf', source: 'ADT', createObjtype: 'INTF/OI', affSchemaFile: 'intf-v1.json' },
  { type: 'PROG', folder: 'prog', source: 'ADT', createObjtype: 'PROG/P', affSchemaFile: 'prog-v1.json' },
  { type: 'FUGR', folder: 'fugr', source: 'ADT', createObjtype: 'FUGR/F', affSchemaFile: 'fugr-v1.json' },
  // DDIC objects (ICF) — STRU reuses TABL's schema (spec 018 / spec 033 US5).
  { type: 'TABL', folder: 'tabl', source: 'ICF', affSchemaFile: 'tabl-v1.json' },
  { type: 'STRU', folder: 'stru', source: 'ICF', affSchemaFile: 'tabl-v1.json' },
  { type: 'DOMA', folder: 'doma', source: 'ICF', affSchemaFile: 'doma-v1.json' },
  { type: 'DTEL', folder: 'dtel', source: 'ICF', affSchemaFile: 'dtel-v1.json' },
  // HTTP service (SICF node) via ICF
  { type: 'HTTP', folder: 'http', source: 'ICF', affSchemaFile: 'http-v1.json' },
  // Transaction code (SE93) via ICF
  { type: 'TRAN', folder: 'tran', source: 'ICF', affSchemaFile: 'tran-v1.json' },
] as const;

const DEFAULT_FOLDER = 'unknown';
const INDEX: Record<string, ObjectTypeEntry> = Object.fromEntries(
  TYPE_REGISTRY.map((e) => [e.type, e]),
);

/** Resolve the subdirectory name for an object type. Case-insensitive. */
export function folderFor(type: string): string {
  const primary = type.split('/')[0]!.toUpperCase();
  return INDEX[primary]?.folder ?? DEFAULT_FOLDER;
}

/** Resolve the ADT objtype for create (source objects only). */
export function createObjtypeFor(type: string): string | undefined {
  const primary = type.split('/')[0]!.toUpperCase();
  return INDEX[primary]?.createObjtype;
}

/** Resolve the routing strategy (ADT or ICF). */
export function sourceFor(type: string): ObjectSource | undefined {
  const primary = type.split('/')[0]!.toUpperCase();
  return INDEX[primary]?.source;
}

/** Whether the given type is one of the 10 supported types. */
export function isSupportedType(type: string): boolean {
  const primary = type.split('/')[0]!.toUpperCase();
  return primary in INDEX;
}

/** Return all supported type codes (uppercase, in registry order). */
export function allSupportedTypes(): string[] {
  return TYPE_REGISTRY.map((e) => e.type);
}

/** DDIC types (TABL/STRU/DOMA/DTEL) subset — single source of truth (US11, T048). */
export const DDIC_TYPES = ['DOMA', 'DTEL', 'TABL', 'STRU'] as const;
/** Legacy name retained for back-compat re-exports. */
export const DDIC_SUPPORTED_TYPES = DDIC_TYPES;
export type DdicSupportedType = (typeof DDIC_TYPES)[number];

/** HTTP service (SICF node) subset. */
export const HTTP_TYPES = ['HTTP'] as const;
/** Legacy name retained for back-compat re-exports. */
export const HTTP_SUPPORTED_TYPES = HTTP_TYPES;
export type HttpSupportedType = (typeof HTTP_TYPES)[number];

/** Transaction code (SE93) subset. */
export const TRAN_TYPES = ['TRAN'] as const;
/** Legacy name retained for back-compat re-exports. */
export const TRAN_SUPPORTED_TYPES = TRAN_TYPES;
export type TranSupportedType = (typeof TRAN_TYPES)[number];

/** Narrow an arbitrary type string to the supported DDIC types. */
export function isDdicSupportedType(t: string): t is DdicSupportedType {
  return (DDIC_TYPES as readonly string[]).includes(t);
}

/** 022: narrow an arbitrary type string to the supported HTTP types. */
export function isHttpSupportedType(t: string): t is HttpSupportedType {
  return (HTTP_TYPES as readonly string[]).includes(t);
}

/** Narrow an arbitrary type string to the supported Transaction types. */
export function isTranSupportedType(t: string): t is TranSupportedType {
  return (TRAN_TYPES as readonly string[]).includes(t);
}

/**
 * Resolve the absolute filesystem path of the AFF canonical schema for `type`.
 * Wraps `aff/schema-paths.ts#schemaPathFor` so legacy call sites stay decoupled
 * from the AFF submodule.
 */
export function schemaPathFor(type: string, mirrorRoot?: string): string {
  // Lazy import keeps tree-shaking happy; tests can override mirrorRoot.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const mod = require('../aff/schema-paths.js') as typeof import('../aff/schema-paths.js');
  return mod.schemaPathFor(type, mirrorRoot);
}

/** AFF schema filename only (relative under the mirror). */
export function affSchemaFileFor(type: string): string | undefined {
  const primary = type.split('/')[0]!.toUpperCase();
  return INDEX[primary]?.affSchemaFile;
}
