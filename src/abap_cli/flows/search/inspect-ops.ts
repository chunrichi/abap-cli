import * as fs from 'node:fs';
import * as path from 'node:path';
import { getRevisionLink } from 'abap-adt-api/build/api/revisions.js';
import type { AbapObjectStructure, classIncludes } from 'abap-adt-api/build/api/objectstructure.js';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError } from '../../output/json.js';
import { resolveObject } from '../../core/resolve.js';
import { SEARCH_RESULT_LIMIT } from '../../core/limits.js';
import { toRelativeOutputPath } from '../../core/path-output.js';
import { parseVersionsFeed } from '../../formats/versions-feed.js';

/** Base object metadata — always returned. */
export interface ObjectMetadata {
  object: string;
  type: string;
  uri: string;
  description?: string;
  packageName?: string;
  changedAt?: number;
  changedBy?: string;
  responsible?: string;
}

/** Structure element from `--structure`. */
export interface ObjectStructureElement {
  name: string;
  type: string;
  visibility?: string;
  children: ObjectStructureElement[];
}

/** Class include part from `--includes`. */
export interface ObjectInclude {
  includeType: string;
  name: string;
  sourceUri: string;
}

/** Lock/transport ownership from `--locks`. */
export interface ObjectLock {
  transport: string;
  status: string;
  owner: string;
  text: string;
}

/** Per-part activation state from `--activation`. */
export interface ActivationPart {
  includeType: string;
  sourceUri: string;
  /** true when the active source equals the latest (inactive) source. */
  active: boolean;
  /**
   * Optional human-readable note for parts whose `active` flag carries a
   * known SAP/ADT semantic quirk. On releases where ADT returns an empty body
   * for the system-regenerated OO `source/main` INCLUDE, `active: false` there
   * is structural and must not be read as "the class is inactive" — the
   * object-level `hasPendingInactiveVersion` flag is authoritative.
   */
  note?: string;
}

/** Why an object/part is considered not fully activated. */
export type ActivationReason = 'stale_active' | 'pending_inactive_version';

export interface ActivationInfo {
  /**
   * true when the object is fully activated.
   *
   * Determined by two independent signals (either one fails `ok`):
   *  1. the object is absent from the ADT inactive-objects list for this user
   *     (`hasPendingInactiveVersion`), and
   *  2. no implementation part reports `active: false`.
   *
   * Signal 1 is the only reliable one for OO classes whose pending change may
   * live solely in the system-managed `source/main` INCLUDE — the previous
   * implementation parts-only rule silently reported `ok: true` for a class
   * left unactivated by a failed `push` (feedback F-02).
   */
  ok: boolean;
  parts: ActivationPart[];
  /** Per-part reasons when `ok === false` (debug aid; not part of the ok contract). */
  inactive?: { includeType: string; reason: ActivationReason }[];
  /**
   * Whether the ADT inactive-objects list contains this object for the current
   * user. `undefined` when the endpoint could not be queried (older releases) —
   * in that case `ok` falls back to the part comparison only.
   */
  hasPendingInactiveVersion?: boolean;
}

/** One entry of an object's version history (ADT versions Atom feed). */
export interface ObjectVersionEntry {
  /** ADT version id (`atom:id`), e.g. "00000". */
  version: string;
  /** Feed `updated` timestamp (ISO 8601, as returned by SAP). */
  date: string;
  author: string;
  /** Feed title — usually the version description / transport text. */
  title: string;
  /** Content URI of this version; pass to `getObjectSource` to read it. */
  uri: string;
  /** Transport request carrying this version, when SAP exposes the link. */
  transport?: string;
}

/** Version history for `--versions`. */
export interface ObjectVersionsInfo {
  /** Include part the versions were read for (`main` for non-class objects). */
  include: string;
  /** Number of returned entries (kept even when the list is empty). */
  count: number;
  versions: ObjectVersionEntry[];
  /** Present with `--show <version>`: the selected version + its source. */
  shown?: { version: string; source?: string; out?: string };
}

