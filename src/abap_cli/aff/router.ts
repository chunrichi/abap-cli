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
 *   *.doma.docu.json / *.dtel.docu.json → DOCU (companion schema, not a type)
 *   *.enqu.json                        → ENQU
 *   *.nrob.json                        → NROB
 *   *.http.json / *.http.*.json        → HTTP
 *   *.tran.json / *.tran.*.json        → TRAN
 *   *.sm59.json                        → SM59
 *   *.srfc.json                        → SRFC
 *   *.oa2p.json                        → OA2P
 *   *.xslt.json / *.xslt.xml           → XSLT  (metadata + source pair)
 *   *.devc.json                        → DEVC
 *
 * STRU is routed to `tabl-v1.json` at runtime via schemaPathFor().
 * DOCU is the 0..1 long-text companion of DOMA/DTEL, validated against
 * `docu-v1.json`; it is a schema identifier only and has no registry entry.
 */

import * as path from 'node:path';

/** Tuple of (suffix, type, schemaFile?). Order matters — longer suffixes first
 *  to avoid ambiguous matches when a filename contains multiple dots.
 *  `schemaFile` overrides the default schema filename for that type (used for
 *  TABL/STRU `settings.json` which upstream validates with `tabt-v1.json`). */
const SUFFIX_RULES: ReadonlyArray<{ suffix: string; type: string; schemaFile?: string }> = [
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
  // TABL three-piece layout: main JSON + DDL source + technical-settings JSON.
  // `.tabl.settings.json` is validated against `tabt-v1.json` (technical table
  // settings), not `tabl-v1.json` (which only declares formatVersion + header).
  { suffix: '.tabl.json', type: 'TABL', schemaFile: 'tabl-v1.json' },
  { suffix: '.tabl.settings.json', type: 'TABL', schemaFile: 'tabt-v1.json' },
  { suffix: '.tabl.ddic', type: 'TABL' },
  // STRU three-piece layout: same split as TABL; schema alias via tabl-v1.json.
  { suffix: '.stru.json', type: 'STRU', schemaFile: 'tabl-v1.json' },
  { suffix: '.stru.settings.json', type: 'STRU', schemaFile: 'tabt-v1.json' },
  { suffix: '.stru.ddic', type: 'STRU' },
  // DOMA/DTEL long-text companions — 0..1 documentation files validated
  // against the dedicated `docu-v1.json` (not the object's own schema).
  { suffix: '.doma.docu.json', type: 'DOCU' },
  { suffix: '.dtel.docu.json', type: 'DOCU' },
  { suffix: '.doma.json', type: 'DOMA' },
  { suffix: '.dtel.json', type: 'DTEL' },
  { suffix: '.http.json', type: 'HTTP' },
  { suffix: '.tran.json', type: 'TRAN' },
  // SM59 HTTP destination local-extension document (no upstream AFF format).
  { suffix: '.sm59.json', type: 'SM59' },
  // UCON RFC service local-extension document (no upstream AFF format).
  { suffix: '.srfc.json', type: 'SRFC' },
  // OAuth 2.0 client profile local-extension document (no upstream AFF format).
  { suffix: '.oa2p.json', type: 'OA2P' },
  // Database view local-extension document (upstream AFF has no view format).
  { suffix: '.view.json', type: 'VIEW' },
  // Transformation pair: metadata + source companion.
  { suffix: '.xslt.json', type: 'XSLT' },
  { suffix: '.xslt.xml', type: 'XSLT' },
  // Search help local-extension document (upstream AFF has no SHLP format).
  { suffix: '.shlp.json', type: 'SHLP' },
  // Application job definition local-extension document (no upstream AFF).
  { suffix: '.jobd.json', type: 'JOBD' },
  // dual-channel DDIC + CDS companions.
  { suffix: '.ttyp.json', type: 'TTYP' },
  { suffix: '.msag.json', type: 'MSAG' },
  { suffix: '.ddls.json', type: 'DDLS' },
  { suffix: '.ddls.acds', type: 'DDLS' },
  // DDIC bridge objects (lock object / number range object).
  { suffix: '.enqu.json', type: 'ENQU' },
  { suffix: '.nrob.json', type: 'NROB' },
  // Package (DEVC) local document.
  { suffix: '.devc.json', type: 'DEVC' },
  // ATC configuration objects (category / check / variant).
  { suffix: '.chkc.json', type: 'CHKC' },
  { suffix: '.chko.json', type: 'CHKO' },
  { suffix: '.chkv.json', type: 'CHKV' },
  // CDS technical objects: DTDC/DTEB/DSFD are JSON + `.acds` source pairs;
  // DSFI is a single JSON document (its source *is* the AFF JSON).
  { suffix: '.dtdc.json', type: 'DTDC' },
  { suffix: '.dtdc.acds', type: 'DTDC' },
  { suffix: '.dteb.json', type: 'DTEB' },
  { suffix: '.dteb.acds', type: 'DTEB' },
  { suffix: '.dsfd.json', type: 'DSFD' },
  { suffix: '.dsfd.acds', type: 'DSFD' },
  { suffix: '.dsfi.json', type: 'DSFI' },
  { suffix: '.drty.json', type: 'DRTY' },
  { suffix: '.drty.acds', type: 'DRTY' },
  // Type pool: AFF `type.json` metadata + classic ABAP source (`.type.abap`).
  { suffix: '.type.json', type: 'TYPE' },
  { suffix: '.type.abap', type: 'TYPE' },
  // Application jobs: single JSON document carried over ADT blueSource +
  // `source/main` (SAJC catalog entry / SAJT template).
  { suffix: '.sajc.json', type: 'SAJC' },
  { suffix: '.sajt.json', type: 'SAJT' },
  // Authorization-object family: hand-written ICF routes (no ADT resource).
  { suffix: '.auth.json', type: 'AUTH' },
  { suffix: '.susc.json', type: 'SUSC' },
  { suffix: '.sucu.json', type: 'SUCU' },
  { suffix: '.sush.json', type: 'SUSH' },
  { suffix: '.suso.json', type: 'SUSO' },
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
  for (const { suffix, type, schemaFile } of SUFFIX_RULES) {
    if (base.endsWith(suffix)) {
      return {
        type,
        isJson: base.endsWith(JSON_SUFFIX),
        schemaFile: schemaFile ?? schemaFileFor(type),
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
