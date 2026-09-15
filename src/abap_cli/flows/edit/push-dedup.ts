import { isTablArtifactFile, tablArtifactPaths } from '../../formats/ddic/tabl-artifact.js';

/**
 * PR3 (C1): when a workspace holds the full TABL/STRU artifact trio
 * (`.tabl.json` + `.tabl.ddic` [+ optional `.tabl.settings.json`]), the
 * scanner / explicit `abap push --all` invocation naturally enumerates all
 * three. They refer to a single SAP object, so pushing each one in turn
 * would write the table three times.
 *
 * Collapse any Tabl/Stru artifact file to its `.tabl.json` (canonical main)
 * — every other sidecar in the same group resolves to the same key. A
 * `seen` set guarantees the first file in iteration order wins (stable);
 * non-artifact files pass through untouched. The key is lowercased so dedup
 * is case-insensitive.
 */
export function deduplicateTablArtifactTargets(files: string[]): string[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    if (!isTablArtifactFile(file)) return true;
    const key = tablArtifactPaths(file).main.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
