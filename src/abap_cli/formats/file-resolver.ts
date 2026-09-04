import * as path from 'path';
import { CliError } from '../output/json.js';
import { sourceFor } from '../types/registry.js';

export interface ResolvedFile {
  /** Full file path */
  filePath: string;
  /** Object name (e.g., ZCL_FOO) */
  objectName: string;
  /** SAP object type (e.g., CLAS, INTF, PROG, DOMA) */
  objectType: string;
  /** Subtype / include (e.g., main, implementations, testclasses) */
  subtype: string;
  /** Route: 'adt' for source objects, 'icf' for DDIC objects, 'textpool' for .properties */
  route: 'adt' | 'icf' | 'textpool';
  /** File format: 'abap' for source, 'xml' for metadata, 'json' for DDIC */
  format: 'abap' | 'xml' | 'json';
}

const EXT_ROUTE_MAP: Record<string, 'adt' | 'icf'> = {
  '.abap': 'adt',
  '.xml': 'adt',
  '.json': 'icf',
};

/** 014: textpool .properties categories (abap-file-format layout). */
const TEXTPOOL_EXTENSIONS = new Set(['texts', 'selections', 'headings']);

const SOURCE_EXTENSIONS = new Set(['.abap', '.asddls', '.asbdef', '.assrvd']);

/**
 * Parse a filename into object metadata.
 * Examples:
 *   zcl_foo.clas.abap → { objectName: "ZCL_FOO", objectType: "CLAS", subtype: "main", route: "adt" }
 *   zcl_foo.clas.implementations.abap → { objectName: "ZCL_FOO", objectType: "CLAS", subtype: "implementations", route: "adt" }
 *   zmy_domain.doma.json → { objectName: "ZMY_DOMAIN", objectType: "DOMA", subtype: "", route: "icf" }
 *   zmy_table.tabl.json → { objectName: "ZMY_TABLE", objectType: "TABL", subtype: "", route: "icf" }
 *   zprog.prog.texts.en.properties → { objectName: "ZPROG", objectType: "PROG", subtype: "texts.en", route: "textpool" }
 */
export function resolveFile(filePath: string): ResolvedFile {
  const basename = path.basename(filePath);
  const ext = getOuterExtension(basename);

  // Textpool .properties — <name>.<type>.<category>.<lang>.properties
  if (ext === '.properties') {
    const stem = basename.slice(0, basename.length - '.properties'.length);
    const parts = stem.split('.');
    // parts: [name, type, category, lang] — lang may be absent in some layouts.
    if (parts.length < 3) {
      throw new CliError('FILE_PARSE_ERROR', `Cannot resolve textpool file: ${basename}`, {
        file: basename,
        nextSteps: ['Textpool files follow abap-file-format: <name>.<type>.texts|selections|headings.<lang>.properties.'],
      });
    }
    const objectName = parts[0]!.toUpperCase().replace(/#/g, '/');
    const objectType = parts[1]!.toUpperCase();
    const category = parts[2]!;
    if (!TEXTPOOL_EXTENSIONS.has(category)) {
      throw new CliError('FILE_PARSE_ERROR', `Unknown textpool category '${category}' in ${basename}`, {
        file: basename,
        nextSteps: [`Valid categories: ${[...TEXTPOOL_EXTENSIONS].join(', ')}.`],
      });
    }
    return {
      filePath,
      objectName,
      objectType,
      subtype: parts.slice(2).join('.'),
      route: 'textpool',
      format: 'json',
    };
  }

  const stem = basename.slice(0, basename.length - ext.length);
  const parts = stem.split('.');

  if (parts.length < 2) {
    throw new CliError('FILE_PARSE_ERROR', `Cannot resolve object type from filename: ${basename}`, {
      file: basename,
      nextSteps: [
        'Files must follow the abap-file-format layout: <name>.<type>.abap (e.g. zcl_foo.clas.abap).',
        'Run `abap pull <object>` to regenerate the file with the correct name.',
      ],
      example: 'abap pull ZCL_FOO',
    });
  }

  // parts.length >= 2 guaranteed by the check above
  // Namespaced objects are stored as `#ns#name` on disk; restore the `/` form.
  const objectName = parts[0]!.toUpperCase().replace(/#/g, '/');
  const objectType = parts[1]!.toUpperCase();
  const subtype = parts.slice(2).join('.') || 'main';
  // 037 US3: type-based routing takes priority. ADT types (CLAS/INTF/PROG/FUGR
  // /TTYP/MSAG/DDLS) resolve to 'adt' regardless of `.json` extension;
  // DDIC/HTTP/TRAN resolve to 'icf'. Falls back to the legacy extension map
  // for unknown type codes (kept as a safety net).
  const sourceRoute = sourceFor(objectType)?.toLowerCase() as 'adt' | 'icf' | undefined;
  const route: 'adt' | 'icf' = sourceRoute ?? EXT_ROUTE_MAP[ext] ?? 'adt';
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
 * Namespaced names (e.g. /UI2/CL_JSON) must not create directory levels: / → #.
 * The hashed form (`#ui2#cl_json`) is both the object directory and the file
 * prefix. This is a local convention, not a guaranteed abapGit contract.
 */
export function objectDirName(objectName: string): string {
  return objectName.toLowerCase().replace(/\//g, '#');
}

/**
 * Build a filename from object metadata.
 * The ADT object type may carry a subtype suffix (e.g. "PROG/P"); only the
 * primary type is used for the file extension (bcalv_grid_demo.prog.abap).
 */
export function buildFilename(objectName: string, objectType: string, subtype?: string, ext = '.abap'): string {
  const name = objectDirName(objectName);
  const type = objectType.split('/')[0]!.toLowerCase();
  const sub = subtype && subtype !== 'main' ? `.${subtype}` : '';
  return `${name}.${type}${sub}${ext}`;
}
