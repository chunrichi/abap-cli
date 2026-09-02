import { describe, expect, it } from 'vitest';
import { validateClassName } from '../../src/abap_cli/flows/data/run.js';
import { CliError } from '../../src/abap_cli/output/json.js';

// Spec edge case — class name regex.

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