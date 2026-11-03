/**
 * CDS technical objects — ADT wire helpers (DTDC / DTEB / DSFD / DSFI).
 *
 * Two ADT wire families (verified against S/4HANA on 2026-11-03):
 *
 *   source objects (DTDC / DTEB / DSFD)
 *     POST <collection>            → object metadata (versioned XML / blueSource)
 *     GET  <object>                → metadata XML
 *     GET/PUT <object>/source/main → `.acds` CDS source (text/plain)
 *     POST /sap/bc/adt/activation  → activate
 *
 *   DSFI (scalar function implementation reference)
 *     POST /sap/bc/adt/ddic/dsfi   → blueSource metadata
 *     GET/PUT <object>/source/main → the AFF JSON document itself (application/json)
 *
 * SAP-side quirks encoded here:
 *   - DSFD writes require the user parameter `DD_CDS_DSFD` to be enabled; when
 *     it is missing SAP answers with a misleading "Insufficient authorizations
 *     for modifying CDS Scalar Function" message (`mapDsfdFeatureError` turns
 *     that into an actionable error).
 *   - A DSFI name must end with `_ANA` on this release (only the analytical
 *     engine is accepted); the referenced DSFD is the name without the suffix.
 *   - DTEB activation requires the target view entity to allow buffering
 *     (`@AbapCatalog.entityBuffer.definitionAllowed: true`); SAP reports
 *     "Referred entity … is not bufferable".
 */
import { XMLParser } from 'fast-xml-parser';
import { CliError } from '../output/json.js';
import type { CdsTechHeader, CdsTechType, DsfiEngineLocal, DsfiLocal } from '../formats/cds-tech/json.js';

const ADT_CORE_NS = 'http://www.sap.com/adt/core';
const DTDC_NS = 'http://www.sap.com/adt/ddic/dtdcsources';
const DTEB_NS = 'http://www.sap.com/adt/ddic/dtebsources';
const BLUE_NS = 'http://www.sap.com/wbobj/blue';

/** ADT media type of a blue-source object (DSFD / DSFI). */
export const BLUE_MEDIA_TYPE = 'application/vnd.sap.adt.blues.v1+xml';

export interface CdsTechInfo {
  /** ADT object type reported in `adtcore:type`. */
  readonly objtype: string;
  /** POST collection for create. */
  readonly collection: string;
  /** Content type of the create body. */
  readonly createMediaType: string;
  /** Accept/Content type of the metadata resource (source types only). */
  readonly metaMediaType: string;
  /** Content type of `source/main`. */
  readonly sourceMediaType: string;
  /** True when the type has a separate `.acds` source sidecar. */
  readonly hasSourceSidecar: boolean;
  /** ADT name length limit (from typestructure). */
  readonly maxNameLength: number;
  /** SAP user parameter that gates writes, when one exists. */
  readonly featureParameter?: 'DD_CDS_DSFD';
}

/** Endpoint + media type per CDS technical object type. */
export const CDS_TECH_INFO: Record<CdsTechType, CdsTechInfo> = {
  DTDC: {
    objtype: 'DTDC/DF',
    collection: '/sap/bc/adt/ddic/dtdc/sources',
    createMediaType: 'application/vnd.sap.adt.ddic.dtdc.v1+xml',
    metaMediaType: 'application/vnd.sap.adt.ddic.dtdc.v1+xml',
    sourceMediaType: 'text/plain; charset=utf-8',
    hasSourceSidecar: true,
    maxNameLength: 30,
  },
  DTEB: {
    objtype: 'DTEB/DF',
    collection: '/sap/bc/adt/ddic/dteb/sources',
    createMediaType: 'application/vnd.sap.adt.ddic.dteb.v1+xml',
    metaMediaType: 'application/vnd.sap.adt.ddic.dteb.v1+xml',
    sourceMediaType: 'text/plain; charset=utf-8',
    hasSourceSidecar: true,
    maxNameLength: 30,
  },
  DSFD: {
    objtype: 'DSFD/SCF',
    collection: '/sap/bc/adt/ddic/dsfd/sources',
    createMediaType: BLUE_MEDIA_TYPE,
    metaMediaType: BLUE_MEDIA_TYPE,
    sourceMediaType: 'text/plain; charset=utf-8',
    hasSourceSidecar: true,
    maxNameLength: 26,
    featureParameter: 'DD_CDS_DSFD',
  },
  DSFI: {
    objtype: 'DSFI/SFI',
    collection: '/sap/bc/adt/ddic/dsfi',
    createMediaType: BLUE_MEDIA_TYPE,
    metaMediaType: BLUE_MEDIA_TYPE,
    sourceMediaType: 'application/json',
    hasSourceSidecar: false,
    maxNameLength: 40,
  },
};

