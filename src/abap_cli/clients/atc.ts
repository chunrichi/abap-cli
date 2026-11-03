/**
 * ATC configuration objects — ADT wire helpers (CHKC / CHKO / CHKV).
 *
 * ADT exposes the three abap-file-format (AFF) objects as versioned XML
 * resources (verified against S/4HANA on 2026-11-03):
 *
 *   CHKC  /sap/bc/adt/atc/checkcategories/<name>   chkcv1+xml
 *   CHKO  /sap/bc/adt/atc/checks/<name>            chkov1+xml
 *   CHKV  /sap/bc/adt/atc/checkvariants/<name>     chkvv4+xml
 *
 * `abap-adt-api` has no endpoint for these, so the CLI builds and parses the
 * XML itself (same pattern as `clients/srvb.ts`). Create posts the collection,
 * update is a locked PUT of the resource, and both need an explicit activate
 * before the object becomes usable.
 *
 * Mapping notes:
 *   - CHKO `parameters[].hidden` ↔ wire `parameterModifiable` (inverse).
 *   - CHKO `checkType` (`local` / `remoteEnabled`) ↔ `<chko:remoteEnabled>`.
 *   - CHKV `selectedChecks[]` is carried on the wire as one
 *     `<chkvcheck:parameterValueXml>` JSON fragment per check (the fragment is
 *     the AFF check object itself, so it round-trips verbatim).
 *   - `header.abapLanguageVersion`: AFF uses space/`5` for
 *     standard/cloudDevelopment; the ADT resource reports `0`/`X` for
 *     standard. `standard` is the schema default and is omitted on pull.
 */
import { XMLParser } from 'fast-xml-parser';
import { CliError } from '../output/json.js';
import type {
  AtcHeader,
  AtcLocal,
  AtcType,
  ChkcLocal,
  ChkoLocal,
  ChkvCheckLocal,
  ChkvLocal,
} from '../formats/atc/json.js';

const ADT_CORE_NS = 'http://www.sap.com/adt/core';
const CHKC_NS = 'http://www.sap.com/wbobj/atc/chkc';
const CHKO_NS = 'http://www.sap.com/wbobj/atc/chko';
const CHKO_PARAMETER_NS = 'http://www.sap.com/wbobj/atc/chkoParameter';
const CHKV_NS = 'http://www.sap.com/wbobj/atc/chkv';
const CHKV_CHECK_NS = 'http://www.sap.com/wbobj/atc/chkvCheck';

export interface AtcTypeInfo {
  /** ADT collection path; the object URL appends `/<lowercase name>`. */
  readonly basePath: string;
  /** Content type of the XML resource (also used as the create/PUT body type). */
  readonly mediaType: string;
  /** ADT object type reported in `adtcore:type`. */
  readonly objtype: string;
}

/** Endpoint + media type per ATC object type. */
export const ATC_TYPE_INFO: Record<AtcType, AtcTypeInfo> = {
  CHKC: {
    basePath: '/sap/bc/adt/atc/checkcategories',
    mediaType: 'application/vnd.sap.adt.chkcv1+xml',
    objtype: 'CHKC/TYP',
  },
  CHKO: {
    basePath: '/sap/bc/adt/atc/checks',
    mediaType: 'application/vnd.sap.adt.chkov1+xml',
    objtype: 'CHKO/TYP',
  },
  CHKV: {
    basePath: '/sap/bc/adt/atc/checkvariants',
    mediaType: 'application/vnd.sap.adt.chkvv4+xml',
    objtype: 'CHKV/TYP',
  },
};

/** ADT media type of one ATC object type. */
export function atcMediaType(type: AtcType): string {
  return ATC_TYPE_INFO[type].mediaType;
}

/** Per-object ADT URL; namespaced names are percent-encoded. */
export function atcObjectUrl(type: AtcType, name: string): string {
  return `${ATC_TYPE_INFO[type].basePath}/${encodeURIComponent(name.toLowerCase())}`;
}

