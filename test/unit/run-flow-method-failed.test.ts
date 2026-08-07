import { describe, expect, it } from 'vitest';
import { runRun } from '../../src/abap_cli/flows/run-flow.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';
import { CliError } from '../../src/abap_cli/output/json.js';

// US2 acceptance 5 + US4 acceptance 1.

function fakeClient(stdout: string): AdtClientWrapper {
  return { runClass: async () => stdout } as unknown as AdtClientWrapper;
}

describe('run-flow METHOD_FAILED', () => {
  it('maps to METHOD_FAILED with details.class + details.method', async () => {
    const stdout = JSON.stringify({
      status: 'error', code: 'METHOD_FAILED',
      class: 'ZCL_FOO', method: 'compute',
      message: 'CX_SY_ARITHMETIC_ERROR: division by zero',
    });
    try {
      await runRun('ZCL_FOO', { method: 'compute' }, fakeClient(stdout));
    } catch (e) {
      const err = e as CliError;
      expect(err.code).toBe('METHOD_FAILED');
      expect(err.details?.class).toBe('ZCL_FOO');
      expect(err.details?.method).toBe('compute');
    }
  });

  it('returns message containing the exception class name and text', async () => {
    const stdout = JSON.stringify({
      status: 'error', code: 'METHOD_FAILED',
      class: 'ZCL_FOO', method: 'fail',
      message: 'CX_SY_ZERODIVIDE: division by zero',
    });
    try {
      await runRun('ZCL_FOO', { method: 'fail' }, fakeClient(stdout));
    } catch (e) {
      expect((e as CliError).message).toMatch(/CX_SY/);
    }
  });

  it('returns nextSteps pointing at abap inspect', async () => {
    const stdout = JSON.stringify({
      status: 'error', code: 'METHOD_FAILED', message: 'x',
    });
    try {
      await runRun('ZCL_FOO', { method: 'x' }, fakeClient(stdout));
    } catch (e) {
      const ns = (e as CliError).nextSteps;
      expect(ns?.some((s) => s.includes('inspect'))).toBe(true);
    }
  });
});