import { describe, expect, it, vi } from 'vitest';
import { registerRunCommand } from '../../src/abap_cli/commands/run.js';
import { makeProgram, runCommand } from './cli-helper.js';

// FR-015 — --schema prints the full command schema without any SAP call.

describe('abap run --schema', () => {
  it('prints schema JSON with arguments/options/exclusive/examples/errors', async () => {
    const program = makeProgram();
    registerRunCommand(program);
    const res = await runCommand(program, ['run', '--schema', '--json']);
    const schema = JSON.parse(res.stdout);
    expect(schema.command).toBe('run');
    expect(Array.isArray(schema.arguments)).toBe(true);
    expect(schema.arguments[0].name).toBe('class-name');
    expect(Array.isArray(schema.options)).toBe(true);
    expect(schema.options.some((o: { name: string }) => o.name === '--method')).toBe(true);
    expect(Array.isArray(schema.examples)).toBe(true);
    expect(Array.isArray(schema.errors)).toBe(true);
  });

  it('exits 0 and never calls SAP (no class-name required)', async () => {
    const program = makeProgram();
    registerRunCommand(program);
    const res = await runCommand(program, ['run', '--schema']);
    expect(res.exitCode).toBeUndefined();
    const schema = JSON.parse(res.stdout);
    expect(schema.errors.some((e: { code: string }) => e.code === 'METHOD_NOT_SUPPORTED')).toBe(true);
  });

  it('schema error table covers all 7 new 015 codes', async () => {
    const program = makeProgram();
    registerRunCommand(program);
    const res = await runCommand(program, ['run', '--schema']);
    const codes = JSON.parse(res.stdout).errors.map((e: { code: string }) => e.code);
    for (const c of [
      'METHOD_FAILED',
      'METHOD_NOT_SUPPORTED',
      'CLASS_NOT_RUNNABLE',
      'OBJECT_NOT_ACTIVE',
      'LOCAL_CLASS_NOT_RUNNABLE',
      'TIMEOUT',
      'WRAPPER_NOT_DEPLOYED',
    ]) {
      expect(codes).toContain(c);
    }
  });
});