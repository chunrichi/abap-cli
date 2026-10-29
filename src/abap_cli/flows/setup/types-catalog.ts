/**
 * Static catalog: CLI type code ↔ TADIR PGMID/OBJECT ↔ DDIC tabclass.
 *
 * Feedback S-5: callers had to learn "CLI HTTP is TADIR SICF" and
 * "CLI STRU is TADIR TABL (distinguished by DD02L-TABCLASS=INTTAB)"
 * by trial and error. This module is the single source of truth so:
 *
 *   - `abap types` prints the whole mapping.
 *   - Future JOINs / queries against TADIR can derive the TADIR entry
 *     from the CLI code via `tadirObjectFor(type)` rather than each
 *     flow re-encoding the mapping locally.
 *
 * Notes on convention:
 *   - CLI `HTTP` (an ICF service node) appears in TADIR with OBJECT='SICF'.
 *     SAP distinguishes an SICF node from a generic HTTP object; the
 *     CLI collapses both into the `HTTP` type code.
 *   - CLI `STRU` (a structure) appears in TADIR with OBJECT='TABL' — the
 *     same as transparent tables. Disambiguate via DD02L-TABCLASS='INTTAB'
 *     (transparent tables use 'TRANSP'). `abap select --table DD02L` is
 *     the cheapest discovery path.
 *   - FUGR function modules are listed as separate entries with OBJECT
 *     'FUGR' under PGMID='R3TR' but the SAP-side object type used in
 *     ADT queries is `FUGR/F` (function module) — both are listed.
 */
import { TYPE_REGISTRY, type ObjectTypeEntry } from '../../types/registry.js';

/** TADIR object type code as it appears in TADIR-OBJECT for a CLI-typed object. */
export interface TadirMapping {
  /** CLI type code (matches a TYPE_REGISTRY entry). */
  cliType: string;
  /** TADIR PGMID; almost always 'R3TR' for development objects. */
  pgmid: 'R3TR';
  /** TADIR OBJECT — the value that goes into TADIR-OBJECT. */
  tadirObject: string;
  /**
   * DD02L-TABCLASS value when the object has a TADIR TABL entry. Empty
   * string when N/A. Used to distinguish CLI STRU from CLI TABL.
   */
  ddicTabclass: 'TRANSP' | 'INTTAB' | 'POOL' | 'CLUSTER' | 'VIEW' | 'APPEND' | '';
  /** Routing channel the CLI uses to read/write this object. */
  channel: 'ADT' | 'ICF';
  /** Local source folder under `src/<folder>/` for `--type <type>` writes. */
  folder: string;
  /** AFF canonical schema filename, when the object has one. */
  affSchema: string;
  /** Human-readable description (one line). */
  description: string;
}

/**
 * Manual table of TADIR object codes + DDIC tabclass values.
 *
 * Only the entries the CLI can read/write/list are enumerated; the
 * full TADIR table has ~7000 OBJECT codes and is not worth listing.
 *
 * Source of truth for the mappings:
 *   - TYPE_REGISTRY (CLI ↔ channel ↔ folder ↔ AFF schema) — see types/registry.ts
 *   - SAP TADIR-PGMID/OBJECT standard values for development objects
 *   - DD02L-TABCLASS values from SAP ABAP DDIC documentation
 *
 * Updates should keep this list in sync with the registry — adding a
 * new TYPE_REGISTRY entry without adding a row here will silently break
 * TADIR-derived queries.
 */