/** One flattened symbol of an object structure tree. */
export interface ObjectSymbol {
  name: string;
  /** Normalized kind (class / interface / method / attribute / …). */
  kind: string;
  /** Raw ADT structure element type, kept for machine use. */
  type: string;
  visibility?: string;
  level?: string;
  /** 1-based start line in the owning include; null when the backend omits it. */
  startLine: number | null;
  /** 1-based end line; null when the backend omits it. */
  endLine: number | null;
  constructor?: boolean;
  final?: boolean;
  redefinition?: boolean;
  testmethod?: boolean;
}

/** Flattened symbol table for `--symbols`. */
export interface ObjectSymbolsInfo {
  /** false when the object type has no ADT object-structure endpoint. */
  supported: boolean;
  reason?: string;
  /** Number of returned symbols (kept even when the list is empty). */
  count: number;
  symbols: ObjectSymbol[];
}

export interface InspectResult {
  metadata: ObjectMetadata;
  structure?: ObjectStructureElement[];
  includes?: ObjectInclude[];
  locks?: ObjectLock[];
  activation?: ActivationInfo;
  versions?: ObjectVersionsInfo;
  symbols?: ObjectSymbolsInfo;
}

export interface InspectFlags {
  structure?: boolean;
  includes?: boolean;
  locks?: boolean;
  package?: boolean;
  /** Compare active vs latest source to verify real activation (read-only). */
  activation?: boolean;
  /** Read the ADT versions feed (read-only). */
  versions?: boolean;
  /** Include part for --versions (default main; only for CLAS / INTF). */
  include?: string;
  /** Show the source of one version (requires --versions). */
  show?: string;
  /** Write the shown version source to this file instead of returning it. */
  out?: string;
  /** Max number of version entries to return (default 50). */
  limit?: number;
  /** Flatten the object structure into symbols with source line ranges. */
  symbols?: boolean;
  /** Comma-separated symbol kinds to keep (method, attribute, …). */
  kinds?: string;
  /** Case-insensitive regex filter on symbol names. */
  namePattern?: string;
}

/**
 * Inspect an object's metadata read-only. Never calls lock() —
 * lock/transport ownership is read via transportInfo.
 */
export async function inspectObject(client: AdtClientWrapper, name: string, flags: InspectFlags = {}): Promise<InspectResult> {
  // resolveObject gives exact-name resolution + OBJECT_NOT_FOUND/AMBIGUOUS_OBJECT.
  const resolved = await resolveObject(client, name);

  // Package name lives on the search hit; re-fetch to capture it (resolveObject discards it).
  let packageName: string | undefined;
  if (flags.package) {
    const hits = await client.searchObject(resolved.name, resolved.type, SEARCH_RESULT_LIMIT);
    packageName = hits.find((h) => h['adtcore:name'] === resolved.name)?.['adtcore:packageName'];
  }

  const structure = await client.objectStructure(resolved.objectUrl);
  const meta = structure.metaData as Partial<{
    'adtcore:name': string;
    'adtcore:type': string;
    'adtcore:description': string;
    'adtcore:changedAt': number;
    'adtcore:changedBy': string;
    'adtcore:responsible': string;
  }>;

  const metadata: ObjectMetadata = {
    object: meta['adtcore:name'] ?? resolved.name,
    type: meta['adtcore:type'] ?? resolved.type,
    uri: resolved.objectUrl,
    description: meta['adtcore:description'],
    packageName,
    changedAt: meta['adtcore:changedAt'],
    changedBy: meta['adtcore:changedBy'],
    responsible: meta['adtcore:responsible'],
  };

  const result: InspectResult = { metadata };

  if (flags.structure) {
    const elements = await client.objectStructureElements(resolved.objectUrl);
    result.structure = elements as unknown as ObjectStructureElement[];
  }

  if (flags.includes && 'includes' in structure && Array.isArray(structure.includes)) {
    result.includes = structure.includes.map((inc) => ({
      includeType: inc['class:includeType'],
      name: resolved.name,
      sourceUri: inc['abapsource:sourceUri'],
    }));
  }

  if (flags.locks) {
    const main = resolved.parts.find((p) => p.subtype === 'main')?.sourceUrl ?? resolved.objectUrl;
    const info = await client.transportInfo(main);
    result.locks = (info.TRANSPORTS ?? []).map((t) => ({
      transport: t.TRKORR,
      status: t.TRSTATUS,
      owner: t.AS4USER,
      text: t.AS4TEXT,
    }));
  }

  if (flags.activation && 'includes' in structure && Array.isArray(structure.includes)) {
    result.activation = await checkActivation(client, resolved.objectUrl, structure.includes, resolved.type);
  }

  const target = { name: resolved.name, type: metadata.type, objectUrl: resolved.objectUrl };
  if (flags.symbols) result.symbols = await readSymbols(client, target, flags);
  if (flags.versions) result.versions = await readVersions(client, target, flags, structure);

  return result;
}

