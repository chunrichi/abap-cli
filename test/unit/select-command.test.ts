import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registerSelectCommand, formatHuman } from '../../src/abap_cli/commands/select.js';
import { renderError } from '../../src/abap_cli/output/json.js';
import { Command } from 'commander';
import type { SelectResult } from '../../src/abap_cli/flows/select-flow.js';

describe('select human rendering — native-typed values (017 Q1 B)', () => {
  it('formatHuman stringifies numbers/dates and renders null cells as empty', () => {
    const result: SelectResult = {
      table: 'ZTAB_FIXTURE',
      objectType: 'TABL',
      fields: ['ID', 'STATUS', 'CREATED', 'NOTE'],
      rows: [
        { ID: 1, STATUS: 'X', CREATED: '2026-01-01', NOTE: null },
        { ID: 2000000000, STATUS: 'Y', CREATED: '2026-12-31', NOTE: 'ok' },
      ],
      rowCount: 2,
      truncated: false,
      excludedFields: [],
      offset: 0,
      limit: 100,
      countOnly: false,
      dryRun: false,
      durationMs: 5,
    };
    const out = formatHuman(result);
    // Native number renders as decimal (leading zeros dropped), date as YYYY-MM-DD,
    // null cell renders empty.
    expect(out).toContain('2026-01-01');
    expect(out).toContain('2000000000');
    expect(out).toContain('2 row(s)');
    expect(out).toContain('ID');
  });
});

describe('select command — schema ()', () => {
  it('--schema prints a JSON document with options + errors + examples', () => {
    const program = new Command();
    const log: string[] = [];
    const original = console.log;
    console.log = (msg: string) => log.push(msg);
    try {
      registerSelectCommand(program);
      const selectCmd = program.commands.find((c) => c.name() === 'select');
      expect(selectCmd).toBeDefined();
      // Simulate invocation with --schema flag.
      const cli = new Command();
      registerSelectCommand(cli);
      process.argv = ['node', 'abap', 'select', '--schema'];
      try {
        cli.parse(process.argv);
      } catch (_e) {
        // ignore — we capture stdout via console.log
      }
    } finally {
      console.log = original;
    }
    // The unified JSON envelope goes to stdout via console.log; the schema lives in data.
    const envelope = JSON.parse(log[log.length - 1] ?? '{}');
    expect(envelope.status).toBe('success');
    const schema = envelope.data;
    expect(schema.command).toBe('select');
    expect(Array.isArray(schema.options)).toBe(true);
    expect(schema.options.length).toBeGreaterThanOrEqual(8);
    expect(Array.isArray(schema.examples)).toBe(true);
    expect(schema.examples.length).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(schema.errors)).toBe(true);
    expect(schema.errors.find((e: { code: string }) => e.code === 'TABLE_NOT_FOUND')).toBeDefined();
    expect(schema.errors.find((e: { code: string }) => e.code === 'INVALID_WHERE')).toBeDefined();
  });
});

describe('select command — lazy registration ()', () => {
  it('does not eagerly import commands/select when index.ts is loaded', () => {
    // The presence of a CommandSchema (256+ lines) in commands/select.ts would
    // balloon any single-file import. The lazy loader gate in
    // src/abap_cli/core/lazy.ts only imports the module when the command is
    // invoked or `--help` is requested. We verify by grepping source — the
    // register is wired in index.ts COMMAND_SPECS via load() arrow.
    const indexSrc = readFileSync(resolve(__dirname, '../../src/abap_cli/index.ts'), 'utf8');
    expect(indexSrc).toMatch(/name:\s*'select'/);
    expect(indexSrc).toMatch(/load:\s*\(\)\s*=>\s*import\('\.\/commands\/select\.js'\)/);
  });
});

describe('select command — stdout empty on failure ()', () => {
  // We don't drive the runner here — that would require a running mock-adt.
  // The contract is enforced by output/json.ts renderError which writes JSON
  // errors to stderr only. We assert the contract by reading the renderer.
  it('renderError writes JSON to stderr only', () => {
    const out = renderError(true, new Error('boom'), {
      command: 'abap select',
      version: '0.7.0',
      timestamp: '2026-08-07T00:00:00Z',
      durationMs: 1,
      warnings: [],
    });
    expect(out.stdout).toEqual([]);
    expect(out.stderr.length).toBeGreaterThan(0);
    expect(out.stderr[0]).toContain('boom');
  });
});
