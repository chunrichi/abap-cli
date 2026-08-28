/**
 * `extensions.lock.json` — npm extension integrity pinning (027 US2 / US3).
 *
 * Hashing is local-only (`node:crypto`); no network, no new dependencies.
 * See data-model.md §1-§3 and contracts/extensions-lock-v1.md.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import type { ExtensionManifest } from './types.js';

export interface ExtensionLockEntry {
  packageName: string;
  /** Absolute path returned by `createRequire(...).resolve(packageName)`. */
  resolved: string;
  /** `sha512-<base64>` of the resolved entry file's bytes. */
  integrity: string;
}

export interface ExtensionsLock {
  schemaVersion: 1;
  /** ISO 8601 UTC. */
  lastResolved: string;
  entries: ExtensionLockEntry[];
}

export type LockfileStatus = 'present' | 'absent' | 'outdated' | 'mismatch';

export type LockVerificationResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'LOCKFILE_MISSING_ENTRY'
        | 'LOCKFILE_INTEGRITY_MISMATCH'
        | 'INTEGRITY_UNRESOLVABLE'
        | 'INVALID_PACKAGE_NAME';
      expected?: string;
      actual?: string;
      lockfilePath?: string;
    };

export const LOCKFILE_NAME = 'extensions.lock.json';

const INTEGRITY_RE = /^sha512-[A-Za-z0-9+/=]+$/;
const NPM_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/** Absolute path of the lockfile for a project root. */
export function extensionsLockPath(projectRoot: string): string {
  return path.join(projectRoot, LOCKFILE_NAME);
}

/**
 * Strict npm package-name validation (FR-010). Runs before any module
 * resolution so a hostile string never reaches Node's resolver.
 */
export function validateNpmPackageName(
  name: unknown,
): { ok: true } | { ok: false; reason: string } {
  if (typeof name !== 'string' || name.length === 0) {
    return { ok: false, reason: 'package name must be a non-empty string' };
  }
  if (name.length > 214) return { ok: false, reason: 'package name exceeds 214 characters' };
  if (name.includes('..')) return { ok: false, reason: "package name must not contain '..'" };
  if (name.includes('\\')) return { ok: false, reason: 'package name must not contain a backslash' };
  if (name.startsWith('/') || name.startsWith('.')) {
    return { ok: false, reason: 'package name must not be a filesystem path' };
  }
  if (/^[a-zA-Z]:[\\/]/.test(name)) {
    return { ok: false, reason: 'package name must not be an absolute Windows path' };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(name)) {
    return { ok: false, reason: 'package name must not contain a URL scheme' };
  }
  if (name.startsWith('@') && !name.includes('/')) {
    return { ok: false, reason: 'scoped package name requires a scope separator' };
  }
  if (name.startsWith('@/')) return { ok: false, reason: 'scoped package name has an empty scope' };
  if (!NPM_NAME_RE.test(name)) {
    return { ok: false, reason: 'package name does not match npm naming rules' };
  }
  return { ok: true };
}

