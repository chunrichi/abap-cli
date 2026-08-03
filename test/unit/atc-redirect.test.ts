import { describe, expect, it } from 'vitest';
import { registerAtcCommand } from '../../src/abap_cli/commands/atc.js';
import { makeProgram, runCommand } from './cli-helper.js';

describe('abap atc redirect (US3, FR-010, SC-003)', () => {
  it('abap atc ... exits 7 with COMMAND_MOVED and nextSteps to check --atc', async () => {
    const program = makeProgram();
    registerAtcCommand(program);
    const res = await runCommand(program, ['atc', 'src/zcl_ok.clas.abap', '--json']);
    expect(res.exitCode).toBe(7);
    const json = JSON.parse(res.stderr);
    expect(json.status).toBe('error');
    expect(json.error.code).toBe('COMMAND_MOVED');
    expect(Array.isArray(json.error.nextSteps)).toBe(true);
    expect(json.error.nextSteps.join(' ')).toMatch(/check --atc/);
  });

  it('abap atc --help exits 0', async () => {
    const program = makeProgram();
    registerAtcCommand(program);
    const res = await runCommand(program, ['atc', '--help']);
    expect(res.exitCode).toBe(0);
  });
});