const TADIR_OBJECT_BY_CLI: Record<string, Omit<TadirMapping, 'cliType'>> = {
  // Source objects (ADT)
  CLAS: { pgmid: 'R3TR', tadirObject: 'CLAS', ddicTabclass: '', channel: 'ADT', folder: 'clas', affSchema: 'clas-v1.json', description: 'Global ABAP class' },
  INTF: { pgmid: 'R3TR', tadirObject: 'INTF', ddicTabclass: '', channel: 'ADT', folder: 'intf', affSchema: 'intf-v1.json', description: 'ABAP interface' },
  PROG: { pgmid: 'R3TR', tadirObject: 'PROG', ddicTabclass: '', channel: 'ADT', folder: 'prog', affSchema: 'prog-v1.json', description: 'Executable program / report (TRDIR-SUBC=1)' },
  FUGR: { pgmid: 'R3TR', tadirObject: 'FUGR', ddicTabclass: '', channel: 'ADT', folder: 'fugr', affSchema: 'fugr-v1.json', description: 'Function group (FF = function module lives under FUGR)' },

  // DDIC objects (ICF)
  TABL: { pgmid: 'R3TR', tadirObject: 'TABL', ddicTabclass: 'TRANSP', channel: 'ICF', folder: 'tabl', affSchema: 'tabl-v1.json', description: 'Transparent table (DD02L-TABCLASS=TRANSP)' },
  STRU: { pgmid: 'R3TR', tadirObject: 'TABL', ddicTabclass: 'INTTAB', channel: 'ICF', folder: 'stru', affSchema: 'tabl-v1.json', description: 'Structure (DDIC) — TADIR OBJECT is also TABL; disambiguate via DD02L-TABCLASS=INTTAB' },
  DOMA: { pgmid: 'R3TR', tadirObject: 'DOMA', ddicTabclass: '', channel: 'ICF', folder: 'doma', affSchema: 'doma-v1.json', description: 'Domain (DDIC)' },
  DTEL: { pgmid: 'R3TR', tadirObject: 'DTEL', ddicTabclass: '', channel: 'ICF', folder: 'dtel', affSchema: 'dtel-v1.json', description: 'Data element (DDIC)' },
  ENQU: { pgmid: 'R3TR', tadirObject: 'ENQU', ddicTabclass: '', channel: 'ICF', folder: 'enqu', affSchema: 'enqu-v1.json', description: 'Lock object (DDIC)' },
  NROB: { pgmid: 'R3TR', tadirObject: 'NROB', ddicTabclass: '', channel: 'ADT', folder: 'nrob', affSchema: 'nrob-v1.json', description: 'Number range object' },

  // CDS family (ADT)
  DDLS: { pgmid: 'R3TR', tadirObject: 'DDLS', ddicTabclass: '', channel: 'ADT', folder: 'ddls', affSchema: 'ddls-v1.json', description: 'CDS view (DDDLSRC-SOURCE_TYPE=V); not supported on ECC pre-7.40' },
  DDLX: { pgmid: 'R3TR', tadirObject: 'DDLX', ddicTabclass: '', channel: 'ADT', folder: 'ddlx', affSchema: 'ddlx-v1.json', description: 'CDS metadata extension' },
  DDLA: { pgmid: 'R3TR', tadirObject: 'DDLA', ddicTabclass: '', channel: 'ADT', folder: 'ddla', affSchema: 'ddla-v1.json', description: 'CDS annotation definition' },
  DCLS: { pgmid: 'R3TR', tadirObject: 'DCLS', ddicTabclass: '', channel: 'ADT', folder: 'dcls', affSchema: 'dcls-v1.json', description: 'CDS access control (RAP)' },

  // RAP behavior
  BDEF: { pgmid: 'R3TR', tadirObject: 'BDEF', ddicTabclass: '', channel: 'ADT', folder: 'bdef', affSchema: 'bdef-v1.json', description: 'RAP behavior definition (pull-only — no ADT create endpoint)' },

  // Service bindings (RAP / ABAP annotations)
  SRVD: { pgmid: 'R3TR', tadirObject: 'SRVD', ddicTabclass: '', channel: 'ADT', folder: 'srvd', affSchema: 'srvd-v1.json', description: 'Service definition (CDS + behavior)' },
  SRVB: { pgmid: 'R3TR', tadirObject: 'SRVB', ddicTabclass: '', channel: 'ADT', folder: 'srvb', affSchema: 'srvb-v1.json', description: 'Service binding (metadata-only)' },

  // Message class
  MSAG: { pgmid: 'R3TR', tadirObject: 'MSAG', ddicTabclass: '', channel: 'ADT', folder: 'msag', affSchema: 'msag-v1.json', description: 'Message class (T100A)' },

  // Table type (DDIC)
  TTYP: { pgmid: 'R3TR', tadirObject: 'TTYP', ddicTabclass: '', channel: 'ADT', folder: 'ttyp', affSchema: 'ttyp-v1.json', description: 'Table type (DDIC)' },

  // HTTP / SICF
  // CLI HTTP ↔ TADIR SICF (the gotcha). SAP's TADIR OBJECT for an SICF
  // service node is 'SICF', not 'HTTP' (which is reserved for something
  // else in the SAP namespace). The CLI's HTTP type code is a friendly
  // rename — keep this single source of truth.
  HTTP: { pgmid: 'R3TR', tadirObject: 'SICF', ddicTabclass: '', channel: 'ICF', folder: 'http', affSchema: 'http-v1.json', description: 'ICF/SICF service node (TADIR OBJECT is SICF, not HTTP)' },

  // Transaction code (SE93)
  TRAN: { pgmid: 'R3TR', tadirObject: 'TRAN', ddicTabclass: '', channel: 'ICF', folder: 'tran', affSchema: 'tran-v1.json', description: 'Transaction code (TSTC/TSTCC)' },
};

