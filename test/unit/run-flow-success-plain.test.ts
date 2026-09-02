import { describe, expect, it } from 'vitest';
import { runRun } from '../../src/abap_cli/flows/data/run.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';

// US1 acceptance 3 — non-JSON plain text is treated as business success.

function fakeClient(stdout: string): AdtClientWrapper {
  return {
    runClass: async () => stdout,
  } as unknown as AdtClientWrapper;
}

describe('run-flow success (plain text)', () => {
  it('returns plain text as data.output with parsed=null and exitCode=0', async () => {
    const result = await runRun('ZCL_PLAIN', {}, fakeClient('hello world'));
    expect(result.route).toBe('classrun');
    expect(result.output).toBe('hello world');
    expect(result.parsed).toBeNull();
    expect(result.exitCode).toBe(0);
  });

  it('handles trailing whitespace and newlines from SAP', async () => {
    const result = await runRun('ZCL_PLAIN', {}, fakeClient('  output line\n'));
    // trim() strips outer whitespace; leading inner spaces preserved.
    expect(result.output).toBe('output line');
    expect(result.parsed).toBeNull();
    expect(result.exitCode).toBe(0);
  });
});