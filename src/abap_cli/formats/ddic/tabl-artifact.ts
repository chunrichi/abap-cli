import * as fs from 'fs/promises';
import * as path from 'path';
import type { DdicFieldLocal, DdicObject, DdicSupportedType } from './json.js';

export interface TablArtifact {
  objectName: string;
  type: Extract<DdicSupportedType, 'TABL' | 'STRU'>;
  local: DdicObject;
  files: string[];
}

export interface TablArtifactPaths {
  main: string;
  ddic: string;
  settings: string;
}

/** 024: match TABL (.tabl.{json,ddic,settings.json}) and STRU (.stru.{json,ddic,settings.json}). */
export function isTablArtifactFile(filePath: string): boolean {
  return /\.(tabl|stru)(?:\.settings)?\.(?:json|ddic)$/i.test(path.basename(filePath));
}

export function tablArtifactPaths(filePath: string): TablArtifactPaths {
  const basename = path.basename(filePath);
  const match = basename.match(/^(.*)\.(tabl|stru)(?:\.settings)?\.(json|ddic)$/i);
  if (!match?.[1] || !match?.[2]) throw new Error(`Not a Table and Structure artifact file: ${basename}`);
  const prefix = match[1];
  const typeTag = match[2]!.toLowerCase();
  const directory = path.dirname(filePath);
  return {
    main: path.join(directory, `${prefix}.${typeTag}.json`),
    ddic: path.join(directory, `${prefix}.${typeTag}.ddic`),
    settings: path.join(directory, `${prefix}.${typeTag}.settings.json`),
  };
}

export async function readTablArtifact(filePath: string): Promise<TablArtifact | undefined> {
  const paths = tablArtifactPaths(filePath);
  const exists = await Promise.all([fileExists(paths.main), fileExists(paths.ddic), fileExists(paths.settings)]);
  const isSidecar = path.basename(filePath).toLowerCase().endsWith('.tabl.ddic')
    || path.basename(filePath).toLowerCase().endsWith('.tabl.settings.json');
  if (!exists[1] && !isSidecar) return undefined;
  if (!exists[0] || !exists[1]) {
    throw new Error(`Incomplete Table and Structure artifact: ${path.basename(paths.main)} and ${path.basename(paths.ddic)} are required`);
  }

  const main = JSON.parse(await fs.readFile(paths.main, 'utf-8')) as Record<string, unknown>;
  const ddic = await fs.readFile(paths.ddic, 'utf-8');
  const settings = exists[2]
    ? JSON.parse(await fs.readFile(paths.settings, 'utf-8')) as Record<string, unknown>
    : undefined;
  const parsed = parseTablDdic(ddic);
  const header = main.header && typeof main.header === 'object' ? main.header as Record<string, unknown> : {};
  const generalInformation = settings?.generalInformation && typeof settings.generalInformation === 'object'
    ? settings.generalInformation as Record<string, unknown>
    : {};
  // US6: filter the synthetic @ClientHandling.type / @AbapCatalog.* sentinel fields
  // — they are stash markers, not real table fields.
  const realFields = parsed.fields.filter(f => !f.fieldName.startsWith('@'));
  const fields = realFields.filter(field => !(parsed.type === 'TABL' && ['CLIENT', 'MANDT'].includes(field.fieldName.toUpperCase())));
  // US6: explicit @ClientHandling.type beats field heuristic — `CLIENT_DEPENDENT` /
  // `CLIENT_INDEPENDENT` map to clientDependent. The legacy fallback (presence of a
  // CLIENT/MANDT field) keeps on-prem parity.
  const clientHandlingField = realFields.find(f => f.fieldName === '@ClientHandling.type');
  const explicitClientHandling = clientHandlingField?.dataType;
  const clientDependent = parsed.type === 'TABL' && (
    explicitClientHandling === 'CLIENT_DEPENDENT'
    || (explicitClientHandling === undefined
      && realFields.some(field => ['CLIENT', 'MANDT'].includes(field.fieldName.toUpperCase())))
  );

// 033: AFF canonical — settings live under `generalInformation.*` and the
  // table-level deliveryClass / dataClass / sizeCategory / clientDependent
  // are nested there too. `formatVersion` lives at the top level.
  const localGeneral: Record<string, unknown> = { ...generalInformation };
  if (parsed.deliveryClass !== undefined) localGeneral.deliveryClass = parsed.deliveryClass;
  if (typeof generalInformation.dataClassCategory === 'string') {
    localGeneral.dataClassCategory = generalInformation.dataClassCategory;
  }
  if (typeof generalInformation.sizeCategory === 'string') {
    localGeneral.sizeCategory = generalInformation.sizeCategory;
  }
  localGeneral.clientDependent = clientDependent;
  const local: DdicObject = {
    name: parsed.objectName,
    formatVersion: main.formatVersion,
    description: typeof header.description === 'string' ? header.description : undefined,
    generalInformation: localGeneral,
    fields,
  };
  if (typeof main.package === 'string') local.package = main.package;
  if (typeof main.transportRequest === 'string') local.transportRequest = main.transportRequest;
  return {
    objectName: parsed.objectName,
    type: parsed.type,
    local,
    files: [paths.main, paths.ddic, ...(exists[2] ? [paths.settings] : [])],
  };
}