function escapeXmlAttribute(value: string | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeXmlText(value: string | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export interface AtcWriteMeta {
  /**
   * Target package (create) / current package (update). Omit on update to
   * leave the package reference out of the PUT body — ADT keeps the existing
   * package.
   */
  packageName?: string;
  /** Logon language reported as `adtcore:language` (defaults to EN). */
  language?: string;
}

/** Map the AFF cloud-only language version enum onto the ADT attribute. */
function languageVersionAttribute(header: AtcHeader): string {
  return header.abapLanguageVersion === 'cloudDevelopment' ? ' adtcore:abapLanguageVersion="5"' : '';
}

function atcHeaderAttributes(name: string, objtype: string, header: AtcHeader, language: string): string {
  return (
    ` adtcore:name="${escapeXmlAttribute(name)}"` +
    ` adtcore:type="${escapeXmlAttribute(objtype)}"` +
    ` adtcore:description="${escapeXmlAttribute(header.description)}"` +
    ` adtcore:language="${escapeXmlAttribute(language)}"` +
    ` adtcore:masterLanguage="${escapeXmlAttribute((header.originalLanguage || language).toUpperCase())}"` +
    languageVersionAttribute(header)
  );
}

function packageRef(packageName: string | undefined): string {
  return packageName ? `<adtcore:packageRef adtcore:name="${escapeXmlAttribute(packageName)}"/>` : '';
}

function buildChkcBody(name: string, doc: ChkcLocal, opts: AtcWriteMeta): string {
  const language = (opts.language ?? 'EN').toUpperCase();
  const category = doc.parentCategory
    ? `<chkc:category adtcore:name="${escapeXmlAttribute(doc.parentCategory)}"/>`
    : '<chkc:category/>';
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<chkc:checkCategoryObject xmlns:chkc="${CHKC_NS}" xmlns:adtcore="${ADT_CORE_NS}"` +
    atcHeaderAttributes(name, ATC_TYPE_INFO.CHKC.objtype, doc.header, language) +
    '>' +
    packageRef(opts.packageName) +
    `<chkc:content>${category}</chkc:content>` +
    '</chkc:checkCategoryObject>'
  );
}

function buildChkoBody(name: string, doc: ChkoLocal, opts: AtcWriteMeta): string {
  const language = (opts.language ?? 'EN').toUpperCase();
  const remoteEnabled = doc.checkType === 'remoteEnabled';
  const parameters = (doc.parameters ?? [])
    .map(
      (param, index) =>
        '<chkoParameter:parameter>' +
        `<chkoParameter:parameterTechnicalId>${index + 1}</chkoParameter:parameterTechnicalId>` +
        `<chkoParameter:parameterName>${escapeXmlText(param.name)}</chkoParameter:parameterName>` +
        `<chkoParameter:parameterDescription>${escapeXmlText(param.description)}</chkoParameter:parameterDescription>` +
        `<chkoParameter:parameterModifiable>${param.hidden === true ? 'false' : 'true'}</chkoParameter:parameterModifiable>` +
        '</chkoParameter:parameter>',
    )
    .join('');
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<chko:checkObject xmlns:chko="${CHKO_NS}" xmlns:adtcore="${ADT_CORE_NS}"` +
    atcHeaderAttributes(name, ATC_TYPE_INFO.CHKO.objtype, doc.header, language) +
    '>' +
    packageRef(opts.packageName) +
    '<chko:content>' +
    `<chko:category adtcore:name="${escapeXmlAttribute(doc.category)}"/>` +
    `<chko:implementingClass adtcore:name="${escapeXmlAttribute(doc.implementingClass)}"/>` +
    `<chko:remoteEnabled>${remoteEnabled ? 'true' : 'false'}</chko:remoteEnabled>` +
    (parameters
      ? `<chkoParameter:parameters xmlns:chkoParameter="${CHKO_PARAMETER_NS}">${parameters}</chkoParameter:parameters>`
      : '') +
    '</chko:content></chko:checkObject>'
  );
}

function buildChkvBody(name: string, doc: ChkvLocal, opts: AtcWriteMeta): string {
  const language = (opts.language ?? 'EN').toUpperCase();
  const checks = doc.selectedChecks
    .map((check) => {
      const payload: Record<string, unknown> = { checkName: check.checkName };
      if (check.parameters !== undefined) payload.parameters = check.parameters;
      return (
        `<chkvcheck:check xmlns:chkvcheck="${CHKV_CHECK_NS}">` +
        `<chko:checkObject adtcore:name="${escapeXmlAttribute(check.checkName)}" xmlns:chko="${CHKO_NS}"><chko:content/></chko:checkObject>` +
        `<chkvcheck:parameterValueXml>${escapeXmlText(JSON.stringify(payload))}</chkvcheck:parameterValueXml>` +
        '</chkvcheck:check>'
      );
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<chkv:checkvariant xmlns:chkv="${CHKV_NS}" xmlns:adtcore="${ADT_CORE_NS}"` +
    atcHeaderAttributes(name, ATC_TYPE_INFO.CHKV.objtype, doc.header, language) +
    '>' +
    packageRef(opts.packageName) +
    '<chkv:content>' +
    `<chkv:name>${escapeXmlText(name)}</chkv:name>` +
    `<chkv:remoteEnabled>${doc.remoteEnabled === true ? 'true' : 'false'}</chkv:remoteEnabled>` +
    '<chkv:referencedVariant/>' +
    checks +
    '</chkv:content></chkv:checkvariant>'
  );
}

/**
 * Build the ADT XML body for create (POST) and update (locked PUT).
 *
 * Both operations send the same document shape: the create response and a
 * subsequent GET return the same envelope, so the update body can be rebuilt
 * from the local AFF document without echoing server attributes.
 */
export function buildAtcBody(type: AtcType, name: string, doc: AtcLocal, opts: AtcWriteMeta): string {
  switch (type) {
    case 'CHKC':
      return buildChkcBody(name, doc as ChkcLocal, opts);
    case 'CHKO':
      return buildChkoBody(name, doc as ChkoLocal, opts);
    case 'CHKV':
      return buildChkvBody(name, doc as ChkvLocal, opts);
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

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function asNode(value: unknown): XmlNode {
  return value !== null && typeof value === 'object' ? (value as XmlNode) : {};
}

function attr(node: XmlNode, name: string): string | undefined {
  const value = node[`@_${name}`];
  return value === undefined || value === null ? undefined : String(value);
}

function text(node: unknown): string {
  if (node === undefined || node === null) return '';
  if (typeof node === 'object') {
    const value = (node as XmlNode)['#text'];
    return value === undefined ? '' : String(value);
  }
  return String(node);
}

function invalidWire(type: AtcType, reason: string): never {
  throw new CliError('SAP_ERROR', `Unexpected ${type} response from SAP: ${reason}`, {
    type,
    details: { reason },
    nextSteps: ['The ADT resource returned a body this CLI does not understand; check the ADT release and report the response shape.'],
  });
}

function parseRoot(type: AtcType, xml: string): XmlNode {
  let parsed: XmlNode;
  try {
    parsed = parser.parse(xml) as XmlNode;
  } catch (error) {
    invalidWire(type, `XML parse failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const rootKey = type === 'CHKC' ? 'checkCategoryObject' : type === 'CHKO' ? 'checkObject' : 'checkvariant';
  const root = parsed[rootKey];
  if (root === undefined) invalidWire(type, `expected <${rootKey}> root element`);
  return asNode(root);
}

function headerFromWire(root: XmlNode): AtcHeader {
  const description = attr(root, 'description') ?? '';
  const masterLanguage = attr(root, 'masterLanguage') ?? attr(root, 'language') ?? 'EN';
  const header: AtcHeader = {
    description,
    originalLanguage: masterLanguage.toLowerCase(),
  };
  // ADT reports `0` / `X` for standard objects and `5` for ABAP Cloud objects.
  const languageVersion = attr(root, 'abapLanguageVersion');
  if (languageVersion === '5') header.abapLanguageVersion = 'cloudDevelopment';
  return header;
}

/** Package name declared by the object's `<adtcore:packageRef>` (for delete rules). */
export function parseAtcPackageName(type: AtcType, xml: string): string | undefined {
  const root = parseRoot(type, xml);
  const packageRefNode = root['packageRef'];
  if (packageRefNode === undefined) return undefined;
  return attr(asNode(packageRefNode), 'name');
}

function parseChkc(xml: string): ChkcLocal {
  const root = parseRoot('CHKC', xml);
  const content = asNode(root['content']);
  const category = asNode(content['category']);
  const parent = attr(category, 'name');
  const doc: ChkcLocal = {
    formatVersion: '1',
    header: headerFromWire(root),
  };
  if (parent) doc.parentCategory = parent;
  return doc;
}

function parseChko(xml: string): ChkoLocal {
  const root = parseRoot('CHKO', xml);
  const content = asNode(root['content']);
  const category = asNode(content['category']);
  const implementingClass = asNode(content['implementingClass']);
  const doc: ChkoLocal = {
    formatVersion: '1',
    header: headerFromWire(root),
    category: attr(category, 'name') ?? '',
    implementingClass: attr(implementingClass, 'name') ?? '',
    checkType: text(content['remoteEnabled']).toLowerCase() === 'true' ? 'remoteEnabled' : 'local',
  };
  const parameters = asArray(content['parameters'] !== undefined ? asNode(content['parameters'])['parameter'] : undefined).map(
    (entry) => {
      const param = asNode(entry);
      const name = text(param['parameterName']);
      const description = text(param['parameterDescription']);
      // A missing flag means the attribute is editable (SAP omits the element
      // only for older payloads); only an explicit `false` maps to hidden.
      const modifiableRaw = text(param['parameterModifiable']).toLowerCase();
      const modifiable = modifiableRaw === '' ? true : modifiableRaw === 'true';
      return {
        ...(name ? { name } : {}),
        ...(description ? { description } : {}),
        ...(modifiable ? {} : { hidden: true }),
      };
    },
  );
  if (parameters.length > 0) doc.parameters = parameters;
  return doc;
}

/** Parse one wire `parameterValueXml` JSON fragment into an AFF check object. */
function parseCheckFragment(checkName: string, fragment: string): ChkvCheckLocal {
  const trimmed = fragment.trim();
  if (!trimmed) return { checkName };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new CliError(
      'SAP_ERROR',
      `Unexpected CHKV response from SAP: parameterValueXml is not JSON: ${error instanceof Error ? error.message : String(error)}`,
      {
        type: 'CHKV',
        details: { checkName, fragment: trimmed.slice(0, 500) },
        nextSteps: ['The ATC variant payload embeds JSON per check; a non-JSON value usually means the ADT release changed its shape.'],
      },
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new CliError('SAP_ERROR', 'Unexpected CHKV response from SAP: parameterValueXml is not a JSON object', {
      type: 'CHKV',
      details: { checkName },
    });
  }
  const record = parsed as Record<string, unknown>;
  const parsedName = typeof record.checkName === 'string' && record.checkName ? record.checkName : checkName;
  const check: ChkvCheckLocal = { checkName: parsedName };
  if (Array.isArray(record.parameters) && record.parameters.length > 0) {
    check.parameters = record.parameters as ChkvCheckLocal['parameters'];
  }
  return check;
}

function parseChkv(xml: string): ChkvLocal {
  const root = parseRoot('CHKV', xml);
  const content = asNode(root['content']);
  const checks = asArray(content['check']).map((entry) => {
    const check = asNode(entry);
    const checkObject = asNode(check['checkObject']);
    const checkName = attr(checkObject, 'name') ?? '';
    return parseCheckFragment(checkName, text(check['parameterValueXml']));
  });
  const doc: ChkvLocal = {
    formatVersion: '1',
    header: headerFromWire(root),
    remoteEnabled: text(content['remoteEnabled']).toLowerCase() === 'true',
    selectedChecks: checks,
  };
  if (doc.remoteEnabled === false) delete doc.remoteEnabled;
  return doc;
}

/** Project an ADT XML response body onto the local AFF document. */
export function parseAtcObject(type: AtcType, xml: string): AtcLocal {
  switch (type) {
    case 'CHKC':
      return parseChkc(xml);
    case 'CHKO':
      return parseChko(xml);
    case 'CHKV':
      return parseChkv(xml);
  }
}
