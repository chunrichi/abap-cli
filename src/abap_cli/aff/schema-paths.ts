/**
 * AFF schema path resolver.
 *
 * Owns the mapping from canonical abap-cli type code → schema file path.
 * STRU reuses `tabl-v1.json` (single source of truth: spec 018 / spec 033).
 *
 * Schemas are searched in this priority order:
 *   1. `ABAP_CLI_AFF_MIRROR` environment variable (explicit dev override).
 *   2. Bundled copy under `src/abap_cli/schema/` (always present in the
 *      repo and in published npm artifacts — CI does not depend on git
 *      clone or postinstall scripts).
 *   3. Legacy dev mirror at `tmp/abap-file-formats/file-formats/`
 *      (preserved as an override path for developers who cloned the
 *      full SAP upstream locally and want live edits without syncing).
 *
 * This module is also exported via `types/registry.ts` as
 * `schemaPathFor(type)`. Both call into the same constant map so the
 * registry and the validator agree on paths.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const AFF_MIRROR_ENV = 'ABAP_CLI_AFF_MIRROR';

/** Mapping of canonical abap-cli type codes to AFF schema filenames.
 *  Schemas live flat under each root (no per-type directory). */
const SCHEMA_FILE: Record<string, string> = {
  CLAS: 'clas-v1.json',
  INTF: 'intf-v1.json',
  PROG: 'prog-v1.json',
  FUGR: 'fugr-v1.json',
  TABL: 'tabl-v1.json',
  // STRU reuses TABL's schema (spec 018 US1 / spec 033 US5).
  STRU: 'tabl-v1.json',
  // TABL/STRU `settings.json` companion files use the technical-settings
  // schema (the main `tabl-v1.json` only declares formatVersion + header).
  TABT: 'tabt-v1.json',
  DOMA: 'doma-v1.json',
  DTEL: 'dtel-v1.json',
  HTTP: 'http-v1.json',
  TRAN: 'tran-v1.json',
  // 036-ttyp-msag-ddls: three new dual-channel types.
  TTYP: 'ttyp-v1.json',   // handcrafted (upstream has type-pool only)
  MSAG: 'msag-v1.json',
  DDLS: 'ddls-v1.json',
  // T1.5 FUGR pull: REPS + FUNC companion schemas.
  REPS: 'reps-v1.json',
  FUNC: 'func-v1.json',
  // T3.2 / T3.1 / T3.3 / T3.4 — Phase 3 type extensions (SRVB metadata-only;
  // SRVD / BDEF / DCLS / DDLX / DDLA all source-bearing).
  SRVB: 'srvb-v1.json',
  SRVD: 'srvd-v1.json',
  BDEF: 'bdef-v1.json',
  DCLS: 'dcls-v1.json',
  DDLX: 'ddlx-v1.json',
  DDLA: 'ddla-v1.json',
};

/** Resolve the bundled-schema directory shipped with the package.
 *  `src/abap_cli/aff/schema-paths.ts` → repo root → src/abap_cli/schema/. */
function bundledMirrorRoot(): string {
  if (typeof import.meta === 'object' && typeof import.meta.url === 'string') {
    const here = path.dirname(new URL(import.meta.url).pathname);
    return path.resolve(here, '..', 'schema');
  }
  return path.join(process.cwd(), 'src', 'abap_cli', 'schema');
}

/** Legacy dev-mirror path (full SAP upstream clone). Used only if the
 *  bundled copy and the env override both miss. */
function legacyMirrorRoot(): string {
  if (typeof import.meta === 'object' && typeof import.meta.url === 'string') {
    const here = path.dirname(new URL(import.meta.url).pathname);
    return path.resolve(here, '..', '..', '..', 'tmp', 'abap-file-formats', 'file-formats');
  }
  return path.join(process.cwd(), 'tmp', 'abap-file-formats', 'file-formats');
}

/** Pick the first mirror root whose directory exists. The function is
 *  synchronous because `schemaPathFor` must remain sync (called in hot
 *  loops); we only stat the bundled and legacy roots, not the env override
 *  (which is treated as authoritative when set). */
function pickMirrorRoot(): string {
  const envRoot = process.env[AFF_MIRROR_ENV];
  if (envRoot) return envRoot;
  const bundled = bundledMirrorRoot();
  if (fs.existsSync(bundled)) return bundled;
  return legacyMirrorRoot();
}

/**
 * Resolve the absolute path of the AFF schema for a given type.
 * @param type Canonical abap-cli type code (uppercase).
 * @param mirrorRoot Optional explicit mirror root (tests only). When set,
 *   the env var and the priority chain are bypassed.
 * @param schemaFileOverride Optional explicit schema filename (used for
 *   TABL/STRU `.settings.json` → `tabt-v1.json`).
 */
export function schemaPathFor(
  type: string,
  mirrorRoot?: string,
  schemaFileOverride?: string,
): string {
  const key = type.toUpperCase();
  const file = schemaFileOverride ?? SCHEMA_FILE[key];
  if (!file) {
    throw new Error(`No AFF schema mapping registered for type "${type}"`);
  }
  const root = mirrorRoot ?? pickMirrorRoot();
  return path.join(root, file);
}

/** Return the set of AFF-supported types (used by router + CLI command discovery). */
export function affSupportedTypes(): string[] {
  return Object.keys(SCHEMA_FILE);
}

/** Exposed for diagnostics/tests: which root was selected and why. */
export function resolveMirrorRoot(): {
  root: string;
  source: 'env' | 'bundled' | 'legacy' | 'override';
} {
  const envRoot = process.env[AFF_MIRROR_ENV];
  if (envRoot) return { root: envRoot, source: 'env' };
  const bundled = bundledMirrorRoot();
  if (fs.existsSync(bundled)) return { root: bundled, source: 'bundled' };
  return { root: legacyMirrorRoot(), source: 'legacy' };
}