/** ADT media type of one type's metadata resource. */
export function cdsTechMetaMediaType(type: CdsTechType): string {
  return CDS_TECH_INFO[type].metaMediaType;
}

/** Per-object ADT URL; namespaced names are percent-encoded. */
export function cdsTechObjectUrl(type: CdsTechType, name: string): string {
  return `${CDS_TECH_INFO[type].collection}/${encodeURIComponent(name.toLowerCase())}`;
}

/** `source/main` URL of one object. */
export function cdsTechSourceUrl(type: CdsTechType, name: string): string {
  return `${cdsTechObjectUrl(type, name)}/source/main`;
}

function escapeXmlAttribute(value: string | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface CdsTechWriteMeta {
  /** Target package (create). Omit on update to leave the package untouched. */
  packageName?: string;
  /** Object description (create bodies require it). */
  description?: string;
  /** Logon language reported as `adtcore:language` (defaults to EN). */
  language?: string;
  /** Original language of the object (defaults to `language`). */
  originalLanguage?: string;
}

/**
 * Build the ADT create body. Source-bearing types use their resource root
 * element; DSFD / DSFI use the generic blueSource envelope.
 */
export function buildCdsTechCreateBody(type: CdsTechType, name: string, meta: CdsTechWriteMeta): string {
  const language = (meta.language ?? 'EN').toUpperCase();
  const masterLanguage = (meta.originalLanguage ?? language).toUpperCase();
  const attrs =
    ` adtcore:name="${escapeXmlAttribute(name)}"` +
    ` adtcore:type="${escapeXmlAttribute(CDS_TECH_INFO[type].objtype)}"` +
    ` adtcore:description="${escapeXmlAttribute(meta.description)}"` +
    ` adtcore:language="${escapeXmlAttribute(language)}"` +
    ` adtcore:masterLanguage="${escapeXmlAttribute(masterLanguage)}"`;
  const pkg = meta.packageName
    ? `<adtcore:packageRef adtcore:name="${escapeXmlAttribute(meta.packageName)}"/>`
    : '';
  switch (type) {
    case 'DTDC':
      return (
        '<?xml version="1.0" encoding="utf-8"?>' +
        `<dtdc:dtdcSource xmlns:dtdc="${DTDC_NS}" xmlns:adtcore="${ADT_CORE_NS}"${attrs}>${pkg}</dtdc:dtdcSource>`
      );
    case 'DTEB':
      return (
        '<?xml version="1.0" encoding="utf-8"?>' +
        `<dteb:dtebSource xmlns:dteb="${DTEB_NS}" xmlns:adtcore="${ADT_CORE_NS}"${attrs}>${pkg}</dteb:dtebSource>`
      );
    case 'DSFD':
    case 'DSFI':
      return '<?xml version="1.0" encoding="utf-8"?>' + `<blue:blueSource xmlns:blue="${BLUE_NS}" xmlns:adtcore="${ADT_CORE_NS}"${attrs}>${pkg}</blue:blueSource>`;
  }
}

/** fast-xml-parser result shape used here (attributes prefixed with `@_`). */
type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

function asNode(value: unknown): XmlNode {
  return value !== null && typeof value === 'object' ? (value as XmlNode) : {};
}

function attr(node: XmlNode, name: string): string | undefined {
  const value = node[`@_${name}`];
  return value === undefined || value === null ? undefined : String(value);
}

function parseRoot(type: CdsTechType, xml: string): XmlNode {
  let parsed: XmlNode;
  try {
    parsed = parser.parse(xml) as XmlNode;
  } catch (error) {
    throw new CliError('SAP_ERROR', `Unexpected ${type} response from SAP: XML parse failed: ${error instanceof Error ? error.message : String(error)}`, { type });
  }
  const rootKey = type === 'DTDC' ? 'dtdcSource' : type === 'DTEB' ? 'dtebSource' : 'blueSource';
  const root = parsed[rootKey];
  if (root === undefined) {
    throw new CliError('SAP_ERROR', `Unexpected ${type} response from SAP: expected <${rootKey}> root element`, { type });
  }
  return asNode(root);
}

export interface CdsTechMeta {
  header: CdsTechHeader;
  packageName?: string;
}

/** Project the metadata XML of a CDS technical object onto its AFF header. */
export function parseCdsTechMeta(type: CdsTechType, xml: string): CdsTechMeta {
  const root = parseRoot(type, xml);
  const masterLanguage = attr(root, 'masterLanguage') ?? attr(root, 'language') ?? 'EN';
  const header: CdsTechHeader = {
    description: attr(root, 'description') ?? '',
    originalLanguage: masterLanguage.toLowerCase(),
  };
  // ADT reports `0` / `X` for standard objects and `5` for ABAP Cloud objects.
  const languageVersion = attr(root, 'abapLanguageVersion');
  if (languageVersion === '5') header.abapLanguageVersion = 'cloudDevelopment';
  const packageRef = root['packageRef'];
  const packageName = packageRef === undefined ? undefined : attr(asNode(packageRef), 'name');
  return { header, ...(packageName ? { packageName } : {}) };
}

const DSFI_LANGUAGE_VERSIONS: ReadonlySet<string> = new Set(['standard', 'keyUser', 'cloudDevelopment']);
const DSFI_ENGINES: ReadonlySet<string> = new Set(['analyticalEngine', 'sqlEngine']);

/**
 * Normalise the JSON document served by DSFI's `source/main`.
 *
 * SAP stores an empty `abapLanguageVersion` for standard objects (the AFF
 * schema does not allow the empty string) and may echo server-side values, so
 * the projection is explicit rather than a blind pass-through.
 */
export function parseDsfiSource(source: string): DsfiLocal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new CliError('SAP_ERROR', `Unexpected DSFI response from SAP: source is not JSON: ${error instanceof Error ? error.message : String(error)}`, {
      type: 'DSFI',
      details: { source: source.slice(0, 500) },
    });
  }
  const record = asNode(parsed);
  const headerRaw = asNode(record.header);
  const header: CdsTechHeader = {
    description: String(headerRaw.description ?? ''),
    originalLanguage: String(headerRaw.originalLanguage ?? 'en').toLowerCase(),
  };
  const languageVersion = headerRaw.abapLanguageVersion;
  if (typeof languageVersion === 'string' && DSFI_LANGUAGE_VERSIONS.has(languageVersion)) {
    header.abapLanguageVersion = languageVersion as CdsTechHeader['abapLanguageVersion'];
  }
  const scalarFunctionName = String(record.scalarFunctionName ?? '');
  const doc: DsfiLocal = { formatVersion: '1', header, scalarFunctionName };
  const engine = record.engine;
  if (typeof engine === 'string' && DSFI_ENGINES.has(engine)) {
    doc.engine = engine as DsfiEngineLocal;
  }
  const sqlProperties = asNode(record.sqlProperties);
  if (typeof sqlProperties.amdpReference === 'string' && sqlProperties.amdpReference) {
    doc.sqlProperties = { amdpReference: sqlProperties.amdpReference };
    if (typeof sqlProperties.autoExposedInSqlServices === 'boolean') {
      doc.sqlProperties.autoExposedInSqlServices = sqlProperties.autoExposedInSqlServices;
    }
  }
  return doc;
}

