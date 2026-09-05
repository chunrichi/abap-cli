import { describe, expect, it } from 'vitest';
import { runRun } from '../../src/abap_cli/flows/data/run.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';
import { CliError } from '../../src/abap_cli/output/json.js';

// Non-JSON output handling for `abap run`:
//   - plain business output → success (parsed=null, exitCode=0)
//   - empty / whitespace-only stdout → SAP_ERROR (must never silently pass)
//   - CX_ROOT / CX_SY / RAISE markers in plain text → SAP_ERROR with truncated
//     message
//   - SAP plain-text error patterns ("does not exist", "does not implement",
//     "is inactive", "locked by") → mapped structured errors
//
// Regression: TC010/TC013 — real SAP returns plain text for several failure
// modes instead of a JSON envelope. Verified on vhcala4hci 2026-08-07.

function fakeClient(stdout: string): AdtClientWrapper {
  return { runClass: async () => stdout } as unknown as AdtClientWrapper;
}

describe('run-flow non-JSON output', () => {
  describe('plain text success', () => {
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

  describe('empty stdout', () => {
    it('throws SAP_ERROR when stdout is empty', async () => {
      try {
        await runRun('ZCL_SILENT', {}, fakeClient(''));
        expect.fail('should have thrown');
      } catch (e) {
        const err = e as CliError;
        expect(err.code).toBe('SAP_ERROR');
        expect(err.message).toMatch(/no output/);
      }
    });

    it('throws SAP_ERROR when stdout is only whitespace', async () => {
      try {
        await runRun('ZCL_SILENT', {}, fakeClient('   \n  '));
        expect.fail('should have thrown');
      } catch (e) {
        expect((e as CliError).code).toBe('SAP_ERROR');
      }
    });
  });

  describe('exception markers', () => {
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
  });

  describe('SAP plain-text error patterns (TC010/TC013 regression)', () => {
    it('maps "does not exist" plain text to OBJECT_NOT_FOUND', async () => {
      const text = 'Object ZCL_TC_NOT_EXIST_001 of type CLAS does not exist.';
      try {
        await runRun('ZCL_TC_NOT_EXIST_001', {}, fakeClient(text));
        expect.fail('should have thrown');
      } catch (e) {
        const err = e as CliError;
        expect(err.code).toBe('OBJECT_NOT_FOUND');
        expect(err.nextSteps?.some((s) => s.includes('search'))).toBe(true);
      }
    });

    it('maps "does not implement" plain text to CLASS_NOT_RUNNABLE', async () => {
      const text = 'Error: Class does not implement if_oo_adt_classrun~main method!';
      try {
        await runRun('ZCL_ABAP_VIBE_ICF', {}, fakeClient(text));
        expect.fail('should have thrown');
      } catch (e) {
        const err = e as CliError;
        expect(err.code).toBe('CLASS_NOT_RUNNABLE');
        expect(err.nextSteps?.some((s) => s.includes('pull'))).toBe(true);
      }
    });

    it('maps "is inactive" plain text to OBJECT_NOT_ACTIVE', async () => {
      try {
        await runRun('ZCL_FOO', {}, fakeClient('Class ZCL_FOO is inactive'));
        expect.fail('should have thrown');
      } catch (e) {
        expect((e as CliError).code).toBe('OBJECT_NOT_ACTIVE');
      }
    });

    it('maps "locked by" plain text to LOCKED', async () => {
      try {
        await runRun('ZCL_FOO', {}, fakeClient('Object ZCL_FOO is locked by user OTHER'));
        expect.fail('should have thrown');
      } catch (e) {
        expect((e as CliError).code).toBe('LOCKED');
      }
    });

    it('plain WRITE output is still business success (no false positive)', async () => {
      const result = await runRun('ZCL_FOO', {}, fakeClient('hello world'));
      expect(result.exitCode).toBe(0);
      expect(result.parsed).toBeNull();
    });

    it('plain text containing "does not exist" as legitimate output is still error (SAP semantics)', async () => {
      // A class that prints "record does not exist" is indistinguishable from
      // SAP's object-not-found text at the protocol level — we favour the
      // structured error (verified real-SAP behaviour).
      try {
        await runRun('ZCL_FOO', {}, fakeClient('record does not exist'));
        expect.fail('should have thrown');
      } catch (e) {
        expect((e as CliError).code).toBe('OBJECT_NOT_FOUND');
      }
    });
  });
});