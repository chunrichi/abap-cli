import * as fs from 'fs/promises';
import * as path from 'path';
import { DDIC_SUPPORTED_TYPES, type DdicSupportedType } from '../../types/registry.js';
import { CliError } from '../../output/json.js';

// Known DDIC object extensions
export const DDIC_EXTENSIONS = ['.doma.json', '.dtel.json', '.tabl.json', '.stru.json', '.ttyp.json', '.msag.json', '.ddls.json'];

/** Re-exported from `types/registry.ts` (T048, US11). */
export { DDIC_SUPPORTED_TYPES, type DdicSupportedType };

export interface DdicObject {
  name: string;
  description?: string;
  [key: string]: unknown;
}

/** 014: local abap-file-format field representation (snake_case / nested). */
export interface DdicFieldLocal {
  fieldName: string;
  rollname?: string;
  dataType?: string;
  length?: number | string;
  decimals?: number | string;
  keyFlag?: boolean;
  notNull?: boolean;
  ddtext?: string;
  refTable?: string;
  refField?: string;
  checkTable?: string;
  /** 024: TABL include/append target structure name (.INCLUDE / .INCLU--AP). */
  precField?: string;
  /** 032 US6: TABL `.INCLUDE ... WITH SUFFIX <suffix>` suffix. */
  includeSuffix?: string;
  /** 032 US6: foreign-key entries for `@AbapCatalog.foreignKeys` block. */
  foreignKeys?: Array<{ checkTable: string; label?: string }>;
}

/** 014: ICF wire representation (camelCase, transport envelope). */
export interface DdicFieldWire {
  fieldName: string;
  rollname?: string;
  dataType?: string;
  length?: number;
  decimals?: number;
  keyFlag?: boolean;
  notNull?: boolean;
  ddtext?: string;
  refTable?: string;
  refField?: string;
  checkTable?: string;
  /** 024: TABL include/append target structure name (.INCLUDE / .INCLU--AP). */
  precField?: string;
}

/**
 * T2.1: split `DdicWirePayload` into per-type wire interfaces so each
 * DDIC variant (DOMA / DTEL / TABL settings) declares only the fields
 * its AFF schema actually carries. The legacy union `DdicWirePayload`
 * is preserved as a backward-compatible alias; new code should pick the
 * narrowed interface that matches its `wireToLocal<…>(type, wire)` call.
 */

/** DOMA wire payload — fields declared by `doma-v1.json`. */
export interface DdicDomaWire {
  name: string;
  description?: string;
  package?: string;
  transportRequest?: string;
  header?: {
    description?: string;
    originalLanguage?: string;
    abapLanguageVersion?: string;
  };
  format?: {
    dataType?: string;
    length?: number;
    decimals?: number;
    signFlag?: string;
    lowercase?: string;
    convExit?: string;
  };
  outputCharacteristics?: {
    length?: number;
    [k: string]: unknown;
  };
  fixedValues?: DdomaFixedValueWire[];
  warnings?: Array<{ code: string; message: string }>;
  errorCode?: string;
  errorMessage?: string;
}

/** DTEL wire payload — fields declared by `dtel-v1.json`. */
export interface DdicDtelWire {
  name: string;
  description?: string;
  package?: string;
  transportRequest?: string;
  header?: {
    description?: string;
    originalLanguage?: string;
    abapLanguageVersion?: string;
  };
  // See DdicDtelWire.dataTypeInformation for the AFF canonical categories.
  dataTypeInformation?: {
    category:
      | 'domain'
      | 'predefinedType'
      | 'referenceToPredefinedType'
      | 'referenceDictionaryType'
      | 'referenceClasIntType';
    typeName?: string;
    /** Legacy 032 alias retained on the wire shape (not in AFF schema). */
    referencedTypeName?: string;
    predefinedType?: { dataType?: string; length?: number; decimals?: number };
  };
  shortText?: string;
  mediumText?: string;
  longText?: string;
  headerText?: string;
  warnings?: Array<{ code: string; message: string }>;
  errorCode?: string;
  errorMessage?: string;
}

