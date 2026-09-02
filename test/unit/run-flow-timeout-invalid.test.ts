import { describe, expect, it } from 'vitest';
import { runRun, validateTimeout } from '../../src/abap_cli/flows/data/run.js';
import { CliError } from '../../src/abap_cli/output/json.js';

// US3 acceptance 3 / edge case — invalid --timeout values.

describe('run-flow timeout validation', () => {
  it('rejects values below 100ms', () => {
    expect(() => validateTimeout(50)).toThrow(CliError);
    expect(() => validateTimeout(0)).toThrow(CliError);
    expect(() => validateTimeout(-100)).toThrow(CliError);
  });

  it('rejects values above 600000ms', () => {
    expect(() => validateTimeout(700000)).toThrow(CliError);
  });

  it('rejects non-numeric strings', () => {
    expect(() => validateTimeout('abc')).toThrow(CliError);
  });

  it('rejects non-integer floats', () => {
    expect(() => validateTimeout(123.456)).toThrow(CliError);
  });

  it('runRun throws INVALID_ARGUMENT for an invalid timeout before SAP call', async () => {
    try {
      await runRun('ZCL_X', { timeout: 50 }, {
        runClass: async () => {
          throw new Error('should not be called');
        },
      } as unknown as never);
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as CliError).code).toBe('INVALID_ARGUMENT');
    }
  });
});