import * as fs from 'fs/promises';
import * as path from 'path';

// Known DDIC object extensions
export const DDIC_EXTENSIONS = ['.doma.json', '.dtel.json', '.tabl.json', '.stru.json', '.ttyp.json'];

/** DDIC types this CLI can create/pull (Q2: excludes TTYP). */
export const DDIC_SUPPORTED_TYPES = ['DOMA', 'DTEL', 'TABL', 'STRU'] as const;
export type DdicSupportedType = (typeof DDIC_SUPPORTED_TYPES)[number];

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

/** 014: DDIC payload wire shape (camelCase, matches icf-ddic-service.md). */
export interface DdicWirePayload {
  name: string;
  description?: string;
  package?: string;
  transportRequest?: string;
  // DOMA-only:
  dataType?: string;
  length?: number;
  decimals?: number;
  signFlag?: boolean;
  lowercase?: boolean;
  convExit?: string;
  // DTEL-only:
  domain?: string;
  shortText?: string;
  mediumText?: string;
  longText?: string;
  headerText?: string;
  // TABL/STRU-only (flat pull wire — kept for round-trip tests):
  deliveryClass?: string;
  dataClass?: string;
  sizeCategory?: string;
  clientDependent?: boolean;
  allowMaintenance?: boolean;
  fields?: DdicFieldWire[];
  // 024: TABL/STRU abap-file-format three-piece pull wire
  // (populated by zcl_abap_vibe_tabl_format). main_json / ddic_source /
  // settings_json are canonical strings; type/has_settings/warnings/error_*
  // supplement for diagnostics.
  type?: 'TABL' | 'STRU';
  mainJson?: string;
  ddicSource?: string;
  settingsJson?: string;
  hasSettings?: boolean;
  warnings?: Array<{ code: string; message: string }>;
  errorCode?: string;
  errorMessage?: string;
}