/** TABL/STRU technical-settings wire payload — fields declared by `tabt-v1.json`. */
export interface DdicTableSettingsWire {
  name: string;
  description?: string;
  package?: string;
  transportRequest?: string;
  header?: {
    description?: string;
    originalLanguage?: string;
    abapLanguageVersion?: string;
  };
  generalInformation?: Record<string, unknown>;
  fields?: DdicFieldWire[];
  type?: 'TABL' | 'STRU';
  mainJson?: string;
  ddicSource?: string;
  settingsJson?: string;
  hasSettings?: boolean;
  warnings?: Array<{ code: string; message: string }>;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * @deprecated Use {@link DdicDomaWire} | {@link DdicDtelWire} | {@link DdicTableSettingsWire}
 * depending on the DDIC variant you are handling. Kept as a structural union
 * for backward compatibility with the pre-T2.1 single-interface contract.
 */
export type DdicWirePayload = DdicDomaWire | DdicDtelWire | DdicTableSettingsWire;

/**
 * T2.1: type-level mapping from a DDIC variant code to its narrowed wire
 * interface. Lets `localToWire<DOMA>(...)` / `wireToLocal<DTEL>(...)`
 * return / accept exactly the wire shape the AFF schema declares.
 */
export type WireForDdicType<T extends DdicSupportedType> =
  T extends 'DOMA' ? DdicDomaWire :
  T extends 'DTEL' ? DdicDtelWire :
  DdicTableSettingsWire;

/** 024: extract the canonical three-piece strings from a wire payload. */
export function extractTablArtifactWire(wire: DdicWirePayload): {
  mainJson: string;
  ddicSource: string;
  settingsJson: string | undefined;
  hasSettings: boolean;
} | undefined {
  // T2.1: TABL/STRU three-piece payload lives on the TABL-settings wire
  // variant. Narrow via unknown before reading to keep the union type safe.
  const w = wire as unknown as Partial<DdicTableSettingsWire> & Record<string, unknown>;
  if (typeof w.mainJson !== 'string' || typeof w.ddicSource !== 'string') return undefined;
  return {
    mainJson: w.mainJson,
    ddicSource: w.ddicSource,
    settingsJson: typeof w.settingsJson === 'string' ? w.settingsJson : undefined,
    hasSettings: w.hasSettings === true,
  };
}
/** 032 + 033: DOMA fixed-value wire shape. `description` is the AFF canonical
 *  plain string; `fixedValueLong` is the legacy014 multi-language shape retained
 *  for backwards compatibility with objects that still use it. */
export interface DdomaFixedValueWire {
  fixedValue: string;
  description?: string;
  fixedValueLong?: {
    languageIndependent?: string;
    languageDependent?: Array<{ language: string; description: string }>;
  };
}

/** 033: DOMA fixed-value local shape. AFF canonical uses a plain string
 *  description; legacy014 used a multi-language object. Both shapes are
 *  accepted on read; writers emit the AFF canonical plain string. */
export interface DomaFixedValueLocal {
  fixedValue: string;
  description?: string | {
    languageIndependent?: string;
    languageDependent?: Array<{ language: string; description: string }>;
  };
}
/**
 * Read a DDIC JSON file from disk.
 */
export async function readDdicJson(filePath: string): Promise<DdicObject> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as DdicObject;
}

/**
 * abap-file-format compliant reader for the `create` flow.
 *
 * For TABL/STRU, look for a three-piece layout next to the main JSON:
 * `<name>.tabl.json` + `<name>.tabl.ddic` (+ optional `<name>.tabl.settings.json`).
 * If the sidecars exist, parse them via `readTablArtifact` so the wire payload
 * honors abap-file-format (DDL is the source of truth for fields, settings
 * holds dataClassCategory / sizeCategory). If only the main JSON is present
 * (legacy wire-flat shape), fall back to `readDdicJson` for backwards
 * compatibility. For DOMA/DTEL the legacy wire-flat shape is the only one.
 */
