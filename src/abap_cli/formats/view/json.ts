/**
 * VIEW (DDIC database view) local-file ↔ ICF wire mapping.
 *
 * Local file: `<name>.view.json` — a handcrafted abap-file-format-shaped
 * document validated by `view-v1.json` (upstream abap-file-formats has no
 * view schema, so this is a local extension).
 * Wire: the same document posted to the self-built ICF route `/ddic/view`
 * (camelCase JSON, persisted through DDIF_VIEW_PUT). Local and wire differ
 * only by the CLI envelope fields (`type` / `package` / `transportRequest`).
 *
 * Field semantics trace back to the DDIC maintenance structures:
 *   DD25V → header / viewClass / rootTable
 *   DD26V → tables[]
 *   DD27P → fields[]
 *   DD28J → joinConditions[]
 *   DD28V → selectionConditions[]
 */
import { validateAff } from '../../aff/schema-validator.js';
import { defineWireArtifact } from '../artifact.js';

export const VIEW_VIEW_CLASSES = [
  'databaseView',
  'maintenanceView',
  'helpView',
  'projectionView',
] as const;
export type ViewClass = (typeof VIEW_VIEW_CLASSES)[number];

export const VIEW_NAME_MAX_LENGTH = 16;
export const VIEW_DESCRIPTION_MAX_LENGTH = 60;

export interface ViewHeader {
  description: string;
  originalLanguage: string;
  abapLanguageVersion?: string;
}

export interface ViewTable {
  tableName: string;
  tablePosition: number;
  foreignTableName?: string;
  forField?: string;
  forDirection?: string;
}

export interface ViewField {
  viewFieldName?: string;
  tableName: string;
  fieldName: string;
  keyFlag?: boolean;
  rollName?: string;
  viewFieldRollName?: string;
}

export interface ViewJoinCondition {
  leftTable: string;
  leftField: string;
  operator?: string;
  rightTable: string;
  rightField: string;
  source?: string;
}

export interface ViewSelectionCondition {
  fieldName: string;
  operator?: string;
  constants?: string;
  andOr?: string;
  negation?: string;
}

export interface ViewLocal {
  formatVersion: '1';
  header: ViewHeader;
  name: string;
  package?: string;
  viewClass: ViewClass;
  rootTable: string;
  tables: ViewTable[];
  fields: ViewField[];
  joinConditions?: ViewJoinCondition[];
  selectionConditions?: ViewSelectionCondition[];
}

/** Wire payload accepted by ICF `/ddic/view` (local shape + CLI envelope). */
export interface ViewWire extends ViewLocal {
  type?: string;
  package?: string;
  transportRequest?: string;
}

/** VIEW class (wire name / DD25V-VIEWCLASS letter) helper tuple. */
const VIEW_CLASS_LETTERS: ReadonlyArray<{ wire: ViewClass; letter: 'D' | 'C' | 'H' | 'P' }> = [
  { wire: 'databaseView', letter: 'D' },
  { wire: 'maintenanceView', letter: 'C' },
  { wire: 'helpView', letter: 'H' },
  { wire: 'projectionView', letter: 'P' },
];

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

/** Normalize a wire viewClass (camelCase enum or DDIC letter) to the local enum. */
export function normaliseViewClass(value: unknown): ViewClass {
  const raw = asText(value);
  const byWire = VIEW_VIEW_CLASSES.find((c) => c.toLowerCase() === raw.toLowerCase());
  if (byWire) return byWire;
  const byLetter = VIEW_CLASS_LETTERS.find((c) => c.letter === raw.toUpperCase());
  return byLetter?.wire ?? 'databaseView';
}

