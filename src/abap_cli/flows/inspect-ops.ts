import type { AdtClientWrapper } from '../clients/adt-client.js';
import { resolveObject } from '../core/resolve.js';
import { SEARCH_RESULT_LIMIT } from '../core/limits.js';

/** Base object metadata — always returned (FR-011). */
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

/** Structure element from `--structure` (FR-012). */
export interface ObjectStructureElement {
  name: string;
  type: string;
  visibility?: string;
  children: ObjectStructureElement[];
}

/** Class include part from `--includes` (FR-012). */
export interface ObjectInclude {
  includeType: string;
  name: string;
  sourceUri: string;
}

/** Lock/transport ownership from `--locks` (FR-012). */
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
  /** true when every source part is fully activated (active == latest). */
  ok: boolean;
  parts: ActivationPart[];
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
 * Inspect an object's metadata read-only (FR-011..014). Never calls lock() —
 * lock/transport ownership is read via transportInfo (research §2).
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
  return { ok: parts.every((p) => p.active), parts };
}
