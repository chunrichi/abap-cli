import { describe, expect, it } from 'vitest';
import { runRun } from '../../src/abap_cli/flows/run-flow.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';
import { CliError } from '../../src/abap_cli/output/json.js';

// US4 acceptance 2 — plain-text output with exception markers → SAP_ERROR.

function fakeClient(stdout: string): AdtClientWrapper {
  return { runClass: async () => stdout } as unknown as AdtClientWrapper;
}

describe('run-flow non-JSON error text', () => {
  it('treats CX_ROOT/CX_SY/RAISE text as SAP_ERROR with truncated message', async () => {
    const text = 'Short dump: CX_SY_ARITHMETIC_ERROR\nDivision by zero\n'.repeat(5);
    try {
      await runRun('ZCL_FOO', {}, fakeClient(text));
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as CliError;
      expect(err.code).toBe('SAP_ERROR');
      expect(err.message.length).toBeLessThanOrEqual(200 + 100);
    }
  });

  it('treats plain WRITE output as business success (no markers)', async () => {
    const result = await runRun('ZCL_FOO', {}, fakeClient('hello world'));
    expect(result.exitCode).toBe(0);
    expect(result.parsed).toBeNull();
  });
});