/** Serialise the local DSFI document as the wire JSON body of `source/main`. */
export function buildDsfiSource(doc: DsfiLocal): string {
  const payload: Record<string, unknown> = {
    formatVersion: '1',
    header: {
      description: doc.header.description,
      originalLanguage: doc.header.originalLanguage.toLowerCase(),
      ...(doc.header.abapLanguageVersion ? { abapLanguageVersion: doc.header.abapLanguageVersion } : {}),
    },
    scalarFunctionName: doc.scalarFunctionName,
  };
  if (doc.engine) payload.engine = doc.engine;
  if (doc.sqlProperties) payload.sqlProperties = doc.sqlProperties;
  return JSON.stringify(payload);
}

/**
 * DSFI engine suffixes accepted by the ADT layer. This release only accepts
 * the analytical engine (`_ANA`); the SQL engine exists in the AFF schema but
 * the WB handler rejects every non-analytical suffix.
 */
const DSFI_SUFFIXES: ReadonlyArray<{ suffix: string; engine: DsfiEngineLocal }> = [
  { suffix: '_ANA', engine: 'analyticalEngine' },
];

export interface DsfiNameParts {
  scalarFunctionName: string;
  engine: DsfiEngineLocal;
}

/** Derive (scalar function, engine) from a DSFI object name, or undefined. */
export function dsfiNameParts(name: string): DsfiNameParts | undefined {
  const upper = name.toUpperCase();
  for (const { suffix, engine } of DSFI_SUFFIXES) {
    if (upper.endsWith(suffix) && upper.length > suffix.length) {
      return { scalarFunctionName: upper.slice(0, -suffix.length), engine };
    }
  }
  return undefined;
}

