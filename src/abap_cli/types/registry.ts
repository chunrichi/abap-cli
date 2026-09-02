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
}

/** Single registry; iterated in `allSupportedTypes()` for deterministic order. */
export const TYPE_REGISTRY: readonly ObjectTypeEntry[] = [
  // Source objects (ADT)
  { type: 'CLAS', folder: 'clas', source: 'ADT', createObjtype: 'CLAS/OC' },
  { type: 'INTF', folder: 'intf', source: 'ADT', createObjtype: 'INTF/OI' },
  { type: 'PROG', folder: 'prog', source: 'ADT', createObjtype: 'PROG/P' },
  { type: 'FUGR', folder: 'fugr', source: 'ADT', createObjtype: 'FUGR/F' },
  // DDIC objects (ICF)
  { type: 'TABL', folder: 'tabl', source: 'ICF' },
  { type: 'STRU', folder: 'stru', source: 'ICF' },
  { type: 'DOMA', folder: 'doma', source: 'ICF' },
  { type: 'DTEL', folder: 'dtel', source: 'ICF' },
  // HTTP service (SICF node) via ICF
  { type: 'HTTP', folder: 'http', source: 'ICF' },
  // Transaction code (SE93) via ICF
  { type: 'TRAN', folder: 'tran', source: 'ICF' },
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

/** DDIC types (TABL/STRU/DOMA/DTEL) subset for convenience. */
export const DDIC_TYPES: readonly string[] = TYPE_REGISTRY
  .filter((e) => e.source === 'ICF' && ['TABL', 'STRU', 'DOMA', 'DTEL'].includes(e.type))
  .map((e) => e.type);

/** HTTP / TRAN subset for convenience. */
export const HTTP_TYPES: readonly string[] = TYPE_REGISTRY
  .filter((e) => e.type === 'HTTP')
  .map((e) => e.type);

export const TRAN_TYPES: readonly string[] = TYPE_REGISTRY
  .filter((e) => e.type === 'TRAN')
  .map((e) => e.type);

/** Narrow an arbitrary type string to the supported DDIC types. */
export function isDdicSupportedType(t: string): boolean {
  return DDIC_TYPES.includes(t.toUpperCase());
}

/** Narrow an arbitrary type string to the HTTP type. */
export function isHttpSupportedType(t: string): boolean {
  return t.toUpperCase() === 'HTTP';
}

/** Narrow an arbitrary type string to the Transaction type. */
export function isTranSupportedType(t: string): boolean {
  return t.toUpperCase() === 'TRAN';
}
