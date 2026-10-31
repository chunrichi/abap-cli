import { describe, expect, it } from 'vitest';
import { categoryOf } from '../../src/abap_cli/output/error-codes.js';
import { exitCodeFor } from '../../src/abap_cli/output/exit-codes.js';

/**
 * `--schema` is the machine contract agents read, and `docs/commands.md` is
 * generated from it. Each command's `errors[]` row must therefore agree with the
 * authoritative mapping in `output/error-codes.ts` + `output/exit-codes.ts`;
 * previously the schemas hand-maintained a second copy and drifted.
 */
const commandModules = import.meta.glob('../../src/abap_cli/commands/*.ts', { eager: true }) as Record<
  string,
  Record<string, unknown>
>;

interface SchemaError {
  code: string;
  category: string;
  exitCode: number;
}

function collectSchemaErrorRows(): { where: string; row: SchemaError }[] {
  const rows: { where: string; row: SchemaError }[] = [];
  for (const [file, module] of Object.entries(commandModules)) {
    const fileName = file.split('/').pop() ?? file;
    for (const [exportName, value] of Object.entries(module)) {
      if (!value || typeof value !== 'object') continue;
      const errors = (value as { errors?: unknown }).errors;
      if (!Array.isArray(errors)) continue;
      for (const entry of errors) {
        if (!entry || typeof entry !== 'object') continue;
        const row = entry as Partial<SchemaError>;
        if (typeof row.code === 'string' && typeof row.category === 'string' && typeof row.exitCode === 'number') {
          rows.push({ where: `${fileName}:${exportName}`, row: row as SchemaError });
        }
      }
    }
  }
  return rows;
}

describe('command schemas: errors[] matches the authoritative error mapping', () => {
  it('discovers schema error rows', () => {
    expect(collectSchemaErrorRows().length).toBeGreaterThan(30);
  });

  it('every exported error code/category/exit is consistent', () => {
    const problems: string[] = [];
    for (const { where, row } of collectSchemaErrorRows()) {
      const authority = categoryOf(row.code as never);
      if (!authority) {
        problems.push(`${where}: ${row.code} is not an ErrorCode in output/error-codes.ts`);
        continue;
      }
      const expectedExit = exitCodeFor(authority);
      if (row.category !== authority) {
        problems.push(`${where}: ${row.code} category=${row.category}, expected ${authority}`);
      }
      if (row.exitCode !== expectedExit) {
        problems.push(`${where}: ${row.code} exitCode=${row.exitCode}, expected ${expectedExit}`);
      }
    }
    expect(problems, `schema errors[] drift:\n${problems.join('\n')}`).toEqual([]);
  });
});
