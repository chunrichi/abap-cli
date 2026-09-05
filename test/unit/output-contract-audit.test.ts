import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { EXIT_CODES } from '../../src/abap_cli/output/exit-codes.js';
import { categoryOf, type ErrorCategory, type ErrorCode } from '../../src/abap_cli/output/error-codes.js';
import { makeProgram, runCommand } from './cli-helper.js';
import { registerSearchCommand } from '../../src/abap_cli/commands/search.js';
import { registerCreateCommand } from '../../src/abap_cli/commands/create.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const codesSchemaPath = path.join(repoRoot, 'src/abap_cli/output/cli-output-codes.schema.json');
const codesSchema = JSON.parse(fs.readFileSync(codesSchemaPath, 'utf-8'));
const srcRoot = path.join(repoRoot, 'src/abap_cli');

const ajv = new Ajv({ allErrors: true, strict: false });
const validateCodes = ajv.compile(codesSchema);

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

// Re-parse CATEGORY_OF_CODE from error-codes.ts so the audit sees every key,
// even ones only referenced via categoryOf(). Ajv rejects extra / missing
// properties against the schema's `required` array.
function categoryOfEveryCode(): Record<ErrorCode, ErrorCategory> {
  const src = fs.readFileSync(path.join(repoRoot, 'src/abap_cli/output/error-codes.ts'), 'utf-8');
  const m = src.match(/const CATEGORY_OF_CODE[^=]*=([\s\S]*?)\};/);
  if (!m) throw new Error('CATEGORY_OF_CODE not found in error-codes.ts');
  const map: Record<string, string> = {};
  for (const entry of m[1]!.matchAll(/^\s*([A-Z_][A-Z0-9_]*)\s*:\s*'([A-Z_]+)'/gm)) {
    map[entry[1]!] = entry[2]!;
  }
  return map as Record<ErrorCode, ErrorCategory>;
}

describe('output contract audit', () => {
  it('TS exit-code map matches the codes schema (round-trip)', () => {
    const tsShape = {
      exitCodeByCategory: EXIT_CODES,
      errorCodeByCategory: categoryOfEveryCode(),
    };
    const ok = validateCodes(tsShape);
    if (!ok) {
      throw new Error('TS constants drift from cli-output-codes.schema.json:\n' +
        ajv.errorsText(validateCodes.errors, { separator: '\n' }));
    }
    expect(Object.keys(EXIT_CODES).sort()).toEqual(
      [...codesSchema.definitions.exitCodeByCategory.required].sort(),
    );
  });

  it('no command builds its own envelope JSON (renderer bypass)', () => {
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

  it('--schema outputs share the unified envelope with reduced meta', async () => {
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

  it('DDIC_TABL_FORMAT_UNSUPPORTED and PULL_PARTIAL_FAILURE map to VALIDATION_ERROR', () => {
    expect(categoryOf('DDIC_TABL_FORMAT_UNSUPPORTED')).toBe('VALIDATION_ERROR');
    expect(categoryOf('PULL_PARTIAL_FAILURE')).toBe('VALIDATION_ERROR');
    expect(EXIT_CODES.VALIDATION_ERROR).toBe(7);
  });
});
