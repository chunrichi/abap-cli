/**
 * tcode: pure response-interpreter and validator coverage.
 *
 * `interpretTcode` is exercised directly so no SAP/ICF call is needed; the
 * transport itself is a thin IcfClient.getTcode wrapper.
 */
import { describe, expect, it } from 'vitest';
import { interpretTcode, validateTcode } from '../../src/abap_cli/flows/tcode-flow.js';
import { CliError } from '../../src/abap_cli/output/json.js';
import { categoryOf } from '../../src/abap_cli/output/error-codes.js';

function success(data: unknown) {
  return { status: 'success' as const, data: data as never, error: null };
}

describe('tcode: validateTcode', () => {
  it('trims and upper-cases the transaction code', () => {
    expect(validateTcode('  se38 ')).toBe('SE38');
  });

  it('accepts namespaced codes containing a slash', () => {
    expect(validateTcode('/ABC/MYTCODE')).toBe('/ABC/MYTCODE');
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['undefined', undefined],
    ['embedded blank', 'SE 38'],
    ['too long', 'A'.repeat(21)],
  ])('rejects %s with INVALID_ARGUMENT', (_label, raw) => {
    try {
      validateTcode(raw as string | undefined);
      throw new Error('expected validateTcode to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).code).toBe('INVALID_ARGUMENT');
    }
  });
});

describe('tcode: interpretTcode', () => {
  it('shapes a full ICF payload', () => {
    const result = interpretTcode(
      'SE38',
      success({
        tcode: 'SE38',
        description: 'ABAP Editor',
        entry: { program: 'SAPMS38M', screen: '0100' },
        target: { kind: 'program', name: 'SAPMS38M', resolved: true },
        resolutionState: 'entry_only',
        resolutionChain: [],
      }),
    );
    expect(result).toEqual({
      tcode: 'SE38',
      description: 'ABAP Editor',
      entry: { program: 'SAPMS38M', screen: '0100' },
      target: { kind: 'program', name: 'SAPMS38M', resolved: true },
      resolutionState: 'entry_only',
      resolutionChain: [],
    });
  });

  it('does not carry durationMs — the envelope meta owns timing', () => {
    const result = interpretTcode('SE38', success({ entry: { program: 'SAPMS38M' } }));
    expect(result).not.toHaveProperty('durationMs');
  });

  it('defaults target/resolutionState from the entry program', () => {
    const result = interpretTcode('ZFOO', success({ entry: { program: 'ZPROG' } }));
    expect(result.tcode).toBe('ZFOO');
    expect(result.description).toBe('');
    expect(result.entry).toEqual({ program: 'ZPROG', screen: '' });
    expect(result.target).toEqual({ kind: 'program', name: 'ZPROG', resolved: true });
    expect(result.resolutionState).toBe('entry_only');
  });

  it('maps TCODE_NOT_FOUND to the NOT_FOUND category (exit 8)', () => {
    try {
      interpretTcode('ZNOPE', {
        status: 'error',
        data: null,
        error: { code: 'TCODE_NOT_FOUND', message: 'Transaction ZNOPE does not exist' },
      });
      throw new Error('expected interpretTcode to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).code).toBe('TCODE_NOT_FOUND');
      expect(categoryOf('TCODE_NOT_FOUND')).toBe('NOT_FOUND');
    }
  });

  it('maps TCODE_NOT_AUTHORIZED to the AUTH_ERROR category (exit 5)', () => {
    expect(() =>
      interpretTcode('SE38', {
        status: 'error',
        data: null,
        error: { code: 'TCODE_NOT_AUTHORIZED', message: 'no S_TCODE authority' },
      }),
    ).toThrow(CliError);
    expect(categoryOf('TCODE_NOT_AUTHORIZED')).toBe('AUTH_ERROR');
  });

  it('falls back to SAP_ERROR for unknown ICF error codes', () => {
    try {
      interpretTcode('SE38', { status: 'error', data: null, error: { code: 'WAT', message: 'boom' } });
      throw new Error('expected interpretTcode to throw');
    } catch (error) {
      expect((error as CliError).code).toBe('SAP_ERROR');
    }
  });

  it('rejects a success payload with no entry.program', () => {
    try {
      interpretTcode('SE38', success({ entry: { screen: '0100' } }));
      throw new Error('expected interpretTcode to throw');
    } catch (error) {
      expect((error as CliError).code).toBe('SAP_ERROR');
    }
  });
});
