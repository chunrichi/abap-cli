/**
 * AFF schema router.
 *
 * Maps a local file path to its canonical abap-cli type code (and therefore
 * to the AFF schema filename). Companion-file discovery for TABL/STRU/CLAS/
 * FUGR lives in `companion-check.ts`; this module only inspects the
 * filename.
 *
 * Rules:
 *   *.clas.json / *.clas.*.json        → CLAS
 *   *.intf.json / *.intf.*.json        → INTF
 *   *.prog.json / *.prog.*.json        → PROG
 *   *.fugr.json                        → FUGR
 *   *.fugr.*.reps.json / *.fugr.*.func.json  → FUGR  (companion reps/func files)
 *   *.tabl.json / *.tabl.*.json        → TABL
 *   *.stru.json / *.stru.*.json        → STRU
 *   *.doma.json / *.doma.*.json        → DOMA
 *   *.dtel.json / *.dtel.*.json        → DTEL
 *   *.http.json / *.http.*.json        → HTTP
 *   *.tran.json / *.tran.*.json        → TRAN
 *
 * STRU is routed to `tabl-v1.json` at runtime via schemaPathFor().
 */

import * as path from 'node:path';

/** Tuple of (suffix, type). Order matters — longer suffixes first to avoid
 *  ambiguous matches when a filename contains multiple dots. */
const SUFFIX_RULES: ReadonlyArray<{ suffix: string; type: string }> = [
  { suffix: '.clas.json', type: 'CLAS' },
  { suffix: '.clas.definitions.abap', type: 'CLAS' },
  { suffix: '.clas.implementations.abap', type: 'CLAS' },
  { suffix: '.clas.macros.abap', type: 'CLAS' },
  { suffix: '.clas.testclasses.abap', type: 'CLAS' },
  { suffix: '.clas.texts.en.properties', type: 'CLAS' },
  { suffix: '.intf.json', type: 'INTF' },
  { suffix: '.intf.abap', type: 'INTF' },
  { suffix: '.prog.json', type: 'PROG' },
  { suffix: '.prog.abap', type: 'PROG' },
  { suffix: '.fugr.json', type: 'FUGR' },
  { suffix: '.fugr.abap', type: 'FUGR' },
  // FUGR companion reps/func files.
  { suffix: '.reps.json', type: 'FUGR' },
  { suffix: '.reps.abap', type: 'FUGR' },
  { suffix: '.func.json', type: 'FUGR' },
  { suffix: '.func.abap', type: 'FUGR' },
  { suffix: '.tabl.json', type: 'TABL' },
  { suffix: '.tabl.settings.json', type: 'TABL' },
  { suffix: '.tabl.ddic', type: 'TABL' },
  { suffix: '.stru.json', type: 'STRU' },
  { suffix: '.stru.settings.json', type: 'STRU' },
  { suffix: '.stru.ddic', type: 'STRU' },
  { suffix: '.doma.json', type: 'DOMA' },
  { suffix: '.dtel.json', type: 'DTEL' },
  { suffix: '.http.json', type: 'HTTP' },
  { suffix: '.tran.json', type: 'TRAN' },
];

const SUFFIX_INDEX: Map<string, string> = new Map(
  SUFFIX_RULES.map((r) => [r.suffix, r.type]),
);

const JSON_SUFFIX = '.json';

export interface RouteResult {
  type: string;
  /** True when the file should be validated against an AFF JSON schema. */
  isJson: boolean;
  /** Schema basename that this file maps to. */
  schemaFile: string;
}

/** Route a file path to its canonical type and schema file. */
export function routeAffSchema(filePath: string): RouteResult | undefined {
  const base = path.basename(filePath);
  if (!base) return undefined;
  // Try longest-suffix first: SUFFIX_RULES already sorted that way.
  for (const { suffix, type } of SUFFIX_RULES) {
    if (base.endsWith(suffix)) {
      return {
        type,
        isJson: base.endsWith(JSON_SUFFIX),
        schemaFile: schemaFileFor(type),
      };
    }
  }
  // Plain `.json` extension never maps unless we matched one of the suffix
  // rules — unknown JSON files are not in scope of AFF validation.
  return undefined;
}

/** Return the AFF schema filename for a given type. */
export function schemaFileFor(type: string): string {
  const t = type.toUpperCase();
  if (t === 'STRU') return 'tabl-v1.json'; // schema reuse
  return `${t.toLowerCase()}-v1.json`;
}

/** Convenience: route and return just the type code. */
export function routeType(filePath: string): string | undefined {
  return routeAffSchema(filePath)?.type;
}

/** For tests/inspection. */
export const __SUFFIX_RULES = SUFFIX_RULES;