/**
 * Compare active vs latest source for each part and cross-check the ADT
 * inactive-objects list (dogfooding lesson: an activate that reports
 * success may leave active == stale skeleton). Read-only.
 *
 * For OO classes/interfaces (CLAS/OC, INTF/OI) the `source/main` INCLUDE may
 * be a system-managed artefact whose active version is regenerated by SAP, so
 * `main.active === false` is ambiguous on its own. The object-level
 * inactive-objects list resolves the ambiguity: when the object is listed
 * there, an unactivated version really exists (feedback F-02: a failed
 * `push` left the new source inactive while `ok` still reported true because
 * `main` was excluded from the decision).
 */
async function checkActivation(
  client: AdtClientWrapper,
  objectUrl: string,
  includes: Array<{ 'class:includeType'?: string; 'abapsource:sourceUri'?: string }>,
  objectType: string,
): Promise<ActivationInfo> {
  const parts: ActivationPart[] = [];
  // OO objects (classes / interfaces) may have a system-managed `source/main`
  // INCLUDE whose active body is regenerated server-side (or returned empty).
  const OO_TYPES = new Set(['CLAS/OC', 'INTF/OI']);
  const isOOClass = OO_TYPES.has(objectType);
  const OO_MAIN_QUIRK_NOTE =
    'SAP-managed INCLUDE: ADT returns a system-regenerated (or empty) active ' +
    'body here, so active=false is structural, not an indication that the ' +
    'class is inactive. The object-level hasPendingInactiveVersion flag is ' +
    'authoritative for the class activation state.';
  const OO_MAIN_PENDING_NOTE =
    'active=false matches the pending inactive version recorded by ADT — the ' +
    'class has changes that were written but not activated.';

  for (const inc of includes) {
    const includeType = inc['class:includeType'] ?? 'main';
    const sourceUri = inc['abapsource:sourceUri'] ?? '';
    const abs = sourceUri.startsWith('/') ? sourceUri : `${objectUrl.replace(/\/$/, '')}/${sourceUri}`;
    let active = false;
    try {
      const [latest, activeSrc] = await Promise.all([
        client.getObjectSource(abs),
        client.getActiveObjectSource(abs),
      ]);
      active = latest === activeSrc;
    } catch {
      active = false;
    }
    parts.push({ includeType, sourceUri, active });
  }

  // Authoritative object-level signal: does this user currently hold an
  // unactivated version of the object?
  const hasPendingInactiveVersion = await probePendingInactiveVersion(client, objectUrl);

  // Annotate the OO `main` part now that the ambiguity is resolved.
  if (isOOClass) {
    const mainPart = parts.find((p) => p.includeType === 'main');
    if (mainPart && !mainPart.active) {
      mainPart.note = hasPendingInactiveVersion === true ? OO_MAIN_PENDING_NOTE : OO_MAIN_QUIRK_NOTE;
    }
  }

  // Implementation parts are always authoritative when they differ.
  const IMPLEMENTATION_PARTS = new Set(['implementations', 'definitions', 'testclasses', 'macros']);
  const staleImplementationParts = parts.filter((p) => IMPLEMENTATION_PARTS.has(p.includeType) && !p.active);

  const inactive: { includeType: string; reason: ActivationReason }[] = [];
  if (hasPendingInactiveVersion === true) {
    inactive.push({ includeType: 'object', reason: 'pending_inactive_version' });
  }
  for (const p of staleImplementationParts) {
    inactive.push({ includeType: p.includeType, reason: 'stale_active' });
  }

  const info: ActivationInfo = {
    ok: inactive.length === 0,
    parts,
  };
  if (hasPendingInactiveVersion !== undefined) info.hasPendingInactiveVersion = hasPendingInactiveVersion;
  if (inactive.length > 0) info.inactive = inactive;
  return info;
}

