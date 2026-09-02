import type { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError } from '../output/json.js';

/** Subtype (abap-file-format name): main, definitions, implementations, macros, testclasses */
export interface ObjectPart {
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
  /** abapLanguageVersion — "standard" | "cloudDevelopment" | "keyUser" | undefined. */
  abapLanguageVersion?: string;
}

export interface ObjectPartsResult {
  parts: ObjectPart[];
  metadata: ObjectMetadata;
}

/** Map ADT class include types to abap-file-format subtypes (file-name suffixes). */
const CLASS_INCLUDE_SUBTYPES: Record<string, string> = {
  main: 'main',
  definitions: 'definitions',
  implementations: 'implementations',
  macros: 'macros',
  testclasses: 'testclasses',
};

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
  const meta = (struc as { metaData?: { 'adtcore:description'?: string; 'adtcore:masterLanguage'?: string; 'abapsource:sourceUri'?: string; 'program:programType'?: string; 'adtcore:type'?: string; 'adtcore:abapLanguageVersion'?: string } }).metaData;
  const metadata: ObjectMetadata = {
    description: meta?.['adtcore:description'],
    masterLanguage: meta?.['adtcore:masterLanguage'],
    programType: meta?.['program:programType'],
    objectType: meta?.['adtcore:type'],
    abapLanguageVersion: meta?.['adtcore:abapLanguageVersion'],
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
