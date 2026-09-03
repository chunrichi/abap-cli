/**
 * AFF schema path resolver.
 *
 * Owns the mapping from canonical abap-cli type code → schema file path.
 * STRU reuses `tabl-v1.json` (single source of truth: spec 018 / spec 033).
 *
 * This is also exported via `types/registry.ts` as `schemaPathFor(type)`.
 * Both call into the same constant map so the registry and the validator
 * agree on paths.
 */

import * as path from 'node:path';

/** Mapping of canonical abap-cli type codes to AFF schema filenames. */
const SCHEMA_FILE: Record<string, string> = {
  CLAS: 'clas-v1.json',
  INTF: 'intf-v1.json',
  PROG: 'prog-v1.json',
  FUGR: 'fugr-v1.json',
  TABL: 'tabl-v1.json',
  // STRU reuses TABL's schema (spec 018 US1 / spec 033 US5). The schema
  // physically lives under `tabl/tabl-v1.json`, so we also remap the
  // directory to `tabl`.
  STRU: 'tabl-v1.json',
  // TABL/STRU `settings.json` companion files use the technical-settings
  // schema (the main `tabl-v1.json` only declares formatVersion + header).
  TABT: 'tabt-v1.json',
  DOMA: 'doma-v1.json',
  DTEL: 'dtel-v1.json',
  HTTP: 'http-v1.json',
  TRAN: 'tran-v1.json',
};

/** Mapping of canonical abap-cli type codes → AFF mirror directory (lowercase).
 *  STRU reuses TABL's directory because there is no `stru/` folder on disk.
 *  TABT (technical settings) also lives under `tabl/`. */
const SCHEMA_DIR: Record<string, string> = {
  CLAS: 'clas',
  INTF: 'intf',
  PROG: 'prog',
  FUGR: 'fugr',
  TABL: 'tabl',
  STRU: 'tabl',
  TABT: 'tabl',
  DOMA: 'doma',
  DTEL: 'dtel',
  HTTP: 'http',
  TRAN: 'tran',
};

/** Repo-root default mirror path. */
function defaultMirrorRoot(): string {
  if (typeof import.meta === 'object' && typeof import.meta.url === 'string') {
    const here = path.dirname(new URL(import.meta.url).pathname);
    return path.resolve(here, '..', '..', '..', 'tmp', 'abap-file-formats', 'file-formats');
  }
  return path.join(process.cwd(), 'tmp', 'abap-file-formats', 'file-formats');
}

/**
 * Resolve the absolute path of the AFF schema for a given type.
 * @param type Canonical abap-cli type code (uppercase).
 * @param mirrorRoot Optional explicit mirror root (tests only).
 * @param schemaFileOverride Optional explicit schema filename (used for
 *   TABL/STRU `.settings.json` → `tabt-v1.json`). When set, the type's
 *   default file is ignored but the directory mapping is still honored.
 */
export function schemaPathFor(
  type: string,
  mirrorRoot?: string,
  schemaFileOverride?: string,
): string {
  const key = type.toUpperCase();
  const dir = SCHEMA_DIR[key];
  if (!dir) {
    throw new Error(`No AFF schema directory registered for type "${type}"`);
  }
  const file = schemaFileOverride ?? SCHEMA_FILE[key];
  if (!file) {
    throw new Error(`No AFF schema mapping registered for type "${type}"`);
  }
  const root = mirrorRoot ?? defaultMirrorRoot();
  return path.join(root, dir, file);
}

/** Return the set of AFF-supported types (used by router + CLI command discovery). */
export function affSupportedTypes(): string[] {
  return Object.keys(SCHEMA_FILE);
}
