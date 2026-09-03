import { describe, expect, it } from 'vitest';
import { runRun, parseArgs } from '../../src/abap_cli/flows/data/run.js';
import { CliError } from '../../src/abap_cli/output/json.js';

// Edge case — --args JSON parse failures.

describe('run-flow args parse error', () => {
  it('throws INVALID_ARGUMENT on malformed JSON', async () => {
    try {
      await runRun('ZCL_X', { method: 'x', args: '{a:3' });
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as CliError;
      expect(err.code).toBe('INVALID_ARGUMENT');
      expect(err.message).toMatch(/--args|parse|JSON/i);
    }
  });

  it('throws INVALID_ARGUMENT when args is an array (must be object)', () => {
    try {
      parseArgs('[1,2,3]');
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as CliError).code).toBe('INVALID_ARGUMENT');
    }
  });
});