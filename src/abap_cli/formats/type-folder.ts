/**
 * Local-convention type → subdirectory mapping.
 *
 * Decided (Q5=B): local convention over abapGit compatibility. Files are
 * written under `<rootDir>/<typeFolder>/...` so source and DDIC objects no
 * longer collide in a single `src/` directory.
 *
 * Notes:
 *   - Folder names follow the abapGit style (lowercase type code) so that
 *     downstream tooling that already understands `src/clas/` etc. keeps
 *     working with minimal adjustment. This is a *local* convention and is
 *     NOT guaranteed to round-trip with a vanilla `abapGit` import.
 *   - DDIC types are bucketed here too, even though `abap-file-format`
 *     traditionally lays DDIC files flat. We deliberately diverge from
 *     that to keep all object types under one classification scheme.
 *   - Unknown types fall through to `unknown/` so we never silently write
 *     outside the documented layout.
 */
const TYPE_FOLDER: Record<string, string> = {
  // Source objects
  CLAS: 'clas',
  INTF: 'intf',
  PROG: 'prog',
  FUGR: 'fugr',
  // DDIC objects (014)
  TABL: 'tabl',
  DOMA: 'doma',
  STRU: 'stru',
  DTEL: 'dtel',
  // 022: HTTP service (SICF node) — also routed via the self-built ICF service.
  HTTP: 'http',
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