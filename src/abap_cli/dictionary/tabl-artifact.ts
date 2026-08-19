import * as fs from 'fs/promises';
import * as path from 'path';
import type { DdicFieldLocal, DdicObject, DdicSupportedType } from './ddic-json.js';

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
  const fields = parsed.fields.filter(field => !(parsed.type === 'TABL' && ['CLIENT', 'MANDT'].includes(field.fieldName.toUpperCase())));
  const clientDependent = parsed.type === 'TABL'
    && parsed.fields.some(field => ['CLIENT', 'MANDT'].includes(field.fieldName.toUpperCase()));

  const local: DdicObject = {
    name: parsed.objectName,
    formatVersion: main.formatVersion,
    description: typeof header.description === 'string' ? header.description : undefined,
    deliveryClass: parsed.deliveryClass,
    dataClass: typeof generalInformation.dataClassCategory === 'string' ? generalInformation.dataClassCategory : undefined,
    sizeCategory: typeof generalInformation.sizeCategory === 'string' ? generalInformation.sizeCategory : undefined,
    clientDependent,
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
    if (pendingField) {
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
    const includeMatch = line.match(/^include\s+([\w/#]+)\s*;$/i);
    if (includeMatch) {
      fields.push({ fieldName: '.INCLUDE', precField: includeMatch[1]!.toUpperCase() });
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
    const type = parseDdlType(fieldType);
    const field: DdicFieldLocal = {
      fieldName,
      ...type,
      keyFlag: Boolean(fieldMatch[1]),
      notNull,
      ...(pendingLabel !== undefined ? { ddtext: pendingLabel } : {}),
      ...(pendingReference ? { refTable: pendingReference.table.toUpperCase(), refField: pendingReference.field.toUpperCase() } : {}),
    };
    if (hasSemicolon) fields.push(field);
    else pendingField = field;
    pendingLabel = undefined;
    pendingReference = undefined;
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