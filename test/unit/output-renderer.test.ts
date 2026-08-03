import { describe, expect, it } from 'vitest';
import { CliError, renderResult, renderError, toErrorShape } from '../../src/abap_cli/output/json.js';

describe('output renderer (FR-001, FR-002, SC-008)', () => {
  it('renderResult(true, data) emits JSON on stdout, empty stderr, no exitCode', () => {
    const out = renderResult(true, { hello: 'world' }, 'human text');
    expect(out.stdout).toHaveLength(1);
    const parsed = JSON.parse(out.stdout[0]!);
    expect(parsed).toEqual({ status: 'success', data: { hello: 'world' } });
    expect(out.stderr).toEqual([]);
    expect(out.exitCode).toBeUndefined();
  });

  it('renderResult(false, ...) emits human text on stdout', () => {
    const out = renderResult(false, { x: 1 }, 'hello human');
    expect(out.stdout).toEqual(['hello human']);
    expect(out.stderr).toEqual([]);
    expect(out.exitCode).toBeUndefined();
  });

  it('renderError(true, CliError) emits JSON on stderr and sets exitCode', () => {
    const err = new CliError('OBJECT_NOT_FOUND', 'ZCL_FOO missing', {
      nextSteps: ['abap search ZCL_FOO'],
      example: 'abap search ZCL_FOO',
    });
    const out = renderError(true, err);
    expect(out.stdout).toEqual([]);
    expect(out.stderr).toHaveLength(1);
    const parsed = JSON.parse(out.stderr[0]!);
    expect(parsed.status).toBe('error');
    expect(parsed.error.code).toBe('OBJECT_NOT_FOUND');
    expect(parsed.error.nextSteps).toEqual(['abap search ZCL_FOO']);
    expect(out.exitCode).toBe(8); // NOT_FOUND → 8
  });

  it('renderError(false, CliError) emits human text including Try: line', () => {
    const err = new CliError('TLS_ERROR', 'self-signed cert', {
      nextSteps: ['set CA', 'use --insecure'],
    });
    const out = renderError(false, err);
    expect(out.stderr[0]).toContain('Error: self-signed cert');
    expect(out.stderr[1]).toContain('Try: set CA / use --insecure');
    expect(out.exitCode).toBe(4); // TLS_ERROR → 4
  });

  it('toErrorShape surfaces details/nextSteps/example from CliError', () => {
    const err = new CliError('CONFIG_ERROR', 'bad config', {
      details: { file: '.abap.json' },
      nextSteps: ['run abap init'],
      example: 'abap init --system dev',
    });
    const shape = toErrorShape(err);
    expect(shape).toMatchObject({
      code: 'CONFIG_ERROR',
      message: 'bad config',
      details: { file: '.abap.json' },
      nextSteps: ['run abap init'],
      example: 'abap init --system dev',
    });
  });
});