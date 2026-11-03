/**
 * Type pool (TYPE-POOL) — local AFF documents.
 *
 * Upstream AFF (`type-v1.json`) describes a type pool as a header-only JSON
 * metadata document plus a `.type.abap` companion carrying the classic ABAP
 * source (`TYPE-POOL <name>.` / `TYPES ...`). The same layout is used by
 * abapGit for the source file; only the metadata format differs (JSON here,
 * XML there).
 */
import { defineJsonArtifact } from '../artifact.js';

export interface TypeLocal {
  formatVersion: '1';
  header: {
    description: string;
    originalLanguage: string;
  };
}

/** `type-v1.json` artifact plumbing. */
export const typeArtifact = defineJsonArtifact<TypeLocal>({ type: 'TYPE' });

/** Companion source filename next to `<name>.type.json`. */
export function typeSourceFileName(jsonFileName: string): string {
  return jsonFileName.replace(/\.type\.json$/i, '.type.abap');
}