export async function readDdicObjectForCreate(filePath: string, type: DdicSupportedType): Promise<DdicObject> {
  if (type === 'TABL' || type === 'STRU') {
    // Lazy import to avoid pulling tabl-artifact code for non-TABL flows.
    const { readTablArtifact } = await import('./tabl-artifact.js');
    const artifact = await readTablArtifact(filePath).catch((error: unknown) => {
      // readTablArtifact throws on malformed DDL / missing main+ddic pair.
      // Surface the message verbatim — the create-flow wrapper turns it into
      // a structured CliError.
      throw error instanceof Error ? error : new Error(String(error));
    });
    if (artifact) return artifact.local;
  }
  return readDdicJson(filePath);
}

/**
 * Write a DDIC JSON file to disk, creating parent directories as needed.
 */
export async function writeDdicJson(filePath: string, data: DdicObject): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * List all DDIC JSON files in a directory recursively.
 */
export async function listDdicFiles(dirPath: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        results.push(...await listDdicFiles(fullPath));
      } else if (DDIC_EXTENSIONS.some(ext => entry.name.endsWith(ext))) {
        results.push(fullPath);
      }
    }
  } catch {
    // directory may not exist
  }
  return results;
}

/** Names that mean "the client (MANDT) key column" in TABL field lists.
 * The wire format never carries MANDT — the server prepends it when
 * `clientDependent: true` (see zcl_abap_vibe_icf.create_ddic_table). We strip
 * both `CLIENT` (abap-file-format DDL alias) and `MANDT` (legacy name) from
 * the wire payload to keep the two create paths in lockstep.
 *
 * Kept in sync with `tabl-artifact.ts:57` which applies the same filter on
 * the abap-file-format three-piece path.
 */
export const CLIENT_FIELD_NAMES = new Set(['CLIENT', 'MANDT']);
export function isClientFieldName(name: unknown): boolean {
  return typeof name === 'string' && CLIENT_FIELD_NAMES.has(name.toUpperCase());
}
/** Filter out client field entries from a local field list. Pure function. */
export function stripClientFields(fields: DdicFieldLocal[] | undefined): DdicFieldLocal[] {
  if (!Array.isArray(fields)) return [];
  return fields.filter((f) => !isClientFieldName(f.fieldName));
}

/** 014: map abap-file-format field (snake_case, mixed numeric) to wire (camelCase, number). */
export function localFieldToWire(local: DdicFieldLocal): DdicFieldWire {
  const wire: DdicFieldWire = { fieldName: local.fieldName };
  if (local.rollname !== undefined) wire.rollname = local.rollname;
  if (local.dataType !== undefined) wire.dataType = local.dataType;
  if (local.length !== undefined) wire.length = Number(local.length);
  if (local.decimals !== undefined) wire.decimals = Number(local.decimals);
  if (local.keyFlag !== undefined) wire.keyFlag = !!local.keyFlag;
  if (local.notNull !== undefined) wire.notNull = !!local.notNull;
  if (local.ddtext !== undefined) wire.ddtext = local.ddtext;
  if (local.refTable !== undefined) wire.refTable = local.refTable;
  if (local.refField !== undefined) wire.refField = local.refField;
  if (local.checkTable !== undefined) wire.checkTable = local.checkTable;
  if (local.precField !== undefined) wire.precField = local.precField;
  return wire;
}

/** 014: map wire field back to abap-file-format. Used for round-trip assertion. */
export function wireFieldToLocal(wire: DdicFieldWire): DdicFieldLocal {
  const local: DdicFieldLocal = { fieldName: wire.fieldName };
  if (wire.rollname !== undefined) local.rollname = wire.rollname;
  if (wire.dataType !== undefined) local.dataType = wire.dataType;
  if (wire.length !== undefined) local.length = wire.length;
  if (wire.decimals !== undefined) local.decimals = wire.decimals;
  if (wire.keyFlag !== undefined) local.keyFlag = wire.keyFlag;
  if (wire.notNull !== undefined) local.notNull = wire.notNull;
  if (wire.ddtext !== undefined) local.ddtext = wire.ddtext;
  if (wire.refTable !== undefined) local.refTable = wire.refTable;
  if (wire.refField !== undefined) local.refField = wire.refField;
  if (wire.checkTable !== undefined) local.checkTable = wire.checkTable;
  if (wire.precField !== undefined) local.precField = wire.precField;
  return local;
}

