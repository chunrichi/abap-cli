import * as path from 'path';
import * as fs from 'fs/promises';
import { readFileSync } from 'fs';
import { loadIgnorePatterns } from './ignore.js';
import { findWorkspaceConfig } from '../config/project-config.js';
import { resolveFile } from '../formats/file-resolver.js';
import { CliError } from '../output/json.js';

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
 *    — explicit files always win, unparseable ones included).
 *  - When `all` is set: scan `.abap.json::sourceDir` (resolved against the
 *    nearest config file) when configured, else `cwd`; honour `.abapignore` +
 *    defaults; skip stray files that do not follow the `<name>.<type>.abap|xml`
 *    layout (whole-workspace scans must not die on one junk file).
 *
 * The default `cwd` is `process.cwd()`. Pass `cwd` explicitly from tests.
 */
export async function resolveLocalTargets(
  opts: ResolveLocalTargetsOptions,
  cwd: string = process.cwd(),
): Promise<LocalTargetResolution> {
  if (opts.all) {
    const sourceDir = resolveAllSourceDir(cwd);
    const patterns = loadIgnorePatterns(sourceDir);
    let walked: string[];
    try {
      walked = await walkDir(sourceDir, patterns);
    } catch (error) {
      // A configured sourceDir may not exist yet (pre-pull) — treat as empty.
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        walked = [];
      } else {
        throw error;
      }
    }
    const files: string[] = [];
    for (const file of walked) {
      try {
        resolveFile(file);
        files.push(file);
      } catch (error: unknown) {
        if (!(error instanceof CliError && error.code === 'FILE_PARSE_ERROR')) throw error;
      }
    }
    return { sourceDir, files, ignorePatterns: patterns };
  }
  if (opts.files && opts.files.length > 0) {
    return {
      sourceDir: cwd,
      files: opts.files.map((f) => path.resolve(f)),
      ignorePatterns: loadIgnorePatterns(cwd),
    };
  }
  return { sourceDir: cwd, files: [], ignorePatterns: loadIgnorePatterns(cwd) };
}

/**
 * Effective scan root for `--all`: `.abap.json::sourceDir` when the nearest
 * config declares it (resolved relative to the config file's directory), else
 * `cwd`. The config file is read directly (JSON.parse tolerated) so commands
 * stay usable in mock/dev workspaces that have no valid system profile.
 */
function resolveAllSourceDir(cwd: string): string {
  const configPath = findWorkspaceConfig(cwd);
  if (!configPath) return cwd;
  try {
    const raw: unknown = JSON.parse(readFileSync(configPath, 'utf-8'));
    const sourceDir = (raw as { sourceDir?: unknown } | null)?.sourceDir;
    if (typeof sourceDir === 'string' && sourceDir.trim() !== '') {
      return path.resolve(path.dirname(configPath), sourceDir);
    }
  } catch {
    // Unreadable / invalid .abap.json — fall back to cwd.
  }
  return cwd;
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