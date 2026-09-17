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
  { type: 'CLAS', folder: 'clas', source: 'ADT', createObjtype: 'CLAS/OC', affSchemaFile: 'clas-v1.json' },
  { type: 'INTF', folder: 'intf', source: 'ADT', createObjtype: 'INTF/OI', affSchemaFile: 'intf-v1.json' },
  { type: 'PROG', folder: 'prog', source: 'ADT', createObjtype: 'PROG/P', affSchemaFile: 'prog-v1.json' },
  { type: 'FUGR', folder: 'fugr', source: 'ADT', createObjtype: 'FUGR/F', affSchemaFile: 'fugr-v1.json' },
  // DDIC objects (ICF) — STRU reuses TABL's schema (spec 018 / spec 033 US5).
  { type: 'TABL', folder: 'tabl', source: 'ICF', affSchemaFile: 'tabl-v1.json', requiresFile: true },
  { type: 'STRU', folder: 'stru', source: 'ICF', affSchemaFile: 'tabl-v1.json', requiresFile: true },
  { type: 'DOMA', folder: 'doma', source: 'ICF', affSchemaFile: 'doma-v1.json', requiresFile: true },
  { type: 'DTEL', folder: 'dtel', source: 'ICF', affSchemaFile: 'dtel-v1.json', requiresFile: true },
  // PR5: ENQU (lock object) and NROB (number range object) — both DDIC,
  // routed through ICF (NROB has no abap-adt-api endpoint; ENQU is included
  // here so the SAP-side ICF dispatch has a single /ddic/* entry to extend).
  // NROB keeps `source: 'ADT'` for the metadata (pull is ADT-primary with an
  // ICF fallback — see flows/edit/pull-nrob.ts); the `channel.fallbackReason`
  // block was previously declared but never read, so it was dropped on
  // 2026-09-17 (handoff §4.2). pull-nrob.ts hardcodes the literal reason
  // string, so the registry cleanup is safe.
  { type: 'ENQU', folder: 'enqu', source: 'ICF', affSchemaFile: 'enqu-v1.json', requiresFile: true },
  { type: 'NROB', folder: 'nrob', source: 'ADT', affSchemaFile: 'nrob-v1.json', requiresFile: true },
  // HTTP service (SICF node) via ICF. 032 US10 originally wrote a local
  // skeleton when --file was absent; that path was removed (refactor decision
  // 1A) to match DDIC/DDLS, so HTTP now requires --file too.
  { type: 'HTTP', folder: 'http', source: 'ICF', affSchemaFile: 'http-v1.json', requiresFile: true },
  // Transaction code (SE93) via ICF
  { type: 'TRAN', folder: 'tran', source: 'ICF', affSchemaFile: 'tran-v1.json', requiresFile: true },
  // 036-ttyp-msag-ddls: dual-channel DDIC + CDS.
  // TTYP — handcrafted schema (upstream type-v1.json is type-pool, not table-type).
  {
    type: 'TTYP',
    folder: 'ttyp',
    source: 'ADT',
    affSchemaFile: 'ttyp-v1.json',
    requiresFile: true,
    channel: { icfFallback: true, eccSupported: true, fallbackReason: 'ECC_EHP6_NO_ADT_TABLETYPE' },
  },
  // MSAG — upstream schema available at msag/msag-v1.json.
  {
    type: 'MSAG',
    folder: 'msag',
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
    folder: 'ddls',
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
    folder: 'srvb',
    source: 'ADT',
    affSchemaFile: 'srvb-v1.json',
  },
  // T3.1 — Service definition source object (`.acds`). Pull writes
  // `<name>.srvd.json` + `<name>.srvd.acds`. Create requires `--file`.
  {
    type: 'SRVD',
    folder: 'srvd',
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
    folder: 'bdef',
    source: 'ADT',
    affSchemaFile: 'bdef-v1.json',
  },
  // T3.4 — Three CDS companion types (`.acds`). DCLS carries access
  // control, DDLX metadata extensions, DDLA annotation definitions.
  // Create requires `--file`.
  {
    type: 'DCLS',
    folder: 'dcls',
    source: 'ADT',
    createObjtype: 'DCLS/DL',
    affSchemaFile: 'dcls-v1.json',
    requiresFile: true,
  },
  {
    type: 'DDLX',
    folder: 'ddlx',
    source: 'ADT',
    createObjtype: 'DDLX/EX',
    affSchemaFile: 'ddlx-v1.json',
    requiresFile: true,
  },
  {
    type: 'DDLA',
    folder: 'ddla',
    source: 'ADT',
    createObjtype: 'DDLA/ADF',
    affSchemaFile: 'ddla-v1.json',
    requiresFile: true,
  },
] as const;

/** 036-ttyp-msag-ddls: sub-registry types for channel-detect / ICF fallback gating. */
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

/** 036: resolver for the per-type channel capability. */
export function channelFor(type: string): ChannelCapability | undefined {
  const primary = type.split('/')[0]!.toUpperCase();
  return INDEX[primary]?.channel;
}

/** Return all supported type codes (uppercase, in registry order). */
export function allSupportedTypes(): string[] {
  return TYPE_REGISTRY.map((e) => e.type);
}