/**
 * Validate the DSFI name/doc relationship before touching SAP:
 *   - the object name must carry a supported engine suffix (`_ANA`);
 *   - `scalarFunctionName` must be the name without that suffix;
 *   - `engine`, when present, must match the suffix's engine.
 */
export function validateDsfiDocument(name: string, doc: DsfiLocal): DsfiNameParts {
  const upper = name.toUpperCase();
  const parts = dsfiNameParts(upper);
  if (!parts) {
    throw new CliError(
      'VALIDATION_ERROR',
      `DSFI name ${upper} must end with a supported engine suffix (_ANA on this release)`,
      {
        object: upper,
        type: 'DSFI',
        nextSteps: [
          'Name the implementation reference `<scalarFunctionName>_ANA`, e.g. `ZCL_RATIO_ANA`.',
          'The referenced scalar function definition (the name without the suffix) must exist and be active.',
        ],
        example: 'abap create DSFI ZCL_MY_FUNC_ANA --file src/zcl_my_func_ana.dsfi.json --package $TMP --yes',
      },
    );
  }
  if (doc.scalarFunctionName.toUpperCase() !== parts.scalarFunctionName) {
    throw new CliError(
      'VALIDATION_ERROR',
      `DSFI ${upper} references scalar function "${doc.scalarFunctionName}" but its name implies "${parts.scalarFunctionName}"`,
      {
        object: upper,
        type: 'DSFI',
        details: { scalarFunctionName: doc.scalarFunctionName, expected: parts.scalarFunctionName },
        nextSteps: [`Set scalarFunctionName to ${parts.scalarFunctionName}, or rename the object.`],
      },
    );
  }
  if (doc.engine !== undefined && doc.engine !== parts.engine) {
    throw new CliError(
      'VALIDATION_ERROR',
      `DSFI ${upper} has engine "${doc.engine}" but its name suffix implies "${parts.engine}"`,
      {
        object: upper,
        type: 'DSFI',
        details: { engine: doc.engine, expected: parts.engine },
        nextSteps: ['Drop the engine field (the suffix decides), or use a matching suffix.'],
      },
    );
  }
  return parts;
}

/**
 * Turn SAP's misleading DSFD feature-gate rejection into an actionable error.
 * Without the `DD_CDS_DSFD` user parameter SAP answers every DSFD create /
 * modify / delete with "Insufficient authorizations for modifying CDS Scalar
 * Function" even though the user's S_DEVELOP authorizations are fine.
 */
export function rethrowDsfdFeatureError(error: unknown): never {
  if (
    error instanceof CliError &&
    /insufficient authorizations for (modifying|deleting|activating) CDS Scalar Function/i.test(error.message)
  ) {
    throw new CliError(
      'DSFD_FEATURE_NOT_ENABLED',
      'SAP rejected the DSFD write because the CDS scalar function feature is not enabled for this user',
      {
        details: { sapMessage: error.message },
        nextSteps: [
          'In SAP GUI, run SU3 → Parameter tab and add ID `DD_CDS_DSFD` with value `X` (then save).',
          'Or enable it for the session with an ABAP helper that runs SET PARAMETER ID \'DD_CDS_DSFD\' FIELD \'X\'.',
          'This is a SAP-side feature switch, not an abap-cli authorization problem.',
        ],
      },
    );
  }
  throw error;
}