/** `sha512-<base64>` of a file's bytes. */
export async function hashFile(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

/** Resolve a bare npm specifier to its absolute entry file, or null. */
export function resolvePackageEntry(packageName: string): string | null {
  try {
    return createRequire(import.meta.url).resolve(packageName);
  } catch {
    return null;
  }
}

function isValidEntry(raw: unknown): raw is ExtensionLockEntry {
  if (!raw || typeof raw !== 'object') return false;
  const e = raw as Record<string, unknown>;
  return (
    typeof e.packageName === 'string' &&
    validateNpmPackageName(e.packageName).ok &&
    typeof e.resolved === 'string' &&
    path.isAbsolute(e.resolved) &&
    typeof e.integrity === 'string' &&
    INTEGRITY_RE.test(e.integrity)
  );
}

/**
 * Read + validate the lockfile. Returns null when absent or corrupt —
 * a corrupt lockfile is treated as `absent` per data-model.md §2.
 */
export async function readLockfile(projectRoot: string): Promise<ExtensionsLock | null> {
  let text: string;
  try {
    text = await readFile(extensionsLockPath(projectRoot), 'utf8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const obj = parsed as Record<string, unknown>;
  if (obj.schemaVersion !== 1) return null;
  if (typeof obj.lastResolved !== 'string' || Number.isNaN(Date.parse(obj.lastResolved))) return null;
  if (!Array.isArray(obj.entries)) return null;

  const seen = new Set<string>();
  const entries: ExtensionLockEntry[] = [];
  for (const raw of obj.entries) {
    if (!isValidEntry(raw)) continue;
    if (seen.has(raw.packageName)) continue;
    seen.add(raw.packageName);
    entries.push({ packageName: raw.packageName, resolved: raw.resolved, integrity: raw.integrity });
  }

  return { schemaVersion: 1, lastResolved: obj.lastResolved, entries };
}

/** Write the lockfile atomically (`.tmp` + rename). */
export async function writeLockfile(projectRoot: string, lock: ExtensionsLock): Promise<void> {
  const target = extensionsLockPath(projectRoot);
  const tmp = `${target}.tmp`;
  await writeFile(tmp, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  try {
    await rename(tmp, target);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

/** True when the on-disk file still hashes to the entry's recorded integrity. */
export async function verifyEntry(
  entry: ExtensionLockEntry,
  onDiskPath: string,
): Promise<boolean> {
  try {
    return (await hashFile(onDiskPath)) === entry.integrity;
  } catch {
    return false;
  }
}

/** Look up a lockfile entry by package name. */
export function findLockEntry(
  lock: ExtensionsLock | null,
  packageName: string,
): ExtensionLockEntry | undefined {
  if (!lock) return undefined;
  return lock.entries.find((e) => e.packageName === packageName);
}

/** npm package names declared in the manifest list, de-duplicated in order. */
export function declaredNpmPackages(extensions: ExtensionManifest[] | undefined): string[] {
  const out: string[] = [];
  for (const m of extensions ?? []) {
    const src = m.source as { sourceType?: string; packageName?: string } | undefined;
    if (src?.sourceType !== 'npm' || typeof src.packageName !== 'string') continue;
    if (!out.includes(src.packageName)) out.push(src.packageName);
  }
  return out;
}

/**
 * Verify one npm extension against the lockfile before `import()`.
 * `path:` sources never reach here (FR-006).
 */
export async function verifyNpmPackage(
  packageName: string,
  lock: ExtensionsLock | null,
  lockfilePath?: string,
): Promise<LockVerificationResult> {
  const nameCheck = validateNpmPackageName(packageName);
  if (!nameCheck.ok) return { ok: false, reason: 'INVALID_PACKAGE_NAME' };

  const entry = lock?.entries.find((e) => e.packageName === packageName);
  if (!entry) return { ok: false, reason: 'LOCKFILE_MISSING_ENTRY', lockfilePath };

  const resolved = resolvePackageEntry(packageName) ?? entry.resolved;
  let actual: string;
  try {
    actual = await hashFile(resolved);
  } catch {
    return { ok: false, reason: 'INTEGRITY_UNRESOLVABLE', lockfilePath };
  }

  if (actual !== entry.integrity) {
    return {
      ok: false,
      reason: 'LOCKFILE_INTEGRITY_MISMATCH',
      expected: entry.integrity.slice(7, 15),
      actual: actual.slice(7, 15),
      lockfilePath,
    };
  }
  return { ok: true };
}

export interface RegenerateResult {
  lock: ExtensionsLock;
  added: string[];
  updated: string[];
  removed: string[];
  unresolved: string[];
}

/**
 * Recompute lock entries for every declared npm extension, diffing against the
 * existing lockfile so the `extensions lock` command can report the change set.
 */
export async function regenerateLock(
  projectRoot: string,
  extensions: ExtensionManifest[] | undefined,
): Promise<RegenerateResult> {
  const previous = await readLockfile(projectRoot);
  const declared = declaredNpmPackages(extensions);

  const entries: ExtensionLockEntry[] = [];
  const added: string[] = [];
  const updated: string[] = [];
  const unresolved: string[] = [];

  for (const packageName of declared) {
    if (!validateNpmPackageName(packageName).ok) {
      unresolved.push(packageName);
      continue;
    }
    const resolved = resolvePackageEntry(packageName);
    if (!resolved) {
      unresolved.push(packageName);
      continue;
    }
    let integrity: string;
    try {
      integrity = await hashFile(resolved);
    } catch {
      unresolved.push(packageName);
      continue;
    }
    entries.push({ packageName, resolved, integrity });

    const before = previous?.entries.find((e) => e.packageName === packageName);
    if (!before) added.push(packageName);
    else if (before.integrity !== integrity || before.resolved !== resolved) updated.push(packageName);
  }

  const removed = (previous?.entries ?? [])
    .map((e) => e.packageName)
    .filter((name) => !entries.some((e) => e.packageName === name));

  return {
    lock: { schemaVersion: 1, lastResolved: new Date().toISOString(), entries },
    added,
    updated,
    removed,
    unresolved,
  };
}

/** Suggested remediation steps per failure reason (data-model.md §3). */
export function lockNextSteps(reason: string): string[] {
  switch (reason) {
    case 'INVALID_PACKAGE_NAME':
      return [
        'Edit .abap.json: package name must match npm naming rules',
        'See: https://docs.npmjs.com/cli/v10/configuring-npm/package-json#name',
      ];
    case 'LOCKFILE_MISSING_ENTRY':
      return ['Run: abap extensions lock --allow-unsigned', 'Commit extensions.lock.json to your repo'];
    case 'LOCKFILE_INTEGRITY_MISMATCH':
      return ['Run: abap extensions lock to refresh the entry', 'Review the change in data before committing'];
    case 'INTEGRITY_UNRESOLVABLE':
      return ['Re-run npm install for the extension', 'If intentional, run: abap extensions lock --allow-unsigned'];
    default:
      return [];
  }
}
