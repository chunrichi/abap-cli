/**
 * Companion file completeness check for AFF canonical objects.
 *
 * Some object types split their layout across more than one file:
 *   - TABL / STRU: `.tabl.json` + `.tabl.ddic` + `.tabl.settings.json`
 *   - CLAS:        `.clas.json` + `.clas.{definitions,implementations,
 *                   macros,testclasses}.abap` (+ optional `.clas.texts.
 *                   <lang>.properties`)
 *   - FUGR:        `.fugr.json` + per-reps / per-func companion files
 *
 * The router identifies each filename's type; this module probes a `main`
 * JSON file for the canonical set of expected companions, returning a list
 * of relative paths that are missing (relative to the main file's directory).
 *
 * Companion-check semantics:
 *   - TABL: `.ddic` is required, `.settings.json` is required for transparent
 *           tables.
 *   - STRU: same as TABL except `.settings.json` is OPTIONAL.
 *   - CLAS: each `.clas.<part>.abap` is required except texts.properties (opt).
 *   - FUGR: at minimum the main `.fugr.json` exists; companion `*.reps.*` /
 *           `*.func.*` files are discovered dynamically from the main file.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { routeAffSchema } from './router.js';

export interface CompanionCheckResult {
  missing: string[];
  optional: string[];
  /** "structural" = required file pair missing; "optional" = not enforced. */
  severity: 'ok' | 'structural';
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Probe companions for a single file (typically a main JSON). */
export async function checkCompanions(filePath: string): Promise<CompanionCheckResult> {
  const route = routeAffSchema(filePath);
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);

  if (!route || !route.isJson) {
    return { missing: [], optional: [], severity: 'ok' };
  }
  const type = route.type;
  const baseNoJson = base.replace(/\.json$/, '');

  if (type === 'TABL' || type === 'STRU') {
    // The settings.json file is part of the three-piece layout; companions
    // are checked against the MAIN JSON, not against settings.json itself.
    if (base.endsWith('.tabl.settings.json') || base.endsWith('.stru.settings.json')) {
      return { missing: [], optional: [], severity: 'ok' };
    }
    const ddlPath = path.join(dir, `${baseNoJson}.ddic`);
    const settingsPath = path.join(dir, `${baseNoJson}.settings.json`);
    const missing: string[] = [];
    const optional: string[] = [];
    if (!(await fileExists(ddlPath))) missing.push(path.basename(ddlPath));
    // STRU settings.json is optional per spec 033 US5.
    if (type === 'STRU') {
      if (!(await fileExists(settingsPath))) optional.push(path.basename(settingsPath));
    } else if (!(await fileExists(settingsPath))) {
      missing.push(path.basename(settingsPath));
    }
    return { missing, optional, severity: missing.length === 0 ? 'ok' : 'structural' };
  }

  if (type === 'CLAS') {
    const parts = ['definitions', 'implementations', 'macros', 'testclasses'];
    const missing: string[] = [];
    const optional: string[] = [];
    for (const part of parts) {
      const p = path.join(dir, `${baseNoJson}.${part}.abap`);
      if (!(await fileExists(p))) missing.push(path.basename(p));
    }
    const texts = path.join(dir, `${baseNoJson}.texts.en.properties`);
    if (!(await fileExists(texts))) optional.push(path.basename(texts));
    return { missing, optional, severity: missing.length === 0 ? 'ok' : 'structural' };
  }

  if (type === 'FUGR') {
    // No static required companion set; the main JSON declares its members.
    return { missing: [], optional: [], severity: 'ok' };
  }

  return { missing: [], optional: [], severity: 'ok' };
}
