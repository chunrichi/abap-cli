/**
 * TTYP local-file ↔ ADT wire-format mapping.
 *
 * Local file: `*.ttyp.json` (AFF nested — `formatVersion / header /
 * accessType / lineType / keyDefinition? / keyKind? / rows?`). Table types are
 * pure DDIC metadata — there is no ABAP source companion (abapGit serializes
 * them as a single XML file for the same reason).
 *
 * Wire: the ADT DDIC table-type document returned by
 * `/sap/bc/adt/ddic/tabletypes/<name>` (shape verified against a live
 * S/4HANA system):
 *
 *   <ttyp:tableType xmlns:ttyp="http://www.sap.com/dictionary/tabletype"
 *                   xmlns:adtcore="http://www.sap.com/adt/core"
 *                   adtcore:name="ZMY_TTYP" adtcore:type="TTYP/DA"
 *                   adtcore:description="…" adtcore:masterLanguage="EN">
 *     <adtcore:packageRef adtcore:name="$TMP"/>
 *     <ttyp:rowType>
 *       <ttyp:typeKind>dictionaryType</ttyp:typeKind>
 *       <ttyp:typeName>LVC_S_TABL</ttyp:typeName>
 *       <ttyp:builtInType>…</ttyp:builtInType>
 *       <ttyp:rangeType/>
 *     </ttyp:rowType>
 *     <ttyp:accessType>standard</ttyp:accessType>
 *     <ttyp:primaryKey>
 *       <ttyp:definition>standard|keyComponents</ttyp:definition>
 *       <ttyp:kind>unique|nonUnique</ttyp:kind>
 *       <ttyp:components><ttyp:component ttyp:name="CARRID"/>…</ttyp:components>
 *     </ttyp:primaryKey>
 *   </ttyp:tableType>
 *
 * The local file name carries the object name, and only the create request
 * needs the `adtcore:packageRef`, so `localToWire` takes both as arguments.
 * The artifact itself keeps the shared JSON/schema plumbing.
 *
 * A predefined row type (`table of string`, `table of char10`) keeps its
 * DDIC data-type name in `lineType.rowType` plus the optional
 * `lineType.rowTypeLength` / `lineType.rowTypeDecimals` that ADT carries in
 * `<ttyp:builtInType>`. A dictionary row type has no length/decimals — SAP
 * derives them from the referenced repository object.
 */
import { defineJsonArtifact } from '../artifact.js';

export interface TtypLocal {
  formatVersion: '1';
  header: { description: string; originalLanguage: string; abapLanguageVersion?: string };
  accessType: 'standard' | 'sorted' | 'hashed';
  lineType: {
    rowType?: string;
    /** Predefined row type only — DDIC data-type length (ADT `<ttyp:length>`). */
    rowTypeLength?: number;
    /** Predefined row type only — DDIC data-type decimals (ADT `<ttyp:decimals>`). */
    rowTypeDecimals?: number;
    rowStructure?: { fieldName: string; dataType?: string; length?: number; decimals?: number };
  };
  keyDefinition?: Array<{ keyField: string; descending?: boolean }>;
  /** Primary-key uniqueness when keyDefinition is set (ADT `ttyp:primaryKey/kind`). */
  keyKind?: 'unique' | 'nonUnique';
  rows?: Array<Record<string, unknown>>;
}

/**
 * DDIC predefined data types that can stand as a table-type row type.
 *
 * ADT identifies a predefined row type by its DDIC data-type name, never by an
 * ABAP type code: `table of char10` comes back as `CHAR` with length `000010`,
 * and sending `C` instead fails activation with "data type C does not exist".
 * The set mirrors the predefined-type enum of the AFF `dtel-v1.json`.
 */
const PREDEFINED_DATA_TYPES = new Set([
  'ACCP',
  'CHAR',
  'CLNT',
  'CUKY',
  'CURR',
  'DATN',
  'DATS',
  'DEC',
  'DECFLOAT16',
  'DECFLOAT34',
  'DF16_DEC',
  'DF16_RAW',
  'DF16_SCL',
  'DF34_DEC',
  'DF34_RAW',
  'DF34_SCL',
  'FLTP',
  'GEOM_EWKB',
  'INT1',
  'INT2',
  'INT4',
  'INT8',
  'LANG',
  'LCHR',
  'LRAW',
  'NUMC',
  'PREC',
  'QUAN',
  'RAW',
  'RAWSTRING',
  'SSTRING',
  'STRING',
  'TIMN',
  'TIMS',
  'UNIT',
  'UTCLONG',
  'VARC',
]);

