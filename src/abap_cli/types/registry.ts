/**
 * Single source of truth for supported object types.
 *
 * Replaces the legacy type registries:
 *   - flows/create-types.ts#TYPE_MAP (type → ADT objtype for source objects)
 *   - formats/{ddic,http,transport}/json.ts#*_SUPPORTED_TYPES (DDIC/ICF type sets)
 *
 * Local artifact paths are not registered here: abap-file-format artifacts are
 * written flat (`<rootDir>/<name>.<type>.<ext>`), so there is no type →
 * subdirectory mapping anymore.
 */

export type ObjectSource = 'ADT' | 'ICF';

export interface ObjectTypeEntry {
  /** User-facing type code (uppercase, e.g. "CLAS", "TABL"). */
  type: string;
  /** Routing strategy for SAP communication. */
  source: ObjectSource;
  /** ADT objtype for source objects (CLAS/INTF/PROG/FUGR); undefined for DDIC/HTTP/TRAN. */
  createObjtype?: string;
  /**
   * `abap create <type>` can only run against an abap-file-format JSON input
   * (`--file <path>`); there is no skeleton path for these types. Drives the
   * dispatcher's fail-fast check and the `create --schema` contract, so the
   * requirement lives in exactly one place.
   */
  requiresFile?: boolean;
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
  { type: 'CLAS', source: 'ADT', createObjtype: 'CLAS/OC', affSchemaFile: 'clas-v1.json' },
  { type: 'INTF', source: 'ADT', createObjtype: 'INTF/OI', affSchemaFile: 'intf-v1.json' },
  { type: 'PROG', source: 'ADT', createObjtype: 'PROG/P', affSchemaFile: 'prog-v1.json' },
  { type: 'FUGR', source: 'ADT', createObjtype: 'FUGR/F', affSchemaFile: 'fugr-v1.json' },
  // DDIC objects (ICF) — STRU reuses TABL's schema (spec 018 / spec 033 US5).
  { type: 'TABL', source: 'ICF', affSchemaFile: 'tabl-v1.json', requiresFile: true },
  { type: 'STRU', source: 'ICF', affSchemaFile: 'tabl-v1.json', requiresFile: true },
  { type: 'DOMA', source: 'ICF', affSchemaFile: 'doma-v1.json', requiresFile: true },
  { type: 'DTEL', source: 'ICF', affSchemaFile: 'dtel-v1.json', requiresFile: true },
  // PR5: ENQU (lock object) and NROB (number range object) — both DDIC,
  // routed through ICF (NROB has no abap-adt-api endpoint; ENQU is included
  // here so the SAP-side ICF dispatch has a single /ddic/* entry to extend).
  // NROB keeps `source: 'ADT'` for the metadata (pull is ADT-primary with an
  // ICF fallback — see flows/edit/pull-nrob.ts); the `channel.fallbackReason`
  // block was previously declared but never read, so it was dropped on
  // 2026-09-17 (handoff §4.2). pull-nrob.ts hardcodes the literal reason
  // string, so the registry cleanup is safe.
  { type: 'ENQU', source: 'ICF', affSchemaFile: 'enqu-v1.json', requiresFile: true },
  { type: 'NROB', source: 'ADT', affSchemaFile: 'nrob-v1.json', requiresFile: true },
  // HTTP service (SICF node) via ICF. 032 US10 originally wrote a local
  // skeleton when --file was absent; that path was removed (refactor decision
  // 1A) to match DDIC/DDLS, so HTTP now requires --file too.
  { type: 'HTTP', source: 'ICF', affSchemaFile: 'http-v1.json', requiresFile: true },
  // Transaction code (SE93) via ICF
  { type: 'TRAN', source: 'ICF', affSchemaFile: 'tran-v1.json', requiresFile: true },
  // 036-ttyp-msag-ddls: dual-channel DDIC + CDS.
  // TTYP — handcrafted schema (upstream type-v1.json is type-pool, not table-type).
  {
    type: 'TTYP',
    source: 'ADT',
    affSchemaFile: 'ttyp-v1.json',
    requiresFile: true,
    channel: { icfFallback: true, eccSupported: true, fallbackReason: 'ECC_EHP6_NO_ADT_TABLETYPE' },
  },
  // MSAG — upstream schema available at msag/msag-v1.json.
  {
    type: 'MSAG',
    source: 'ADT',
    affSchemaFile: 'msag-v1.json',
    requiresFile: true,
    channel: { icfFallback: true, eccSupported: true, fallbackReason: 'ECC_EHP6_NO_ADT_MESSAGECLASS' },
  },
  // DDLS — ADT only. There is no ICF fallback; ECC releases pre-7.40 simply
  // cannot host CDS sources, so the channel-detect layer hard-errors with
  // DDLS_NOT_SUPPORTED_ON_ECC (exit 64) instead of silently degrading.
  {
    type: 'DDLS',
    source: 'ADT',
    affSchemaFile: 'ddls-v1.json',
    requiresFile: true,
    channel: { icfFallback: false, eccSupported: false },
  },
  // T3.2 — Service binding metadata only (no source code). Pull writes a
  // single `<name>.srvb.json` via `metadataOnlyStrategy`. Bindings are
  // managed in SAP GUI; the CLI does not create them.
  {
    type: 'SRVB',
    source: 'ADT',
    affSchemaFile: 'srvb-v1.json',
  },
  // T3.1 — Service definition source object (`.acds`). Pull writes
  // `<name>.srvd.json` + `<name>.srvd.acds`. Create requires `--file`.
  {
    type: 'SRVD',
    source: 'ADT',
    createObjtype: 'SRVD/SRV',
    affSchemaFile: 'srvd-v1.json',
    requiresFile: true,
  },
  // T3.3 — Behaviour definition source object (`.abdl`). Pull-only:
  // `abap-adt-api`'s `CreatableTypeIds` has no BDEF entry, so this CLI
  // cannot create one. Pull writes `<name>.bdef.json` + `<name>.bdef.abdl`.
  {
    type: 'BDEF',
    source: 'ADT',
    affSchemaFile: 'bdef-v1.json',
  },
  // T3.4 — Three CDS companion types (`.acds`). DCLS carries access
  // control, DDLX metadata extensions, DDLA annotation definitions.
  // Create requires `--file`.
  {
    type: 'DCLS',
    source: 'ADT',
    createObjtype: 'DCLS/DL',
    affSchemaFile: 'dcls-v1.json',
    requiresFile: true,
  },
  {
    type: 'DDLX',
    source: 'ADT',
    createObjtype: 'DDLX/EX',
    affSchemaFile: 'ddlx-v1.json',
    requiresFile: true,
  },
  {
    type: 'DDLA',
    source: 'ADT',
    createObjtype: 'DDLA/ADF',
    affSchemaFile: 'ddla-v1.json',
    requiresFile: true,
  },
] as const;

