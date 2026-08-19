import { describe, expect, it, vi } from 'vitest';
import { renderResult, renderError } from '../../src/abap_cli/output/json.js';
import { buildMeta } from '../../src/abap_cli/output/meta.js';
import { CliError } from '../../src/abap_cli/output/json.js';

// P1.7 / FR-011 — stdout/stderr separation for abap run envelopes.

describe('abap run output streams', () => {
  const meta = buildMeta();

  it('human success: output text on stdout only', () => {
    const out = renderResult(
      'human',
      { className: 'ZCL_FOO', exitCode: 0, output: 'hello', parsed: null },
      'hello',
      meta,
    );
    expect(out.stdout.join('')).toContain('hello');
    expect(out.stderr).toHaveLength(0);
  });

  it('human failure: Error + Try on stderr, stdout empty', () => {
    const err = new CliError('METHOD_NOT_SUPPORTED', 'bad signature', {
      nextSteps: ['Use classrun instead'],
    });
    const out = renderError('human', err, meta);
    expect(out.stdout).toHaveLength(0);
    expect(out.stderr.join('')).toContain('Error: bad signature');
    expect(out.stderr.join('')).toContain('Try:');
  });

  it('--json success: JSON envelope on stdout, stderr empty', () => {
    const out = renderResult(
      'json',
      { className: 'ZCL_FOO', exitCode: 0, output: '{"status":"ok"}' },
      'human ignored',
      meta,
    );
    const parsed = JSON.parse(out.stdout.join(''));
    expect(parsed.status).toBe('success');
    expect(out.stderr).toHaveLength(0);
  });

  it('--json failure: stdout strictly empty, JSON envelope on stderr', () => {
    const err = new CliError('METHOD_FAILED', 'method failed', { nextSteps: ['inspect'] });
    const out = renderError('json', err, meta);
    expect(out.stdout).toHaveLength(0);
    const parsed = JSON.parse(out.stderr.join(''));
    expect(parsed.status).toBe('error');
    expect(parsed.error.code).toBe('METHOD_FAILED');
  });
});