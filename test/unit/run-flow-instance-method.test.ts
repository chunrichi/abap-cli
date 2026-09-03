import { describe, expect, it } from 'vitest';
import { runRun } from '../../src/abap_cli/flows/data/run.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';
import { CliError } from '../../src/abap_cli/output/json.js';

// FR-005 — INSTANCE_METHOD_NOT_SUPPORTED collapses to METHOD_NOT_SUPPORTED.

function fakeClient(stdout: string): AdtClientWrapper {
  return { runClass: async () => stdout } as unknown as AdtClientWrapper;
}

describe('run-flow instance method', () => {
  it('maps INSTANCE_METHOD_NOT_SUPPORTED to METHOD_NOT_SUPPORTED', async () => {
    const stdout = JSON.stringify({
      status: 'error', code: 'INSTANCE_METHOD_NOT_SUPPORTED',
      class: 'ZCL_FOO', method: 'x', message: 'runner requires STATIC',
    });
    try {
      await runRun('ZCL_FOO', { method: 'x' }, fakeClient(stdout));
    } catch (e) {
      expect((e as CliError).code).toBe('METHOD_NOT_SUPPORTED');
    }
  });
});