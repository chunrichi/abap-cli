/**
 * SHLP (DDIC search help) local-file ↔ ICF wire mapping.
 *
 * Local file: `<name>.shlp.json` — a handcrafted abap-file-format-shaped
 * document validated by `shlp-v1.json` (upstream abap-file-formats has no
 * search-help schema, so this is a local extension).
 * Wire: the same document posted to the self-built ICF route `/ddic/shlp`
 * (camelCase JSON, persisted through DDIF_SHLP_PUT). Local and wire differ
 * only by the CLI envelope fields (`type` / `package` / `transportRequest`).
 *
 * Field semantics trace back to the DDIC maintenance structures:
 *   DD30V → header / kind / selectionMethod / selectionMethodType / textTable /
 *           dialogType / hotkey
 *   DD31V → includedSearchHelps[]
 *   DD32P → parameters[]
 *   DD33V → parameterMappings[]
 */
import { validateAff } from '../../aff/schema-validator.js';
import { defineWireArtifact } from '../artifact.js';

export const SHLP_KINDS = ['elementary', 'collective'] as const;
export type ShlpKind = (typeof SHLP_KINDS)[number];

export const SHLP_SELECTION_METHOD_TYPES = ['table', 'view'] as const;
export type ShlpSelectionMethodType = (typeof SHLP_SELECTION_METHOD_TYPES)[number];

export const SHLP_DIALOG_TYPES = ['displayValuesList', 'dialog'] as const;
export type ShlpDialogType = (typeof SHLP_DIALOG_TYPES)[number];

export const SHLP_VALUE_DIRECTIONS = ['import', 'export'] as const;
export type ShlpValueDirection = (typeof SHLP_VALUE_DIRECTIONS)[number];

export const SHLP_NAME_MAX_LENGTH = 30;
export const SHLP_DESCRIPTION_MAX_LENGTH = 60;

export interface ShlpHeader {
  description: string;
  originalLanguage: string;
  abapLanguageVersion?: string;
}

export interface ShlpParameter {
  fieldName: string;
  position: number;
  rollName?: string;
  input?: boolean;
  output?: boolean;
  selectionPosition?: number;
  listPosition?: number;
  defaultValue?: string;
}

export interface ShlpIncluded {
  searchHelp: string;
  position: number;
  viaSearchHelp?: string;
  hide?: boolean;
}

export interface ShlpMapping {
  fieldName: string;
  subSearchHelp: string;
  subFieldName: string;
  valueDirection?: ShlpValueDirection;
}

export interface ShlpLocal {
  formatVersion: '1';
  header: ShlpHeader;
  name: string;
  package?: string;
  kind: ShlpKind;
  selectionMethod?: string;
  selectionMethodType?: ShlpSelectionMethodType;
  textTable?: string;
  dialogType?: ShlpDialogType;
  hotkey?: string;
  parameters: ShlpParameter[];
  includedSearchHelps?: ShlpIncluded[];
  parameterMappings?: ShlpMapping[];
}

