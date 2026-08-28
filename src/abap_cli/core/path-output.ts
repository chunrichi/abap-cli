/**
 * Output-path normalization boundary (P0 — Windows / cross-platform path contract).
 *
 * Background:
 *   The CLI runs on macOS, Linux and Windows. Node's `path.join` / `path.relative`
 *   produce the host's native separator (`/` on POSIX, `\` on Windows), which is
 *   correct for filesystem operations but inconsistent for **structured output**
 *   that agents parse. Agents expect a single canonical shape regardless of
 *   platform — the abap-file-format reference layout uses POSIX separators
 *   (`src/clas/zcl_demo/zcl_demo.clas.abap`).
 *
 * Boundary:
 *   Internally the code may use `path.join` / `path.relative` freely — they are
 *   correct for `fs` operations. At the **output boundary** (the `data` payload
 *   passed to `printResult` / `printError`, the `human` message rendered to
 *   stdout, and any field agents parse like `file`, `localFile`, `entries[].file`,
 *   `written`, `skipped`, `failed`, deploy `files[].path`, etc.) every path must
 *   go through `toOutputPath()` so the JSON / human text is identical on every
 *   platform.
 *
 * Rules (matches POSIX / abap-file-format):
 *   - Use `/` as separator.
 *   - Collapse leading `./` only.
 *   - Preserve `..` segments (they are part of the logical path the caller gave
 *     us; rewriting them silently would change semantics).
 *   - Empty / whitespace input is returned as-is.
 *
 * Anti-rule:
 *   Do NOT call `toOutputPath` on a path that is about to be passed to
 *   `fs.readFile` / `fs.writeFile` / `path.resolve` / `path.isAbsolute`. Use the
 *   native helpers there — the OS only understands its own separators for I/O.
 */

import * as path from 'node:path';

/** True when `p` is a string that looks like a path (non-empty, no newlines). */
export function isPathLike(p: unknown): p is string {
  return typeof p === 'string' && p.length > 0 && !p.includes('\n') && !p.includes('\r');
}

/** Absolute host path → cwd-relative POSIX path (for the output boundary).
 *  Falls back to the POSIX-normalised absolute path when `path.relative`
 *  produces an empty string (i.e. the file IS the cwd).
 *  Pass the flow's own `cwd` when it differs from `process.cwd()` so the
 *  relative form always matches the directory the file was resolved against. */
export function toRelativeOutputPath(absFile: string, cwd: string = process.cwd()): string {
  return toOutputPath(path.relative(cwd, absFile)) || toOutputPath(absFile);
}

/**
 * Normalize a path for output (JSON `data` payload, human message, log line).
 *
 * - Any `\` — whether produced by Windows `path.join` / `path.relative`, or
 *   typed literally by the user in a `--file` / `--out` argument — is converted
 *   to `/` so the emitted string reads identically on every platform.
 * - A single leading `./` is stripped (POSIX convention emitted by
 *   `path.relative`); `..` segments and `//` are preserved.
 *
 * @example
 *   toOutputPath('src/clas/zcl_demo/zcl_demo.clas.abap') // 'src/clas/zcl_demo/...'
 *   toOutputPath(path.join('src','clas','foo'))         // 'src/clas/foo' (Win: 'src\\clas\\foo' → 'src/clas/foo')
 *   toOutputPath('./src/foo.abap')                       // 'src/foo.abap'
 */
export function toOutputPath(p: string | undefined | null): string {
  if (p === undefined || p === null) return '';
  if (p === '') return '';
  // Replace any backslash (host separator or escaped Windows separator) with '/'.
  // Do not collapse multiple slashes — they are not produced by path.join, and
  // a literal `//` may be meaningful to the caller.
  let out = p.replace(/\\/g, '/');
  // Strip a single leading "./" (POSIX convention; emitted by path.relative on
  // the cwd itself on POSIX).
  if (out.startsWith('./')) out = out.slice(2);
  return out;
}

/**
 * Normalize every `file`-typed field in a `data` envelope for the pull family.
 *
 * Recognised fields (all strings or string arrays):
 *   - `file`
 *   - `entries[].file` (recursively walks arrays of objects)
 *   - `entries[].files` (string[])
 *   - `written`, `skipped`, `failed` (string[])
 *   - `entry.file` (shorthand shape used by skip-existing branches)
 *
 * Non-string values, non-path strings, and unrelated keys are left alone.
 * This keeps the boundary explicit — it only touches fields an agent parses
 * back to disk, never opaque metadata.
 */
export function normalizePullData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  const stringArrayKeys = ['written', 'skipped', 'failed'];
  for (const k of stringArrayKeys) {
    const v = out[k];
    if (Array.isArray(v)) {
      out[k] = v.map((x) => (typeof x === 'string' && isPathLike(x) ? toOutputPath(x) : x));
    }
  }
  if (Array.isArray(out.entries)) {
    out.entries = (out.entries as unknown[]).map((entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      const e = { ...(entry as Record<string, unknown>) };
      if (typeof e.file === 'string' && isPathLike(e.file)) e.file = toOutputPath(e.file);
      if (Array.isArray(e.files)) {
        e.files = (e.files as unknown[]).map((x) => (typeof x === 'string' && isPathLike(x) ? toOutputPath(x) : x));
      }
      return e;
    });
  }
  if (typeof out.file === 'string' && isPathLike(out.file)) {
    out.file = toOutputPath(out.file);
  }
  return out;
}
