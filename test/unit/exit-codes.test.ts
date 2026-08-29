import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import {
  EXIT_CODES,
  EXIT_GENERIC_FALLBACK,
  EXIT_SUCCESS,
  categoryFor,
  exitCodeFor,
} from '../../src/abap_cli/output/exit-codes.js';
import { categoryOf, type ErrorCode } from '../../src/abap_cli/output/error-codes.js';

describe('exit codes ', () => {
  it('every ErrorCategory has a unique exit code (UNKNOWN=1, categories 2..9)', () => {
    const codes = Object.values(EXIT_CODES);
    expect(codes).toHaveLength(9);
    expect(new Set(codes).size).toBe(9);
    expect(exitCodeFor('UNKNOWN')).toBe(1);
    for (const c of codes) {
      expect(c).toBeGreaterThanOrEqual(1);
      expect(c).toBeLessThanOrEqual(9);
    }
    expect(EXIT_SUCCESS).toBe(0);
    expect(EXIT_GENERIC_FALLBACK).toBe(1); // same value as EXIT_CODES.UNKNOWN
  });

  it('exitCodeFor returns the documented mapping', () => {
    expect(exitCodeFor('UNKNOWN')).toBe(1);
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
    expect(categoryFor(1)).toBe('UNKNOWN');
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
      ['UNKNOWN', 'UNKNOWN'],
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

// --- Process-level exit-code contract (US-3) ---
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cliEntry = path.join(repoRoot, 'dist/src/abap_cli/index.js');
const run = promisify(execFile);
const hasBuiltCli = fs.existsSync(cliEntry);

describe('process-level help/version (US-3)', () => {
  it.skipIf(!hasBuiltCli)('--help exits 0 with text output and no envelope JSON', async () => {
    const { stdout, stderr } = await run(process.execPath, [cliEntry, '--help']);
    expect(stdout).toContain('Usage');
    expect(stderr).toBe('');
    expect(stdout).not.toContain('"status"');
  });

  it.skipIf(!hasBuiltCli)('--version exits 0 with version text and no envelope JSON', async () => {
    const { stdout } = await run(process.execPath, [cliEntry, '--version']);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(stdout).not.toContain('"status"');
  });
});