/** Wire payload accepted by ICF `/ddic/shlp` (local shape + CLI envelope). */
export interface ShlpWire extends ShlpLocal {
  type?: string;
  transportRequest?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asUpperText(value: unknown): string {
  return asText(value).toUpperCase();
}

function asPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

function asCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

/** Normalize a wire selection-method type (enum or DDIC letter) to the local enum. */
export function normaliseSelectionMethodType(value: unknown): ShlpSelectionMethodType {
  const raw = asText(value).toLowerCase();
  return raw === 'view' || raw === 'v' ? 'view' : 'table';
}

/** Normalize a wire dialog type (enum or DDIC letter) to the local enum. */
export function normaliseDialogType(value: unknown): ShlpDialogType {
  const raw = asText(value).toLowerCase();
  return raw === 'dialog' || raw === 'c' ? 'dialog' : 'displayValuesList';
}

/** Normalize a wire value direction (enum or DDIC letter) to the local enum. */
export function normaliseValueDirection(value: unknown): ShlpValueDirection {
  const raw = asText(value).toUpperCase();
  return raw === 'E' || raw === 'EXPORT' ? 'export' : 'import';
}

/** Convert the ICF GET payload into the local shlp-v1 document. */
export function wireToLocal(wire: unknown): ShlpLocal {
  const w = asRecord(wire) ?? {};
  const header = asRecord(w.header) ?? {};
  const local: ShlpLocal = {
    formatVersion: '1',
    header: {
      description: asText(header.description),
      originalLanguage: asText(header.originalLanguage).toLowerCase() || 'en',
    },
    name: asUpperText(w.name),
    kind: asText(w.kind).toLowerCase() === 'collective' ? 'collective' : 'elementary',
    parameters: Array.isArray(w.parameters)
      ? w.parameters.map((raw, index) => compactParameter(asRecord(raw) ?? {}, index + 1))
      : [],
  };
  const languageVersion = asText(header.abapLanguageVersion);
  if (languageVersion && languageVersion !== 'standard') local.header.abapLanguageVersion = languageVersion;
  const packageName = asUpperText(w.package);
  if (packageName) local.package = packageName;
  const selectionMethod = asUpperText(w.selectionMethod);
  if (selectionMethod) local.selectionMethod = selectionMethod;
  const selectionMethodType = asText(w.selectionMethodType);
  if (selectionMethodType) local.selectionMethodType = normaliseSelectionMethodType(selectionMethodType);
  const textTable = asUpperText(w.textTable);
  if (textTable) local.textTable = textTable;
  const dialogType = asText(w.dialogType);
  if (dialogType) local.dialogType = normaliseDialogType(dialogType);
  const hotkey = asUpperText(w.hotkey);
  if (hotkey) local.hotkey = hotkey;
  const included = Array.isArray(w.includedSearchHelps)
    ? w.includedSearchHelps
        .map((raw) => compactIncluded(asRecord(raw) ?? {}))
        .filter((entry): entry is ShlpIncluded => entry !== undefined)
    : [];
  if (included.length > 0) local.includedSearchHelps = included;
  const mappings = Array.isArray(w.parameterMappings)
    ? w.parameterMappings
        .map((raw) => compactMapping(asRecord(raw) ?? {}))
        .filter((entry): entry is ShlpMapping => entry !== undefined)
    : [];
  if (mappings.length > 0) local.parameterMappings = mappings;
  return local;
}

function compactParameter(raw: Record<string, unknown>, fallbackPosition: number): ShlpParameter {
  const parameter: ShlpParameter = {
    fieldName: asUpperText(raw.fieldName),
    position: asPositiveInt(raw.position, fallbackPosition),
  };
  const rollName = asUpperText(raw.rollName);
  if (rollName) parameter.rollName = rollName;
  if (raw.input === true) parameter.input = true;
  if (raw.output === true) parameter.output = true;
  const selectionPosition = asCount(raw.selectionPosition);
  if (selectionPosition > 0) parameter.selectionPosition = selectionPosition;
  const listPosition = asCount(raw.listPosition);
  if (listPosition > 0) parameter.listPosition = listPosition;
  const defaultValue = asText(raw.defaultValue);
  if (defaultValue) parameter.defaultValue = defaultValue;
  return parameter;
}

function compactIncluded(raw: Record<string, unknown>): ShlpIncluded | undefined {
  const searchHelp = asUpperText(raw.searchHelp);
  if (!searchHelp) return undefined;
  const included: ShlpIncluded = { searchHelp, position: asPositiveInt(raw.position, 1) };
  const viaSearchHelp = asUpperText(raw.viaSearchHelp);
  if (viaSearchHelp) included.viaSearchHelp = viaSearchHelp;
  if (raw.hide === true) included.hide = true;
  return included;
}

function compactMapping(raw: Record<string, unknown>): ShlpMapping | undefined {
  const fieldName = asUpperText(raw.fieldName);
  const subSearchHelp = asUpperText(raw.subSearchHelp);
  const subFieldName = asUpperText(raw.subFieldName);
  if (!fieldName || !subSearchHelp || !subFieldName) return undefined;
  return { fieldName, subSearchHelp, subFieldName, valueDirection: normaliseValueDirection(raw.valueDirection) };
}

/** Convert the local document into the wire payload ICF `/ddic/shlp` accepts. */
export function localToWire(local: ShlpLocal): ShlpWire {
  const header: ShlpHeader = {
    description: asText(local.header?.description),
    originalLanguage: asText(local.header?.originalLanguage).toLowerCase() || 'en',
  };
  const languageVersion = asText(local.header?.abapLanguageVersion);
  if (languageVersion) header.abapLanguageVersion = languageVersion;
  const wire: ShlpWire = {
    formatVersion: '1',
    header,
    name: asUpperText(local.name),
    kind: local.kind === 'collective' ? 'collective' : 'elementary',
    parameters: (local.parameters ?? []).map((parameter, index) => {
      const out: ShlpParameter = {
        fieldName: asUpperText(parameter.fieldName),
        position: asPositiveInt(parameter.position, index + 1),
      };
      const rollName = asUpperText(parameter.rollName);
      if (rollName) out.rollName = rollName;
      if (parameter.input === true) out.input = true;
      if (parameter.output === true) out.output = true;
      const selectionPosition = asCount(parameter.selectionPosition);
      if (selectionPosition > 0) out.selectionPosition = selectionPosition;
      const listPosition = asCount(parameter.listPosition);
      if (listPosition > 0) out.listPosition = listPosition;
      const defaultValue = asText(parameter.defaultValue);
      if (defaultValue) out.defaultValue = defaultValue;
      return out;
    }),
  };
  const packageName = asUpperText(local.package);
  if (packageName) wire.package = packageName;
  const selectionMethod = asUpperText(local.selectionMethod);
  if (selectionMethod) wire.selectionMethod = selectionMethod;
  if (local.selectionMethodType) wire.selectionMethodType = local.selectionMethodType;
  const textTable = asUpperText(local.textTable);
  if (textTable) wire.textTable = textTable;
  if (local.dialogType) wire.dialogType = local.dialogType;
  const hotkey = asUpperText(local.hotkey);
  if (hotkey) wire.hotkey = hotkey;
  const included = (local.includedSearchHelps ?? [])
    .map((entry) => compactIncluded(entry as unknown as Record<string, unknown>))
    .filter((entry): entry is ShlpIncluded => entry !== undefined);
  if (included.length > 0) wire.includedSearchHelps = included;
  const mappings = (local.parameterMappings ?? [])
    .map((entry) => compactMapping(entry as unknown as Record<string, unknown>))
    .filter((entry): entry is ShlpMapping => entry !== undefined);
  if (mappings.length > 0) wire.parameterMappings = mappings;
  return wire;
}

/**
 * Semantic validation beyond JSON Schema: name/header rules, parameter and
 * mapping consistency, and the elementary/collective structural contracts.
 */
export function validateShlpObject(doc: unknown): string[] {
  const data = asRecord(doc);
  if (!data) return ['search help document must be a JSON object'];
  const errors: string[] = [];

  const rawName = asText(data.name);
  const name = rawName.toUpperCase();
  if (!name) {
    errors.push('Missing required field: name (e.g. { "name": "ZCLI_TC_SHLP", ... })');
  } else {
    if (name.length > SHLP_NAME_MAX_LENGTH) {
      errors.push(`name must not exceed ${SHLP_NAME_MAX_LENGTH} characters (got ${name.length})`);
    }
    if (!/^[A-Z0-9_/]+$/.test(name)) {
      errors.push(`name must contain only A-Z, 0-9, _ and / (got "${rawName}")`);
    }
  }

  const header = asRecord(data.header);
  if (!header) {
    errors.push('header is required (header.description and header.originalLanguage)');
  } else {
    const description = asText(header.description);
    if (!description) errors.push('header.description is required');
    else if (description.length > SHLP_DESCRIPTION_MAX_LENGTH) {
      errors.push(`header.description must not exceed ${SHLP_DESCRIPTION_MAX_LENGTH} characters (got ${description.length})`);
    }
    const language = asText(header.originalLanguage);
    if (!/^[A-Za-z]{2}$/.test(language)) {
      errors.push('header.originalLanguage must be a two-letter ISO code (e.g. "en")');
    }
  }

  const kind = asText(data.kind).toLowerCase();
  if (!SHLP_KINDS.includes(kind as ShlpKind)) {
    errors.push(`kind must be one of ${SHLP_KINDS.join(', ')}`);
  }

  const parameters = Array.isArray(data.parameters) ? data.parameters : [];
  if (parameters.length === 0) errors.push('parameters[] must contain at least one interface parameter');
  const parameterNames = new Set<string>();
  parameters.forEach((raw, index) => {
    const parameter = asRecord(raw) ?? {};
    const fieldName = asUpperText(parameter.fieldName);
    if (!fieldName) {
      errors.push(`parameters[${index}].fieldName is required`);
      return;
    }
    if (parameterNames.has(fieldName)) {
      errors.push(`parameters[${index}].fieldName "${fieldName}" is declared more than once`);
    } else {
      parameterNames.add(fieldName);
    }
  });

  const included = Array.isArray(data.includedSearchHelps) ? data.includedSearchHelps : [];
  const includedNames = new Set<string>();
  included.forEach((raw, index) => {
    const entry = asRecord(raw) ?? {};
    const searchHelp = asUpperText(entry.searchHelp);
    if (!searchHelp) {
      errors.push(`includedSearchHelps[${index}].searchHelp is required`);
      return;
    }
    if (includedNames.has(searchHelp)) {
      errors.push(`includedSearchHelps[${index}].searchHelp "${searchHelp}" is declared more than once`);
    } else {
      includedNames.add(searchHelp);
    }
  });

  const mappings = Array.isArray(data.parameterMappings) ? data.parameterMappings : [];
  mappings.forEach((raw, index) => {
    const mapping = asRecord(raw) ?? {};
    const fieldName = asUpperText(mapping.fieldName);
    const subSearchHelp = asUpperText(mapping.subSearchHelp);
    const subFieldName = asUpperText(mapping.subFieldName);
    if (!fieldName || !subSearchHelp || !subFieldName) {
      errors.push(`parameterMappings[${index}] requires fieldName, subSearchHelp and subFieldName`);
      return;
    }
    if (parameterNames.size > 0 && !parameterNames.has(fieldName)) {
      errors.push(`parameterMappings[${index}].fieldName "${fieldName}" is not an interface parameter`);
    }
    if (includedNames.size > 0 && !includedNames.has(subSearchHelp)) {
      errors.push(`parameterMappings[${index}].subSearchHelp "${subSearchHelp}" is not in includedSearchHelps[]`);
    }
    const direction = asText(mapping.valueDirection);
    if (direction && !SHLP_VALUE_DIRECTIONS.includes(direction as ShlpValueDirection)) {
      errors.push(`parameterMappings[${index}].valueDirection must be one of ${SHLP_VALUE_DIRECTIONS.join(', ')}`);
    }
  });

  if (kind === 'elementary') {
    if (!asUpperText(data.selectionMethod)) {
      errors.push('selectionMethod is required for an elementary search help');
    }
    if (included.length > 0) errors.push('includedSearchHelps[] only applies to a collective search help');
    if (mappings.length > 0) errors.push('parameterMappings[] only applies to a collective search help');
  }
  if (kind === 'collective') {
    if (included.length === 0) {
      errors.push('includedSearchHelps[] must contain at least one included search help for a collective search help');
    }
    if (mappings.length === 0) {
      errors.push('parameterMappings[] must map the interface parameters for a collective search help');
    }
    if (asUpperText(data.selectionMethod)) errors.push('selectionMethod only applies to an elementary search help');
  }

  return errors;
}

/** Agent-facing minimal shlp-v1 examples (`abap create --schema SHLP`). */
export function getShlpJsonExample(): string {
  return `# src/zcli_tc_shlp.shlp.json (elementary; single file)
{
  "formatVersion": "1",
  "header": {
    "description": "ZCLI demo elementary search help",
    "originalLanguage": "en"
  },
  "name": "ZCLI_TC_SHLP",
  "kind": "elementary",
  "selectionMethod": "T002",
  "selectionMethodType": "table",
  "textTable": "T002T",
  "parameters": [
    { "fieldName": "SPRAS", "rollName": "SPRAS", "input": true, "output": true },
    { "fieldName": "LAISO", "rollName": "LAISO", "output": true }
  ]
}
# A collective search help sets "kind": "collective", plus:
#   "includedSearchHelps": [{ "searchHelp": "ZCLI_TC_SHLP", "position": 1 }],
#   "parameterMappings": [{ "fieldName": "SPRAS", "subSearchHelp": "ZCLI_TC_SHLP",
#                           "subFieldName": "SPRAS", "valueDirection": "import" }]`;
}

/** SHLP AFF artifact: file/schema plumbing + local ↔ ICF wire mapping. */
export const shlpArtifact = defineWireArtifact<ShlpLocal, ShlpWire>({
  type: 'SHLP',
  toWire: (local) => localToWire(local),
  fromWire: (wire) => wireToLocal(wire),
  validate: async (doc) => {
    const result = await validateAff('SHLP', doc);
    const schemaErrors =
      result.status === 'pass' || result.status === 'warn'
        ? []
        : result.errors.map((e) => `${e.instancePath || '/'}: ${e.message}`);
    return [...schemaErrors, ...validateShlpObject(doc)];
  },
});