/** One entry of the ADT inactive-objects list. */
interface InactiveObjectEntry {
  object?: { 'adtcore:uri'?: string; 'adtcore:name'?: string; deleted?: boolean };
}

/**
 * Whether the ADT inactive-objects list contains `objectUrl` for the current
 * user. Returns `undefined` when the probe fails (endpoint unavailable on some
 * releases) so callers can distinguish "known active" from "unknown".
 */
async function probePendingInactiveVersion(
  client: AdtClientWrapper,
  objectUrl: string,
): Promise<boolean | undefined> {
  try {
    const list = (await client.inactiveObjects()) as InactiveObjectEntry[];
    const target = objectUrl.replace(/\/+$/, '').toLowerCase();
    return list.some((entry) => {
      const obj = entry?.object;
      if (!obj || obj.deleted === true) return false;
      if (typeof obj['adtcore:uri'] !== 'string') return false;
      return obj['adtcore:uri'].replace(/\/+$/, '').toLowerCase() === target;
    });
  } catch {
    // Endpoint missing/forbidden on this release — the caller falls back to the
    // per-part comparison rather than reporting a bogus "active".
    return undefined;
  }
}

/** Flow outcome: JSON envelope data + human summary, printed by the command layer. */
export interface InspectEnvelope {
  data: InspectResult;
  human: string;
}

export async function runInspect(
  object: string | undefined,
  flags: InspectFlags = {},
): Promise<InspectEnvelope> {
  if (!object) {
    throw new CliError('USAGE', 'inspect requires an object name.', {
      nextSteps: ['Find objects: abap search <query>'],
      example: 'abap inspect ZCL_MY_CLASS',
    });
  }
  if (flags.out && !flags.show) {
    throw new CliError('USAGE', '--out requires --show <version>.', {
      nextSteps: ['Pick a version first: abap inspect <object> --versions'],
      example: `abap inspect ${object} --versions --show <version> --out <file>`,
    });
  }
  if (flags.show && !flags.versions) {
    throw new CliError('USAGE', '--show requires --versions.', {
      nextSteps: ['List versions first: abap inspect <object> --versions'],
      example: `abap inspect ${object} --versions --show <version>`,
    });
  }
  if (flags.include && !flags.versions) {
    throw new CliError('USAGE', '--include requires --versions.', {
      nextSteps: ['Add --versions to inspect one include part of the version history.'],
      example: `abap inspect ${object} --versions --include implementations`,
    });
  }
  if (flags.limit !== undefined && (!Number.isInteger(flags.limit) || flags.limit < 1 || flags.limit > 200)) {
    throw new CliError('INVALID_ARGUMENT', '--limit must be an integer between 1 and 200.', {
      details: { limit: flags.limit },
      example: `abap inspect ${object} --versions --limit 20`,
    });
  }
  if (flags.namePattern) {
    try {
      new RegExp(flags.namePattern);
    } catch {
      throw new CliError('INVALID_ARGUMENT', `Invalid --name-pattern '${flags.namePattern}': not a valid regular expression.`, {
        details: { namePattern: flags.namePattern },
        example: `abap inspect ${object} --symbols --name-pattern '^RUN'`,
      });
    }
  }
  const client = await AdtClientWrapper.create();
  const result = await inspectObject(client, object, flags);
  const human = [
    `${result.metadata.object} (${result.metadata.type})`,
    `  uri: ${result.metadata.uri}`,
    ...(result.metadata.description ? [`  description: ${result.metadata.description}`] : []),
    ...(result.metadata.packageName ? [`  package: ${result.metadata.packageName}`] : []),
    ...(result.structure ? [`  structure: ${result.structure.length} element(s)`] : []),
    ...(result.includes ? [`  includes: ${result.includes.length} part(s)`] : []),
    ...(result.locks ? [`  locks: ${result.locks.length} request(s)`] : []),
    ...(result.activation
      ? [
          `  activation: ${result.activation.ok ? 'OK (active == latest)' : 'STALE (active != latest)'}`,
          ...result.activation.parts.map((p) => `    ${p.includeType}: ${p.active ? 'active' : 'stale'} (${p.sourceUri})`),
        ]
      : []),
    ...(result.versions
      ? [
          `  versions: ${result.versions.versions.length} entry(ies) (include: ${result.versions.include})`,
          ...(result.versions.shown
            ? [`    shown: ${result.versions.shown.version}${result.versions.shown.out ? ` → ${result.versions.shown.out}` : ''}`]
            : []),
        ]
      : []),
    ...(result.symbols
      ? [
          result.symbols.supported
            ? `  symbols: ${result.symbols.symbols.length} symbol(s)`
            : `  symbols: unsupported (${result.symbols.reason ?? 'object type has no structure endpoint'})`,
        ]
      : []),
  ].join('\n');
  return { data: result, human };
}

