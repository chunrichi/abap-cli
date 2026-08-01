import type { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError } from '../output/json.js';

export interface ObjectPart {
  /** Subtype: main, locals_def, locals_imp, macros, testclasses */
  subtype: string;
  /** ADT source URI of this part */
  sourceUrl: string;
}

export interface ResolvedObject {
  name: string;
  type: string;
  objectUrl: string;
  parts: ObjectPart[];
}

/** Map ADT class include types to abap-file-format subtypes. */
const CLASS_INCLUDE_SUBTYPES: Record<string, string> = {
  main: 'main',
  definitions: 'locals_def',
  implementations: 'locals_imp',
  macros: 'macros',
  testclasses: 'testclasses',
};

/**
 * Locate an object by name (optionally filtered by type) and normalize its name.
 * Throws OBJECT_NOT_FOUND / AMBIGUOUS_OBJECT per contracts/cli-commands.md.
 */
export async function resolveObject(
  client: AdtClientWrapper,
  name: string,
  type?: string,
): Promise<ResolvedObject> {
  const normalized = name.trim().toUpperCase();
  const results = await client.searchObject(normalized, type, 10);
  const matches = results.filter((r) => r['adtcore:name'] === normalized);
  if (matches.length === 0) {
    throw new CliError('OBJECT_NOT_FOUND', `Object ${normalized} not found in system`, { object: normalized });
  }
  if (matches.length > 1 && !type) {
    throw new CliError('AMBIGUOUS_OBJECT', `Object ${normalized} matches multiple types; specify --type`, {
      object: normalized,
      types: matches.map((m) => m['adtcore:type']),
    });
  }
  const hit = matches[0];
  return { name: hit['adtcore:name'], type: hit['adtcore:type'], objectUrl: hit['adtcore:uri'], parts: [] };
}

/** Fetch all source parts (class includes or the single main part) of an object. */
export async function getObjectParts(
  client: AdtClientWrapper,
  object: { name: string; objectUrl: string },
): Promise<ObjectPart[]> {
  const struc = await client.objectStructure(object.objectUrl);
  const parts: ObjectPart[] = [];
  const push = (subtype: string, sourceUrl: string) =>
    parts.push({ subtype, sourceUrl: absoluteSourceUrl(object.objectUrl, sourceUrl) });
  if ('includes' in struc && struc.includes) {
    for (const inc of struc.includes) {
      push(CLASS_INCLUDE_SUBTYPES[inc['class:includeType']] ?? 'main', inc['abapsource:sourceUri']);
    }
  } else {
    const meta = struc.metaData as { 'abapsource:sourceUri'?: string };
    if (meta['abapsource:sourceUri']) {
      push('main', meta['abapsource:sourceUri']);
    }
  }
  if (parts.length === 0) {
    throw new CliError('SAP_ERROR', `No source parts found for object ${object.name}`, { object: object.name });
  }
  return parts;
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
