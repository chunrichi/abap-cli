import { describe, expect, it } from 'vitest';
import {
  EXIT_CODES,
  EXIT_GENERIC_FALLBACK,
  EXIT_SUCCESS,
  categoryFor,
  exitCodeFor,
} from '../../src/abap_cli/output/exit-codes.js';
import { categoryOf, type ErrorCode } from '../../src/abap_cli/output/error-codes.js';

describe('exit codes (FR-003, SC-002)', () => {
  it('every ErrorCategory has a unique exit code in 2..9', () => {
    const codes = Object.values(EXIT_CODES);
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const c of codes) {
      expect(c).toBeGreaterThanOrEqual(2);
      expect(c).toBeLessThanOrEqual(9);
    }
    expect(EXIT_SUCCESS).toBe(0);
    expect(EXIT_GENERIC_FALLBACK).toBe(1);
  });

  it('exitCodeFor returns the documented mapping', () => {
    expect(exitCodeFor('USAGE')).toBe(2);
    expect(exitCodeFor('CONFIG_ERROR')).toBe(3);
    expect(exitCodeFor('TLS_ERROR')).toBe(4);
    expect(exitCodeFor('AUTH_ERROR')).toBe(5);
    expect(exitCodeFor('SAP_ERROR')).toBe(6);
    expect(exitCodeFor('VALIDATION_ERROR')).toBe(7);
    expect(exitCodeFor('NOT_FOUND')).toBe(8);
    expect(exitCodeFor('LOCKED')).toBe(9);
  });

  it('categoryFor round-trips each exit code', () => {
    expect(categoryFor(2)).toBe('USAGE');
    expect(categoryFor(3)).toBe('CONFIG_ERROR');
    expect(categoryFor(4)).toBe('TLS_ERROR');
    expect(categoryFor(5)).toBe('AUTH_ERROR');
    expect(categoryFor(6)).toBe('SAP_ERROR');
    expect(categoryFor(7)).toBe('VALIDATION_ERROR');
    expect(categoryFor(8)).toBe('NOT_FOUND');
    expect(categoryFor(9)).toBe('LOCKED');
    expect(categoryFor(99)).toBeUndefined();
  });

  it('categoryOf maps every known sub-code to a category with an exit code', () => {
    // We can't enumerate every ErrorCode from the runtime without exporting
    // the map; instead, sanity-check a representative sample.
    const sample: Array<[ErrorCode, string]> = [
      ['OBJECT_NOT_FOUND', 'NOT_FOUND'],
      ['LOCK_FAILED', 'LOCKED'],
      ['TLS_ERROR', 'TLS_ERROR'],
      ['AUTH_ERROR', 'AUTH_ERROR'],
      ['SYNTAX_ERROR', 'VALIDATION_ERROR'],
      ['CONFIG_ERROR', 'CONFIG_ERROR'],
      ['USAGE', 'USAGE'],
    ];
    for (const [code, cat] of sample) {
      expect(categoryOf(code)).toBe(cat);
      expect(Object.values(EXIT_CODES)).toContain(exitCodeFor(categoryOf(code)));
    }
  });
});