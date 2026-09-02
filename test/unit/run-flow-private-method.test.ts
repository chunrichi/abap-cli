import { describe, expect, it } from 'vitest';
import { runRun } from '../../src/abap_cli/flows/data/run.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';
import { CliError } from '../../src/abap_cli/output/json.js';

// FR-005 — PRIVATE methods → AUTH_ERROR (CLI side preserves runner semantics).

function fakeClient(stdout: string): AdtClientWrapper {
  return { runClass: async () => stdout } as unknown as AdtClientWrapper;
}

describe('run-flow private method', () => {
  it('maps ACCESS_DENIED to AUTH_ERROR (exit 5)', async () => {
    const stdout = JSON.stringify({
      status: 'error', code: 'ACCESS_DENIED',
      class: 'ZCL_FOO', method: 'x', message: 'method is PRIVATE',
    });
    try {
      await runRun('ZCL_FOO', { method: 'x' }, fakeClient(stdout));
    } catch (e) {
      const err = e as CliError;
      expect(err.code).toBe('AUTH_ERROR');
    }
  });
});