/**
 * 014 + BUG-1: return a minimal **abap-file-format** example for a given DDIC
 * type. For TABL/STRU this is the canonical three-piece layout
 * (`<name>.tabl.json` + `<name>.tabl.ddic` + optional `<name>.tabl.settings.json`).
 * For DOMA/DTEL the legacy single-file wire-flat shape is the only one.
 *
 * Used in three places: (1) `create --schema` for agent discovery,
 * (2) quickstart docs, (3) validation error next-steps.
 */
export function getDdicJsonExample(type: DdicSupportedType): string {
  switch (type) {
    case 'DOMA':
      return `# src/zdoma_example.doma.json (single file)
{
  "name": "ZDOMA_EXAMPLE",
  "description": "Example domain",
  "dataType": "CHAR",
  "length": 10
}`;
    case 'DTEL':
      return `# src/zdtel_example.dtel.json (single file)
{
  "name": "ZDTEL_EXAMPLE",
  "description": "Example data element",
  "domain": "ZDOMA_EXAMPLE",
  "shortText": "Short",
  "mediumText": "Medium",
  "longText": "Long field text",
  "headerText": "Header"
}`;
    case 'TABL':
      return `# abap-file-format three-piece layout (preferred).
# Place all three files in the same directory and pass --file the main JSON.
# src/ztab_example.tabl.json
{
  "formatVersion": "1",
  "header": {
    "description": "Example table",
    "originalLanguage": "en"
  }
}

# src/ztab_example.tabl.ddic
@EndUserText.label : 'Example table'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #RESTRICTED
define table ztab_example {
  key client : abap.clnt not null;
  key id     : abap.char(10) not null;
}

# src/ztab_example.tabl.settings.json (optional — buffering / data class / size)
{
  "formatVersion": "1",
  "generalInformation": {
    "dataClassCategory": "APPL0",
    "sizeCategory": "0"
  }
}`;
    case 'STRU':
      return `# abap-file-format three-piece layout (preferred).
# src/zstru_example.stru.json
{
  "formatVersion": "1",
  "header": {
    "description": "Example structure",
    "originalLanguage": "en"
  }
}

# src/zstru_example.stru.ddic
@EndUserText.label : 'Example structure'
define structure zstru_example {
  field1 : abap.char(20);
}`;
  }
}

/**
 * BUG-1 / legacy fallback: the **wire-flat** single-file shape accepted by
 * `localToWire` when only the main JSON is present (no `.tabl.ddic` sidecar).
 * Used in validation errors to remind first-time users that the legacy
 * single-file layout still has `name` / `fields[]` at the top level.
 */
export function getDdicFlatJsonExample(type: DdicSupportedType): string {
  switch (type) {
    case 'DOMA':
      return `{
  "name": "ZDOMA_EXAMPLE",
  "description": "Example domain",
  "dataType": "CHAR",
  "length": 10
}`;
    case 'DTEL':
      return `{
  "name": "ZDTEL_EXAMPLE",
  "description": "Example data element",
  "domain": "ZDOMA_EXAMPLE",
  "shortText": "Short",
  "mediumText": "Medium",
  "longText": "Long field text",
  "headerText": "Header"
}`;
    case 'TABL':
      return `{
  "name": "ZTAB_EXAMPLE",
  "description": "Example table",
  "deliveryClass": "A",
  "dataClass": "APPL0",
  "sizeCategory": "0",
  "clientDependent": true,
  "fields": [
    { "fieldName": "FIELD1", "dataType": "CHAR", "length": 20, "keyFlag": true }
  ]
}`;
    case 'STRU':
      return `{
  "name": "ZSTRU_EXAMPLE",
  "description": "Example structure",
  "fields": [
    { "fieldName": "FIELD1", "dataType": "CHAR", "length": 20 }
  ]
}`;
  }
}

/**
 * T2.1: convert a local abap-file-format nested DDIC object to the ICF
 * wire payload. Wire equals the AFF nested shape (no flat fallback).
 * DOMA under `format.*`, DTEL under `dataTypeInformation.*`,
 * TABL/STRU as three-piece (DDL + settings + json).
 *
 * Generic over the type so the return narrows to the matching wire
 * interface (DdicDomaWire / DdicDtelWire / DdicTableSettingsWire).
 */