// --- Version history (`--versions`) ---

const CLASS_INCLUDE_VALUES = ['main', 'definitions', 'implementations', 'macros', 'testclasses'] as const;
type ClassIncludeValue = (typeof CLASS_INCLUDE_VALUES)[number];

interface VersionTarget {
  name: string;
  type: string;
  objectUrl: string;
}

function isClassLike(type: string): boolean {
  const upper = type.toUpperCase();
  return upper.startsWith('CLAS') || upper.startsWith('INTF');
}

function normalizeInclude(raw: string | undefined): ClassIncludeValue {
  const value = (raw ?? 'main').trim().toLowerCase();
  if (!(CLASS_INCLUDE_VALUES as readonly string[]).includes(value)) {
    throw new CliError('INVALID_ARGUMENT', `Unknown include '${raw}'.`, {
      details: { allowed: [...CLASS_INCLUDE_VALUES] },
      nextSteps: [`Use one of: ${CLASS_INCLUDE_VALUES.join(', ')}`],
      example: 'abap inspect ZCL_MY_CLASS --versions --include implementations',
    });
  }
  return value as ClassIncludeValue;
}

async function readVersions(
  client: AdtClientWrapper,
  target: VersionTarget,
  flags: InspectFlags,
  structure: AbapObjectStructure,
): Promise<ObjectVersionsInfo> {
  if (!isClassLike(target.type) && (flags.include || flags.show)) {
    throw new CliError('INVALID_ARGUMENT', `--include / --show are only available for classes and interfaces (got ${target.type}).`, {
      details: { type: target.type },
      example: `abap inspect ${target.name} --versions`,
    });
  }
  const include = normalizeInclude(flags.include);
  const feedPath = getRevisionLink(structure, isClassLike(target.type) ? (include as classIncludes) : undefined);
  if (!feedPath) {
    throw new CliError('TYPE_NOT_SUPPORTED', `Version history is not available for ${target.name} (${target.type}).`, {
      details: { object: target.name, type: target.type },
      nextSteps: [
        'Version history needs an ADT versions feed; objects created outside versioning (for example $TMP-only objects) may not have one.',
        `Verify the activation state instead: abap inspect ${target.name} --activation`,
      ],
      example: `abap inspect ${target.name} --activation`,
    });
  }
  const xml = await client.adtFeed(feedPath);
  const raw = parseVersionsFeed(xml);
  const limit = flags.limit ?? 50;
  const versions: ObjectVersionEntry[] = raw.slice(0, limit).map((entry) => ({
    version: entry.version,
    date: entry.date,
    author: entry.author,
    title: entry.title,
    uri: entry.uri,
    ...(entry.transport ? { transport: entry.transport } : {}),
  }));
  const info: ObjectVersionsInfo = { include, count: versions.length, versions };
  if (flags.show) {
    const wanted = flags.show.trim();
    const revision =
      raw.find((r) => r.version === wanted) ?? raw.find((r) => r.version.toLowerCase() === wanted.toLowerCase());
    if (!revision) {
      throw new CliError('INVALID_ARGUMENT', `Version '${wanted}' not found for ${target.name}.`, {
        details: { object: target.name, available: versions.map((v) => v.version) },
        nextSteps: ['List the available versions first: abap inspect <object> --versions'],
        example: `abap inspect ${target.name} --versions`,
      });
    }
    const source = await client.getObjectSource(revision.uri);
    if (flags.out) {
      const absolute = path.resolve(flags.out);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, source, 'utf8');
      info.shown = { version: revision.version, out: toRelativeOutputPath(absolute) };
    } else {
      info.shown = { version: revision.version, source };
    }
  }
  return info;
}

