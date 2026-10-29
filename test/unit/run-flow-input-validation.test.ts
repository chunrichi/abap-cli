import { describe, expect, it } from 'vitest';
import {
  parseArgs,
  validateClassName,
  validateMethodName,
  validateTimeout,
  runRun,
} from '../../src/abap_cli/flows/data/run.js';
import { CliError } from '../../src/abap_cli/output/json.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';

// Input validation for `abap run`:
//   - class name pattern (regex) + the "~" allowance
//   - method name pattern (stricter than class)
//   - --args JSON parse + must-be-object guard
//   - --timeout bounds (integer in [100, 600000])
//
// These checks fire BEFORE any SAP call, so test stubs must never invoke
// `runClass` and must observe the thrown CliError instead.

describe('run-flow input validation', () => {
  describe('validateClassName', () => {
    it('accepts a normal class name', () => {
      expect(validateClassName('ZCL_MY_THING')).toBe('ZCL_MY_THING');
    });

    it('rejects names starting with a digit', () => {
      expect(() => validateClassName('1CL_BAD')).toThrow(CliError);
    });

    it('rejects names longer than 30 chars', () => {
      const long = 'Z' + 'A'.repeat(29);
      expect(() => validateClassName(long + 'X')).toThrow(CliError);
    });

    it('rejects names with special characters', () => {
      expect(() => validateClassName('ZCL!FOO')).toThrow(CliError);
      expect(() => validateClassName('ZCL@BAR')).toThrow(CliError);
    });

    it('allows ~ (rejected at runtime as LOCAL_CLASS_NOT_RUNNABLE)', () => {
      // Pattern allows ~ so the validator is satisfied; run-time checks later.
      expect(validateClassName('ZCL_FOO~LCL_BAR')).toBe('ZCL_FOO~LCL_BAR');
    });
  });

  describe('validateMethodName', () => {
    it('accepts camelCase method names', () => {
      expect(validateMethodName('computeValue')).toBe('computeValue');
      expect(validateMethodName('_private')).toBe('_private');
    });

    it('rejects method names starting with a digit', () => {
      expect(() => validateMethodName('1method')).toThrow(CliError);
    });

    it('rejects method names with hyphens', () => {
      expect(() => validateMethodName('add-two')).toThrow(CliError);
    });

    it('rejects method names with dots (SAP forbids)', () => {
      expect(() => validateMethodName('foo.bar')).toThrow(CliError);
    });
  });

  describe('parseArgs / --args', () => {
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

  describe('validateTimeout / --timeout', () => {
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
});