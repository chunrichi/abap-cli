import { describe, expect, it } from 'vitest';
import { runRun } from '../../src/abap_cli/flows/data/run.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';
import { CliError } from '../../src/abap_cli/output/json.js';

// US2 acceptance 3 — METHOD_NOT_SUPPORTED.

function fakeClient(stdout: string): AdtClientWrapper {
  return { runClass: async () => stdout } as unknown as AdtClientWrapper;
}

describe('run-flow METHOD_NOT_SUPPORTED', () => {
  it('maps wrapper output {code:"METHOD_NOT_SUPPORTED"} → METHOD_NOT_SUPPORTED + exit 7', async () => {
    const stdout = JSON.stringify({
      status: 'error', code: 'METHOD_NOT_SUPPORTED',
      class: 'ZCL_FOO', method: 'compute',
      message: 'method signature contains CHANGING/TABLES',
    });
    try {
      await runRun('ZCL_FOO', { method: 'compute' }, fakeClient(stdout));
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as CliError;
      expect(err.code).toBe('METHOD_NOT_SUPPORTED');
      expect(err.message).toMatch(/CHANGING/);
    }
  });

  it('attaches details.class and details.method from classrun JSON', async () => {
    const stdout = JSON.stringify({
      status: 'error', code: 'METHOD_NOT_SUPPORTED',
      class: 'ZCL_FOO', method: 'compute', message: 'x',
    });
    try {
      await runRun('ZCL_FOO', { method: 'compute' }, fakeClient(stdout));
    } catch (e) {
      const err = e as CliError;
      expect(err.details?.class).toBe('ZCL_FOO');
      expect(err.details?.method).toBe('compute');
    }
  });

  it('attaches nextSteps suggesting --method is the wrong path', async () => {
    const stdout = JSON.stringify({
      status: 'error', code: 'METHOD_NOT_SUPPORTED', message: 'x',
    });
    try {
      await runRun('ZCL_FOO', { method: 'x' }, fakeClient(stdout));
    } catch (e) {
      const err = e as CliError;
      expect(err.nextSteps?.length).toBeGreaterThan(0);
    }
  });
});