/** Complete catalog in registry-stable order. */
export function typeCatalog(): TadirMapping[] {
  const order = TYPE_REGISTRY.map((e) => e.type);
  const seen = new Set<string>();
  const rows: TadirMapping[] = [];
  for (const cliType of order) {
    const row = TADIR_OBJECT_BY_CLI[cliType];
    if (row) {
      rows.push({ cliType, ...row });
      seen.add(cliType);
    }
  }
  // Catch any registry entries that were added without a TADIR mapping.
  for (const cliType of Object.keys(TADIR_OBJECT_BY_CLI)) {
    if (!seen.has(cliType)) {
      rows.push({ cliType, ...TADIR_OBJECT_BY_CLI[cliType]! });
    }
  }
  return rows;
}

/** Look up the TADIR OBJECT value for a CLI type code. */
export function tadirObjectFor(cliType: string): string | undefined {
  return TADIR_OBJECT_BY_CLI[cliType.toUpperCase()]?.tadirObject;
}

/** Look up the DDIC tabclass filter for a CLI type code (empty when N/A). */
export function ddicTabclassFor(cliType: string): TadirMapping['ddicTabclass'] | undefined {
  return TADIR_OBJECT_BY_CLI[cliType.toUpperCase()]?.ddicTabclass;
}

/**
 * Resolve the TADIR `where` predicate for "all rows belonging to this CLI type".
 * Example: `tadirWhereFor('STRU')` → `(pgmid = 'R3TR' AND object = 'TABL'
 *   AND object IN (SELECT obj_name FROM dd02l WHERE tabclass = 'INTTAB'))`.
 *
 * NOTE: callers cannot use this verbatim in `abap select --where` because
 * `abap select` reads a single table. This helper exists so that
 * future `abap tadir` / `abap types --tadir` commands can produce a
 * pre-baked query string.
 */
export function tadirWhereFor(cliType: string): string {
  const row = TADIR_OBJECT_BY_CLI[cliType.toUpperCase()];
  if (!row) {
    throw new Error(`Unknown CLI type code: ${cliType}`);
  }
  const tabclassClause = row.ddicTabclass
    ? ` AND object IN (SELECT tabname FROM dd02l WHERE as4local = 'A' AND tabclass = '${row.ddicTabclass}')`
    : '';
  return `pgmid = '${row.pgmid}' AND object = '${row.tadirObject}'${tabclassClause}`;
}

/** Convenience export: registry entries for tests. */
export function registryEntries(): readonly ObjectTypeEntry[] {
  return TYPE_REGISTRY;
}