export function localToWire<T extends DdicSupportedType>(type: T, local: DdicObject): WireForDdicType<T> {
  const l = local as Record<string, unknown>;
  const headerObj = (l.header && typeof l.header === 'object') ? (l.header as Record<string, unknown>) : undefined;
  const description = (headerObj?.description as string | undefined) ?? (l.description as string | undefined);
  const wire: DdicWirePayload = {
    name: String(local.name).toUpperCase(),
    description,
    package: l.package as string | undefined,
    transportRequest: l.transportRequest as string | undefined,
  };
  // AFF canonical — every DDIC object carries `header.{description,
  // originalLanguage, abapLanguageVersion?}`. Forward the nested header
  // when present so wire ↔ local stays lossless.
  if (l.header !== undefined && typeof l.header === 'object') {
    wire.header = l.header as DdicWirePayload['header'];
  }
  switch (type) {
    case 'DOMA': {
      // Wire must mirror AFF: dataType/length/decimals/signFlag/lowercase/convExit
      // all under `format.*`. `outputCharacteristics` and `fixedValues` live at
      // the top level of the local document; the wire carries them too.
      const srcFormat = l.format as Record<string, unknown> | undefined;
      const nested: Record<string, unknown> = {};
      if (srcFormat) {
        if (srcFormat.dataType !== undefined) nested.dataType = srcFormat.dataType;
        if (srcFormat.length !== undefined) nested.length = srcFormat.length;
        if (srcFormat.decimals !== undefined) nested.decimals = srcFormat.decimals;
        if (srcFormat.signFlag !== undefined) nested.signFlag = String(srcFormat.signFlag);
        if (srcFormat.lowercase !== undefined) nested.lowercase = String(srcFormat.lowercase);
        if (srcFormat.convExit !== undefined) nested.convExit = String(srcFormat.convExit);
      }
      if (Object.keys(nested).length > 0) (wire as DdicDomaWire).format = nested as DdicDomaWire['format'];
      // outputCharacteristics is at top level on both local and wire (AFF shape).
      const oc = l.outputCharacteristics as Record<string, unknown> | undefined;
      if (oc) (wire as DdicDomaWire).outputCharacteristics = { ...oc } as DdicDomaWire['outputCharacteristics'];
      // fixedValues: prefer top-level (AFF canonical). Empty array ⇒ omit wire.
      const rawFixed =
        (Array.isArray(l.fixedValues) ? (l.fixedValues as unknown[]) : undefined) ??
        (srcFormat && Array.isArray(srcFormat.fixedValues) ? (srcFormat.fixedValues as unknown[]) : undefined);
      if (Array.isArray(rawFixed) && rawFixed.length > 0) {
        (wire as DdicDomaWire).fixedValues = rawFixed.map((raw) => {
          const r = raw as Record<string, unknown>;
          const out: DdomaFixedValueWire = { fixedValue: String(r.fixedValue ?? '') };
          const descRaw = r.description;
          if (typeof descRaw === 'string') {
            // AFF canonical: plain string description.
            out.description = descRaw;
            return out;
          }
          if (descRaw && typeof descRaw === 'object') {
            const longRaw = descRaw as Record<string, unknown>;
            const li = longRaw.languageIndependent as string | undefined;
            const ldRaw = Array.isArray(longRaw.languageDependent)
              ? (longRaw.languageDependent as Array<Record<string, unknown>>)
              : undefined;
            const long: {
              languageIndependent?: string;
              languageDependent?: Array<{ language: string; description: string }>;
            } = {};
            if (li !== undefined) long.languageIndependent = li;
            if (ldRaw && ldRaw.length > 0) {
              long.languageDependent = ldRaw.map((d) => ({
                language: String(d.language ?? ''),
                description: String(d.description ?? ''),
              }));
            }
            if (long.languageIndependent !== undefined || long.languageDependent !== undefined) {
              out.fixedValueLong = long;
            }
          }
          return out;
        });
      }
      break;
    }
    case 'DTEL': {
      // Wire carries `dataTypeInformation.{category,...}` per AFF dtel-v1.json.
      // Five categories are accepted; `predefinedType` category nests its
      // type info under `predefinedType.{dataType,length,decimals}`. Legacy
      // 032 alias `typeRef` is mapped to `referenceDictionaryType` (TTYP /
      // dictionary reference) on the way out so existing callers keep working.
      const dti = l.dataTypeInformation as Record<string, unknown> | undefined;
      if (dti && typeof dti === 'object') {
        const rawCat = String(dti.category ?? '');
        const aliasedCat = rawCat === 'typeRef' ? 'referenceDictionaryType' : rawCat;
        const wireDti: Record<string, unknown> = { category: aliasedCat };
        if (dti.typeName !== undefined) wireDti.typeName = String(dti.typeName);
        if (dti.referencedTypeName !== undefined) {
          wireDti.referencedTypeName = String(dti.referencedTypeName);
        }
        const ptRaw = dti.predefinedType;
        if (ptRaw && typeof ptRaw === 'object') {
          const pt = ptRaw as Record<string, unknown>;
          wireDti.predefinedType = {
            dataType: String(pt.dataType ?? ''),
            ...(pt.length !== undefined ? { length: Number(pt.length) } : {}),
            ...(pt.decimals !== undefined ? { decimals: Number(pt.decimals) } : {}),
          };
        }
        (wire as DdicDtelWire).dataTypeInformation = wireDti as DdicDtelWire['dataTypeInformation'];
      }
      const w = wire as DdicDtelWire;
      w.shortText = l.shortText as string | undefined;
      w.mediumText = l.mediumText as string | undefined;
      w.longText = l.longText as string | undefined;
      w.headerText = l.headerText as string | undefined;
      break;
    }
    case 'TABL':
    case 'STRU': {
      // Wire carries the three-piece payload; the merge/split happens in
      // tabl-artifact.ts and in the ICF handler. Here we forward the
      // server-required transport envelope + fields-list. The DDL source
      // and settings.json remain external artifact files. Top-level
      // `header` and `generalInformation` are forwarded when present so the
      // ICF handler can persist deliveryClass / dataClass / sizeCategory.
      const w = wire as DdicTableSettingsWire;
      if (Array.isArray(l.fields)) {
        const original = l.fields as DdicFieldLocal[];
        const stripped = stripClientFields(original);
        const dropped = original
          .filter((f) => isClientFieldName(f.fieldName))
          .map((f) => String(f.fieldName).toUpperCase());
        if (dropped.length > 0) {
          const ws = (w.warnings ?? (w.warnings = []));
          ws.push({
            code: 'CLIENT_FIELD_STRIPPED',
            message: `dropped ${dropped.join(', ')} from fields[] — the server prepends MANDT when clientDependent: true`,
          });
        }
        w.fields = stripped.map(localFieldToWire);
      }
      // Forward abap-file-format nested header + generalInformation.
      if (l.header !== undefined) w.header = l.header as DdicTableSettingsWire['header'];
      if (l.generalInformation !== undefined) {
        w.generalInformation = l.generalInformation as DdicTableSettingsWire['generalInformation'];
      }
      break;
    }
  }
  return wire as WireForDdicType<T>;
}