/** Render a length/decimals as the zero-padded 6-digit ADT wire value. */
function wireLength(value: number | undefined): string {
  return String(Math.trunc(value ?? 0)).padStart(6, '0');
}

/** Parse an ADT wire length/decimals; `undefined` for absent / zero / junk. */
function parseWireLength(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

/** Read one `adtcore:`-prefixed attribute from the root element. */
function coreAttribute(xml: string, name: string): string | undefined {
  return new RegExp(`\\badtcore:${name}\\s*=\\s*"([^"]*)"`).exec(xml)?.[1];
}

/** Decode the five XML pre-defined entities (attributes only in this model). */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Attribute-safe encoding for values written into the ADT document. */
function encodeXmlEntities(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** First text of `<ttyp:tag>…</ttyp:tag>` inside `xml`. */
function ttypTag(xml: string, tag: string): string | undefined {
  return new RegExp(`<ttyp:${tag}>([\\s\\S]*?)</ttyp:${tag}>`).exec(xml)?.[1]?.trim();
}

/** Parse the real ADT DDIC table-type document into the local AFF shape. */
export function wireToLocal(xml: string): TtypLocal {
  const description = decodeXmlEntities(coreAttribute(xml, 'description') ?? '');
  const originalLanguage = (
    coreAttribute(xml, 'masterLanguage') ??
    coreAttribute(xml, 'language') ??
    'EN'
  ).toUpperCase();
  const accessType = (ttypTag(xml, 'accessType') || 'standard').toLowerCase() as TtypLocal['accessType'];

  // Row type: a dictionary reference (typeName) or a predefined ABAP type
  // (builtInType/dataType). Ref/range kinds fall back to the referenced name.
  const rowTypeBlock = /<ttyp:rowType>([\s\S]*?)<\/ttyp:rowType>/.exec(xml)?.[1] ?? '';
  const typeKind = ttypTag(rowTypeBlock, 'typeKind') ?? '';
  const typeName = ttypTag(rowTypeBlock, 'typeName') ?? '';
  const builtInType = /<ttyp:builtInType>([\s\S]*?)<\/ttyp:builtInType>/.exec(rowTypeBlock)?.[1] ?? '';
  const dataType = ttypTag(builtInType, 'dataType') ?? '';
  const rowType = typeKind === 'predefinedAbapType' ? dataType : typeName || dataType;

  const lineType: TtypLocal['lineType'] = rowType
    ? { rowType }
    : { rowStructure: { fieldName: 'DUMMY', dataType: 'CHAR', length: 1 } };
  if (rowType && typeKind === 'predefinedAbapType') {
    // Only a predefined row type carries a length/decimals of its own; ADT
    // leaves them at 000000 for types whose length is fixed or absent
    // (STRING, INT4, ...), so a zero is "not applicable" and gets omitted.
    const length = parseWireLength(ttypTag(builtInType, 'length'));
    const decimals = parseWireLength(ttypTag(builtInType, 'decimals'));
    if (length !== undefined) lineType.rowTypeLength = length;
    if (decimals !== undefined) lineType.rowTypeDecimals = decimals;
  }

  const local: TtypLocal = {
    formatVersion: '1',
    header: { description, originalLanguage },
    accessType: ['standard', 'sorted', 'hashed'].includes(accessType) ? accessType : 'standard',
    lineType,
  };

  // Primary key: only `keyComponents` carries an explicit field list; the
  // `standard` definition means "row type determines the key" (no local list).
  const primaryKey = /<ttyp:primaryKey\b[^>]*>([\s\S]*?)<\/ttyp:primaryKey>/.exec(xml)?.[1] ?? '';
  if (ttypTag(primaryKey, 'definition') === 'keyComponents') {
    const components = [...primaryKey.matchAll(/<ttyp:component\b[^>]*\bttyp:name="([^"]+)"/g)].map((m) => ({
      keyField: m[1]!,
      descending: false,
    }));
    if (components.length > 0) {
      local.keyDefinition = components;
      const kind = ttypTag(primaryKey, 'kind');
      local.keyKind = kind === 'unique' ? 'unique' : 'nonUnique';
    }
  }
  return local;
}

