/**
 * Type pool (TYPE-POOL / TYPES) — ADT wire helpers.
 *
 * A type pool is a classic ABAP repository object: the metadata resource
 * carries the description and package, and the source (a `TYPE-POOL ... TYPES
 * ...` include) lives at `source/main`.
 *
 *   POST   /sap/bc/adt/ddic/typegroups           → inactive object (200 + XML)
 *   GET    /sap/bc/adt/ddic/typegroups/<name>    → atypgr:abapTypeGroup metadata
 *   GET/PUT …/<name>/source/main                 → ABAP source (text/plain)
 *   POST   /sap/bc/adt/activation                → activate
 *   DELETE …/<name>                              → delete (lock → DELETE → unlock)
 *
 * Name rules: a type pool name is limited to 5 characters, starts with a letter
 * and continues with letters, digits or underscores (classic DDIC naming).
 */
import { XMLParser } from 'fast-xml-parser';
import { CliError } from '../output/json.js';

const ADT_CORE_NS = 'http://www.sap.com/adt/core';
const TYPEGROUP_NS = 'http://www.sap.com/adt/ddic/typegroups';

/** ADT media type of the type-group metadata envelope. */
export const TYPEGROUP_MEDIA = 'application/vnd.sap.adt.ddic.typegroups.v3+xml';
/** ADT object type reported for a type pool (TADIR `TYPE`, subtype `DG`). */
export const TYPEGROUP_OBJTYPE = 'TYPE/DG';
/** Collection used for create. */
export const TYPEGROUP_COLLECTION = '/sap/bc/adt/ddic/typegroups';
/** Maximum object-name length (typestructure `TYPE/DG`). */
export const TYPEGROUP_NAME_MAX = 5;

/** ADT URL of one type pool. */
export function typegroupUrl(name: string): string {
  return `${TYPEGROUP_COLLECTION}/${encodeURIComponent(name.toLowerCase())}`;
}

/** `source/main` URL of one type pool. */
export function typegroupSourceUrl(name: string): string {
  return `${typegroupUrl(name)}/source/main`;
}

/**
 * Validate the object name before touching SAP. Type pools are limited to five
 * characters and cannot start with a digit; the check runs before the create
 * request so a long name fails with an actionable message instead of a
 * low-level DDIC error.
 */
export function assertTypegroupName(name: string): string {
  const upper = name.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{0,4}$/.test(upper)) {
    throw new CliError(
      'VALIDATION_ERROR',
      `TYPE name "${upper}" is not a valid type pool name (1-5 characters, starts with a letter, letters/digits/underscore only)`,
      {
        object: upper,
        type: 'TYPE',
        nextSteps: ['Rename the type pool to at most five characters, e.g. `ZMYTY`.'],
      },
    );
  }
  return upper;
}

function escapeXmlAttribute(value: string | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface TypegroupWriteMeta {
  /** Target package (create). Omit on update to leave the package untouched. */
  packageName?: string;
  /** Object description (create and description sync). */
  description: string;
  /** Logon language reported as `adtcore:language` (defaults to EN). */
  language?: string;
  /** Original language of the object (defaults to `language`). */
  originalLanguage?: string;
}

/** Build the `atypgr:abapTypeGroup` body used by create and metadata updates. */
export function buildTypegroupBody(name: string, meta: TypegroupWriteMeta): string {
  const language = (meta.language ?? 'EN').toUpperCase();
  const masterLanguage = (meta.originalLanguage ?? language).toUpperCase();
  const pkg = meta.packageName
    ? `<adtcore:packageRef adtcore:name="${escapeXmlAttribute(meta.packageName)}"/>`
    : '';
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<atypgr:abapTypeGroup xmlns:atypgr="${TYPEGROUP_NS}" xmlns:adtcore="${ADT_CORE_NS}"` +
    ` adtcore:name="${escapeXmlAttribute(name)}" adtcore:type="${TYPEGROUP_OBJTYPE}"` +
    ` adtcore:description="${escapeXmlAttribute(meta.description)}"` +
    ` adtcore:language="${escapeXmlAttribute(language)}" adtcore:masterLanguage="${escapeXmlAttribute(masterLanguage)}">` +
    `${pkg}</atypgr:abapTypeGroup>`
  );
}

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

export interface TypegroupMeta {
  /** AFF header projection (description + original language). */
  header: { description: string; originalLanguage: string };
  /** Package reported by the metadata resource (used by the transport rule). */
  packageName?: string;
}

/**
 * Return the metadata XML with only `adtcore:description` replaced.
 *
 * The metadata PUT must keep SAP's own envelope: `abapsource:activeUnicodeCheck`
 * and the nested `abapsource:syntaxConfiguration` drive the generated include
 * program's attributes. Sending a minimal body resets the unicode flag to
 * false, after which every activation fails with "not Unicode-compatible".
 */
export function withTypegroupDescription(xml: string, description: string): string {
  const escaped = escapeXmlAttribute(description);
  if (/adtcore:description="[^"]*"/.test(xml)) {
    return xml.replace(/adtcore:description="[^"]*"/, `adtcore:description="${escaped}"`);
  }
  // Some responses omit the description attribute entirely; inject it next to
  // the object type so the attribute stays inside the root element.
  return xml.replace(/(adtcore:type="TYPE\/DG")/, `$1 adtcore:description="${escaped}"`);
}

/** Project the `atypgr:abapTypeGroup` metadata XML onto the AFF header. */
export function parseTypegroupMeta(xml: string): TypegroupMeta {
  let parsed: XmlNode;
  try {
    parsed = parser.parse(xml) as XmlNode;
  } catch (error) {
    throw new CliError('SAP_ERROR', `Unexpected TYPE response from SAP: XML parse failed: ${error instanceof Error ? error.message : String(error)}`, {
      type: 'TYPE',
    });
  }
  const root = parsed.abapTypeGroup;
  if (root === undefined) {
    throw new CliError('SAP_ERROR', 'Unexpected TYPE response from SAP: expected <abapTypeGroup> root element', {
      type: 'TYPE',
    });
  }
  const node = asNode(root);
  const masterLanguage = attr(node, 'masterLanguage') ?? attr(node, 'language') ?? 'EN';
  const packageRef = node.packageRef;
  const packageName = packageRef === undefined ? undefined : attr(asNode(packageRef), 'name');
  return {
    header: {
      description: attr(node, 'description') ?? '',
      originalLanguage: masterLanguage.toLowerCase(),
    },
    ...(packageName ? { packageName } : {}),
  };
}
