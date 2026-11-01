/**
 * TTYP local-file ↔ ADT wire-format mapping.
 *
 * Local file: `*.ttyp.json` (AFF nested — `formatVersion / header /
 * accessType / lineType / keyDefinition? / keyKind? / rows?`), plus a
 * `*.type.abap` sidecar with the pseudo-DDL `define type ...` form (human
 * readable only — push always rebuilds the ADT document from the JSON).
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
 * Known limitation: a predefined ABAP row type (`table of string`, `table of
 * char10`) has no faithful local representation — `lineType.rowType` stores the
 * data-type name and the length/decimals from `ttyp:builtInType` are lost.
 * DDIC table types in practice use dictionary row types (ROWKIND S/E/L).
 */
import { defineJsonArtifact } from '../artifact.js';

export interface TtypLocal {
  formatVersion: '1';
  header: { description: string; originalLanguage: string; abapLanguageVersion?: string };
  accessType: 'standard' | 'sorted' | 'hashed';
  lineType: { rowType?: string; rowStructure?: { fieldName: string; dataType?: string; length?: number; decimals?: number } };
  keyDefinition?: Array<{ keyField: string; descending?: boolean }>;
  /** Primary-key uniqueness when keyDefinition is set (ADT `ttyp:primaryKey/kind`). */
  keyKind?: 'unique' | 'nonUnique';
  rows?: Array<Record<string, unknown>>;
}

/** ABAP built-in data types that can be used as a table-type row type. */
const BUILT_IN_TYPES = new Set([
  'C',
  'D',
  'DECFLOAT16',
  'DECFLOAT34',
  'F',
  'I',
  'INT1',
  'INT2',
  'INT4',
  'INT8',
  'N',
  'P',
  'S',
  'STRING',
  'T',
  'UTCLONG',
  'X',
  'XSTRING',
]);

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

  const local: TtypLocal = {
    formatVersion: '1',
    header: { description, originalLanguage },
    accessType: ['standard', 'sorted', 'hashed'].includes(accessType) ? accessType : 'standard',
    lineType: rowType
      ? { rowType }
      : { rowStructure: { fieldName: 'DUMMY', dataType: 'CHAR', length: 1 } },
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
      if (BUILT_IN_TYPES.has(upper)) {
        return [
          '    <ttyp:typeKind>predefinedAbapType</ttyp:typeKind>',
          '    <ttyp:typeName/>',
          `    <ttyp:builtInType><ttyp:dataType>${encodeXmlEntities(upper)}</ttyp:dataType><ttyp:length>000000</ttyp:length><ttyp:decimals>000000</ttyp:decimals></ttyp:builtInType>`,
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

/** Build the pseudo-DDL `define type <name>: ...` sidecar (human readable). */
export function buildTypeSource(name: string, local: TtypLocal): string {
  const access = local.accessType === 'standard' ? '' : ` ${local.accessType}`;
  const key = (local.keyDefinition ?? []).map((k) => k.keyField.toLowerCase());
  const keyPart = key.length > 0
    ? ` with ${local.keyKind === 'unique' || local.accessType === 'hashed' ? 'unique' : 'non-unique'} key ${key.join(' ')}`
    : '';
  if (local.lineType.rowType) {
    return `define type ${name.toLowerCase()}:${access} table of ${local.lineType.rowType.toLowerCase()}${keyPart}.`;
  }
  const f = local.lineType.rowStructure!;
  const type = (f.dataType ?? 'CHAR').toLowerCase();
  const len = f.length !== undefined ? ` LENGTH ${f.length}` : '';
  return `define type ${name.toLowerCase()}:${access} table of begin of line, ${f.fieldName.toLowerCase()} type ${type}${len}, end of line${keyPart}.`;
}
