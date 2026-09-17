/**
 * PR5 (B1): ENQU (lock object) local ↔ wire mapping.
 *
 * Local shape mirrors the upstream `enqu-v1.json` AFF schema (vendored under
 * `src/abap_cli/schema/enqu-v1.json`):
 *   { formatVersion, header, primaryTable, secondaryTables?, lockParameters, lockModules }
 *
 * Wire body is JSON (ICF `/ddic/enqu` route, same convention as the other
 * DDIC types). The CLI is the schema-of-record; the ABAP side does not need
 * to know the AFF shape — it gets the same JSON and persists it via
 * `DDIF_ENQU_PUT` after extracting the parts it needs.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CliError } from '../../output/json.js';
import { validateAff } from '../../aff/schema-validator.js';

export type LockMode =
  | 'exclusive'
  | 'shared'
  | 'exclusiveNotCumulative'
  | 'setOptimistic'
  | 'promoteOptimistic'
  | 'conflictCheckExtendedExcl'
  | 'conflictCheckExclusive'
  | 'conflictCheckShared'
  | 'promotionCheckOptimized'
  | 'reserved1'
  | 'reserved2'
  | 'initial';

export interface EnquLockTable {
  name: string;
  lockMode: LockMode;
}

export interface EnquLockParameter {
  name: string;
  table: string;
  field: string;
  active: boolean;
}

export interface EnquLockModules {
  allowRfc: boolean;
}

export interface EnquLocal {
  formatVersion: '1';
  header: { description: string; originalLanguage: string };
  primaryTable: EnquLockTable;
  secondaryTables?: EnquLockTable[];
  lockParameters: EnquLockParameter[];
  lockModules: EnquLockModules;
}

export async function readEnquJson(filePath: string): Promise<EnquLocal> {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw) as EnquLocal;
}

export async function writeEnquJson(filePath: string, doc: EnquLocal): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
}

/**
 * Convert an ENQU wire payload to local AFF shape. The wire mirrors the
 * local schema 1:1 (no SAP-specific envelope), so this is a typed shallow
 * copy with sensible defaults for the few optional fields.
 */
export function wireToLocal(wire: Record<string, unknown>): EnquLocal {
  const header = (wire.header && typeof wire.header === 'object') ? wire.header as Record<string, unknown> : {};
  const primaryTable = (wire.primaryTable && typeof wire.primaryTable === 'object') ? wire.primaryTable as Record<string, unknown> : {};
  const local: EnquLocal = {
    formatVersion: '1',
    header: {
      description: String(header.description ?? ''),
      originalLanguage: String(header.originalLanguage ?? 'en').toLowerCase(),
    },
    primaryTable: {
      name: String(primaryTable.name ?? '').toUpperCase(),
      lockMode: (primaryTable.lockMode as LockMode | undefined) ?? 'exclusive',
    },
    lockParameters: Array.isArray(wire.lockParameters)
      ? (wire.lockParameters as EnquLockParameter[]).map((p) => ({
          name: String(p.name ?? '').toUpperCase(),
          table: String(p.table ?? '').toUpperCase(),
          field: String(p.field ?? '').toUpperCase(),
          active: p.active !== false,
        }))
      : [],
    lockModules: {
      allowRfc: !!(wire.lockModules as { allowRfc?: unknown } | undefined)?.allowRfc,
    },
  };
  if (Array.isArray(wire.secondaryTables) && (wire.secondaryTables as unknown[]).length > 0) {
    local.secondaryTables = (wire.secondaryTables as EnquLockTable[]).map((t) => ({
      name: String(t.name ?? '').toUpperCase(),
      lockMode: (t.lockMode as LockMode | undefined) ?? 'exclusive',
    }));
  }
  return local;
}

/** Convert a local ENQU document to its wire JSON. Pure shape (the ABAP side
 *  is responsible for translating to SAP's ENQU structure). */
export function localToWire(local: EnquLocal): Record<string, unknown> {
  return {
    formatVersion: '1',
    header: local.header,
    primaryTable: local.primaryTable,
    secondaryTables: local.secondaryTables ?? [],
    lockParameters: local.lockParameters,
    lockModules: local.lockModules,
  };
}

/** Validate an ENQU document against the AFF schema. Returns error messages. */
export async function validateEnquObject(doc: unknown): Promise<string[]> {
  const result = await validateAff('ENQU', doc);
  if (result.status === 'pass' || result.status === 'warn') return [];
  return result.errors.map((e) => `${e.instancePath || '/'}: ${e.message ?? ''}`);
}

/** Read, parse, and validate an ENQU .json file in one step. */
export async function loadAndValidate(filePath: string): Promise<EnquLocal> {
  const doc = await readEnquJson(filePath);
  const errors = await validateEnquObject(doc);
  if (errors.length > 0) {
    throw new CliError('AFF_FIXTURE_INVALID', `Invalid ENQU definition in ${path.basename(filePath)}: ${errors.join('; ')}`, {
      file: filePath,
      type: 'ENQU',
      details: errors,
    });
  }
  return doc;
}