/** Convert the ICF GET payload into the local view-v1 document. */
export function wireToLocal(wire: unknown): ViewLocal {
  const w = asRecord(wire) ?? {};
  const header = asRecord(w.header) ?? {};
  const local: ViewLocal = {
    formatVersion: '1',
    header: {
      description: asText(header.description),
      originalLanguage: asText(header.originalLanguage).toLowerCase() || 'en',
    },
    name: asUpperText(w.name),
    viewClass: normaliseViewClass(w.viewClass),
    rootTable: asUpperText(w.rootTable),
    tables: Array.isArray(w.tables)
      ? w.tables.map((raw, index) => compactViewTable(asRecord(raw) ?? {}, index + 1))
      : [],
    fields: Array.isArray(w.fields)
      ? w.fields.map((raw) => compactViewField(asRecord(raw) ?? {}))
      : [],
  };
  const languageVersion = asText(header.abapLanguageVersion);
  if (languageVersion && languageVersion !== 'standard') {
    local.header.abapLanguageVersion = languageVersion;
  }
  const packageName = asUpperText(w.package);
  if (packageName) local.package = packageName;
  const joins = Array.isArray(w.joinConditions)
    ? w.joinConditions.map((raw) => compactViewJoin(asRecord(raw) ?? {})).filter((j): j is ViewJoinCondition => j !== undefined)
    : [];
  if (joins.length > 0) local.joinConditions = joins;
  const selections = Array.isArray(w.selectionConditions)
    ? w.selectionConditions
        .map((raw) => compactViewSelection(asRecord(raw) ?? {}))
        .filter((s): s is ViewSelectionCondition => s !== undefined)
    : [];
  if (selections.length > 0) local.selectionConditions = selections;
  return local;
}

function compactViewTable(raw: Record<string, unknown>, fallbackPosition: number): ViewTable {
  const table: ViewTable = {
    tableName: asUpperText(raw.tableName),
    tablePosition: asPositiveInt(raw.tablePosition, fallbackPosition),
  };
  const foreignTable = asUpperText(raw.foreignTableName);
  if (foreignTable) table.foreignTableName = foreignTable;
  const forField = asUpperText(raw.forField);
  if (forField) table.forField = forField;
  const forDirection = asUpperText(raw.forDirection);
  if (forDirection) table.forDirection = forDirection;
  return table;
}

function compactViewField(raw: Record<string, unknown>): ViewField {
  const fieldName = asUpperText(raw.fieldName);
  const viewFieldName = asUpperText(raw.viewFieldName);
  const rollName = asUpperText(raw.rollName);
  const viewFieldRollName = asUpperText(raw.viewFieldRollName);
  const field: ViewField = {
    tableName: asUpperText(raw.tableName),
    fieldName,
    ...(raw.keyFlag === true ? { keyFlag: true } : {}),
  };
  if (viewFieldName && viewFieldName !== fieldName) field.viewFieldName = viewFieldName;
  if (rollName) field.rollName = rollName;
  if (viewFieldRollName && viewFieldRollName !== rollName) field.viewFieldRollName = viewFieldRollName;
  return field;
}

function compactViewJoin(raw: Record<string, unknown>): ViewJoinCondition | undefined {
  const leftTable = asUpperText(raw.leftTable);
  const leftField = asUpperText(raw.leftField);
  const rightTable = asUpperText(raw.rightTable);
  const rightField = asUpperText(raw.rightField);
  if (!leftTable || !leftField || !rightTable || !rightField) return undefined;
  return {
    leftTable,
    leftField,
    operator: asUpperText(raw.operator) || 'EQ',
    rightTable,
    rightField,
    source: asUpperText(raw.source) || 'S',
  };
}

function compactViewSelection(raw: Record<string, unknown>): ViewSelectionCondition | undefined {
  const fieldName = asUpperText(raw.fieldName);
  if (!fieldName) return undefined;
  const condition: ViewSelectionCondition = { fieldName };
  const operator = asUpperText(raw.operator);
  if (operator) condition.operator = operator;
  const constants = asText(raw.constants);
  if (constants) condition.constants = constants;
  const andOr = asUpperText(raw.andOr);
  if (andOr) condition.andOr = andOr;
  const negation = asUpperText(raw.negation);
  if (negation) condition.negation = negation;
  return condition;
}

