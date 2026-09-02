import { describe, expect, it } from 'vitest';
import { runRun } from '../../src/abap_cli/flows/data/run.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';
import { CliError } from '../../src/abap_cli/output/json.js';

// Regression for TC010/TC013 — real SAP returns plain-text errors (not a JSON
// envelope) for several failure modes. These must map to structured errors
// instead of being reported as business success (exit 0).
// Verified on vhcala4hci 2026-08-07:
//   - `Object ZCL_TC_NOT_EXIST_001 of type CLAS does not exist.`
//   - `Error: Class does not implement if_oo_adt_classrun~main method!`

function fakeClient(stdout: string): AdtClientWrapper {
  return { runClass: async () => stdout } as unknown as AdtClientWrapper;
}

describe('run-flow plain-text SAP errors (TC010/TC013 regression)', () => {
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
    const text = 'Class ZCL_FOO is inactive';
    try {
      await runRun('ZCL_FOO', {}, fakeClient(text));
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as CliError).code).toBe('OBJECT_NOT_ACTIVE');
    }
  });

  it('maps "locked by" plain text to LOCKED', async () => {
    const text = 'Object ZCL_FOO is locked by user OTHER';
    try {
      await runRun('ZCL_FOO', {}, fakeClient(text));
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