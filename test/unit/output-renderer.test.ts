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
  it('renderResult("json", data, human, meta) emits compact JSON with meta on stdout', () => {
    const out = renderResult('json', { hello: 'world' }, 'human text', meta);
    expect(out.stdout).toHaveLength(1);
    const parsed = JSON.parse(out.stdout[0]!);
    expect(parsed).toEqual({ status: 'success', meta, data: { hello: 'world' } });
    expect(out.stdout[0]).not.toContain('\n'); // compact (no indent)
    expect(out.stderr).toEqual([]);
    expect(out.exitCode).toBeUndefined();
  });

  it('renderResult("pretty-json", ...) emits indented JSON on stdout', () => {
    const out = renderResult('pretty-json', { hello: 'world' }, 'human text', meta);
    expect(out.stdout).toHaveLength(1);
    expect(out.stdout[0]).toContain('\n'); // has newlines from indent
    expect(out.stdout[0]).toMatch(/^\{\s+"status"/); // starts indented
    const parsed = JSON.parse(out.stdout[0]!);
    expect(parsed.status).toBe('success');
    expect(parsed.data).toEqual({ hello: 'world' });
  });

  it('renderResult compact JSON is materially smaller than pretty-json (NFR-001)', () => {
    const payload = {
      items: Array.from({ length: 5 }, (_, i) => ({ id: i, name: `item-${i}`, nested: { ok: true } })),
      skipped: [],
      failed: [],
    };
    const compact = renderResult('json', payload, 'h', meta).stdout[0]!;
    const pretty = renderResult('pretty-json', payload, 'h', meta).stdout[0]!;
    expect(compact.length).toBeLessThan(pretty.length);
    expect(compact).not.toContain('"skipped"');
    expect(compact).not.toContain('"failed"');
  });

  it('renderResult("human", ...) emits human text on stdout and warning lines on stderr', () => {
    const withWarnings: OutputMeta = { ...meta, warnings: [{ code: 'DEPRECATED_OPTION', message: 'use --limit' }] };
    const out = renderResult('human', { x: 1 }, 'hello human', withWarnings);
    expect(out.stdout).toEqual(['hello human']);
    expect(out.stderr).toEqual(['Warning: use --limit']);
    expect(out.exitCode).toBeUndefined();
  });

  it('renderError("json", CliError) emits compact JSON with meta on stderr and sets exitCode', () => {
    const err = new CliError('OBJECT_NOT_FOUND', 'ZCL_FOO missing', {
      nextSteps: ['abap search ZCL_FOO'],
      example: 'abap search ZCL_FOO',
    });
    const out = renderError('json', err, meta);
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

  it('renderError("pretty-json", CliError) emits indented JSON on stderr', () => {
    const err = new CliError('USAGE', 'bad flag');
    const out = renderError('pretty-json', err, meta);
    expect(out.stdout).toEqual([]);
    expect(out.stderr[0]).toMatch(/^\{\s+"status"/);
    const parsed = JSON.parse(out.stderr[0]!);
    expect(parsed.error.code).toBe('USAGE');
  });

  it('renderError("human", CliError) emits warning lines then Error/Try lines', () => {
    const err = new CliError('TLS_ERROR', 'self-signed cert', {
      nextSteps: ['set CA', 'use --insecure'],
    });
    const withWarnings: OutputMeta = { ...meta, warnings: [{ code: 'KEYCHAIN_WARNING', message: 'keychain failed' }] };
    const out = renderError('human', err, withWarnings);
    expect(out.stderr[0]).toContain('Warning: keychain failed');
    expect(out.stderr[1]).toContain('Error: self-signed cert');
    expect(out.stderr[2]).toContain('Try: set CA / use --insecure');
    expect(out.exitCode).toBe(4); // TLS_ERROR → 4
  });

  it('stripEmpty() recurses into nested data (US2)', () => {
    const out = renderResult('json', {
      ok: 1,
      skipped: [],
      failed: [],
      nested: { value: 'x', empty: {}, alsoEmpty: [] },
      nullKept: null,
      zeroKept: 0,
      falseKept: false,
    }, 'h', meta);
    const parsed = JSON.parse(out.stdout[0]!);
    expect(parsed.data).toEqual({
      ok: 1,
      nested: { value: 'x' },
      nullKept: null,
      zeroKept: 0,
      falseKept: false,
    });
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
    const out = renderError('json', new Error('boom'), meta);
    const parsed = JSON.parse(out.stderr[0]!);
    expect(parsed.error.code).toBe('UNKNOWN');
    expect(parsed.error.category).toBe('UNKNOWN');
    expect(parsed.error.message).toContain('boom');
    expect(out.exitCode).toBe(1);
  });

  it('toErrorShape keeps SAP_ERROR + httpStatus for HTTP-shaped errors', () => {
    const out = renderError('json', { statusCode: 500, statusMessage: 'Internal Server Error', message: 'icf failed' }, meta);
    const parsed = JSON.parse(out.stderr[0]!);
    expect(parsed.error.code).toBe('SAP_ERROR');
    expect(parsed.error.category).toBe('SAP_ERROR');
    expect(parsed.error.httpStatus).toBe(500);
    expect(out.exitCode).toBe(6);
  });

  it('toErrorShape surfaces references on CliError instances', () => {
    const err = new CliError('TLS_ERROR', 'self-signed cert', {
      references: 'skills/abap-cli-setup/references/errors.md#tls_error',
    });
    expect(toErrorShape(err).references).toBe('skills/abap-cli-setup/references/errors.md#tls_error');
  });

  it('renderError("human", ...) appends a See: line for error.references', () => {
    const err = new CliError('LOCK_FAILED', 'Cannot lock ZCL_FOO', {
      nextSteps: ['abap inspect ZCL_FOO --locks'],
      references: 'skills/abap-cli-edit/references/errors.md#lock_failed',
    });
    const out = renderError('human', err, meta);
    expect(out.stdout).toEqual([]);
    expect(out.stderr).toContain('Error: Cannot lock ZCL_FOO');
    expect(out.stderr).toContain('  Try: abap inspect ZCL_FOO --locks');
    expect(out.stderr).toContain('  See:  skills/abap-cli-edit/references/errors.md#lock_failed');
  });

  it('renderError("json", ...) includes references in the error envelope', () => {
    const err = new CliError('WRAPPER_NOT_DEPLOYED', 'wrapper missing', {
      nextSteps: ['abap extension deploy'],
      references: 'skills/abap-cli-setup/references/errors.md',
    });
    const out = renderError('json', err, meta);
    const parsed = JSON.parse(out.stderr[0]!);
    expect(parsed.error.references).toBe('skills/abap-cli-setup/references/errors.md');
  });

  it('renderError("human", ...) omits See: when references is absent', () => {
    const err = new CliError('SAP_ERROR', 'plain failure');
    const out = renderError('human', err, meta);
    expect(out.stderr.some((l) => l.startsWith('  See:'))).toBe(false);
  });
});