/** Convert the local document into the wire payload ICF `/ddic/view` accepts. */
export function localToWire(local: ViewLocal): ViewWire {
  const header: ViewHeader = {
    description: asText(local.header?.description),
    originalLanguage: asText(local.header?.originalLanguage).toLowerCase() || 'en',
  };
  const languageVersion = asText(local.header?.abapLanguageVersion);
  if (languageVersion) header.abapLanguageVersion = languageVersion;
  const wire: ViewWire = {
    formatVersion: '1',
    header,
    name: asUpperText(local.name),
    viewClass: normaliseViewClass(local.viewClass),
    rootTable: asUpperText(local.rootTable),
    tables: (local.tables ?? []).map((table, index) => {
      const out: ViewTable = {
        tableName: asUpperText(table.tableName),
        tablePosition: asPositiveInt(table.tablePosition, index + 1),
      };
      const foreignTable = asUpperText(table.foreignTableName);
      if (foreignTable) out.foreignTableName = foreignTable;
      const forField = asUpperText(table.forField);
      if (forField) out.forField = forField;
      const forDirection = asUpperText(table.forDirection);
      if (forDirection) out.forDirection = forDirection;
      return out;
    }),
    fields: (local.fields ?? []).map((field) => {
      const out: ViewField = {
        tableName: asUpperText(field.tableName),
        fieldName: asUpperText(field.fieldName),
      };
      const viewFieldName = asUpperText(field.viewFieldName);
      if (viewFieldName) out.viewFieldName = viewFieldName;
      if (field.keyFlag === true) out.keyFlag = true;
      const rollName = asUpperText(field.rollName);
      if (rollName) out.rollName = rollName;
      const viewFieldRollName = asUpperText(field.viewFieldRollName);
      if (viewFieldRollName) out.viewFieldRollName = viewFieldRollName;
      return out;
    }),
  };
  const packageName = asUpperText(local.package);
  if (packageName) wire.package = packageName;
  const joins = (local.joinConditions ?? [])
    .map((join) => compactViewJoin(join as unknown as Record<string, unknown>))
    .filter((j): j is ViewJoinCondition => j !== undefined);
  if (joins.length > 0) wire.joinConditions = joins;
  const selections = (local.selectionConditions ?? [])
    .map((selection) => compactViewSelection(selection as unknown as Record<string, unknown>))
    .filter((s): s is ViewSelectionCondition => s !== undefined);
  if (selections.length > 0) wire.selectionConditions = selections;
  return wire;
}

/**
 * Semantic validation for a view-v1 document (beyond what JSON Schema can
 * express): name rules, required header, table list consistency and
 * field/table references.
 */
