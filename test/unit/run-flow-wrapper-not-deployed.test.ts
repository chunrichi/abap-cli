import { describe, expect, it } from 'vitest';
import { runRun } from '../../src/abap_cli/flows/run-flow.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';
import { CliError } from '../../src/abap_cli/output/json.js';

// Edge case — wrapper class missing.

function fakeClient(stdout: string): AdtClientWrapper {
  return { runClass: async () => stdout } as unknown as AdtClientWrapper;
}

describe('run-flow WRAPPER_NOT_DEPLOYED', () => {
  it('maps the wrapper-not-found envelope to WRAPPER_NOT_DEPLOYED with nextSteps abap deploy', async () => {
    const stdout = JSON.stringify({
      status: 'error', code: 'WRAPPER_NOT_DEPLOYED',
      message: 'ZCL_ABAP_VIBE_RUNNER missing on target system',
    });
    try {
      await runRun('ZCL_FOO', { method: 'x' }, fakeClient(stdout));
    } catch (e) {
      const err = e as CliError;
      expect(err.code).toBe('WRAPPER_NOT_DEPLOYED');
      expect(err.nextSteps?.some((s) => s.includes('deploy'))).toBe(true);
    }
  });
});