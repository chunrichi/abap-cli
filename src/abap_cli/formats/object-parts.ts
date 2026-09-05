import type { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError } from '../output/json.js';

/** Subtype (abap-file-format name): main, definitions, implementations, macros, testclasses */
export interface ObjectPart {
  subtype: string;
  /** ADT source URI of this part */
  sourceUrl: string;
}

/** Object-level metadata from objectStructure (drives the <name>.<type>.json file).
 *
 * Extended in 0.3.0 to capture the full metadata
 * surface that ADT exposes for PROG / CLAS / INTF objects. Earlier versions
 * only carried 5 fields (description / masterLanguage / programType /
 * objectType / abapLanguageVersion), which silently dropped programStatus /
 * category / descriptions / messageClass / proxy etc. during round-trips —
 * SAP would re-create them with defaults, masking bugs.
 */
export interface ObjectMetadata {
  description?: string;
  masterLanguage?: string;
  /** ADT program:programType — enum ('executableProgram') on real SAP, raw ('1'|'M'|'S'|'I') in mock. */
  programType?: string;
  /** ADT object type (e.g. 'PROG/P', 'PROG/I') from the structure root. */
  objectType?: string;
  /** abapLanguageVersion — "standard" | "cloudDevelopment" | "keyUser" | undefined. */
  abapLanguageVersion?: string;

  // --- T1.1 extensions: PROG fields ---
  /** ADT program:programStatus — enum (sapProductionProgram / customerProductionProgram / systemProgram / testProgram / unknown). */
  programStatus?: string;
  fixPointArithmetic?: boolean;
  editLocked?: boolean;
  startsUsingVariant?: boolean;
  authorizationGroup?: string;
  application?: string;
  /** PROG logical database name. */
  logicalDatabase?: string;
  /** Selection-screen number paired with the logical database. */
  selectionScreen?: string;

  // --- T1.1 extensions: CLAS / INTF fields ---
  /** CLAS category (16 enum values) / INTF category (7 enum values). */
  category?: string;
  /** INTF proxy flag. */
  proxy?: boolean;
  /** CLAS message class. */
  messageClass?: string;

  // --- T1.1 extensions: CDS source marker fields ---
  sourceOrigin?: string;
  sourceType?: string;

  // --- T1.1 extensions: CLAS / INTF method/type descriptions ---
  descriptions?: ObjectDescriptions;
}

export interface ObjectDescription {
  name: string;
  description: string;
  parameters?: ObjectDescription[];
  exceptions?: ObjectDescription[];
}

export interface ObjectDescriptions {
  types?: ObjectDescription[];
  attributes?: ObjectDescription[];
  events?: ObjectDescription[];
  methods?: ObjectDescription[];
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
  const meta = (struc as unknown as { metaData?: Record<string, unknown> }).metaData;
  const metadata: ObjectMetadata = {
    description: stringMeta(meta, 'adtcore:description'),
    masterLanguage: stringMeta(meta, 'adtcore:masterLanguage'),
    abapLanguageVersion:
      stringMeta(meta, 'adtcore:abapLanguageVersion') ?? stringMeta(meta, 'abapLanguageVersion'),
    programType: stringMeta(meta, 'program:programType'),
    programStatus: stringMeta(meta, 'program:programStatus'),
    fixPointArithmetic: booleanMeta(meta, 'abapsource:fixPointArithmetic'),
    editLocked:
      booleanMeta(meta, 'program:lockedByEditor') ?? booleanMeta(meta, 'program:editLocked'),
    startsUsingVariant: booleanMeta(meta, 'program:startsUsingVariant'),
    authorizationGroup: stringMeta(meta, 'program:authorizationGroup'),
    application: stringMeta(meta, 'program:application'),
    logicalDatabase:
      stringMeta(meta, 'program:logicalDatabase') ?? stringMeta(meta, 'program:logicalDatabaseName'),
    selectionScreen: stringMeta(meta, 'program:selectionScreen'),
    category: stringMeta(meta, 'class:category') ?? stringMeta(meta, 'interface:category'),
    proxy: booleanMeta(meta, 'interface:proxy'),
    messageClass:
      stringMeta(meta, 'class:messageClass') ?? stringMeta(meta, 'adtcore:messageClass'),
    objectType: stringMeta(meta, 'adtcore:type'),
    sourceOrigin: stringMeta(meta, 'sourceOrigin'),
    sourceType: stringMeta(meta, 'sourceType'),
  };
  const primaryType = (metadata.objectType ?? '').split('/')[0]?.toUpperCase() ?? '';
  if (primaryType === 'CLAS' || primaryType === 'INTF') {
    // abap-adt-api may not expose objectStructureElements on every ADT build;
    // if it does not, simply omit descriptions (down-stream render skips them).
    const getElements = client.objectStructureElements as unknown as
      | ((url: string) => Promise<unknown[]>)
      | undefined;
    if (getElements) {
      try {
        metadata.descriptions = descriptionsFromElements(await getElements(object.objectUrl));
      } catch {
        // Optional descriptions are unavailable on older ADT implementations.
      }
    }
  }
  const parts: ObjectPart[] = [];
  const push = (subtype: string, sourceUrl: string) =>
    parts.push({ subtype, sourceUrl: absoluteSourceUrl(object.objectUrl, sourceUrl) });
  if ('includes' in struc && struc.includes) {
    for (const inc of struc.includes) {
      push(CLASS_INCLUDE_SUBTYPES[inc['class:includeType']] ?? 'main', inc['abapsource:sourceUri']);
    }
  } else {
    const sourceUri = stringMeta(meta, 'abapsource:sourceUri');
    if (sourceUri) {
      push('main', sourceUri);
    }
  }
  if (parts.length === 0) {
    throw new CliError('SAP_ERROR', `No source parts found for object ${object.name}`, {
      object: object.name,
    });
  }
  return { parts, metadata };
}

