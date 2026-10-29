import { describe, expect, it, vi } from 'vitest';
import { buildDryRun } from '../../src/abap_cli/flows/data/run.js';
import { registerRunCommand } from '../../src/abap_cli/commands/run.js';
import { makeProgram, runCommand } from './cli-helper.js';

// FR-005 decision — --dry-run prints the envelope without any SAP call.

describe('run-flow dry-run', () => {
  it('buildDryRun returns wouldRun=true, dryRun=true, empty output, no SAP', () => {
    const dry = buildDryRun('ZCL_MY_THING', { method: 'compute', args: '{"x":3}' });
    expect(dry.dryRun).toBe(true);
    expect(dry.wouldRun).toBe(true);
    expect(dry.route).toBe('wrapper');
    expect(dry.output).toBe('');
    expect(dry.args).toEqual({ x: 3 });
    expect(dry.durationMs).toBe(0);
  });

  it('classrun route when no method is given', () => {
    const dry = buildDryRun('ZCL_MY_THING', {});
    expect(dry.route).toBe('classrun');
    expect(dry.dryRun).toBe(true);
    expect(dry.wouldRun).toBe(true);
  });

  it('command layer short-circuits before creating any SAP client', async () => {
    // If the command ever tried to reach SAP, AdtClientWrapper.create would be
    // called — make it throw so the dry-run path is proven SAP-free.
    vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
      AdtClientWrapper: {
        create: () => {
          throw new Error('dry-run must not create a client');
        },
      },
    }));
    const program = makeProgram();
    registerRunCommand(program);
    const res = await runCommand(program, ['run', 'ZCL_X', '--method', 'x', '--dry-run', '--json']);
    expect(res.exitCode).toBeUndefined();
    const parsed = JSON.parse(res.stdout);
    expect(parsed.status).toBe('success');
    expect(parsed.data.dryRun).toBe(true);
    expect(parsed.data.wouldRun).toBe(true);
    expect(parsed.data.route).toBe('wrapper');
  });
});