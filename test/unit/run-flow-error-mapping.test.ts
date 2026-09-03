import { describe, expect, it } from 'vitest';
import { runRun } from '../../src/abap_cli/flows/data/run.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';
import { CliError } from '../../src/abap_cli/output/json.js';
import { categoryOf } from '../../src/abap_cli/output/error-codes.js';
import { exitCodeFor } from '../../src/abap_cli/output/exit-codes.js';

// US4 acceptance 1 / FR-008 — full code → category → exit-code mapping.

function fakeClient(stdout: string): AdtClientWrapper {
  return { runClass: async () => stdout } as unknown as AdtClientWrapper;
}

function envelope(code: string) {
  return JSON.stringify({ status: 'error', code, message: 'x' });
}

describe('run-flow error mapping (data-model §5)', () => {
  const cases: Array<{ code: string; expected: string; exit: number }> = [
    { code: 'METHOD_FAILED', expected: 'METHOD_FAILED', exit: 7 },
    { code: 'METHOD_NOT_SUPPORTED', expected: 'METHOD_NOT_SUPPORTED', exit: 7 },
    { code: 'CLASS_NOT_RUNNABLE', expected: 'CLASS_NOT_RUNNABLE', exit: 7 },
    { code: 'OBJECT_NOT_ACTIVE', expected: 'OBJECT_NOT_ACTIVE', exit: 6 },
    { code: 'LOCAL_CLASS_NOT_RUNNABLE', expected: 'LOCAL_CLASS_NOT_RUNNABLE', exit: 6 },
    { code: 'TIMEOUT', expected: 'TIMEOUT', exit: 6 },
    { code: 'WRAPPER_NOT_DEPLOYED', expected: 'WRAPPER_NOT_DEPLOYED', exit: 8 },
  ];

  for (const c of cases) {
    it(`maps ${c.code} → ${c.expected} (exit ${c.exit})`, async () => {
      try {
        await runRun('ZCL_FOO', { method: 'x' }, fakeClient(envelope(c.code)));
        expect.fail('should have thrown');
      } catch (e) {
        const err = e as CliError;
        expect(err.code).toBe(c.expected);
        expect(categoryOf(err.code)).toBe(
          c.exit === 7 ? 'VALIDATION_ERROR' : c.exit === 6 ? 'SAP_ERROR' : 'NOT_FOUND',
        );
        expect(exitCodeFor(categoryOf(err.code))).toBe(c.exit);
      }
    });
  }

  it('falls back to SAP_ERROR for unmapped codes', async () => {
    try {
      await runRun('ZCL_FOO', { method: 'x' }, fakeClient(envelope('UNKNOWN_RANDOM')));
    } catch (e) {
      expect((e as CliError).code).toBe('SAP_ERROR');
    }
  });
});