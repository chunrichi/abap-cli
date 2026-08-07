import { describe, expect, it, vi } from 'vitest';
import { registerRunCommand } from '../../src/abap_cli/commands/run.js';
import { makeProgram, runCommand } from './cli-helper.js';
import { CliError } from '../../src/abap_cli/output/json.js';

// US4 acceptance 5 / FR-011 — --json failure leaves stdout strictly empty.

const failingClient = vi.fn(async () => {
  throw new CliError('METHOD_NOT_SUPPORTED', 'method signature contains CHANGING/TABLES');
});

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: () => ({ runClass: failingClient }),
  },
}));

describe('abap run --json failure separation (P1.7)', () => {
  it('stdout is strictly empty on failure; JSON envelope goes to stderr', async () => {
    const program = makeProgram();
    registerRunCommand(program);
    const res = await runCommand(program, ['run', 'ZCL_FOO', '--method', 'x', '--json']);
    expect(res.stdout).toBe('');
    expect(res.stderr).toContain('"status": "error"');
    expect(res.stderr).toContain('METHOD_NOT_SUPPORTED');
    expect(res.exitCode).toBe(7);
  });

  it('success path prints the JSON envelope on stdout with empty stderr', async () => {
    const okClient = vi.fn(async () =>
      JSON.stringify({ status: 'ok', method: 'x', exitCode: 0, result: 42 }),
    );
    vi.mocked(failingClient).mockImplementation(okClient);
    const program = makeProgram();
    registerRunCommand(program);
    const res = await runCommand(program, ['run', 'ZCL_FOO', '--method', 'x', '--json']);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.status).toBe('success');
    expect(parsed.data.route).toBe('wrapper');
    expect(parsed.data.parsed.result).toBe(42);
    expect(res.stderr).toBe('');
  });
});