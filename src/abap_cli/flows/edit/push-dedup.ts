import * as path from 'node:path';
import { isTablArtifactFile, tablArtifactPaths } from '../../formats/ddic/tabl-artifact.js';

/**
 * (C1): when a workspace holds the full TABL/STRU artifact trio
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

/**
 * XSLT is an AFF pair (`<name>.xslt.json` + `<name>.xslt.xml`). Both files
 * describe the same transformation, so an explicit `abap push` of both would
 * write it twice. Collapse each group to the `.xslt.json` metadata document
 * (the canonical entry point); a lone `.xslt.xml` is kept as-is because
 * pushing the source side alone is supported.
 */
export function deduplicateXsltArtifactTargets(files: string[]): string[] {
  const groups = new Map<string, { json?: string; xml?: string; firstIndex: number }>();
  const passthrough: Array<{ file: string; index: number }> = [];
  files.forEach((file, index) => {
    const lower = file.toLowerCase();
    const isJson = lower.endsWith('.xslt.json');
    const isXml = lower.endsWith('.xslt.xml');
    if (!isJson && !isXml) {
      passthrough.push({ file, index });
      return;
    }
    const base = isJson ? file.slice(0, -'.xslt.json'.length) : file.slice(0, -'.xslt.xml'.length);
    const key = path.resolve(base).toLowerCase();
    const group = groups.get(key) ?? { firstIndex: index };
    if (isJson) group.json = file;
    else group.xml = file;
    groups.set(key, group);
  });
  const kept = [...groups.values()].map((g) => ({ file: g.json ?? g.xml!, index: g.firstIndex }));
  return [...passthrough, ...kept].sort((a, b) => a.index - b.index).map((entry) => entry.file);
}

