import * as path from 'path';

export interface ResolvedFile {
  /** Full file path */
  filePath: string;
  /** Object name (e.g., ZCL_FOO) */
  objectName: string;
  /** SAP object type (e.g., CLAS, INTF, PROG, DOMA) */
  objectType: string;
  /** Subtype / include (e.g., main, locals_imp, testclasses) */
  subtype: string;
  /** Route: 'adt' for source objects, 'icf' for DDIC objects */
  route: 'adt' | 'icf';
  /** File format: 'abap' for source, 'xml' for metadata, 'json' for DDIC */
  format: 'abap' | 'xml' | 'json';
}

const EXT_ROUTE_MAP: Record<string, 'adt' | 'icf'> = {
  '.abap': 'adt',
  '.xml': 'adt',
  '.json': 'icf',
};

const SOURCE_EXTENSIONS = new Set(['.abap', '.asddls', '.asbdef', '.assrvd']);

/**
 * Parse a filename into object metadata.
 * Examples:
 *   zcl_foo.clas.abap → { objectName: "ZCL_FOO", objectType: "CLAS", subtype: "main", route: "adt" }
 *   zcl_foo.clas.locals_imp.abap → { objectName: "ZCL_FOO", objectType: "CLAS", subtype: "locals_imp", route: "adt" }
 *   zmy_domain.doma.json → { objectName: "ZMY_DOMAIN", objectType: "DOMA", subtype: "", route: "icf" }
 *   zmy_table.tabl.json → { objectName: "ZMY_TABLE", objectType: "TABL", subtype: "", route: "icf" }
 */
export function resolveFile(filePath: string): ResolvedFile {
  const basename = path.basename(filePath);
  const ext = getOuterExtension(basename);
  const stem = basename.slice(0, basename.length - ext.length);
  const parts = stem.split('.');

  if (parts.length < 2) {
    throw new Error(`Cannot resolve object type from filename: ${basename}`);
  }

  // parts.length >= 2 guaranteed by the check above
  const objectName = parts[0]!.toUpperCase();
  const objectType = parts[1]!.toUpperCase();
  const subtype = parts.slice(2).join('.') || 'main';
  const route = EXT_ROUTE_MAP[ext] || 'adt';
  const format: 'abap' | 'xml' | 'json' = ext === '.json' ? 'json' : ext === '.xml' ? 'xml' : 'abap';

  return { filePath, objectName, objectType, subtype, route, format };
}

/**
 * Extract the outer extension (.abap, .xml, .json, .asddls, etc.)
 */
function getOuterExtension(filename: string): string {
  const match = filename.match(/\.[^.]+$/);
  return match?.[0] ?? '';
}

/**
 * Build a filename from object metadata.
 * The ADT object type may carry a subtype suffix (e.g. "PROG/P"); only the
 * primary type is used for the file extension (bcalv_grid_demo.prog.abap).
 */
export function buildFilename(objectName: string, objectType: string, subtype?: string, ext = '.abap'): string {
  const name = objectName.toLowerCase();
  const type = objectType.split('/')[0]!.toLowerCase();
  const sub = subtype && subtype !== 'main' ? `.${subtype}` : '';
  return `${name}.${type}${sub}${ext}`;
}
