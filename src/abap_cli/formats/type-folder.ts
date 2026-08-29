/**
 * Local-convention type → subdirectory mapping.
 *
 * Decided (Q5=B): a single uniform layout for source and DDIC objects.
 * Files are written under `<rootDir>/<typeFolder>/...` so source and DDIC
 * objects no longer collide in a single `src/` directory.
 *
 * Notes:
 *   - Folder names are the lowercase type code (`clas` / `intf` / `prog` /
 *     `fugr` / `tabl` / `doma` / `stru` / `dtel` / `http` / `tran`). This
 *     is a *local* convention only.
 *   - DDIC types are bucketed here too, even though `abap-file-format`
 *     traditionally lays DDIC files flat. We deliberately diverge from
 *     that to keep all object types under one classification scheme.
 *   - Unknown types fall through to `unknown/` so we never silently write
 *     outside the documented layout.
 *   - No abapGit round-trip is guaranteed or intended. See constitution
 *     Principle III.
 */
const TYPE_FOLDER: Record<string, string> = {
  // Source objects
  CLAS: 'clas',
  INTF: 'intf',
  PROG: 'prog',
  FUGR: 'fugr',
  // DDIC objects
  TABL: 'tabl',
  DOMA: 'doma',
  STRU: 'stru',
  DTEL: 'dtel',
  // HTTP service (SICF node) — also routed via the self-built ICF service.
  HTTP: 'http',
  // Transaction code (SE93) — routed via the self-built ICF service.
  TRAN: 'tran',
};

const DEFAULT_FOLDER = 'unknown';

/**
 * Resolve the subdirectory name for an object type.
 *
 * @param type  Raw ADT type (may carry a subtype suffix like "PROG/P"; the
 *              primary type code is used). Case-insensitive.
 */
export function folderFor(type: string): string {
  const primary = type.split('/')[0]!.toUpperCase();
  return TYPE_FOLDER[primary] ?? DEFAULT_FOLDER;
}