export interface LocalToWireOptions {
  /** Package for the create request's `adtcore:packageRef`; omit on update. */
  packageName?: string;
  /** Description/master language override. ADT only persists the DDIC text
   *  when both `adtcore:language` and `adtcore:masterLanguage` equal the
   *  logon language, so callers pass the profile language here. */
  language?: string;
}

/** Build the ADT DDIC table-type document that POST/PUT accept. */
export function localToWire(local: TtypLocal, name: string, opts: LocalToWireOptions = {}): string {
  const language = (opts.language ?? local.header.originalLanguage ?? 'EN').toUpperCase();
  const accessType = local.accessType;
  const rowTypeBlock = (() => {
    const rowType = local.lineType.rowType;
    if (rowType) {
      const upper = rowType.toUpperCase();
      if (PREDEFINED_DATA_TYPES.has(upper)) {
        return [
          '    <ttyp:typeKind>predefinedAbapType</ttyp:typeKind>',
          '    <ttyp:typeName/>',
          `    <ttyp:builtInType><ttyp:dataType>${encodeXmlEntities(upper)}</ttyp:dataType><ttyp:length>${wireLength(local.lineType.rowTypeLength)}</ttyp:length><ttyp:decimals>${wireLength(local.lineType.rowTypeDecimals)}</ttyp:decimals></ttyp:builtInType>`,
        ];
      }
      // Dictionary row type: SAP recomputes builtInType from the referenced
      // object, so a placeholder (STRU/0/0) is accepted and overwritten.
      return [
        '    <ttyp:typeKind>dictionaryType</ttyp:typeKind>',
        `    <ttyp:typeName>${encodeXmlEntities(upper)}</ttyp:typeName>`,
        '    <ttyp:builtInType><ttyp:dataType>STRU</ttyp:dataType><ttyp:length>000000</ttyp:length><ttyp:decimals>000000</ttyp:decimals></ttyp:builtInType>',
      ];
    }
    // Inline rowStructure has no ADT DDIC representation (the row type must be
    // a repository type); callers reject it before building the wire.
    return [
      '    <ttyp:typeKind>predefinedAbapType</ttyp:typeKind>',
      '    <ttyp:typeName/>',
      '    <ttyp:builtInType><ttyp:dataType>CHAR</ttyp:dataType><ttyp:length>000001</ttyp:length><ttyp:decimals>000000</ttyp:decimals></ttyp:builtInType>',
    ];
  })();

  const keys = local.keyDefinition ?? [];
  const keyBlock = keys.length > 0
    ? [
        `    <ttyp:definition>keyComponents</ttyp:definition>`,
        `    <ttyp:kind>${local.keyKind ?? (accessType === 'hashed' ? 'unique' : 'nonUnique')}</ttyp:kind>`,
        `    <ttyp:components>${keys.map((k) => `<ttyp:component ttyp:name="${encodeXmlEntities(k.keyField.toUpperCase())}"/>`).join('')}</ttyp:components>`,
        '    <ttyp:alias/>',
      ]
    : [
        '    <ttyp:definition>standard</ttyp:definition>',
        '    <ttyp:kind>nonUnique</ttyp:kind>',
        '    <ttyp:components/>',
        '    <ttyp:alias/>',
      ];

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ttyp:tableType xmlns:ttyp="http://www.sap.com/dictionary/tabletype"',
    '                 xmlns:adtcore="http://www.sap.com/adt/core"',
    `                 adtcore:name="${encodeXmlEntities(name.toUpperCase())}" adtcore:type="TTYP/DA"`,
    `                 adtcore:description="${encodeXmlEntities(local.header.description)}"`,
    `                 adtcore:language="${encodeXmlEntities(language)}" adtcore:masterLanguage="${encodeXmlEntities(language)}">`,
    ...(opts.packageName ? [`  <adtcore:packageRef adtcore:name="${encodeXmlEntities(opts.packageName)}"/>`] : []),
    '  <ttyp:rowType>',
    ...rowTypeBlock,
    '    <ttyp:rangeType/>',
    '  </ttyp:rowType>',
    `  <ttyp:accessType>${accessType}</ttyp:accessType>`,
    '  <ttyp:primaryKey>',
    ...keyBlock,
    '  </ttyp:primaryKey>',
    '</ttyp:tableType>',
  ].join('\n');
}

/** TTYP AFF artifact: file/schema plumbing (wire mapping is the function pair
 *  above — the write side needs the object name and an optional package). */
export const ttypArtifact = defineJsonArtifact<TtypLocal>({ type: 'TTYP' });