export interface ParsedTablDdic {
  objectName: string;
  type: Extract<DdicSupportedType, 'TABL' | 'STRU'>;
  deliveryClass?: string;
  fields: DdicFieldLocal[];
}

export function parseTablDdic(source: string): ParsedTablDdic {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let declaration: RegExpMatchArray | null = null;
  let deliveryClass: string | undefined;
  let inBody = false;
  let pendingLabel: string | undefined;
  let pendingReference: { table: string; field: string } | undefined;
  let pendingForeignKeys: Array<{ checkTable: string; label?: string }> | null = null;
  let pendingField: DdicFieldLocal | undefined;
  const fields: DdicFieldLocal[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const declarationMatch = line.match(/^define\s+(table|structure)\s+([\w/#]+)\s*\{$/i);
    if (declarationMatch) {
      declaration = declarationMatch;
      inBody = true;
      continue;
    }
    const deliveryMatch = line.match(/^@AbapCatalog\.deliveryClass\s*:\s*#([A-Za-z0-9_]+)\s*$/i);
    if (deliveryMatch) {
      deliveryClass = deliveryMatch[1]!.toUpperCase();
      continue;
    }
    const clientHandlingMatch = line.match(/^@ClientHandling\.type\s*:\s*#([A-Za-z0-9_]+)\s*$/i);
    if (clientHandlingMatch) {
      // US6: ClientHandling.type drives clientDependent at the artifact layer.
      // Stash on a sentinel field so the caller (readTablArtifact) can pick it up.
      pendingField = { fieldName: '@ClientHandling.type', dataType: clientHandlingMatch[1]!.toUpperCase() };
      continue;
    }
    const foreignKeyAnn = line.match(/^@AbapCatalog\.foreignKeys\s*\.\s*([A-Za-z0-9_]+)\s*:\s*\[\s*$/i)
      ?? line.match(/^@AbapCatalog\.foreignKeys\s*:\s*\[\s*$/i);
    if (foreignKeyAnn) {
      // Foreign-key block: lines until `]` are individual key entries with table + label.
      pendingForeignKeys = [] as Array<{ checkTable: string; label?: string }>;
      continue;
    }
    if (pendingForeignKeys) {
      const fkLine = line.match(/^key\s+([\w/#]+)\s+with\s+(?:foreign\s+key\s+)?(?:\[[^\]]+\]\s+)?check\s+([\w/#]+)\s*;\s*$/i);
      if (fkLine) {
        pendingForeignKeys.push({ checkTable: fkLine[2]!.toUpperCase(), label: fkLine[1]!.toUpperCase() });
        continue;
      }
      if (line === ']' || /^\]\s*,?\s*$/.test(line)) {
        pendingForeignKeys = null;
        continue;
      }
      // Skip annotation-only lines (e.g. label) inside the block — narrow allowance.
      continue;
    }
    const labelMatch = line.match(/^@EndUserText\.label\s*:\s*'(.*)'\s*$/i);
    if (labelMatch) {
      pendingLabel = unescapeDdlString(labelMatch[1]!);
      continue;
    }
    const referenceMatch = line.match(/^@Semantics\.(?:amount\.currencyCode|quantity\.unitOfMeasure)\s*:\s*'([^']+)'\s*$/i);
    if (referenceMatch) {
      const parts = referenceMatch[1]!.split('.');
      if (parts.length === 2) pendingReference = { table: parts[0]!, field: parts[1]! };
      continue;
    }
    if (!inBody) continue;
    if (line === '}') {
      if (pendingField) fields.push(pendingField);
      pendingField = undefined;
      inBody = false;
      continue;
    }
    if (pendingField && pendingField.fieldName !== '@ClientHandling.type') {
      const foreignKeyMatch = line.match(/^with\s+foreign\s+key(?:\s+\[[^\]]+\])?\s+([\w/#]+)/i);
      if (foreignKeyMatch) {
        pendingField.checkTable = foreignKeyMatch[1]!.toUpperCase();
        if (line.endsWith(';')) {
          fields.push(pendingField);
          pendingField = undefined;
        }
        continue;
      }
      if (/^(?:where|and)\s+/i.test(line)) {
        if (line.endsWith(';')) {
          fields.push(pendingField);
          pendingField = undefined;
        }
        continue;
      }
      throw new Error(`Invalid Table and Structure DDL: unfinished field ${pendingField.fieldName}`);
    }
    const includeMatch = line.match(/^include\s+([\w/#]+)(?:\s+with\s+suffix\s+(\w+))?\s*;$/i);
    if (includeMatch) {
      const includeField: DdicFieldLocal = { fieldName: '.INCLUDE', precField: includeMatch[1]!.toUpperCase() };
      if (includeMatch[2]) includeField.includeSuffix = includeMatch[2]!.toUpperCase();
      fields.push(includeField);
      pendingLabel = undefined;
      pendingReference = undefined;
      continue;
    }
    const hasSemicolon = line.endsWith(';');
    const fieldContent = hasSemicolon ? line.slice(0, -1).trim() : line;
    const fieldMatch = fieldContent.match(/^(key\s+)?([\w/#]+)\s*:\s*(.+)$/i);
    if (!fieldMatch) continue;
    const fieldName = fieldMatch[2]!.toUpperCase();
    let fieldType = fieldMatch[3]!.trim();
    const notNull = /\s+not\s+null$/i.test(fieldType);
    if (notNull) fieldType = fieldType.replace(/\s+not\s+null$/i, '').trim();
    // Inline foreign-key clause on the same line, e.g. `abap.char(3) with foreign key [dependent] check t005`.
    const inlineFkMatch = fieldType.match(/\s+with\s+foreign\s+key(?:\s+\[[^\]]+\])?\s+check\s+([\w/#]+)\s*$/i);
    if (inlineFkMatch) fieldType = fieldType.replace(inlineFkMatch[0], '').trim();
    const type = parseDdlType(fieldType);
    const field: DdicFieldLocal = {
      fieldName,
      ...type,
      keyFlag: Boolean(fieldMatch[1]),
      notNull,
      ...(inlineFkMatch ? { checkTable: inlineFkMatch[1]!.toUpperCase() } : {}),
      ...(pendingLabel !== undefined ? { ddtext: pendingLabel } : {}),
      ...(pendingReference ? { refTable: pendingReference.table.toUpperCase(), refField: pendingReference.field.toUpperCase() } : {}),
    };
    if (pendingForeignKeys) {
      field.foreignKeys = (pendingForeignKeys as Array<{ checkTable: string; label?: string }>).map(fk => ({ checkTable: fk.checkTable, ...(fk.label ? { label: fk.label } : {}) }));
    }
    if (hasSemicolon) fields.push(field);
    else pendingField = field;
    pendingLabel = undefined;
    pendingReference = undefined;
    pendingForeignKeys = null;
  }

  if (!declaration || inBody) throw new Error('Invalid Table and Structure DDL: missing define declaration or closing brace');
  return {
    objectName: declaration[2]!.toUpperCase().replace(/#/g, '/'),
    type: declaration[1]!.toUpperCase() === 'STRUCTURE' ? 'STRU' : 'TABL',
    deliveryClass,
    fields,
  };
}

function parseDdlType(value: string): Pick<DdicFieldLocal, 'rollname' | 'dataType' | 'length' | 'decimals'> {
  const builtin = value.match(/^abap\.([a-z0-9_]+)(?:\(([^)]*)\))?$/i);
  if (!builtin) return { rollname: value.toUpperCase() };

  const typeName = builtin[1]!.toUpperCase();
  const parameters = builtin[2]?.split(',').map(value => Number(value.trim())) ?? [];
  const dataType = BUILTIN_DATA_TYPES[typeName];
  if (!dataType) throw new Error(`Unsupported ABAP built-in type in Table and Structure DDL: ${value}`);
  const result: Pick<DdicFieldLocal, 'rollname' | 'dataType' | 'length' | 'decimals'> = { dataType };
  if (parameters[0] !== undefined && Number.isFinite(parameters[0])) result.length = parameters[0];
  if (parameters[1] !== undefined && Number.isFinite(parameters[1])) result.decimals = parameters[1];
  return result;
}

const BUILTIN_DATA_TYPES: Record<string, string> = {
  ACCP: 'ACCP',
  CHAR: 'CHAR',
  CLNT: 'CLNT',
  CUKY: 'CUKY',
  CURR: 'CURR',
  DATS: 'DATS',
  DATN: 'DATN',
  DEC: 'DEC',
  D16D: 'D16D',
  D16N: 'D16N',
  D16R: 'D16R',
  D16S: 'D16S',
  D34D: 'D34D',
  D34N: 'D34N',
  D34R: 'D34R',
  D34S: 'D34S',
  FLTP: 'FLTP',
  INT1: 'INT1',
  INT2: 'INT2',
  INT4: 'INT4',
  INT8: 'INT8',
  LANG: 'LANG',
  NUMC: 'NUMC',
  PREC: 'PREC',
  QUAN: 'QUAN',
  RAW: 'RAW',
  RSTR: 'RSTR',
  SSTR: 'SSTR',
  STRG: 'STRG',
  TIMN: 'TIMN',
  TIMS: 'TIMS',
  UNIT: 'UNIT',
  UTCL: 'UTCL',
  VARC: 'VARC',
};

function unescapeDdlString(value: string): string {
  return value.replace(/''/g, "'");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}