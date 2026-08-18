/**
 * Extension module loader (FR-005 / FR-006).
 * Handles bare npm packages, local paths, path security (realpath + dual allowlist),
 * recursion guard, and timeout.
 */

import { pathToFileURL } from 'url';
import * as path from 'path';
import * as fs from 'fs';
import { realpath } from 'fs/promises';
import { extensionLoadFailed } from './errors.js';

/** Maximum symlink-following depth before declaring a cycle. */
const MAX_DEPTH = 5;

/** Extension loading timeout in milliseconds. */
const LOAD_TIMEOUT_MS = 30_000;

/**
 * Allowed base directories for local path extensions.
 * - cwd: the project root where .abap.json lives
 * - ~/.abap-cli/extensions/: the dedicated extensions install directory
 */
function getAllowlist(): string[] {
  return [process.cwd(), path.join(process.env.HOME ?? '', '.abap-cli', 'extensions')];
}

/**
 * Resolve a local path to a canonical absolute path, rejecting:
 * - Paths containing `..` segments that escape the allowlist
 * - Paths that resolve outside the allowlist after symlink resolution
 *
 * Returns the realpath of the resolved path.
 */
export async function resolveLocalPath(raw: string): Promise<string> {
  const allowlist = getAllowlist();
  const normalized = path.normalize(raw);

  if (normalized.includes('..')) {
    throw extensionLoadFailed(raw, 'path_contains_parent_ref', {
      reason: 'path contains .. segment',
    });
  }

  // Resolve against cwd to handle relative paths
  const resolved = path.isAbsolute(normalized)
    ? normalized
    : path.resolve(process.cwd(), normalized);

  let real: string;
  try {
    real = await realpath(resolved);
  } catch {
    // File doesn't exist yet — use the path as-is; actual I/O errors surface later
    real = resolved;
  }

  const realNormalized = path.normalize(real);
  const isAllowed = allowlist.some((base) => realNormalized.startsWith(base + path.sep));
  if (!isAllowed) {
    throw extensionLoadFailed(raw, 'path_escapes_allowlist', {
      reason: `resolved path '${real}' is not under allowed directories`,
      allowlist,
    });
  }

  return real;
}

/**
 * Load an extension module given its source spec.
 *
 * npm sourceType: imports the bare package name (expects a `default` export)
 * path sourceType: resolves the path, converts to file:// URL, imports it
 *
 * Timeout (30s) and recursion guard (MAX_DEPTH) prevent runaway loading.
 */
export async function loadExtensionModule(
  spec: { sourceType: 'npm'; packageName: string; path?: string } | { sourceType: 'path'; path: string },
  loadingStack: Set<string> = new Set(),
): Promise<{ default: unknown }> {
  if (loadingStack.size >= MAX_DEPTH) {
    throw extensionLoadFailed(
      spec.sourceType === 'npm' ? spec.packageName : spec.path,
      'recursion_overflow',
      { maxDepth: MAX_DEPTH },
    );
  }

  const key = spec.sourceType === 'npm' ? `npm:${spec.packageName}` : `path:${spec.path}`;
  loadingStack.add(key);

  try {
    let href: string;

    if (spec.sourceType === 'npm') {
      const packageName = spec.path ? `${spec.packageName}/${spec.path}` : spec.packageName;
      href = packageName; // bare specifier — let Node resolve from node_modules
    } else {
      const realPath = await resolveLocalPath(spec.path);
      href = pathToFileURL(realPath).href;
    }

    const timer = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Extension load timed out')), LOAD_TIMEOUT_MS),
    );

    const load = import(href);
    const { default: ext } = await Promise.race([load, timer]);
    return { default: ext };
  } catch (err) {
    const reason =
      err instanceof Error ? err.message : String(err);
    if (err instanceof Error && err.message === 'Extension load timed out') {
      throw extensionLoadFailed(
        spec.sourceType === 'npm' ? spec.packageName : spec.path,
        'load_timeout',
        { timeoutMs: LOAD_TIMEOUT_MS },
      );
    }
    throw extensionLoadFailed(
      spec.sourceType === 'npm' ? spec.packageName : spec.path,
      'import_failed',
      { reason },
    );
  } finally {
    loadingStack.delete(key);
  }
}
