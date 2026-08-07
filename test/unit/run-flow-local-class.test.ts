import { describe, expect, it } from 'vitest';
import { runRun } from '../../src/abap_cli/flows/run-flow.js';
import { CliError } from '../../src/abap_cli/output/json.js';

// Edge case — local class (with `~`).

describe('run-flow local class', () => {
  it('rejects class names containing ~ before any SAP call', async () => {
    try {
      await runRun('ZCL_FOO~LCL_BAR', {});
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as CliError;
      expect(err.code).toBe('LOCAL_CLASS_NOT_RUNNABLE');
      expect(err.message).toMatch(/~/);
    }
  });
});