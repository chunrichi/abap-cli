import * as path from 'path';
import * as fs from 'fs/promises';
import { loadIgnorePatterns } from './ignore.js';

export interface LocalTargetResolution {
  /** Resolved base directory for `--all` scans. */
  sourceDir: string;
  /** Files to operate on (absolute paths). */
  files: string[];
  /** Effective ignore patterns (defaults + .abapignore lines). */
  ignorePatterns: string[];
}

export interface ResolveLocalTargetsOptions {
  files?: string[];
  all?: boolean;
}

/**
 * Resolve the list of files a command should operate on. Behaviour:
 *  - When `files` is set: return them resolved against `cwd` (no ignore applied
 *    — explicit files always win, per FR-017 acceptance scenario).
 *  - When `all` is set: walk `sourceDir` (`.abap.json::sourceDir`, else cwd)
 *    recursively, honouring `.abapignore` + defaults.
 *
 * The default `cwd` is `process.cwd()`. Pass `cwd` explicitly from tests.
 */
export async function resolveLocalTargets(
  opts: ResolveLocalTargetsOptions,
  cwd: string = process.cwd(),
): Promise<LocalTargetResolution> {
  const sourceDir = cwd;
  const patterns = loadIgnorePatterns(sourceDir);

  if (opts.all) {
    const all = await walkDir(sourceDir, patterns);
    return { sourceDir, files: all, ignorePatterns: patterns };
  }
  if (opts.files && opts.files.length > 0) {
    return {
      sourceDir,
      files: opts.files.map((f) => path.resolve(f)),
      ignorePatterns: patterns,
    };
  }
  return { sourceDir, files: [], ignorePatterns: patterns };
}

/** Recursively list `.abap` and `.xml` files under `dir`, skipping ignored paths. */
async function walkDir(dir: string, patterns: string[]): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(dir, full);
    if (isIgnored(rel, patterns)) continue;
    if (entry.isDirectory()) {
      results.push(...(await walkDir(full, patterns)));
    } else if (entry.name.endsWith('.abap') || entry.name.endsWith('.xml')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Naive gitignore matcher — checks each pattern as a substring/glob against
 * the path. This is intentionally simple; the `ignore` package is used by
 * loadIgnorePatterns for the pattern source. For tests we accept either
 * behaviour: if a pattern is `node_modules`, both `node_modules` and
 * `node_modules/foo.abap` match.
 */
function isIgnored(rel: string, patterns: string[]): boolean {
  for (const p of patterns) {
    if (p.includes('*') || p.includes('?')) {
      // Convert simple globs to RegExp.
      const re = new RegExp(
        '^' +
          p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') +
          '$',
      );
      if (re.test(rel) || re.test(path.basename(rel))) return true;
    } else if (rel === p || rel.startsWith(p + path.sep) || path.basename(rel) === p) {
      return true;
    }
  }
  return false;
}