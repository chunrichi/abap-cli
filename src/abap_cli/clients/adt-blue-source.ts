/**
 * ADT blueSource resources carrying official AFF documents.
 *
 * Four AFF object types are plain ADT blueSource objects on the reference
 * release (SAP_BASIS 757, verified with real requests): `source/main` *is* the
 * object's official AFF JSON, so the CLI ships the local document verbatim and
 * never maps fields. The lifecycle is the same as the application-job
 * resources (`clients/appjob.ts`):
 *
 *   POST   <collection>                                    → create (metadata)
 *   GET    <collection>/<name>                             → metadata XML
 *   GET    <collection>/<name>/source/main                 → AFF JSON document
 *   PUT    <collection>/<name>/source/main?lockHandle&corrNr → write
 *   PUT    <collection>/<name>?lockHandle&corrNr           → metadata (description) sync
 *   DELETE <collection>/<name>?lockHandle&corrNr           → delete
 *   POST   <collection>/<name>?_action=LOCK|UNLOCK         → lock lifecycle
 *
 * This module only owns per-type addressing and the XML <-> object projection.
 * The HTTP calls live on `AdtClientWrapper` (`getBlueSourceObject`,
 * `getBlueSourceSource`, `createBlueSourceObject`, `writeBlueSourceSource`) and
 * the flow module `formats/aff/adt-transport.ts`.
 */
import { XMLParser } from 'fast-xml-parser';
import { CliError } from '../output/json.js';
import { affObjectToken } from '../formats/file-resolver.js';

const ADT_CORE_NS = 'http://www.sap.com/adt/core';
const BLUE_NS = 'http://www.sap.com/wbobj/blue';

/** ADT media type of a blueSource resource (metadata read/create). */
export const ADT_BLUE_MEDIA_TYPE = 'application/vnd.sap.adt.blues.v1+xml';
/** Media type of the `source/main` document (official AFF JSON). */
export const ADT_BLUE_SOURCE_MEDIA_TYPE = 'application/json';

/** AFF object types transported over ADT blueSource resources. */
export type AdtBlueSourceType = 'APLO' | 'CHDO' | 'EVTB' | 'SMBC';

/** ADT addressing for one AFF object type. */
export interface AdtBlueSourceInfo {
  /** ADT object type reported in `adtcore:type` (activation/discovery). */
  readonly objtype: string;
  /** ADT collection that serves the type (create + object URLs). */
  readonly collection: string;
  /** Human-readable type label used in messages. */
  readonly label: string;
  /** ADT name length limit (TADIR-OBJ_NAME is CHAR 40). */
  readonly maxNameLength: number;
  /** `source/main` PUT saves and activates in one step (no inactive version). */
  readonly autoActive?: boolean;
  /** Local AFF file suffix (`<name>.aplo.json`). */
  readonly jsonSuffix: string;
}

/** Endpoint + limits per ADT-transported AFF type. */
export const ADT_BLUE_SOURCE_INFO: Record<AdtBlueSourceType, AdtBlueSourceInfo> = {
  APLO: {
    objtype: 'APLO/TYP',
    collection: '/sap/bc/adt/applicationlog/objects',
    label: 'Application Log Object',
    maxNameLength: 20,
    autoActive: true,
    jsonSuffix: '.aplo.json',
  },
  CHDO: {
    objtype: 'CHDO/HD',
    collection: '/sap/bc/adt/changedocuments/objects',
    label: 'Change Document Object',
    // Real-system limit: 17-character names are rejected by SAP
    // ("syntax cannot be used for object name"), 13-character names work.
    maxNameLength: 16,
    jsonSuffix: '.chdo.json',
  },
  EVTB: {
    objtype: 'EVTB/EB',
    collection: '/sap/bc/adt/businessservices/evtbevb',
    label: 'Event Binding',
    maxNameLength: 40,
    jsonSuffix: '.evtb.json',
  },
  SMBC: {
    objtype: 'SMBC/TYP',
    collection: '/sap/bc/adt/bct/smbctyp',
    label: 'Business Configuration Maintenance Object',
    maxNameLength: 40,
    jsonSuffix: '.smbc.json',
  },
};

