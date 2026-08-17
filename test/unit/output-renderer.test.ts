import { describe, expect, it } from 'vitest';
import { CliError, renderResult, renderError, toErrorShape } from '../../src/abap_cli/output/json.js';
import type { OutputMeta } from '../../src/abap_cli/output/meta.js';

const meta: OutputMeta = {
  command: 'abap test',
  version: '0.0.0-test',
  timestamp: '2026-08-05T00:00:00.000Z',
  durationMs: 10,
  warnings: [],
};

describe('output renderer (FR-001, FR-002, FR-016, SC-008)', () => {
  it('renderResult(true, data, human, meta) emits JSON with meta on stdout', () => {
    const out = renderResult(true, { hello: 'world' }, 'human text', meta);
    expect(out.stdout).toHaveLength(1);
    const parsed = JSON.parse(out.stdout[0]!);
    expect(parsed).toEqual({ status: 'success', meta, data: { hello: 'world' } });
    expect(out.stderr).toEqual([]);
    expect(out.exitCode).toBeUndefined();
  });

  it('renderResult(false, ...) emits human text on stdout and warning lines on stderr', () => {
    const withWarnings: OutputMeta = { ...meta, warnings: [{ code: 'DEPRECATED_OPTION', message: 'use --limit' }] };
    const out = renderResult(false, { x: 1 }, 'hello human', withWarnings);
    expect(out.stdout).toEqual(['hello human']);
    expect(out.stderr).toEqual(['Warning: use --limit']);
    expect(out.exitCode).toBeUndefined();
  });

  it('renderError(true, CliError) emits JSON with meta on stderr and sets exitCode', () => {
    const err = new CliError('OBJECT_NOT_FOUND', 'ZCL_FOO missing', {
      nextSteps: ['abap search ZCL_FOO'],
      example: 'abap search ZCL_FOO',
    });
    const out = renderError(true, err, meta);
    expect(out.stdout).toEqual([]);
    expect(out.stderr).toHaveLength(1);
    const parsed = JSON.parse(out.stderr[0]!);
    expect(parsed.status).toBe('error');
    expect(parsed.meta).toEqual(meta);
    expect(parsed.error.code).toBe('OBJECT_NOT_FOUND');
    expect(parsed.error.category).toBe('NOT_FOUND');
    expect(parsed.error.nextSteps).toEqual(['abap search ZCL_FOO']);
    expect(out.exitCode).toBe(8); // NOT_FOUND → 8
  });

  it('renderError(false, CliError) emits warning lines then Error/Try lines', () => {
    const err = new CliError('TLS_ERROR', 'self-signed cert', {
      nextSteps: ['set CA', 'use --insecure'],
    });
    const withWarnings: OutputMeta = { ...meta, warnings: [{ code: 'KEYCHAIN_WARNING', message: 'keychain failed' }] };
    const out = renderError(false, err, withWarnings);
    expect(out.stderr[0]).toContain('Warning: keychain failed');
    expect(out.stderr[1]).toContain('Error: self-signed cert');
    expect(out.stderr[2]).toContain('Try: set CA / use --insecure');
    expect(out.exitCode).toBe(4); // TLS_ERROR → 4
  });

  it('toErrorShape surfaces details/nextSteps/example and explicit category', () => {
    const err = new CliError('CONFIG_ERROR', 'bad config', {
      details: { file: '.abap.json' },
      nextSteps: ['run abap init'],
      example: 'abap init --profile dev',
    });
    const shape = toErrorShape(err);
    expect(shape).toMatchObject({
      code: 'CONFIG_ERROR',
      category: 'CONFIG_ERROR',
      message: 'bad config',
      details: { file: '.abap.json' },
      nextSteps: ['run abap init'],
      example: 'abap init --profile dev',
    });
  });

  it('toErrorShape maps an unmapped exception to UNKNOWN with exit code 1', () => {
    const out = renderError(true, new Error('boom'), meta);
    const parsed = JSON.parse(out.stderr[0]!);
    expect(parsed.error.code).toBe('UNKNOWN');
    expect(parsed.error.category).toBe('UNKNOWN');
    expect(parsed.error.message).toContain('boom');
    expect(out.exitCode).toBe(1);
  });

  it('toErrorShape keeps SAP_ERROR + httpStatus for HTTP-shaped errors', () => {
    const out = renderError(true, { statusCode: 500, statusMessage: 'Internal Server Error', message: 'icf failed' }, meta);
    const parsed = JSON.parse(out.stderr[0]!);
    expect(parsed.error.code).toBe('SAP_ERROR');
    expect(parsed.error.category).toBe('SAP_ERROR');
    expect(parsed.error.httpStatus).toBe(500);
    expect(out.exitCode).toBe(6);
  });
});