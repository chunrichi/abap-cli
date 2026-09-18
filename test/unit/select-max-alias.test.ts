/**
 * F-09 — `abap select --max` must behave like `abap search --max`: a
 * DEPRECATED_OPTION alias for `--limit` rather than `USAGE unknown option`.
 *
 * Most cases use `--dry-run` so no ICF/SAP call is made and the limit mapping
 * can be asserted from the JSON envelope alone; the last one mocks the ICF
 * client to prove the value reaches the wire payload.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const postDataQuery = vi.fn();
vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: { create: async () => ({ postDataQuery }) },
}));

import { registerSelectCommand } from '../../src/abap_cli/commands/select.js';
import { resetWarnings } from '../../src/abap_cli/output/meta.js';
import { makeProgram, runCommand } from './cli-helper.js';

function runSelect(args: string[]) {
  const program = makeProgram();
  registerSelectCommand(program);
  return runCommand(program, args);
}

function envelope(res: { stdout: string; stderr: string }) {
  return JSON.parse(res.stdout || res.stderr);
}

const BASE = ['select', '--table', 'ZTAB_FIXTURE', '--dry-run', '--json'];

describe('abap select --max (deprecated alias for --limit, F-09)', () => {
  beforeEach(() => {
    resetWarnings();
    postDataQuery.mockReset();
    postDataQuery.mockResolvedValue({
      status: 'success',
      data: { table: 'ZTAB_FIXTURE', objectType: 'TABL', fields: ['ID'], rows: [], rowCount: 0, excludedFields: [], durationMs: 1 },
    });
  });

  it('accepts --max instead of failing with USAGE unknown option', async () => {
    const res = await runSelect([...BASE, '--max', '5']);
    expect(res.exitCode).toBeUndefined();
    const env = envelope(res);
    expect(env.status).toBe('success');
    expect(env.data.limit).toBe(5);
  });

  it('emits a DEPRECATED_OPTION warning naming --max', async () => {
    const res = await runSelect([...BASE, '--max', '5']);
    const env = envelope(res);
    expect(env.meta.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DEPRECATED_OPTION',
          details: expect.objectContaining({ option: '--max' }),
        }),
      ]),
    );
  });

  it('explicit --limit wins when both are given (deterministic precedence)', async () => {
    const res = await runSelect([...BASE, '--max', '5', '--limit', '7']);
    const env = envelope(res);
    expect(env.data.limit).toBe(7);
    // The deprecation warning is emitted regardless of which value wins.
    expect(env.meta.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'DEPRECATED_OPTION' })]),
    );
  });

  it('--limit wins regardless of argv order', async () => {
    const res = await runSelect([...BASE, '--limit', '7', '--max', '5']);
    expect(envelope(res).data.limit).toBe(7);
  });

  it('omitting both --limit and --max keeps the default 100', async () => {
    const res = await runSelect([...BASE]);
    expect(envelope(res).data.limit).toBe(100);
  });

  it('--max is bounds-checked exactly like --limit', async () => {
    const res = await runSelect([...BASE, '--max', '0']);
    expect(res.exitCode).toBe(2);
    const env = envelope(res);
    expect(env.status).toBe('error');
    expect(env.error.code).toBe('INVALID_ARGUMENT');
  });

  it('does not warn when --max is not used', async () => {
    const res = await runSelect([...BASE, '--limit', '3']);
    const warnings = envelope(res).meta.warnings ?? [];
    expect(warnings.some((w: { code: string }) => w.code === 'DEPRECATED_OPTION')).toBe(false);
  });

  it('maps --max into the query limit actually sent to the ICF endpoint', async () => {
    const res = await runSelect(['select', '--table', 'ZTAB_FIXTURE', '--max', '5', '--json']);
    expect(res.exitCode).toBeUndefined();
    expect(postDataQuery).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }));
  });
});
