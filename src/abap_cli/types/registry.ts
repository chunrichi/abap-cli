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
  /** 036-ttyp-msag-ddls: dual-channel capability (ICF fallback + ECC support). */
  channel?: ChannelCapability;
}

/** 036-ttyp-msag-ddls: per-type capability hints for channel-detect. */
export interface ChannelCapability {
  /** Type code routed to detect-channel / ICF fallback when ADT is absent. */
  icfFallback: boolean;
  /** Whether ECC releases (EHP5+) carry the type at all. DDLS = no, full stop. */
  eccSupported: boolean;
  /** Human-readable reason for the fallback (consumed by `data.fallbackReason`). */
  fallbackReason?: 'ECC_EHP6_NO_ADT_TABLETYPE' | 'ECC_EHP6_NO_ADT_MESSAGECLASS';
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
  // 036-ttyp-msag-ddls: dual-channel DDIC + CDS.
  // TTYP — handcrafted schema (upstream type-v1.json is type-pool, not table-type).
  {
    type: 'TTYP',
    folder: 'ttyp',
    source: 'ADT',
    affSchemaFile: 'ttyp-v1.json',
    channel: { icfFallback: true, eccSupported: true, fallbackReason: 'ECC_EHP6_NO_ADT_TABLETYPE' },
  },
  // MSAG — upstream schema available at msag/msag-v1.json.
  {
    type: 'MSAG',
    folder: 'msag',
    source: 'ADT',
    affSchemaFile: 'msag-v1.json',
    channel: { icfFallback: true, eccSupported: true, fallbackReason: 'ECC_EHP6_NO_ADT_MESSAGECLASS' },
  },
  // DDLS — ADT only. There is no ICF fallback; ECC releases pre-7.40 simply
  // cannot host CDS sources, so the channel-detect layer hard-errors with
  // DDLS_NOT_SUPPORTED_ON_ECC (exit 64) instead of silently degrading.
  {
    type: 'DDLS',
    folder: 'ddls',
    source: 'ADT',
    affSchemaFile: 'ddls-v1.json',
    channel: { icfFallback: false, eccSupported: false },
  },
  // T3.2 — Service binding metadata only (no source code). Pull writes a
  // single `<name>.srvb.json` via `metadataOnlyStrategy`. createObjtype
  // is unused on the pull path; bindings are managed in SAP GUI, not
  // pushed via the CLI.
  {
    type: 'SRVB',
    folder: 'srvb',
    source: 'ADT',
    createObjtype: 'SRVB/SB',
    affSchemaFile: 'srvb-v1.json',
  },
  // T3.1 — Service definition source object (`.acds`). Pull writes
  // `<name>.srvd.json` + `<name>.srvd.acds`.
  {
    type: 'SRVD',
    folder: 'srvd',
    source: 'ADT',
    createObjtype: 'SRVD/SD',
    affSchemaFile: 'srvd-v1.json',
  },
  // T3.3 — Behaviour definition source object (`.abdl`).
  {
    type: 'BDEF',
    folder: 'bdef',
    source: 'ADT',
    createObjtype: 'BDEF/BD',
    affSchemaFile: 'bdef-v1.json',
  },
  // T3.4 — Three CDS companion types (`.acds`). DCLS carries access
  // control, DDLX metadata extensions, DDLA annotation definitions.
  {
    type: 'DCLS',
    folder: 'dcls',
    source: 'ADT',
    createObjtype: 'DCLS/DC',
    affSchemaFile: 'dcls-v1.json',
  },
  {
    type: 'DDLX',
    folder: 'ddlx',
    source: 'ADT',
    createObjtype: 'DDLX/EX',
    affSchemaFile: 'ddlx-v1.json',
  },
  {
    type: 'DDLA',
    folder: 'ddla',
    source: 'ADT',
    createObjtype: 'DDLA/AE',
    affSchemaFile: 'ddla-v1.json',
  },
] as const;

/** 036-ttyp-msag-ddls: sub-registry types for channel-detect / ICF fallback gating. */
export const ADT_ROUTED_TYPES_LEGACY = ['CLAS', 'INTF', 'PROG', 'FUGR', 'TTYP', 'MSAG', 'DDLS'] as const;
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

/** 036: resolver for the per-type channel capability. */
export function channelFor(type: string): ChannelCapability | undefined {
  const primary = type.split('/')[0]!.toUpperCase();
  return INDEX[primary]?.channel;
}

/** 036: sub-registry of types routed through channel-detect (TTYP/MSAG/DDLS). */
export const ADT_ROUTED_TYPES = new Set(['TTYP', 'MSAG', 'DDLS']) as ReadonlySet<string>;

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
