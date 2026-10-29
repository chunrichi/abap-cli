import type { AdtClientWrapper } from '../../clients/adt-client.js';
import { resolveObject } from '../../core/resolve.js';
import { SEARCH_RESULT_LIMIT } from '../../core/limits.js';

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

/** Per-part activation state from `--activation` (013 dogfooding). */
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

export interface InspectResult {
  metadata: ObjectMetadata;
  structure?: ObjectStructureElement[];
  includes?: ObjectInclude[];
  locks?: ObjectLock[];
  activation?: ActivationInfo;
}

export interface InspectFlags {
  structure?: boolean;
  includes?: boolean;
  locks?: boolean;
  package?: boolean;
  /** Compare active vs latest source to verify real activation (read-only). */
  activation?: boolean;
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

  return result;
}

/**
 * Compare active vs latest source for each part and cross-check the ADT
 * inactive-objects list (013 dogfooding lesson: an activate that reports
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
