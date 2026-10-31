/**
 * Documentation (long text) companion format — DOCU.
 *
 * DOMA / DTEL objects can own a long text that SAP stores outside the
 * object's own DDIC tables (DOKIL/DOKTL). Locally it is a 0..1 companion file
 * next to the object's main JSON:
 *
 *   src/zmy_doma.doma.json        main object document
 *   src/zmy_doma.doma.docu.json   long text (this module)
 *   src/zmy_dtel.dtel.json        main object document
 *   src/zmy_dtel.dtel.docu.json   long text (this module)
 *
 * The file follows the upstream AFF `docu-v1.json` schema — the same document
 * shape the ICF `/ddic/<type>/<name>/docu` endpoint exchanges:
 *
 *   { "formatVersion": "1", "lines": [{ "format": "", "line": "..." }] }
 *
 * `format` is the SAPscript paragraph format (max 2 chars, `""` = plain
 * paragraph) and `line` is one long-text line (max 72 chars). SAP truncates
 * longer lines silently, so the AFF schema's `maxLength` constraints are the
 * client-side gate that keeps a push from losing text.
 *
 * `lines: []` is meaningful: pushing it deletes the SAP-side long text.
 *
 * DOCU is a schema/companion identifier, not an object type — it has no
 * `types/registry.ts` entry, no `abap create` path and no `abap types` row.
 */
import * as path from 'node:path';
import { defineJsonArtifact } from '../artifact.js';

/** Object types that can own a `.docu.json` companion. */
export const DOCU_TYPES = ['DOMA', 'DTEL'] as const;
export type DocuSupportedType = (typeof DOCU_TYPES)[number];

/** One long-text line: SAPscript paragraph format + the line text. */
export interface DocuLine {
  format: string;
  line: string;
}

/** Local (and wire) documentation document — AFF `docu-v1.json`. */
export interface DocuDocument {
  formatVersion: string;
  lines?: DocuLine[];
}

/** AFF docu schema version the ICF endpoint speaks. */
export const DOCU_FORMAT_VERSION = '1';

/** SAP long-text line width (CHAR72); the AFF schema declares the same cap. */
export const DOCU_MAX_LINE_LENGTH = 72;

/** SAPscript paragraph-format key width (CHAR2). */
export const DOCU_MAX_FORMAT_LENGTH = 2;

/** Narrow an arbitrary type code to the docu-capable types. */
export function isDocuSupportedType(type: string | undefined): type is DocuSupportedType {
  if (!type) return false;
  return (DOCU_TYPES as readonly string[]).includes(type.split('/')[0]!.toUpperCase());
}

/**
 * Companion path of an object's main document:
 * `…/zmy.doma.json` → `…/zmy.doma.docu.json` (DTEL analogous).
 * Returns undefined for files that are not DOMA/DTEL main documents.
 */
export function docuCompanionPathFor(mainFile: string): string | undefined {
  const base = path.basename(mainFile);
  for (const type of DOCU_TYPES) {
    const suffix = `.${type.toLowerCase()}.json`;
    if (base.toLowerCase().endsWith(suffix)) {
      // Insert `.docu` before the final extension: `<stem>.docu.json`.
      return path.join(path.dirname(mainFile), `${base.slice(0, -'.json'.length)}.docu.json`);
    }
  }
  return undefined;
}

/**
 * Read/write/validate `.docu.json` documents through the shared AFF artifact
 * plumbing. `type: 'DOCU'` resolves to the vendored `docu-v1.json` schema.
 */
export const docuArtifact = defineJsonArtifact<DocuDocument>({ type: 'DOCU' });

/**
 * Normalize a document coming from the ICF wire into the local shape.
 * The endpoint returns `{formatVersion, lines}`; missing/empty `lines` means
 * the object carries no long text, which callers map to "no companion file".
 */
export function docuDocumentFromWire(data: unknown): DocuDocument | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const raw = data as Record<string, unknown>;
  const lines = Array.isArray(raw.lines)
    ? raw.lines.map((entry) => {
        const line = (entry ?? {}) as Record<string, unknown>;
        return { format: String(line.format ?? ''), line: String(line.line ?? '') };
      })
    : [];
  if (lines.length === 0) return undefined;
  return {
    formatVersion: typeof raw.formatVersion === 'string' ? raw.formatVersion : DOCU_FORMAT_VERSION,
    lines,
  };
}
