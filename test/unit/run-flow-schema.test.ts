import { describe, expect, it, vi } from 'vitest';
import { registerRunCommand } from '../../src/abap_cli/commands/run.js';
import { makeProgram, runCommand, type RunResult } from './cli-helper.js';

// FR-015 — --schema prints the full command schema without any SAP call.
// P1 — --schema emits the unified JSON envelope (success) with the schema in
// `data` and reduced meta (command/version/durationMs only).

function envelopeData(res: RunResult): {
  command: string;
  arguments: Array<{ name: string }>;
  options: Array<{ name: string }>;
  examples: unknown[];
  errors: Array<{ code: string }>;
} {
  const envelope = JSON.parse(res.stdout) as { status: string; meta: { command: string; version: string; durationMs: number }; data: unknown };
  expect(envelope.status).toBe('success');
  expect(Object.keys(envelope.meta).sort()).toEqual(['command', 'durationMs', 'version']);
  return envelope.data as never;
}

describe('abap run --schema', () => {
  it('prints schema JSON with arguments/options/exclusive/examples/errors', async () => {
    const program = makeProgram();
    registerRunCommand(program);
    const res = await runCommand(program, ['run', '--schema', '--json']);
    const schema = envelopeData(res);
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
    const schema = envelopeData(res);
    expect(schema.errors.some((e: { code: string }) => e.code === 'METHOD_NOT_SUPPORTED')).toBe(true);
  });

  it('schema error table covers all 7 new 015 codes', async () => {
    const program = makeProgram();
    registerRunCommand(program);
    const res = await runCommand(program, ['run', '--schema']);
    const codes = envelopeData(res).errors.map((e: { code: string }) => e.code);
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