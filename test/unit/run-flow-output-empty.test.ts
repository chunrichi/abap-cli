import { describe, expect, it } from 'vitest';
import { runRun } from '../../src/abap_cli/flows/data/run.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';
import { CliError } from '../../src/abap_cli/output/json.js';

// US-4 acceptance 3 — classrun produced no output → SAP_ERROR.

function fakeClient(stdout: string): AdtClientWrapper {
  return {
    runClass: async () => stdout,
  } as unknown as AdtClientWrapper;
}

describe('run-flow empty output', () => {
  it('throws SAP_ERROR when stdout is empty', async () => {
    await expect(runRun('ZCL_SILENT', {}, fakeClient(''))).rejects.toBeInstanceOf(CliError);
    try {
      await runRun('ZCL_SILENT', {}, fakeClient(''));
    } catch (e) {
      const err = e as CliError;
      expect(err.code).toBe('SAP_ERROR');
      expect(err.message).toMatch(/no output/);
    }
  });

  it('throws SAP_ERROR when stdout is only whitespace', async () => {
    await expect(runRun('ZCL_SILENT', {}, fakeClient('   \n  '))).rejects.toMatchObject({
      code: 'SAP_ERROR',
    });
  });
});