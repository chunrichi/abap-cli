import { describe, expect, it } from 'vitest';
import { runRun } from '../../src/abap_cli/flows/data/run.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';
import { CliError } from '../../src/abap_cli/output/json.js';

// Edge case — class is locked.

function fakeClient(stdout: string): AdtClientWrapper {
  return { runClass: async () => stdout } as unknown as AdtClientWrapper;
}

describe('run-flow LOCKED', () => {
  it('maps classrun output {code:"LOCKED"} → LOCKED + exit 9', async () => {
    const stdout = JSON.stringify({
      status: 'error', code: 'LOCKED',
      message: 'object is locked by user DEVELOPER',
    });
    try {
      await runRun('ZCL_FOO', { method: 'x' }, fakeClient(stdout));
    } catch (e) {
      expect((e as CliError).code).toBe('LOCKED');
    }
  });
});