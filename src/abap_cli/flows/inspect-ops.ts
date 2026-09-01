import type { AdtClientWrapper } from '../clients/adt-client.js';
import { resolveObject } from '../core/resolve.js';
import { SEARCH_RESULT_LIMIT } from '../core/limits.js';

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
}

export interface ActivationInfo {
  /**
   * true when the implementation parts (`implementations` / `definitions` /
   * `testclasses` / `macros`) are all active. The ADT `main` part is the
   * class's standalone include — its `active` flag carries SAP GUI's
   * "INCLUDE program not separately activated" semantics, which doesn't
   * mean the class is inactive.
   */
  ok: boolean;
  parts: ActivationPart[];
  /** Per-part reasons when `ok === false` (debug aid; not part of the ok contract). */
  inactive?: { includeType: string; reason: 'stale_active' }[];
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
    result.activation = await checkActivation(client, resolved.objectUrl, structure.includes);
  }

  return result;
}

/**
 * Compare active vs latest source for each part (013 dogfooding lesson: an
 * activate that reports success may leave active == stale skeleton). Read-only.
 */
async function checkActivation(
  client: AdtClientWrapper,
  objectUrl: string,
  includes: Array<{ 'class:includeType'?: string; 'abapsource:sourceUri'?: string }>,
): Promise<ActivationInfo> {
  const parts: ActivationPart[] = [];
  for (const inc of includes) {
    const sourceUri = inc['abapsource:sourceUri'] ?? '';
    const abs = sourceUri.startsWith('/') ? sourceUri : `${objectUrl.replace(/\/$/, '')}/${sourceUri}`;
    let active = false;
    try {
      const [latest, activeSrc] = await Promise.all([
        client.getObjectSource(abs),
        client.raw.getObjectSource(abs, { version: 'active' }),
      ]);
      active = latest === activeSrc;
    } catch {
      active = false;
    }
    parts.push({ includeType: inc['class:includeType'] ?? 'main', sourceUri, active });
  }
  // ADT `includeType:main` reports active=false for the INCLUDE program even
  // when the class itself is fully active. Treat only the implementation parts
  // (`implementations` / `definitions` / `testclasses` / `macros`) as the source
  // of truth — `main` is reported for visibility but excluded from the ok flag.
  const IMPLEMENTATION_PARTS = new Set(['implementations', 'definitions', 'testclasses', 'macros']);
  const implementationParts = parts.filter((p) => IMPLEMENTATION_PARTS.has(p.includeType));
  const inactiveImplementation = implementationParts.filter((p) => !p.active);
  const ok = inactiveImplementation.length === 0;
  const inactive = inactiveImplementation.length > 0
    ? inactiveImplementation.map((p) => ({ includeType: p.includeType, reason: 'stale_active' as const }))
    : undefined;
  return inactive ? { ok, parts, inactive } : { ok, parts };
}