/** AFF object types routed through ADT blueSource resources. */
export const ADT_BLUE_SOURCE_TYPES: readonly AdtBlueSourceType[] = ['APLO', 'CHDO', 'EVTB', 'SMBC'];

/** Narrow an arbitrary type code to the ADT blueSource channel. */
export function isAdtBlueSourceType(type: string | undefined): type is AdtBlueSourceType {
  return type !== undefined && (ADT_BLUE_SOURCE_TYPES as readonly string[]).includes(type.toUpperCase());
}

/** Resolve the addressing info for an ADT-transported AFF type. */
export function adtBlueSourceInfo(type: string): AdtBlueSourceInfo {
  const upper = type.toUpperCase();
  if (!isAdtBlueSourceType(upper)) {
    throw new CliError('TYPE_NOT_SUPPORTED', `Type ${type} is not transported over an ADT blueSource resource`, {
      details: { type },
      nextSteps: [`ADT-transported AFF types: ${ADT_BLUE_SOURCE_TYPES.join(', ')}.`],
    });
  }
  return ADT_BLUE_SOURCE_INFO[upper];
}

/** Per-object ADT URL; the resource addresses object names in lower case. */
export function adtBlueSourceObjectUrl(type: AdtBlueSourceType, name: string): string {
  return `${ADT_BLUE_SOURCE_INFO[type].collection}/${encodeURIComponent(name.toLowerCase())}`;
}

/** `source/main` URL of one object — the official AFF JSON document. */
export function adtBlueSourceSourceUrl(type: AdtBlueSourceType, name: string): string {
  return `${adtBlueSourceObjectUrl(type, name)}/source/main`;
}

/** Expected local file name for the object (`<token>.<type>.json`). */
export function adtBlueSourceFileName(name: string, type: string): string {
  return `${affObjectToken(name)}${adtBlueSourceInfo(type).jsonSuffix}`;
}