export function validateViewObject(doc: unknown): string[] {
  const data = asRecord(doc);
  if (!data) return ['view document must be a JSON object'];
  const errors: string[] = [];

  const rawName = asText(data.name);
  const name = rawName.toUpperCase();
  if (!name) {
    errors.push('Missing required field: name (e.g. { "name": "ZCLI_TC_VIEW", ... })');
  } else {
    if (name.length > VIEW_NAME_MAX_LENGTH) {
      errors.push(`name must not exceed ${VIEW_NAME_MAX_LENGTH} characters (got ${name.length})`);
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
    else if (description.length > VIEW_DESCRIPTION_MAX_LENGTH) {
      errors.push(`header.description must not exceed ${VIEW_DESCRIPTION_MAX_LENGTH} characters (got ${description.length})`);
    }
    const language = asText(header.originalLanguage);
    if (!/^[A-Za-z]{2}$/.test(language)) {
      errors.push('header.originalLanguage must be a two-letter ISO code (e.g. "en")');
    }
  }

  if (!VIEW_VIEW_CLASSES.includes(data.viewClass as ViewClass)) {
    errors.push(`viewClass must be one of ${VIEW_VIEW_CLASSES.join(', ')}`);
  }

  const rootTable = asUpperText(data.rootTable);
  if (!rootTable) errors.push('rootTable is required');

  const tableNames = new Set<string>();
  const tables = Array.isArray(data.tables) ? data.tables : [];
  if (tables.length === 0) errors.push('tables[] must contain at least the root table');
  tables.forEach((raw, index) => {
    const table = asRecord(raw) ?? {};
    const tableName = asUpperText(table.tableName);
    if (!tableName) {
      errors.push(`tables[${index}].tableName is required`);
      return;
    }
    if (tableNames.has(tableName)) {
      errors.push(`tables[${index}].tableName "${tableName}" is declared more than once`);
      return;
    }
    tableNames.add(tableName);
  });
  if (rootTable && tables.length > 0) {
    const firstTable = asUpperText(asRecord(tables[0])?.tableName);
    if (firstTable && firstTable !== rootTable) {
      errors.push(`rootTable must equal the first tables[] entry ("${firstTable}")`);
    }
  }

  const fields = Array.isArray(data.fields) ? data.fields : [];
  if (fields.length === 0) errors.push('fields[] must contain at least one view field');
  const fieldKeys = new Set<string>();
  const viewFieldNames = new Set<string>();
  fields.forEach((raw, index) => {
    const field = asRecord(raw) ?? {};
    const tableName = asUpperText(field.tableName);
    const fieldName = asUpperText(field.fieldName);
    if (!tableName || !fieldName) {
      errors.push(`fields[${index}].tableName and fields[${index}].fieldName are required`);
      return;
    }
    if (tableNames.size > 0 && !tableNames.has(tableName)) {
      errors.push(`fields[${index}] references table "${tableName}", which is not in tables[]`);
    }
    const key = `${tableName}.${fieldName}`;
    if (fieldKeys.has(key)) {
      errors.push(`fields[${index}] "${key}" is declared more than once`);
    } else {
      fieldKeys.add(key);
    }
    const viewFieldName = asUpperText(field.viewFieldName) || fieldName;
    if (viewFieldNames.has(viewFieldName)) {
      errors.push(`fields[${index}].viewFieldName "${viewFieldName}" is declared more than once`);
    } else {
      viewFieldNames.add(viewFieldName);
    }
  });

  const joins = Array.isArray(data.joinConditions) ? data.joinConditions : [];
  joins.forEach((raw, index) => {
    const join = asRecord(raw) ?? {};
    const leftTable = asUpperText(join.leftTable);
    const rightTable = asUpperText(join.rightTable);
    for (const [side, tableName] of [
      ['leftTable', leftTable],
      ['rightTable', rightTable],
    ] as const) {
      if (tableName && tableNames.size > 0 && !tableNames.has(tableName)) {
        errors.push(`joinConditions[${index}].${side} "${tableName}" is not in tables[]`);
      }
    }
  });

  return errors;
}

/** Agent-facing minimal view-v1 example (`abap create --schema VIEW`). */
export function getViewJsonExample(): string {
  return `# src/zcli_tc_view.view.json (single file)
{
  "formatVersion": "1",
  "header": {
    "description": "ZCLI demo view over T000",
    "originalLanguage": "en"
  },
  "name": "ZCLI_TC_VIEW",
  "viewClass": "databaseView",
  "rootTable": "T000",
  "tables": [
    { "tableName": "T000", "tablePosition": 1 }
  ],
  "fields": [
    { "tableName": "T000", "fieldName": "MANDT", "keyFlag": true },
    { "tableName": "T000", "fieldName": "MTEXT" }
  ]
}
# Multi-table views add "joinConditions": [{ "leftTable": "...", "leftField": "...",
#   "rightTable": "...", "rightField": "..." }] plus the joined table in tables[].`;
}

/** VIEW AFF artifact: file/schema plumbing + local ↔ ICF wire mapping. */
export const viewArtifact = defineWireArtifact<ViewLocal, ViewWire>({
  type: 'VIEW',
  toWire: (local) => localToWire(local),
  fromWire: (wire) => wireToLocal(wire),
  validate: async (doc) => {
    const result = await validateAff('VIEW', doc);
    const schemaErrors =
      result.status === 'pass' || result.status === 'warn'
        ? []
        : result.errors.map((e) => `${e.instancePath || '/'}: ${e.message}`);
    return [...schemaErrors, ...validateViewObject(doc)];
  },
});
