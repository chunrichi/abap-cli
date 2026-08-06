import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * P0.2 — command-boundary error contract enforcement.
 *
 * The CLI promises that every error reaching the user carries a stable
 * `{ status, error: { code, category, message, ... } }` shape (contract §1.2).
 * If a command path throws a raw `Error` (or any non-CliError value) the
 * renderer falls back to `UNKNOWN` (exit 1) and the user loses the
 * actionable `nextSteps` / `example` hints.
 *
 * This test enforces the rule at the source level: every `throw` in the
 * command boundary directories must construct a `CliError`. An allow-list
 * covers internal assertions where `Error` is the right primitive.
 */

const BOUNDARY_DIRS = [
  'src/abap_cli/commands',
  'src/abap_cli/config',
  'src/abap_cli/formats',
  'src/abap_cli/flows',
  'src/abap_cli/core',
  'src/abap_cli/clients',
];

// Files / lines where raw Error throws are intentional — internal assertions
// that surface as UNKNOWN (exit 1) on the unlikely path of reaching the user.
// Keep this list short; prefer converting to CliError whenever possible.
const RAW_ERROR_ALLOWLIST = new Set([
  // Internal assertion: a lazy-loaded command module did not register the
  // command it was loaded for. This is a programmer bug, not user-facing.
  'src/abap_cli/core/lazy.ts:throw new Error',
]);

function listBoundaryFiles(): { file: string; abs: string }[] {
  const out: { file: string; abs: string }[] = [];
  for (const dir of BOUNDARY_DIRS) {
    const abs = path.join(repoRoot, dir);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.ts')) {
        out.push({ file: path.join(dir, entry.name), abs: path.join(abs, entry.name) });
      }
    }
  }
  return out;
}

interface RawErrorViolation {
  file: string;
  line: number;
  text: string;
}

function findRawErrorThrows(file: string, source: string): RawErrorViolation[] {
  const lines = source.split('\n');
  const violations: RawErrorViolation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Match `throw new Error(...)` and `throw new FooError(...)` where Foo is
    // anything other than CliError. We allow-list lazy.ts which intentionally
    // throws Error.
    const m = /^\s*throw\s+new\s+([A-Z]\w*)\s*\(/.exec(line);
    if (!m) continue;
    const ctor = m[1]!;
    if (ctor === 'CliError') continue;
    const relPos = `${file}:throw new ${ctor}`;
    if (RAW_ERROR_ALLOWLIST.has(relPos)) continue;
    violations.push({ file, line: i + 1, text: line.trim() });
  }
  return violations;
}

describe('P0.2 — command boundary throws must use CliError (lark-style lint)', () => {
  it('every throw new <Error> in command boundaries is a CliError (or allow-listed)', () => {
    const all: RawErrorViolation[] = [];
    for (const { file, abs } of listBoundaryFiles()) {
      const source = fs.readFileSync(abs, 'utf-8');
      all.push(...findRawErrorThrows(file, source));
    }
    if (all.length > 0) {
      const formatted = all.map((v) => `  ${v.file}:${v.line}  ${v.text}`).join('\n');
      throw new Error(
        `Command boundary throws a raw Error subclass — wrap it in CliError so the contract ` +
          `(code / category / nextSteps / example) is preserved.\n${formatted}`,
      );
    }
    expect(all).toEqual([]);
  });

  it('the allow-list still resolves (sanity check, fail fast if files move)', () => {
    for (const entry of RAW_ERROR_ALLOWLIST) {
      const [relPath] = entry.split(':');
      const abs = path.join(repoRoot, relPath!);
      expect(fs.existsSync(abs), `${relPath} (allow-list entry) must still exist`).toBe(true);
    }
  });

  it('boundary dirs themselves are non-empty (the lint stays meaningful)', () => {
    const files = listBoundaryFiles();
    expect(files.length).toBeGreaterThan(0);
  });
});
