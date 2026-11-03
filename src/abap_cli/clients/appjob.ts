/**
 * Application-job objects (SAJC / SAJT) — ADT wire helpers.
 *
 * Both types are blue-source objects (POST collection → activate) whose
 * `source/main` resource *is* the object's JSON document:
 *
 *   POST /sap/bc/adt/applicationjob/{catalogs,templates}   → blueSource metadata
 *   GET  /sap/bc/adt/applicationjob/.../<name>              → metadata XML
 *   GET  /sap/bc/adt/applicationjob/.../<name>/source/main  → JSON document
 *   PUT  .../source/main?lockHandle=<handle>                → write JSON document
 *   POST /sap/bc/adt/activation                             → activate
 *
 * The JSON document shape depends on the SAP release (see
 * `formats/appjob/wire.ts`); the `$schema` sub-resource tells us which model
 * the system serves, which is the cheapest capability probe available before a
 * create/push.
 *
 * Verified against SAP_BASIS 757 (S/4HANA reference system, 2026-11):
 * object names are at most 40 characters, `className` must be an existing
 * runnable class, and the flat (legacy) document model is what `source/main`
 * serves. Writing an invalid document answers HTTP 400
 * `SWB_TOOL/036 "… contains errors and therefore cannot be saved"`.
 */
import { XMLParser } from 'fast-xml-parser';
import { CliError } from '../output/json.js';
import type { AppJobHeader, AppJobType } from '../formats/appjob/json.js';

const ADT_CORE_NS = 'http://www.sap.com/adt/core';
const BLUE_NS = 'http://www.sap.com/wbobj/blue';

/** ADT media type of a blue-source resource (metadata read/create). */
export const APPJOB_MEDIA_TYPE = 'application/vnd.sap.adt.blues.v1+xml';
/** Media type of the ADT object-type JSON schema sub-resource. */
export const APPJOB_SCHEMA_MEDIA_TYPE = 'application/vnd.sap.adt.objecttypeschema.v1+json';
/** Media type of the `source/main` JSON document. */
export const APPJOB_SOURCE_MEDIA_TYPE = 'application/json';

export interface AppJobInfo {
  /** ADT object type reported in `adtcore:type` / used for activation. */
  readonly objtype: string;
  /** ADT collection that serves the type (create + object URLs). */
  readonly collection: string;
  /** Human-readable label used in messages. */
  readonly label: string;
  /** ADT name length limit (typestructure OBJNAME_MAXLENGTH). */
  readonly maxNameLength: number;
  /** Local file suffix (`<name>.sajc.json`). */
  readonly jsonSuffix: string;
}

/** Endpoint + limits per application-job type. */
export const APPJOB_INFO: Record<AppJobType, AppJobInfo> = {
  SAJC: {
    objtype: 'SAJC',
    collection: '/sap/bc/adt/applicationjob/catalogs',
    label: 'Application Job Catalog Entry',
    maxNameLength: 40,
    jsonSuffix: '.sajc.json',
  },
  SAJT: {
    objtype: 'SAJT',
    collection: '/sap/bc/adt/applicationjob/templates',
    label: 'Application Job Template',
    maxNameLength: 40,
    jsonSuffix: '.sajt.json',
  },
};

/** Per-object ADT URL; the resource addresses objects in lower case. */
export function appJobObjectUrl(type: AppJobType, name: string): string {
  return `${APPJOB_INFO[type].collection}/${encodeURIComponent(name.toLowerCase())}`;
}

/** `source/main` URL of one object. */
export function appJobSourceUrl(type: AppJobType, name: string): string {
  return `${appJobObjectUrl(type, name)}/source/main`;
}

/** `$schema` URL — tells which JSON document model the release serves. */
export function appJobSchemaUrl(type: AppJobType): string {
  return `${APPJOB_INFO[type].collection}/$schema`;
}

/** JSON file suffix for a type (`.sajc.json` / `.sajt.json`). */
export function appJobSuffix(type: AppJobType): string {
  return APPJOB_INFO[type].jsonSuffix;
}

function escapeXmlAttribute(value: string | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface AppJobWriteMeta {
  /** Target package (create). Omit on update to leave the package untouched. */
  packageName?: string;
  /** Object description (create bodies require it). */
  description?: string;
  /** Logon language reported as `adtcore:language` (defaults to EN). */
  language?: string;
  /** Original language of the object (defaults to `language`). */
  originalLanguage?: string;
}

/** Build the ADT blueSource create body for a catalog entry / template. */
export function buildAppJobCreateBody(type: AppJobType, name: string, meta: AppJobWriteMeta): string {
  const language = (meta.language ?? 'EN').toUpperCase();
  const masterLanguage = (meta.originalLanguage ?? language).toUpperCase();
  const attrs =
    ` adtcore:name="${escapeXmlAttribute(name)}"` +
    ` adtcore:type="${APPJOB_INFO[type].objtype}"` +
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

export interface AppJobMeta {
  header: AppJobHeader;
  packageName?: string;
}

/** Project the blueSource metadata XML onto the AFF header + package. */
export function parseAppJobMeta(type: AppJobType, xml: string): AppJobMeta {
  let parsed: XmlNode;
  try {
    parsed = parser.parse(xml) as XmlNode;
  } catch (error) {
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
  const header: AppJobHeader = {
    description: attr(node, 'description') ?? '',
    originalLanguage: masterLanguage.toLowerCase(),
  };
  // ADT reports `0` / `X` for standard objects and `5` for ABAP Cloud objects.
  const languageVersion = attr(node, 'abapLanguageVersion');
  if (languageVersion === '5') header.abapLanguageVersion = 'cloudDevelopment';
  const packageRef = node.packageRef;
  const packageName = packageRef === undefined ? undefined : attr(asNode(packageRef), 'name');
  return { header, ...(packageName ? { packageName } : {}) };
}

/**
 * Map the application-job save rejection onto an actionable error.
 *
 * The resource answers HTTP 400 with a resource-specific message (localised to
 * the user's logon language, e.g. English "… contains errors and therefore
 * cannot be saved" / Chinese "… 包含错误，因此无法保存") and no field detail. In
 * practice the cause is a referenced object that does not exist or is not
 * accepted (the executed class of a catalog entry, the catalog entry of a
 * template).
 */
export function rethrowAppJobSaveError(type: AppJobType, name: string, error: unknown): never {
  if (error instanceof CliError && error.details?.httpStatus === 400) {
    throw new CliError(
      'VALIDATION_ERROR',
      `${APPJOB_INFO[type].label} ${name} was rejected by SAP: the document or an object it references is not accepted`,
      {
        object: name,
        type,
        httpStatus: 400,
        ...(error.details?.sapErrorBody ? { sapErrorBody: error.details.sapErrorBody } : {}),
        sapMessage: error.message,
        nextSteps:
          type === 'SAJC'
            ? [
                'Check that generalInformation.className points to an existing class that implements the application-job execute interface (or use generalInformation.programName for a report-based entry).',
                'A push/pull round-trip of an existing entry shows the shape SAP expects.',
              ]
            : [
                'Check that generalInformation.catalogName points to an existing, active application job catalog entry (create the SAJC first).',
              ],
      },
    );
  }
  throw error;
}
