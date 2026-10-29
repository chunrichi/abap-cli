import * as fs from 'fs';
import * as path from 'path';
// `ignore` is a CommonJS package whose default export is a factory.
// Under Node ESM we receive `{ default: factory }`.
import ignoreFactory from 'ignore';

type IgnoreLike = { add: (pattern: string | string[]) => IgnoreLike; ignores: (p: string) => boolean };
const ignore: () => IgnoreLike = (ignoreFactory as unknown as { default?: () => IgnoreLike }).default ?? (ignoreFactory as unknown as () => IgnoreLike);

/** Default ignore patterns — always applied even when .abapignore is absent. */
export const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
];

/** Read `.abapignore` from `cwd` (or returns '' if missing). */
function readIgnoreFile(cwd: string): string {
  const p = path.join(cwd, '.abapignore');
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Return a single Ignore instance loaded from `.abapignore` plus the
 * canonical defaults. Callers use `ig.ignores(relPath)` to test a path.
 */
export function loadIgnore(cwd: string): IgnoreLike {
  const ig = ignore();
  ig.add([...DEFAULT_IGNORE_PATTERNS]);
  const file = readIgnoreFile(cwd);
  if (file.trim().length > 0) {
    ig.add(file);
  }
  return ig;
}

/**
 * Return the effective patterns (defaults + .abapignore lines) as a flat
 * string[]. Useful for `--help` output and tests.
 */
export function loadIgnorePatterns(cwd: string): string[] {
  const file = readIgnoreFile(cwd);
  const fileLines = file
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  return [...DEFAULT_IGNORE_PATTERNS, ...fileLines];
}