/** 033 US12: convert wire payload back to local abap-file-format shape.
 *  Wire is now nested AFF; local mirrors it.
 *
 *  T2.1: generic over the type so callers get a typed `wire` argument
 *  (DdicDomaWire | DdicDtelWire | DdicTableSettingsWire).
 */
export function wireToLocal<T extends DdicSupportedType>(type: T, wire: WireForDdicType<T>): DdicObject {
  const wAny = wire as unknown as Record<string, unknown>;
  const local: DdicObject = { name: String(wAny.name ?? '') };
  if (wAny.description !== undefined) local.description = wAny.description as string;
  if (wAny.package !== undefined) (local as Record<string, unknown>).package = wAny.package;
  if (wAny.transportRequest !== undefined) (local as Record<string, unknown>).transportRequest = wAny.transportRequest;
  // Forward nested header / generalInformation if the wire carried them.
  if (wAny.header !== undefined) (local as Record<string, unknown>).header = wAny.header;
  if (wAny.generalInformation !== undefined) {
    (local as Record<string, unknown>).generalInformation = wAny.generalInformation;
  }
  switch (type) {
    case 'DOMA': {
      const l = local as Record<string, unknown>;
      const w = wire as DdicDomaWire;
      if (w.format) {
        const nested: Record<string, unknown> = {};
        if (w.format.dataType !== undefined) nested.dataType = w.format.dataType;
        if (w.format.length !== undefined) nested.length = w.format.length;
        if (w.format.decimals !== undefined) nested.decimals = w.format.decimals;
        if (w.format.signFlag !== undefined) nested.signFlag = String(w.format.signFlag);
        if (w.format.lowercase !== undefined) nested.lowercase = String(w.format.lowercase);
        if (w.format.convExit !== undefined) nested.convExit = String(w.format.convExit);
        if (Object.keys(nested).length > 0) l.format = nested;
      }
      if (w.outputCharacteristics) l.outputCharacteristics = { ...w.outputCharacteristics };
      if (w.fixedValues !== undefined && w.fixedValues.length > 0) {
        const fixedValuesLocal: DomaFixedValueLocal[] = w.fixedValues.map((fv) => {
          const out: DomaFixedValueLocal = { fixedValue: fv.fixedValue };
          if (typeof fv.description === 'string') {
            out.description = fv.description;
            return out;
          }
          const li = fv.fixedValueLong?.languageIndependent;
          const ld = fv.fixedValueLong?.languageDependent;
          if (li !== undefined || (ld !== undefined && ld.length > 0)) {
            out.description = {};
            if (li !== undefined) out.description.languageIndependent = li;
            if (ld !== undefined && ld.length > 0) out.description.languageDependent = ld;
          }
          return out;
        });
        l.fixedValues = fixedValuesLocal;
      }
      break;
    }
    case 'DTEL': {
      const l = local as Record<string, unknown>;
      const w = wire as DdicDtelWire;
      if (w.dataTypeInformation && typeof w.dataTypeInformation === 'object') {
        const cat = w.dataTypeInformation.category;
        // Legacy 032 alias `typeRef` is mapped back to itself on read so
        // 032 callers that wrote `typeRef` get the same shape back.
        const allowed = [
          'domain',
          'predefinedType',
          'referenceToPredefinedType',
          'referenceDictionaryType',
          'referenceClasIntType',
          'typeRef', // 032 legacy alias
        ] as const;
        if (!(allowed as readonly string[]).includes(cat)) {
          throw new CliError(
            'DTEL_CATEGORY_UNSUPPORTED',
            `Unsupported DTEL dataTypeInformation.category: "${String(cat)}" (expected one of ${allowed.join(', ')})`,
            { details: { category: String(cat), dataTypeInformation: w.dataTypeInformation } },
          );
        }
        l.dataTypeInformation = { ...w.dataTypeInformation };
      }
      if (w.shortText !== undefined) local.shortText = w.shortText;
      if (w.mediumText !== undefined) local.mediumText = w.mediumText;
      if (w.longText !== undefined) local.longText = w.longText;
      if (w.headerText !== undefined) local.headerText = w.headerText;
      break;
    }
    case 'TABL':
    case 'STRU': {
      const w = wire as DdicTableSettingsWire;
      if (w.fields !== undefined) local.fields = w.fields.map(wireFieldToLocal);
      break;
    }
  }
  return local;
}