function stringMeta(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = meta?.[key];
  return typeof value === 'string' ? value : undefined;
}

function booleanMeta(meta: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = meta?.[key];
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function descriptionsFromElements(rawElements: unknown[]): ObjectDescriptions | undefined {
  const result: ObjectDescriptions = {};
  for (const raw of rawElements) {
    if (!raw || typeof raw !== 'object') continue;
    const element = raw as {
      name?: unknown;
      type?: unknown;
      description?: unknown;
      children?: unknown[];
    };
    if (typeof element.name !== 'string' || typeof element.type !== 'string') continue;
    const item = descriptionOf(element);
    const kind = elementKind(element.type);
    if (kind === 'types' || kind === 'attributes' || kind === 'events') {
      result[kind] = [...(result[kind] ?? []), item];
    } else if (kind === 'methods') {
      result.methods = [
        ...(result.methods ?? []),
        { ...item, ...methodChildren(element.children ?? []) },
      ];
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function descriptionOf(element: { name?: unknown; description?: unknown }): ObjectDescription {
  return {
    name: String(element.name ?? ''),
    description: typeof element.description === 'string' ? element.description : '',
  };
}

function methodChildren(children: unknown[]): Pick<ObjectDescription, 'parameters' | 'exceptions'> {
  const parameters: ObjectDescription[] = [];
  const exceptions: ObjectDescription[] = [];
  for (const raw of children) {
    if (!raw || typeof raw !== 'object') continue;
    const child = raw as { name?: unknown; type?: unknown; description?: unknown };
    if (typeof child.name !== 'string' || typeof child.type !== 'string') continue;
    const item = descriptionOf(child);
    const type = child.type.toUpperCase();
    if (/(EXCEPTION|RAISING|\/EXC|\/MX)$/.test(type)) exceptions.push(item);
    else if (/(PARAMETER|IMPORTING|EXPORTING|CHANGING|RETURNING|\/PAR|\/MP)$/.test(type))
      parameters.push(item);
  }
  return {
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(exceptions.length > 0 ? { exceptions } : {}),
  };
}

function elementKind(type: string): keyof ObjectDescriptions | undefined {
  const value = type.toUpperCase();
  if (/(TYPE|\/DT)$/.test(value)) return 'types';
  if (/(ATTRIBUTE|ATTR|\/DA)$/.test(value)) return 'attributes';
  if (/(EVENT|\/EV)$/.test(value)) return 'events';
  if (/(METHOD|\/ME)$/.test(value)) return 'methods';
  return undefined;
}

/**
 * ADT source URIs may be relative to the object URL (e.g. "source/main") on real
 * systems; abap-adt-api requires an absolute /sap/bc/adt/... path.
 */
function absoluteSourceUrl(objectUrl: string, sourceUrl: string): string {
  if (sourceUrl.startsWith('/')) return sourceUrl;
  return `${objectUrl.replace(/\/$/, '')}/${sourceUrl}`;
}
