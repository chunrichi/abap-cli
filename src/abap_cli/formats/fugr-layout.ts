import type { AdtClientWrapper } from '../clients/adt-client.js';

/**
 * Shared FUGR sub-object layout — used by both pull and push so that what is
 * pulled (files) maps back to the exact ADT source URIs it came from.
 *
 * File-name conventions (see fugr README):
 *   <group>.fugr.sapl<group>.reps.*   → function-pool main program (FUGR source/main)
 *   <group>.fugr.l<group>....reps.*   → a FUGR/I include (e.g. l<group>top)
 *   <group>.fugr.<fm>.func.*          → a function module (FUGR/FF)
 */

export interface FugrSubObject {
  /** Object name, upper case (e.g. LZFG_WECHAT_TABLETOP, TABLEFRAME_ZFG_WECHAT_TABLE). */
  name: string;
  /** ADT object URL — the lock/unlock target (e.g. .../includes/lzfg_wechat_tabletop). */
  objectUrl: string;
  /** Absolute source URI (setObjectSource/getObjectSource target). */
  sourceUrl: string;
  /** Object description from the sub-object structure. */
  description: string;
}

export interface FugrFunc extends FugrSubObject {
  /** Raw fmodule:processingType (e.g. 'normal', 'rfc', 'update'). */
  processingType?: string;
}

export interface FugrLayout {
  /** Upper-case group name (e.g. ZFG_WECHAT_TABLE). */
  group: string;
  /** Lower-case group name (e.g. zfg_wechat_table). */
  groupLow: string;
  /** Function-pool main program source URI (= FUGR source/main). */
  saplUrl: string;
  /** FUGR/I includes (UXX included; callers skip it as the spec does). */
  includes: FugrSubObject[];
  /** FUGR/FF function modules. */
  funcs: FugrFunc[];
}

interface SearchHit {
  name: string;
  type: string;
  uri: string;
}

/** Search sub-objects via the untyped quickSearch (real ADT returns them per query). */
async function searchHits(client: AdtClientWrapper, query: string): Promise<SearchHit[]> {
  const results = await client.searchObject(query, '', 200);
  return results.map((r) => ({
    name: r['adtcore:name'],
    type: r['adtcore:type'],
    uri: r['adtcore:uri'],
  }));
}

/** Enumerate a function group's main program, includes and function modules. */
export async function enumerateFugr(client: AdtClientWrapper, objectUrl: string): Promise<FugrLayout> {
  const struc = await client.objectStructure(objectUrl);
  const meta = struc.metaData as unknown as Record<string, unknown>;
  const group = String(meta['adtcore:name'] ?? '').toUpperCase();
  const groupLow = group.toLowerCase();

  const includeHits = await searchHits(client, `L${group}*`);
  const includes: FugrSubObject[] = [];
  for (const h of includeHits.filter((x) => x.type.startsWith('FUGR/I') && x.name.startsWith(`L${group}`))) {
    includes.push(await subObject(client, h.uri));
  }

  const funcHits = await searchHits(client, `*${group}*`);
  const funcs: FugrFunc[] = [];
  for (const h of funcHits.filter((x) => x.type.startsWith('FUGR/FF') && x.uri.includes(`/functions/groups/${groupLow}/fmodules/`))) {
    funcs.push(await subObject(client, h.uri));
  }

  const saplUrl = absolute(meta['abapsource:sourceUri'] as string, objectUrl);
  return { group, groupLow, saplUrl, includes, funcs };
}

/** Fetch one sub-object's source URI + metadata from its ADT object URL. */
async function subObject(client: AdtClientWrapper, objectUrl: string): Promise<FugrSubObject> {
  const struc = await client.objectStructure(objectUrl);
  const meta = struc.metaData as unknown as Record<string, unknown>;
  return {
    name: String(meta['adtcore:name'] ?? '').toUpperCase(),
    objectUrl,
    sourceUrl: absolute(meta['abapsource:sourceUri'] as string, objectUrl),
    description: (meta['adtcore:description'] as string) ?? '',
    ...('fmodule:processingType' in meta ? { processingType: meta['fmodule:processingType'] as string } : {}),
  };
}

/**
 * Map a local FUGR file subtype (the dotted suffix after <group>.fugr) to its
 * ADT source URI, or undefined when the file has no source counterpart
 * (e.g. metadata .json files).
 */
export function fugrSourceUrlForSubtype(layout: FugrLayout, subtype: string): string | undefined {
  return fugrPushTargetFor(layout, subtype, '')?.sourceUrl;
}

/** Lock/unlock + write target for a local FUGR file subtype. */
export interface FugrPushTarget {
  /** ADT object URL — the lock/unlock target. */
  objectUrl: string;
  /** Absolute source URI to write. */
  sourceUrl: string;
}

/** Resolve the lock target + source URI for a FUGR file subtype. */
export function fugrPushTargetFor(layout: FugrLayout, subtype: string, groupObjectUrl: string): FugrPushTarget | undefined {
  if (subtype === `sapl${layout.groupLow}.reps`) return { objectUrl: groupObjectUrl, sourceUrl: layout.saplUrl };
  if (subtype.endsWith('.reps')) {
    const incName = subtype.slice(0, -'.reps'.length).toUpperCase();
    const inc = layout.includes.find((i) => i.name === incName);
    return inc ? { objectUrl: inc.objectUrl, sourceUrl: inc.sourceUrl } : undefined;
  }
  if (subtype.endsWith('.func')) {
    const fmName = subtype.slice(0, -'.func'.length).toUpperCase();
    const fm = layout.funcs.find((f) => f.name === fmName);
    return fm ? { objectUrl: fm.objectUrl, sourceUrl: fm.sourceUrl } : undefined;
  }
  return undefined;
}

/** ADT source URIs may be relative to the object URL. */
function absolute(sourceUrl: string, objectUrl: string): string {
  if (sourceUrl.startsWith('/')) return sourceUrl;
  return `${objectUrl.replace(/\/$/, '')}/${sourceUrl}`;
}