/** 024: extract the canonical three-piece strings from a wire payload. */
export function extractTablArtifactWire(wire: DdicWirePayload): {
  mainJson: string;
  ddicSource: string;
  settingsJson: string | undefined;
  hasSettings: boolean;
} | undefined {
  if (typeof wire.mainJson !== 'string' || typeof wire.ddicSource !== 'string') return undefined;
  return {
    mainJson: wire.mainJson,
    ddicSource: wire.ddicSource,
    settingsJson: typeof wire.settingsJson === 'string' ? wire.settingsJson : undefined,
    hasSettings: wire.hasSettings === true,
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

/** 014: convert a local DDIC object (read from .doma.json etc.) to wire payload. */
export function localToWire(type: DdicSupportedType, local: DdicObject): DdicWirePayload {
  const l = local as Record<string, unknown>;
  // abap-file-format places the description under header.description; the flat CLI
  // convention puts it at the top level. Accept both so the CLI accepts either shape.
  const headerObj = (l.header && typeof l.header === 'object') ? (l.header as Record<string, unknown>) : undefined;
  const description = (l.description as string | undefined) ?? (headerObj?.description as string | undefined);
  const wire: DdicWirePayload = {
    name: String(local.name).toUpperCase(),
    description,
    package: l.package as string | undefined,
    transportRequest: l.transportRequest as string | undefined,
  };
  switch (type) {
    case 'DOMA':
      wire.dataType = l.dataType as string;
      wire.length = l.length !== undefined ? Number(l.length) : undefined;
      wire.decimals = l.decimals !== undefined ? Number(l.decimals) : undefined;
      wire.signFlag = l.signFlag as boolean | undefined;
      wire.lowercase = l.lowercase as boolean | undefined;
      wire.convExit = l.convExit as string | undefined;
      break;
    case 'DTEL':
      wire.domain = l.domain as string | undefined;
      wire.dataType = l.dataType as string | undefined;
      wire.length = l.length !== undefined ? Number(l.length) : undefined;
      wire.decimals = l.decimals !== undefined ? Number(l.decimals) : undefined;
      wire.shortText = l.shortText as string | undefined;
      wire.mediumText = l.mediumText as string | undefined;
      wire.longText = l.longText as string | undefined;
      wire.headerText = l.headerText as string | undefined;
      break;
    case 'TABL':
    case 'STRU':
      wire.deliveryClass = l.deliveryClass as string | undefined;
      wire.dataClass = l.dataClass as string | undefined;
      wire.sizeCategory = l.sizeCategory as string | undefined;
      wire.clientDependent = l.clientDependent as boolean | undefined;
      wire.allowMaintenance = l.allowMaintenance as boolean | undefined;
      if (Array.isArray(l.fields)) {
        wire.fields = (l.fields as DdicFieldLocal[]).map(localFieldToWire);
      }
      break;
  }
  return wire;
}

/** 014: convert wire payload back to local abap-file-format shape for round-trip. */
export function wireToLocal(type: DdicSupportedType, wire: DdicWirePayload): DdicObject {
  const local: DdicObject = { name: wire.name };
  if (wire.description !== undefined) local.description = wire.description;
  if (wire.package !== undefined) (local as Record<string, unknown>).package = wire.package;
  if (wire.transportRequest !== undefined) (local as Record<string, unknown>).transportRequest = wire.transportRequest;
  switch (type) {
    case 'DOMA':
      if (wire.dataType !== undefined) local.dataType = wire.dataType;
      if (wire.length !== undefined) local.length = wire.length;
      if (wire.decimals !== undefined) local.decimals = wire.decimals;
      if (wire.signFlag !== undefined) local.signFlag = wire.signFlag;
      if (wire.lowercase !== undefined) local.lowercase = wire.lowercase;
      if (wire.convExit !== undefined) local.convExit = wire.convExit;
      break;
    case 'DTEL':
      if (wire.domain !== undefined) local.domain = wire.domain;
      if (wire.dataType !== undefined) local.dataType = wire.dataType;
      if (wire.length !== undefined) local.length = wire.length;
      if (wire.decimals !== undefined) local.decimals = wire.decimals;
      if (wire.shortText !== undefined) local.shortText = wire.shortText;
      if (wire.mediumText !== undefined) local.mediumText = wire.mediumText;
      if (wire.longText !== undefined) local.longText = wire.longText;
      if (wire.headerText !== undefined) local.headerText = wire.headerText;
      break;
    case 'TABL':
    case 'STRU':
      if (wire.deliveryClass !== undefined) local.deliveryClass = wire.deliveryClass;
      if (wire.dataClass !== undefined) local.dataClass = wire.dataClass;
      if (wire.sizeCategory !== undefined) local.sizeCategory = wire.sizeCategory;
      if (wire.clientDependent !== undefined) local.clientDependent = wire.clientDependent;
      if (wire.allowMaintenance !== undefined) local.allowMaintenance = wire.allowMaintenance;
      if (wire.fields !== undefined) local.fields = wire.fields.map(wireFieldToLocal);
      break;
  }
  return local;
}

/**
 * 014: validate a local DDIC object against the per-type contract
 * (data-model.md §1-4). Returns an array of human-readable errors
 * (empty when valid). Namespace / package / transport rules enforced here.
 */
export function validateDdicObject(data: DdicObject, objectType: string): string[] {
  const errors: string[] = [];
  if (!data.name) {
    // BUG-1: the file's `name` must be a top-level JSON field, not nested under
    // `header` or anywhere else. Spell that out so first-time users stop
    // writing abap-file-format's nested header layout.
    errors.push(
      `Missing required field: name (must be a top-level field, e.g. { "name": "ZTAB_EXAMPLE", ... })`,
    );
  }

  // FR-004: namespace enforcement (Z/Y/slash only).
  const name = data.name ?? '';
  if (name && name[0] !== 'Z' && name[0] !== 'Y' && name[0] !== '/') {
    errors.push(`Invalid namespace: name must start with Z, Y, or / (got "${name}")`);
  }

  switch (objectType) {
    case 'DOMA':
      if (!data.dataType) errors.push('Domain missing: dataType');
      if (data.length === undefined || data.length === null) errors.push('Domain missing: length');
      break;
    case 'DTEL':
      if (!data.description) errors.push('DataElement missing: description');
      if (!data.domain && !data.dataType) {
        errors.push('DataElement must reference a domain OR specify a built-in type (dataType)');
      }
      break;
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
        for (const f of fields) {
          if (!f.fieldName) errors.push(`${objectType} field missing: fieldName`);
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

