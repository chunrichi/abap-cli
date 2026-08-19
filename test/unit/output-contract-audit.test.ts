import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { EXIT_CODES } from '../../src/abap_cli/output/exit-codes.js';
import { categoryOf, type ErrorCode } from '../../src/abap_cli/output/error-codes.js';
import { makeProgram, runCommand } from './cli-helper.js';
import { registerSearchCommand } from '../../src/abap_cli/commands/search.js';
import { registerCreateCommand } from '../../src/abap_cli/commands/create.js';

// --- FR-012: contract ↔ implementation ↔ actual command output ---
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const contractPath = path.join(repoRoot, 'specs/012-unify-cli-output-contract/contracts/cli-output.md');
const contract = fs.readFileSync(contractPath, 'utf-8');
const srcRoot = path.join(repoRoot, 'src/abap_cli');

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('output contract audit (FR-012, US-4, SC-001/002/005)', () => {
  it('§4 exit-code table in the contract matches EXIT_CODES', () => {
    // Rows like `| 1 | \`UNKNOWN\` |` — category name is the backticked token.
    const parsed = new Map<number, string>();
    for (const m of contract.matchAll(/^\| (\d+) \| `([A-Z_]+)` \|/gm)) {
      parsed.set(Number(m[1]), m[2]!);
    }
    expect(parsed.size).toBeGreaterThanOrEqual(9);
    for (const [category, code] of Object.entries(EXIT_CODES)) {
      expect(parsed.get(code)).toBe(category);
    }
  });

  it('§5 error-code table in the contract matches categoryOf for every code', () => {
    // Rows like `| \`USAGE\` (2) | \`USAGE\`、\`INVALID_ARGUMENT\`、... |`
    const codeRe = /`([A-Z_]+)`/g;
    let rows = 0;
    for (const m of contract.matchAll(/^\| `([A-Z_]+)` \((\d+)\) \| (.+?) \|$/gm)) {
      rows++;
      const category = m[1]!;
      const exitCode = Number(m[2]);
      const cell = m[3]!;
      expect(parsedExitCodeFor(category)).toBe(exitCode); // consistent with §4
      let cm: RegExpExecArray | null;
      while ((cm = codeRe.exec(cell)) !== null) {
        const code = cm[1] as ErrorCode;
        expect(categoryOf(code)).toBe(category);
      }
    }
    expect(rows).toBeGreaterThanOrEqual(9);
  });

  it('no command builds its own envelope JSON (renderer bypass)', () => {
    // output/json.ts IS the renderer — the only legitimate place to build envelopes.
    const rendererPath = path.join(srcRoot, 'output/json.ts');
    const offenders: string[] = [];
    for (const file of listTsFiles(srcRoot)) {
      if (file === rendererPath) continue;
      const content = fs.readFileSync(file, 'utf-8');
      if (/JSON\.stringify\(\{\s*status/.test(content)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('no bare console.warn / console.error Warning: remains (use collectWarning)', () => {
    const offenders: string[] = [];
    for (const file of listTsFiles(srcRoot)) {
      const content = fs.readFileSync(file, 'utf-8');
      if (/console\.warn\(/.test(content)) offenders.push(`${file}: console.warn`);
      if (/console\.error\([^)]*Warning:/.test(content)) offenders.push(`${file}: console.error Warning`);
    }
    expect(offenders).toEqual([]);
  });

  it('--schema outputs share the unified envelope with reduced meta (US-3, 025)', async () => {
    const program = makeProgram();
    registerSearchCommand(program);
    registerCreateCommand(program);
    const search = await runCommand(program, ['search', '--schema']);
    const create = await runCommand(program, ['create', '--schema']);
    const searchKeys = Object.keys(JSON.parse(search.stdout)).sort();
    const createKeys = Object.keys(JSON.parse(create.stdout)).sort();
    expect(searchKeys).toEqual(['data', 'meta', 'status']);
    expect(createKeys).toEqual(['data', 'meta', 'status']);
    for (const res of [search, create]) {
      const parsed = JSON.parse(res.stdout);
      // buildSchemaMeta: only command/version/durationMs (no timestamp/warnings).
      expect(Object.keys(parsed.meta).sort()).toEqual(['command', 'durationMs', 'version']);
      expect(parsed.meta).toMatchObject({
        command: expect.any(String),
        version: expect.any(String),
        durationMs: expect.any(Number),
      });
      expect(parsed.meta).not.toHaveProperty('timestamp');
      expect(parsed.meta).not.toHaveProperty('warnings');
    }
  });

  it('DDIC_TABL_FORMAT_UNSUPPORTED and PULL_PARTIAL_FAILURE map to VALIDATION_ERROR (US5, 025)', () => {
    expect(categoryOf('DDIC_TABL_FORMAT_UNSUPPORTED')).toBe('VALIDATION_ERROR');
    expect(categoryOf('PULL_PARTIAL_FAILURE')).toBe('VALIDATION_ERROR');
    expect(EXIT_CODES.VALIDATION_ERROR).toBe(7);
    // Both codes should appear in the §5 contract table (they were added in 025).
    expect(contract).toContain('`DDIC_TABL_FORMAT_UNSUPPORTED`');
    expect(contract).toContain('`PULL_PARTIAL_FAILURE`');
  });
});

// Shared helper: the §4 table maps exit code → category; invert for lookups.
const parsedExitCodeFor = (() => {
  const map = new Map<string, number>();
  for (const m of contract.matchAll(/^\| (\d+) \| `([A-Z_]+)` \|/gm)) {
    map.set(m[2]!, Number(m[1]));
  }
  return (category: string): number | undefined => map.get(category);
})();
