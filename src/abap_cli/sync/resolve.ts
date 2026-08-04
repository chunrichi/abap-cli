import type { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError } from '../output/json.js';

/** Single source of truth for bounded result sets (FR-023). */
export const SEARCH_RESULT_LIMIT = 20;

export interface ObjectPart {
  /** Subtype (abap-file-format name): main, definitions, implementations, macros, testclasses */
  subtype: string;
  /** ADT source URI of this part */
  sourceUrl: string;
}

/** Object-level metadata from objectStructure (drives the <name>.<type>.json file). */
export interface ObjectMetadata {
  description?: string;
  masterLanguage?: string;
  /** ADT program:programType — enum ('executableProgram') on real SAP, raw ('1'|'M'|'S'|'I') in mock. */
  programType?: string;
  /** ADT object type (e.g. 'PROG/P', 'PROG/I') from the structure root. */
  objectType?: string;
}

export interface ObjectPartsResult {
  parts: ObjectPart[];
  metadata: ObjectMetadata;
}

export interface ResolvedObject {
  name: string;
  type: string;
  objectUrl: string;
  parts: ObjectPart[];
}

/** Map ADT class include types to abap-file-format subtypes (file-name suffixes). */
const CLASS_INCLUDE_SUBTYPES: Record<string, string> = {
  main: 'main',
  definitions: 'definitions',
  implementations: 'implementations',
  macros: 'macros',
  testclasses: 'testclasses',
};

/**
 * Locate an object by name (optionally filtered by type) and normalize its name.
 * Throws OBJECT_NOT_FOUND / AMBIGUOUS_OBJECT per contracts/cli-commands.md.
 *
 * Real-ADT quirk: the quickSearch endpoint requires `*` wildcards — a bare
 * exact name returns zero hits (verified against vhcala4hci 2026-08-04). We
 * retry with `*NAME*` when the exact-name search finds nothing, then filter
 * for the exact match (mock's substring matching stays compatible).
 */
export async function resolveObject(
  client: AdtClientWrapper,
  name: string,
  type?: string,
): Promise<ResolvedObject> {
  const normalized = name.trim().toUpperCase();
  let results = await client.searchObject(normalized, type, SEARCH_RESULT_LIMIT);
  if (results.length === 0) {
    // Real ADT needs wildcards; fall back to *NAME* so exact objects resolve.
    results = await client.searchObject(`*${normalized}*`, type, SEARCH_RESULT_LIMIT);
  }
  const matches = results.filter((r) => r['adtcore:name'] === normalized);
  if (matches.length === 0) {
    throw new CliError('OBJECT_NOT_FOUND', `Object ${normalized} not found in system`, {
      details: { object: normalized },
      nextSteps: ["Verify the name: 'abap search <query>'.", "Confirm the active system: 'abap connection test <name>'."],
      example: `abap search ${normalized}`,
    });
  }
  if (matches.length > 1 && !type) {
    throw new CliError('AMBIGUOUS_OBJECT', `Object ${normalized} matches multiple types; specify --type`, {
      object: normalized,
      types: matches.map((m) => m['adtcore:type']),
    });
  }
  // matches.length > 0 guaranteed by the checks above
  const hit = matches[0]!;
  return { name: hit['adtcore:name'], type: hit['adtcore:type'], objectUrl: hit['adtcore:uri'], parts: [] };
}

/** Fetch all source parts (class includes or the single main part) of an object. */
export async function getObjectParts(
  client: AdtClientWrapper,
  object: { name: string; objectUrl: string },
  retries = 0,
  delayMs = 400,
): Promise<ObjectPart[]> {
  const result = await getObjectPartsWithMeta(client, object, retries, delayMs);
  return result.parts;
}

/** Fetch source parts plus object metadata in one objectStructure call. */
export async function getObjectPartsWithMeta(
  client: AdtClientWrapper,
  object: { name: string; objectUrl: string },
  retries = 0,
  delayMs = 400,
): Promise<ObjectPartsResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await getObjectPartsOnce(client, object);
    } catch (error: unknown) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

async function getObjectPartsOnce(
  client: AdtClientWrapper,
  object: { name: string; objectUrl: string },
): Promise<ObjectPartsResult> {
  const struc = await client.objectStructure(object.objectUrl);
  const meta = (struc as { metaData?: { 'adtcore:description'?: string; 'adtcore:masterLanguage'?: string; 'abapsource:sourceUri'?: string; 'program:programType'?: string; 'adtcore:type'?: string } }).metaData;
  const metadata: ObjectMetadata = {
    description: meta?.['adtcore:description'],
    masterLanguage: meta?.['adtcore:masterLanguage'],
    programType: meta?.['program:programType'],
    objectType: meta?.['adtcore:type'],
  };
  const parts: ObjectPart[] = [];
  const push = (subtype: string, sourceUrl: string) =>
    parts.push({ subtype, sourceUrl: absoluteSourceUrl(object.objectUrl, sourceUrl) });
  if ('includes' in struc && struc.includes) {
    for (const inc of struc.includes) {
      push(CLASS_INCLUDE_SUBTYPES[inc['class:includeType']] ?? 'main', inc['abapsource:sourceUri']);
    }
  } else {
    if (meta?.['abapsource:sourceUri']) {
      push('main', meta['abapsource:sourceUri']);
    }
  }
  if (parts.length === 0) {
    throw new CliError('SAP_ERROR', `No source parts found for object ${object.name}`, { object: object.name });
  }
  return { parts, metadata };
}

/**
 * ADT source URIs may be relative to the object URL (e.g. "source/main") on real
 * systems; abap-adt-api requires an absolute /sap/bc/adt/... path.
 */
function absoluteSourceUrl(objectUrl: string, sourceUrl: string): string {
  if (sourceUrl.startsWith('/')) return sourceUrl;
  return `${objectUrl.replace(/\/$/, '')}/${sourceUrl}`;
}

/** Reject DDIC (ICF route) files in this phase. */
export function validateLocalFile(resolved: { objectName: string; objectType: string; route: string }): void {
  if (resolved.route === 'icf') {
    throw new CliError(
      'DDIC_NOT_SUPPORTED',
      `Object ${resolved.objectName} (${resolved.objectType}) is a DDIC object; not supported in this phase`,
      { object: resolved.objectName, type: resolved.objectType },
    );
  }
}
