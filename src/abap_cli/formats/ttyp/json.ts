/**
 * Spec 036 US2: TTYP local-file ↔ wire-format mapping.
 *
 * Local file: `*.ttyp.json` (AFF nested — `formatVersion / header /
 * accessType / lineType / keyDefinition? / rows?`), plus an optional
 * sibling `*.type.abap` containing the `define type ...: ...` DDL.
 *
 * Wire: SAP ADT `ttyp:tableType` XML, parsed into a flat dict
 * (key → string). Mapped onto our local shape via `wireToLocal()`, then
 * schema-validated through the shared AFF artifact contract (`artifact.ts`).
 *
 * Spec 036 Q1: upstream SAP `type-v1.json` is *type-pool*, not table-type —
 * our `ttyp-v1.json` is a deliberate handcrafted mirror, header-annotated
 * in `tmp/abap-file-formats/file-formats/ttyp/ttyp-v1.json`.
 */
import { defineWireArtifact } from '../artifact.js';

export interface TtypLocal {
  formatVersion: '1';
  header: { description: string; originalLanguage: string; abapLanguageVersion?: string };
  accessType: 'standard' | 'sorted' | 'hashed';
  lineType: { rowType?: string; rowStructure?: { fieldName: string; dataType?: string; length?: number; decimals?: number } };
  keyDefinition?: Array<{ keyField: string; descending?: boolean }>;
  rows?: Array<Record<string, unknown>>;
}

export interface TtypWireFields {
  name: string;
  description?: string;
  accessType: 'standard' | 'sorted' | 'hashed';
  rowType?: string;
  rowStructureFields?: Array<{ fieldName: string; dataType?: string; length?: number; decimals?: number }>;
  keys?: Array<{ keyField: string; descending: boolean }>;
}

/**
 * Wire body schema for a SAP ADT `ttyp:tableType` GET response:
 *   <ttyp:tableType xmlns:ttyp="...">
 *     <ttyp:name>NAME</ttyp:name>
 *     <ttyp:description>...</ttyp:description>
 *     <ttyp:accessType>STANDARD</ttyp:accessType>
 *     <ttyp:lineType>ROW_TYPE_REF</ttyp:lineType>
 *     ...
 *   </ttyp:tableType>
 *
 * This parser uses lightweight regex extraction because the upstream
 * payloads are simple enough; if a future SAP release adds
 * `ttyp:keyDefinition` or `ttyp:rowStructure` children, the regex list
 * below is the single edit point.
 */
export function wireToLocal(xml: string): TtypLocal {
  const tag = (re: RegExp): string => {
    const m = xml.match(re);
    return (m?.[1] ?? '').trim();
  };
  const accessType = (tag(/<[^>]*accessType[^>]*>([^<]+)<\/[^>]+>/i) || 'STANDARD').toLowerCase() as 'standard' | 'sorted' | 'hashed';
  const rowTypeRef = tag(/<[^>]*lineType[^>]*>([^<]+)<\/[^>]+>/i);
  const description = tag(/<[^>]*description[^>]*>([^<]+)<\/[^>]+>/i);
  const langMatch = xml.match(/<[^>]*originalLanguage[^>]*>([^<]+)<\/[^>]+>/i);
  const originalLanguage = (langMatch?.[1] ?? 'EN').trim();

  // Key blocks: <ttyp:key keyField="X" descending="false" />
  const keyBlocks = [...xml.matchAll(/<[^>]*key[^>]*\s+keyField="([^"]+)"(?:\s+descending="([^"]+)")?[^>]*\/>/gi)];
  const keys = keyBlocks.map((m) => ({
    keyField: m[1]!,
    descending: m[2] === 'true' || m[2] === 'X',
  }));

  const local: TtypLocal = {
    formatVersion: '1',
    header: { description, originalLanguage },
    accessType,
    lineType: rowTypeRef ? { rowType: rowTypeRef } : { rowStructure: { fieldName: 'DUMMY', dataType: 'CHAR', length: 1 } },
  };
  if (keys.length > 0) local.keyDefinition = keys;
  return local;
}

/** Convert a local document back to the wire XML body that SAP ADT accepts. */
export function localToWire(local: TtypLocal): string {
  const accessType = local.accessType.toUpperCase();
  const lt = local.lineType;
  const rowTypePart = lt.rowType ? `<ttyp:lineType>${lt.rowType}</ttyp:lineType>` : '';
  const rowStructurePart = lt.rowStructure
    ? `<ttyp:rowStructure><ttyp:field fieldName="${lt.rowStructure.fieldName}"${lt.rowStructure.dataType ? ` dataType="${lt.rowStructure.dataType}"` : ''}${lt.rowStructure.length !== undefined ? ` length="${lt.rowStructure.length}"` : ''}${lt.rowStructure.decimals !== undefined ? ` decimals="${lt.rowStructure.decimals}"` : ''}/></ttyp:rowStructure>`
    : '';
  const keysPart = (local.keyDefinition ?? [])
    .map((k) => `<ttyp:key keyField="${k.keyField}" descending="${k.descending === true ? 'true' : 'false'}"/>`)
    .join('');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ttyp:tableType xmlns:ttyp="http://www.sap.com/adt/ddic/tabletypes">',
    `<ttyp:description>${local.header.description ?? ''}</ttyp:description>`,
    `<ttyp:originalLanguage>${local.header.originalLanguage}</ttyp:originalLanguage>`,
    `<ttyp:accessType>${accessType}</ttyp:accessType>`,
    rowTypePart,
    rowStructurePart,
    keysPart,
    '</ttyp:tableType>',
  ].join('\n');
}

/** TTYP AFF artifact: file/schema plumbing + ADT wire mapping. */
export const ttypArtifact = defineWireArtifact<TtypLocal, string>({
  type: 'TTYP',
  toWire: (local) => localToWire(local),
  fromWire: (xml) => wireToLocal(xml),
});

/** Build the DDL `define type <name>: ...` from a local document. */
export function buildTypeSource(name: string, local: TtypLocal): string {
  if (local.lineType.rowType) {
    const access = local.accessType === 'standard' ? '' : ` ${local.accessType}`;
    return `define type ${name.toLowerCase()}: ${access} table of ${local.lineType.rowType.toLowerCase()}.`;
  }
  // Inline rowStructure: write `BEGIN OF ... END OF`.
  if (local.lineType.rowStructure) {
    const f = local.lineType.rowStructure;
    const type = (f.dataType ?? 'CHAR').toLowerCase();
    const len = f.length !== undefined ? ` LENGTH ${f.length}` : '';
    return `define type ${name.toLowerCase()}: ${local.accessType !== 'standard' ? ` ${local.accessType} ` : ''}table of begin of line, ${f.fieldName.toLowerCase()} type ${type}${len}, end of line.`;
  }
  return `define type ${name.toLowerCase()}: standard table of char1.`;
}
