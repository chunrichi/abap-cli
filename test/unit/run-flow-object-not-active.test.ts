import { describe, expect, it } from 'vitest';
import { runRun } from '../../src/abap_cli/flows/run-flow.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';
import { CliError } from '../../src/abap_cli/output/json.js';

// US1 acceptance 4 — OBJECT_NOT_ACTIVE.

function fakeClient(stdout: string): AdtClientWrapper {
  return { runClass: async () => stdout } as unknown as AdtClientWrapper;
}

describe('run-flow OBJECT_NOT_ACTIVE', () => {
  it('maps to OBJECT_NOT_ACTIVE with nextSteps pointing at abap activate + inspect', async () => {
    const stdout = JSON.stringify({
      status: 'error', code: 'OBJECT_NOT_ACTIVE',
      class: 'ZCL_FOO', method: 'x', message: 'class is inactive',
    });
    try {
      await runRun('ZCL_FOO', { method: 'x' }, fakeClient(stdout));
    } catch (e) {
      const err = e as CliError;
      expect(err.code).toBe('OBJECT_NOT_ACTIVE');
      const ns = err.nextSteps ?? [];
      expect(ns.some((s) => s.includes('activate'))).toBe(true);
      expect(ns.some((s) => s.includes('inspect'))).toBe(true);
    }
  });
});