// --- Symbols (`--symbols`) ---

const LINE_RANGE_PATTERN = /[#&]start=(\d+),(\d+);end=(\d+),(\d+)/;

interface StructureLinkLike {
  href?: string;
  rel?: string;
}

interface StructureElementLike {
  name?: string;
  type?: string;
  visibility?: string;
  level?: string;
  constructor?: boolean;
  final?: boolean;
  redefinition?: boolean;
  testmethod?: boolean;
  links?: StructureLinkLike[];
  children?: StructureElementLike[];
}

/**
 * Normalized kind per ADT object-structure element type (authoritative
 * `CO_*` constants from the official ADT OO plugin, plus bare names returned
 * by older backends). Unknown types fall back to the lower-cased raw type.
 */
const KIND_BY_ADT_TYPE: Record<string, string> = {
  // Global class members.
  'CLAS/OC': 'class',
  'CLAS/OCI': 'class-implementation',
  'CLAS/OR': 'interface-implementation',
  'CLAS/OB': 'alias',
  'CLAS/OO': 'method-definition',
  'CLAS/OM': 'method',
  'CLAS/OA': 'attribute',
  'CLAS/OE': 'event',
  'CLAS/OT': 'type',
  'CLAS/OF': 'friend',
  'CLAS/OK': 'macro',
  'CLAS/I': 'include',
  'CLAS/OCX': 'text-elements',
  'CLAS/OSU': 'public-section',
  'CLAS/OSK': 'package-section',
  'CLAS/OSO': 'protected-section',
  'CLAS/OSI': 'private-section',
  // Local classes / interfaces inside a global class.
  'CLAS/OCL': 'local-class',
  'CLAS/ON': 'local-interface',
  'CLAS/ONB': 'local-interface-alias',
  'CLAS/OLB': 'local-class-alias',
  'CLAS/OLN': 'local-class-interface-implementation',
  'CLAS/OLD': 'local-class-method',
  'CLAS/OLI': 'local-class-method-implementation',
  'CLAS/OLA': 'local-class-attribute',
  'CLAS/ONE': 'local-interface-event',
  'CLAS/OLE': 'local-class-event',
  'CLAS/OOV': 'local-variable',
  'CLAS/OND': 'local-interface-method',
  'CLAS/ONT': 'local-interface-type',
  'CLAS/ONA': 'local-interface-attribute',
  'CLAS/OLT': 'local-class-type',
  'CLAS/OLF': 'local-class-friend',
  'CLAS/OQ': 'test-seam',
  // Global interface members.
  'INTF/OI': 'interface',
  'INTF/IO': 'method',
  'INTF/IA': 'attribute',
  'INTF/IE': 'event',
  'INTF/IT': 'type',
  'INTF/IB': 'alias',
  'INTF/I': 'include',
  'INTF/IOV': 'local-variable',
  // Bare names (mock / older backends).
  METHOD: 'method',
  ATTRIBUTE: 'attribute',
  EVENT: 'event',
  TYPE: 'type',
  CLASS: 'class',
  INTERFACE: 'interface',
};

/** Normalize the visibility suffix (`CLAS/OM/public`) before the kind lookup. */
function baseAdtType(type: string): string {
  const segments = type.split('/');
  if (segments.length >= 3 && /^(public|private|protected)$/i.test(segments[2] ?? '')) {
    return segments.slice(0, 2).join('/');
  }
  return type;
}

function kindFor(type: string): string {
  const base = baseAdtType(type);
  return KIND_BY_ADT_TYPE[base.toUpperCase()] ?? base.toLowerCase();
}

/** Parse the `#start=12,4;end=40,7` fragment of an ADT atom link. */
export function parseLineRange(href: string | undefined): { startLine: number; endLine: number } | null {
  if (!href) return null;
  const match = LINE_RANGE_PATTERN.exec(href);
  if (!match) return null;
  return { startLine: Number(match[1]), endLine: Number(match[3]) };
}

/** Flatten a nested ADT object structure into a stable symbol list. */
export function flattenSymbols(elements: StructureElementLike[]): ObjectSymbol[] {
  const symbols: ObjectSymbol[] = [];
  const walk = (items: StructureElementLike[]): void => {
    for (const element of items) {
      const range = (element.links ?? []).map((link) => parseLineRange(link.href)).find((r) => r !== null) ?? null;
      symbols.push({
        name: element.name ?? '',
        kind: kindFor(element.type ?? ''),
        type: element.type ?? '',
        ...(element.visibility ? { visibility: element.visibility } : {}),
        ...(element.level ? { level: element.level } : {}),
        startLine: range?.startLine ?? null,
        endLine: range?.endLine ?? null,
        ...(element.constructor ? { constructor: true } : {}),
        ...(element.final ? { final: true } : {}),
        ...(element.redefinition ? { redefinition: true } : {}),
        ...(element.testmethod ? { testmethod: true } : {}),
      });
      if (element.children && element.children.length > 0) walk(element.children);
    }
  };
  walk(elements);
  return symbols;
}

/** Apply `--kinds` / `--name-pattern` filters to a flattened symbol list. */
export function filterSymbols(symbols: ObjectSymbol[], kinds?: string, namePattern?: string): ObjectSymbol[] {
  let filtered = symbols;
  if (kinds) {
    const wanted = new Set(
      kinds
        .split(',')
        .map((kind) => kind.trim().toLowerCase())
        .filter(Boolean),
    );
    filtered = filtered.filter((symbol) => wanted.has(symbol.kind.toLowerCase()));
  }
  if (namePattern) {
    let pattern: RegExp;
    try {
      pattern = new RegExp(namePattern, 'i');
    } catch {
      throw new CliError('INVALID_ARGUMENT', `Invalid --name-pattern '${namePattern}': not a valid regular expression.`, {
        details: { namePattern },
      });
    }
    filtered = filtered.filter((symbol) => pattern.test(symbol.name));
  }
  return filtered;
}

async function readSymbols(
  client: AdtClientWrapper,
  target: VersionTarget,
  flags: InspectFlags,
): Promise<ObjectSymbolsInfo> {
  if (!isClassLike(target.type)) {
    return {
      supported: false,
      reason: `symbols are only available for classes and interfaces (got ${target.type})`,
      count: 0,
      symbols: [],
    };
  }
  const raw = (await client.objectStructureElements(target.objectUrl)) as StructureElementLike[];
  const symbols = filterSymbols(flattenSymbols(raw), flags.kinds, flags.namePattern);
  return { supported: true, count: symbols.length, symbols };
}
