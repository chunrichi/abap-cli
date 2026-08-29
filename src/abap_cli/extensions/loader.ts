/**
 * Extension module loader.
 * Handles bare npm packages, local paths, path security (realpath + dual allowlist),
 * recursion guard, and timeout.
 *
 * Also enforces strict npm package-name validation and
 * lockfile-pinned integrity for `sourceType: 'npm'` sources.
 * `sourceType: 'path'` sources skip lockfile verification.
 */

import { pathToFileURL } from 'url';
import * as path from 'path';
import * as fs from 'fs';
import { realpath } from 'fs/promises';
import { extensionLoadFailed } from './errors.js';
import {
  validateNpmPackageName,
  findLockEntry,
  hashFile,
  resolvePackageEntry,
  type ExtensionsLock,
} from './lockfile.js';

/**
 * Optional 2nd argument to `loadExtensionModule` (027 US2).
 * When provided for npm sources, the loader verifies the on-disk file's
 * sha512 against `lockfile` before calling `import()`.
 */
export interface LoadContext {
  lock?: ExtensionsLock | null;
  lockfilePath?: string;
}

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
      parentRef: 'path contains .. segment',
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
      resolvedPath: `resolved path '${real}' is not under allowed directories`,
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
 *
 * When `ctx` is provided for npm sources, the loader first runs
 * strict package-name validation and then verifies the on-disk file's
 * sha512 against `ctx.lock`. `path:` sources skip both checks.
 */
export async function loadExtensionModule(
  spec: { sourceType: 'npm'; packageName: string; path?: string } | { sourceType: 'path'; path: string },
  ctxOrStack?: LoadContext | Set<string>,
  legacyStack?: Set<string>,
): Promise<{ default: unknown }> {
  // Backward-compat: 023 callers passed a Set<string> as the 2nd arg.
  // 027 callers pass a LoadContext. Discriminate by shape.
  let ctx: LoadContext | undefined;
  let loadingStack: Set<string>;
  if (ctxOrStack instanceof Set) {
    loadingStack = ctxOrStack;
  } else {
    ctx = ctxOrStack;
    loadingStack = legacyStack ?? new Set();
  }

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
    // 027 US3 — strict package name validation runs BEFORE any module resolution.
    if (spec.sourceType === 'npm') {
      const nameCheck = validateNpmPackageName(spec.packageName);
      if (!nameCheck.ok) {
        throw extensionLoadFailed(spec.packageName, 'INVALID_PACKAGE_NAME', {
          packageName: spec.packageName,
          validationReason: nameCheck.reason,
        });
      }

      // 027 US2 — lockfile verification before import() for npm sources.
      if (ctx?.lock !== undefined) {
        const entry = findLockEntry(ctx.lock, spec.packageName);
        if (!entry) {
          throw extensionLoadFailed(spec.packageName, 'LOCKFILE_MISSING_ENTRY', {
            lockfilePath: ctx.lockfilePath,
          });
        }
        const resolved = resolvePackageEntry(spec.packageName);
        if (!resolved) {
          throw extensionLoadFailed(spec.packageName, 'INTEGRITY_UNRESOLVABLE', {
            packageName: spec.packageName,
          });
        }
        let actual: string;
        try {
          actual = await hashFile(resolved);
        } catch {
          throw extensionLoadFailed(spec.packageName, 'INTEGRITY_UNRESOLVABLE', {
            packageName: spec.packageName,
          });
        }
        if (actual !== entry.integrity) {
          throw extensionLoadFailed(spec.packageName, 'LOCKFILE_INTEGRITY_MISMATCH', {
            expected: entry.integrity.slice(7, 15),
            actual: actual.slice(7, 15),
            resolved,
          });
        }
      }
    }

    let href: string;

    if (spec.sourceType === 'npm') {
      const packageName = spec.path ? `${spec.packageName}/${spec.path}` : spec.packageName;
      href = packageName; // bare specifier — let Node resolve from node_modules
    } else {
      const realPath = await resolveLocalPath(spec.path);
      href = pathToFileURL(realPath).href;
    }

    let timerHandle: ReturnType<typeof setTimeout> | undefined;
    const timer = new Promise<never>((_, reject) => {
      timerHandle = setTimeout(() => reject(new Error('Extension load timed out')), LOAD_TIMEOUT_MS);
    });

    const load = import(href);
    const { default: ext } = await Promise.race([load, timer]);
    // Clear the timeout so its handle doesn't keep the event loop alive
    // (the original 023 loader had this leak; tests hung for ~30s after success).
    if (timerHandle) clearTimeout(timerHandle);
    return { default: ext };
  } catch (err) {
    // Already a CliError from validation/lockfile step — pass through unchanged.
    if (err instanceof Error && err.name === 'CliError') throw err;
    const reason =
      err instanceof Error ? err.message : String(err);
    if (reason === 'Extension load timed out') {
      throw extensionLoadFailed(
        spec.sourceType === 'npm' ? spec.packageName : spec.path,
        'load_timeout',
        { timeoutMs: LOAD_TIMEOUT_MS },
      );
    }
    throw extensionLoadFailed(
      spec.sourceType === 'npm' ? spec.packageName : spec.path,
      'import_failed',
      { importError: reason },
    );
  } finally {
    loadingStack.delete(key);
  }
}