/**
 * Validate a local DDIC object against the per-type contract.
 * Returns an array of human-readable errors (empty when valid).
 * Namespace / package / transport rules enforced here.
 */
export function validateDdicObject(data: DdicObject, objectType: string): string[] {
  const errors: string[] = [];
  if (!data.name) {
    // The file's `name` must be a top-level JSON field, not nested under
    // `header` or anywhere else. Spell that out so first-time users stop
    // writing abap-file-format's nested header layout.
    errors.push(
      `Missing required field: name (must be a top-level field, e.g. { "name": "ZTAB_EXAMPLE", ... })`,
    );
  }

  // Namespace enforcement: Z/Y/slash only.
  const name = data.name ?? '';
  if (name && name[0] !== 'Z' && name[0] !== 'Y' && name[0] !== '/') {
    errors.push(`Invalid namespace: name must start with Z, Y, or / (got "${name}")`);
  }

  switch (objectType) {
    case 'DOMA': {
      // 033: AFF canonical — `format.dataType` / `format.length`. Legacy flat
      // top-level dataType/length are still accepted as a back-compat shim
      // for pre-014 scripts; the error message keeps the user pointed at the
      // AFF canonical shape so the migration path is clear.
      const format = (data as Record<string, unknown>).format as Record<string, unknown> | undefined;
      const fmtDataType = format?.dataType;
      const fmtLength = format?.length;
      const flatDataType = (data as Record<string, unknown>).dataType;
      const flatLength = (data as Record<string, unknown>).length;
      const hasCanonical = fmtDataType !== undefined && fmtLength !== undefined;
      const hasLegacy = flatDataType !== undefined && flatLength !== undefined;
      if (!hasCanonical && !hasLegacy) {
        errors.push('Domain missing: format.dataType and format.length (AFF canonical under `format.*`)');
      } else if (hasCanonical && (fmtLength === null || fmtLength === undefined)) {
        errors.push('Domain missing: format.length');
      }
      break;
    }
    case 'DTEL': {
      // 033: AFF canonical — `dataTypeInformation.{category, typeName}`.
      const dti = (data as Record<string, unknown>).dataTypeInformation as Record<string, unknown> | undefined;
      const flatDomain = (data as Record<string, unknown>).domain;
      const flatDataType = (data as Record<string, unknown>).dataType;
      if (!data.description) {
        errors.push('DataElement missing: description (and `header.description` per AFF)');
      }
      const hasCanonical = !!dti && (
        dti.category === 'domain' ||
        dti.category === 'predefinedType' ||
        dti.category === 'referenceToPredefinedType' ||
        dti.category === 'referenceDictionaryType' ||
        dti.category === 'referenceClasIntType' ||
        dti.category === 'typeRef' // 032 legacy alias
      );
      const hasLegacy = !!flatDomain || !!flatDataType;
      if (!hasCanonical && !hasLegacy) {
        errors.push(
          'DataElement must declare `dataTypeInformation: { category, typeName }` (AFF) or a flat `domain` (legacy)',
        );
      }
      break;
    }
    case 'TABL':
    case 'STRU':
      if (!Array.isArray((data as Record<string, unknown>).fields)) {
        // BUG-1: spell out that `fields` is a top-level array, not nested.
        errors.push(
          `${objectType} missing: fields (must be a top-level array, e.g. { "fields": [{ "fieldName": "...", "dataType": "...", "length": N }] })`,
        );
      } else {
        const fields = (data as Record<string, unknown>).fields as Array<Record<string, unknown>>;
        if (fields.length === 0) errors.push(`${objectType} fields list is empty`);
        // Enforce the same strip the wire serializer applies, so a user who
        // writes *only* `CLIENT`/`MANDT` in fields[] gets a clear error
        // instead of a silent empty payload.
        const afterStrip = stripClientFields(fields as unknown as DdicFieldLocal[]);
        if (afterStrip.length === 0 && fields.length > 0) {
          errors.push(
            `${objectType} fields list contains only client-key columns (CLIENT/MANDT); these are auto-prepended by the server when clientDependent: true, so the table has no user-defined fields. Add at least one non-client field, or set clientDependent: false.`,
          );
        }
        // Duplicate fieldName is always wrong — the server would reject it
        // anyway, so we surface it before the round-trip.
        const seen = new Set<string>();
        for (const f of fields) {
          if (!f.fieldName) errors.push(`${objectType} field missing: fieldName`);
          else {
            const key = String(f.fieldName).toUpperCase();
            if (seen.has(key)) {
              errors.push(`${objectType} field "${f.fieldName}" is declared more than once`);
            } else {
              seen.add(key);
            }
          }
        }
      }
      break;
    case 'TTYP':
      // Q2: out of scope for this phase; existing diagnostics retained.
      if (!(data as Record<string, unknown>).rowType) errors.push('TableType missing: rowType');
      break;
  }
  return errors;
}