function escapeXmlAttribute(value: string | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface AdtBlueSourceWriteMeta {
  /** Target package (create only; omitted on update so SAP keeps the package). */
  packageName?: string;
  /** Object description (metadata). */
  description?: string;
  /** Logon language reported as `adtcore:language` (defaults to EN). */
  language?: string;
  /** Original language of the object (defaults to `language`). */
  originalLanguage?: string;
}

/** Build the ADT blueSource metadata body (create + description sync). */
export function buildAdtBlueSourceBody(
  type: AdtBlueSourceType,
  name: string,
  meta: AdtBlueSourceWriteMeta,
): string {
  const info = ADT_BLUE_SOURCE_INFO[type];
  const language = (meta.language ?? 'EN').toUpperCase();
  const masterLanguage = (meta.originalLanguage ?? language).toUpperCase();
  const attrs =
    ` adtcore:name="${escapeXmlAttribute(name)}"` +
    ` adtcore:type="${info.objtype}"` +
    ` adtcore:description="${escapeXmlAttribute(meta.description)}"` +
    ` adtcore:language="${escapeXmlAttribute(language)}"` +
    ` adtcore:masterLanguage="${escapeXmlAttribute(masterLanguage)}"`;
  const pkg = meta.packageName
    ? `<adtcore:packageRef adtcore:name="${escapeXmlAttribute(meta.packageName)}"/>`
    : '';
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<blue:blueSource xmlns:blue="${BLUE_NS}" xmlns:adtcore="${ADT_CORE_NS}"${attrs}>${pkg}</blue:blueSource>`
  );
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

type XmlNode = Record<string, unknown>;

function asNode(value: unknown): XmlNode {
  return value !== null && typeof value === 'object' ? (value as XmlNode) : {};
}

function attr(node: XmlNode, name: string): string | undefined {
  const value = node[`@_${name}`];
  return value === undefined || value === null ? undefined : String(value);
}

/** Project the blueSource metadata XML onto the fields the CLI needs. */
export interface AdtBlueSourceMeta {
  description: string;
  /** Master language in the AFF spelling (lower-case, e.g. `en`). */
  originalLanguage: string;
  packageName?: string;
}

/** Parse the blueSource metadata XML of an AFF object. */
export function parseAdtBlueSourceMeta(type: AdtBlueSourceType, xml: string): AdtBlueSourceMeta {
  let parsed: XmlNode;
  try {
    parsed = parser.parse(xml) as XmlNode;
  } catch (error: unknown) {
    throw new CliError(
      'SAP_ERROR',
      `Unexpected ${type} response from SAP: XML parse failed: ${error instanceof Error ? error.message : String(error)}`,
      { type },
    );
  }
  const root = parsed.blueSource;
  if (root === undefined) {
    throw new CliError('SAP_ERROR', `Unexpected ${type} response from SAP: expected <blue:blueSource> root element`, {
      type,
    });
  }
  const node = asNode(root);
  const masterLanguage = attr(node, 'masterLanguage') ?? attr(node, 'language') ?? 'EN';
  const packageRef = node.packageRef;
  const packageName = packageRef === undefined ? undefined : attr(asNode(packageRef), 'name');
  return {
    description: attr(node, 'description') ?? '',
    originalLanguage: masterLanguage.toLowerCase(),
    ...(packageName ? { packageName } : {}),
  };
}

/** Action whose rejection is being mapped (drives the not-found wording). */
export type AdtBlueSourceAction = 'create' | 'read' | 'update' | 'delete';

/**
 * Map an ADT transport error onto the CLI contract.
 *
 * `classifyHttpError` (behind `AdtClientWrapper._call`) surfaces every non-auth
 * HTTP failure as `SAP_ERROR` with `details.httpStatus`; this helper re-labels
 * the statuses the AFF channel exposes:
 *   404 → the resource/object is missing (create: resource absent on release);
 *   409 → the object already exists;
 *   400 → the document was rejected by SAP (keep SAP's message);
 *   405 → the release does not expose the operation on this resource.
 */
export function mapAdtBlueSourceError(
  type: AdtBlueSourceType,
  name: string,
  action: AdtBlueSourceAction,
  error: unknown,
): never {
  const info = ADT_BLUE_SOURCE_INFO[type];
  if (!(error instanceof CliError)) throw error;
  const status = (error.details?.httpStatus as number | undefined) ?? undefined;
  const sapErrorBody = typeof error.details?.sapErrorBody === 'string' ? error.details.sapErrorBody : undefined;

  if (status === 404) {
    if (action === 'create') {
      throw new CliError(
        'AFF_UNSUPPORTED',
        `${info.label} creation is not supported by this SAP release: the ADT resource ${info.collection} is not available`,
        {
          type,
          details: { object: name, httpStatus: 404, collection: info.collection },
          nextSteps: [
            'Verify the target release exposes the ADT blueSource resource (SAP_BASIS 757 reference release has it).',
            'Check the deployed CLI version matches the target release.',
          ],
        },
      );
    }
    throw new CliError('OBJECT_NOT_FOUND', `${type} ${name} does not exist`, {
      object: name,
      type,
      nextSteps: [
        'Verify the object name and type in the target system.',
        action === 'update'
          ? `Create it first: abap create ${type} ${name} --file <main AFF document> --package <package> --yes`
          : `Run \`abap search ${name}\` to confirm the object exists.`,
      ],
    });
  }
  if (status === 409) {
    throw new CliError('AFF_ALREADY_EXISTS', `${type} ${name} already exists`, {
      object: name,
      type,
      details: { httpStatus: 409, ...(sapErrorBody ? { sapErrorBody } : {}) },
      nextSteps: [
        '`abap create` only creates new objects; use `abap push` to update an existing one.',
        `Pull the canonical document first: abap pull ${name} --type ${type} --overwrite`,
      ],
    });
  }
  if (status === 400 || status === 422) {
    throw new CliError('VALIDATION_ERROR', `${type} ${name} was rejected by SAP: ${error.message}`, {
      object: name,
      type,
      details: {
        httpStatus: status,
        sapMessage: error.message,
        ...(sapErrorBody ? { sapErrorBody } : {}),
      },
      nextSteps: [
        'Fix the AFF document (or an object it references) and re-run.',
        `Check the document locally: abap validate:aff <main document>`,
      ],
    });
  }
  if (status === 405) {
    throw new CliError('AFF_UNSUPPORTED', `${type} ${name}: this SAP release does not support ${action} on ${info.label}`, {
      object: name,
      type,
      details: { httpStatus: 405, collection: info.collection },
      nextSteps: ['Verify the target release/ADT resource supports the operation.'],
    });
  }
  throw error;
}