/** DDIC types (TABL/STRU/DOMA/DTEL) subset — single source of truth (US11, T048).
 *  ENQU is NOT in this set: its wire format is a JSON document, not the
 *  DOMA / DTEL / TABL-shape payload produced by `localToWire<DdicSupportedType>`.
 *  ENQU has its own format module (`formats/enqu/json.ts`) and goes through
 *  `CHANNEL_ROUTED_PUSH` in push.ts (always ICF). */
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

// ---------------------------------------------------------------------------
// Handler registration (Phase 3)
//
// create / pull / push dispatchers used to be if-else chains over the type
// code, hard-coded inside `flows/edit/{create,pull,push}.ts`. With this
// registry dispatchers consult per-type handler tables instead. Handlers are
// registered by side effect at module load (per-type module imports
// `register*Handler` at the top level), keeping the import graph acyclic —
// the registry never imports `flows/edit/*`.
//
// Tests use `clearHandlersForTesting()` / `restoreHandlersForTesting()` around
// each case so registrations cannot leak between tests. Production code must
// never call either.
// ---------------------------------------------------------------------------

/**
 * Common argument shape shared by every create handler. `opts` is `unknown`
 * on purpose: the registry must not import the create flow (the flow imports
 * the registry), so concrete per-type modules narrow it to `CreateOptions`
 * themselves. Callers pass a real `CreateOptions`, so the narrowing is a
 * single annotation, not a fight with the type system.
 */
export interface CreateHandlerArgs {
  type: string;
  name: string;
  opts: unknown;
  mode: import('../output/json.js').OutputMode;
}

/** Per-type create handler signature. */
export type CreateHandler = (args: CreateHandlerArgs) => Promise<void>;

export interface PullHandlerResult {
  object: string;
  files: string[];
  channel: 'adt' | 'icf';
  fallbackReason?: string;
}
export interface PullHandlerArgs {
  objectName: string;
  /** Concrete per-type pull flows narrow this to their own options shape. */
  opts: unknown;
}
export type PullHandler = (args: PullHandlerArgs) => Promise<PullHandlerResult>;

const CREATE_HANDLERS: Record<string, CreateHandler> = {};
const PULL_HANDLERS: Record<string, PullHandler> = {};

/**
 * Snapshot taken the first time `clearHandlersForTesting` runs. Per-type
 * modules register via side-effect imports, so the registry is empty at
 * top-level — we must capture the post-import state, not the empty one.
 */
let initialCreateSnapshot: Readonly<Record<string, CreateHandler>> | undefined;
let initialPullSnapshot: Readonly<Record<string, PullHandler>> | undefined;
let snapshotTaken = false;

export function registerCreateHandler(type: string, handler: CreateHandler): void {
  const t = type.toUpperCase();
  if (CREATE_HANDLERS[t]) {
    throw new Error(`Create handler for ${t} already registered`);
  }
  CREATE_HANDLERS[t] = handler;
}

export function createHandlerFor(type: string): CreateHandler | undefined {
  return CREATE_HANDLERS[type.toUpperCase()];
}

export function registerPullHandler(type: string, handler: PullHandler): void {
  const t = type.toUpperCase();
  if (PULL_HANDLERS[t]) {
    throw new Error(`Pull handler for ${t} already registered`);
  }
  PULL_HANDLERS[t] = handler;
}

export function pullHandlerFor(type: string): PullHandler | undefined {
  return PULL_HANDLERS[type.toUpperCase()];
}

/**
 * Test-only: wipe all handler registrations. Captures the current
 * registrations on first call so `restoreHandlersForTesting()` can put them
 * back. Per-type modules register via module-load side effects, so a snapshot
 * taken at top-level would be empty — capturing lazily after imports finish is
 * what makes the restore actually do something.
 *
 * Production code must never call this. Tests must pair it with
 * `restoreHandlersForTesting()` (typically `beforeEach` clear +
 * `afterEach` restore) so a test file that wipes the tables cannot break a
 * later dispatcher-level test running in the same module graph — a plain wipe
 * leaves `createHandlerFor`/`pullHandlerFor` returning `undefined` and the
 * dispatchers then silently fall through to the source-object path.
 */
export function clearHandlersForTesting(): void {
  // Always re-snapshot: a test body that registered a handler between
  // beforeEach and the next clear expects `restoreHandlersForTesting()` to
  // bring that registration back, not the pre-test baseline.
  initialCreateSnapshot = { ...CREATE_HANDLERS };
  initialPullSnapshot = { ...PULL_HANDLERS };
  snapshotTaken = true;
  for (const k of Object.keys(CREATE_HANDLERS)) delete CREATE_HANDLERS[k];
  for (const k of Object.keys(PULL_HANDLERS)) delete PULL_HANDLERS[k];
}

/** Test-only counterpart of `clearHandlersForTesting`: reinstate the captured registrations. */
export function restoreHandlersForTesting(): void {
  if (!snapshotTaken) return;
  for (const k of Object.keys(CREATE_HANDLERS)) delete CREATE_HANDLERS[k];
  for (const k of Object.keys(PULL_HANDLERS)) delete PULL_HANDLERS[k];
  if (initialCreateSnapshot) Object.assign(CREATE_HANDLERS, initialCreateSnapshot);
  if (initialPullSnapshot) Object.assign(PULL_HANDLERS, initialPullSnapshot);
  // Reset the snapshot so the next clear re-captures whatever the new
  // module-graph registered (a registry-handlers test may have side-effected
  // a fake handler before the dispatcher tests run).
  snapshotTaken = false;
  initialCreateSnapshot = undefined;
  initialPullSnapshot = undefined;
}