/** 036-ttyp-msag-ddls: sub-registry types for channel-detect / ICF fallback gating. */
const INDEX: Record<string, ObjectTypeEntry> = Object.fromEntries(
  TYPE_REGISTRY.map((e) => [e.type, e]),
);

/** Resolve the ADT objtype for create (source objects only). */
export function createObjtypeFor(type: string): string | undefined {
  const primary = type.split('/')[0]!.toUpperCase();
  return INDEX[primary]?.createObjtype;
}

/**
 * Whether `abap create <type>` requires an abap-file-format `--file <path>`
 * input (no skeleton path exists). Case-insensitive; `false` for unknown types.
 */
export function requiresFileFor(type: string): boolean {
  const primary = type.split('/')[0]!.toUpperCase();
  return INDEX[primary]?.requiresFile === true;
}

/** All type codes whose `create` requires `--file` (registry order). */
export function typesRequiringFile(): string[] {
  return TYPE_REGISTRY.filter((e) => e.requiresFile === true).map((e) => e.type);
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

/** DDIC types (TABL/STRU/DOMA/DTEL) subset — single source of truth (US11, T048).
 *  ENQU is NOT in this set: its wire format is a JSON document, not the
 *  DOMA / DTEL / TABL-shape payload produced by `localToWire<DdicSupportedType>`.
 *  ENQU has its own format module (`formats/enqu/json.ts`) and a dedicated
 *  routing-table row (`flows/edit/routing.ts`, always ICF). */
export const DDIC_TYPES = ['DOMA', 'DTEL', 'TABL', 'STRU'] as const;
export type DdicSupportedType = (typeof DDIC_TYPES)[number];

/** HTTP service (SICF node) subset. */
export const HTTP_TYPES = ['HTTP'] as const;
export type HttpSupportedType = (typeof HTTP_TYPES)[number];

/** Transaction code (SE93) subset. */
export const TRAN_TYPES = ['TRAN'] as const;
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
