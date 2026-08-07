import { describe, expect, it } from 'vitest';
import { validateMethodName } from '../../src/abap_cli/flows/run-flow.js';
import { CliError } from '../../src/abap_cli/output/json.js';

// Spec edge case — method name regex (stricter than class regex).

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