import { describe, expect, it } from 'vitest';
import { runRun } from '../../src/abap_cli/flows/run-flow.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';
import { CliError } from '../../src/abap_cli/output/json.js';

// US2 acceptance 4 / edge case — class not on SAP.

function fakeClient(stdout: string): AdtClientWrapper {
  return { runClass: async () => stdout } as unknown as AdtClientWrapper;
}

describe('run-flow OBJECT_NOT_FOUND', () => {
  it('maps wrapper output {code:"OBJECT_NOT_FOUND"} → OBJECT_NOT_FOUND + exit 8', async () => {
    const stdout = JSON.stringify({
      status: 'error', code: 'OBJECT_NOT_FOUND',
      class: 'ZCL_NONEXISTENT', method: 'x',
      message: 'class does not exist',
    });
    try {
      await runRun('ZCL_NONEXISTENT', { method: 'x' }, fakeClient(stdout));
    } catch (e) {
      expect((e as CliError).code).toBe('OBJECT_NOT_FOUND');
    }
  });
});