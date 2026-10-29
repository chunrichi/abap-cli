/**
 * S-4 — `abap run-report --format tsv|csv` and `--param NAME=VALUE`.
 *
 * The `--format` flag is implemented client-side: the SAP response
 * carries the raw list; the CLI converts it to a tabular form without
 * re-running the report. `--param` is forwarded to SAP, which echoes
 * it back in `data.params` so the caller can verify the round trip.
 */
import { describe, expect, it, vi } from 'vitest';
import { runReport } from '../../src/abap_cli/flows/data/run-report.js';
import { CliError } from '../../src/abap_cli/output/json.js';
import type { IcfClient } from '../../src/abap_cli/clients/icf-client.js';

function fakeClient(stdout: ReturnType<typeof JSON.stringify>): IcfClient {
  return {
    post: vi.fn(async () => ({ status: 'success', data: JSON.parse(stdout), error: null })),
  } as unknown as IcfClient;
}

const RAW_PAYLOAD = JSON.stringify({
  report: 'ZR_TEST',
  variant: '',
  lines: [
    '|--------------------|--------------------|',
    '|Field1              |Field2              |',
    '|--------------------|--------------------|',
    '|hello               |world               |',
    '|foo                 |bar                 |',
    '|--------------------|--------------------|',
    '|Single-cell line with no bar|',
  ],
  // The server fills `output` from `lines.join('\n')`. Mirror that here so
  // tests for `output` preservation keep working without round-tripping
  // through the real handler.
  output: [
    '|--------------------|--------------------|',
    '|Field1              |Field2              |',
    '|--------------------|--------------------|',
    '|hello               |world               |',
    '|foo                 |bar                 |',
    '|--------------------|--------------------|',
    '|Single-cell line with no bar|',
  ].join('\n'),
  lineCount: 7,
  truncated: false,
  durationMs: 1,
});

describe('run-report --format (S-4)', () => {
  it('keeps the raw list when format is "raw" (default)', async () => {
    const client = fakeClient(RAW_PAYLOAD);
    const result = await runReport('ZR_TEST', {}, client);
    expect(result.format).toBe('raw');
    expect(result.formatted).toBe(result.output);
    // The raw lines still include the separator bars.
    expect(result.lines).toContain('|--------------------|--------------------|');
  });

  it('strips separator bars and emits tab-separated rows in "tsv"', async () => {
    const client = fakeClient(RAW_PAYLOAD);
    const result = await runReport('ZR_TEST', { format: 'tsv' }, client);
    expect(result.format).toBe('tsv');
    expect(result.formatted).not.toContain('|');
    expect(result.formatted).not.toContain('---');
    const rows = result.formatted.split('\n');
    expect(rows[0]).toBe('Field1\tField2');
    expect(rows[1]).toBe('hello\tworld');
    expect(rows[2]).toBe('foo\tbar');
    expect(rows[3]).toBe('Single-cell line with no bar');
  });

  it('emits comma-separated rows in "csv" with RFC-4180 quoting', async () => {
    const payload = JSON.stringify({
      report: 'ZR_TEST',
      lines: [
        '|field1      |field2      |',
        '|a,1         |plain       |',
        '|has "quote" |multi-line  |',
        '|value with , and "quotes"|col2 |',
      ],
      output: '',
      lineCount: 4,
      truncated: false,
      durationMs: 1,
    });
    const result = await runReport('ZR_TEST', { format: 'csv' }, fakeClient(payload));
    expect(result.format).toBe('csv');
    // Comma in cell → quoted
    expect(result.formatted).toContain('"a,1"');
    // Embedded quote → escaped as ""
    expect(result.formatted).toContain('"has ""quote"""');
  });

  it('rejects an unknown --format value early', async () => {
    const client = fakeClient(RAW_PAYLOAD);
    await expect(runReport('ZR_TEST', { format: 'xml' as unknown as 'raw' }, client)).rejects.toBeInstanceOf(CliError);
  });

  it('preserves `output` (raw) alongside `formatted` so callers can switch formats without re-running', async () => {
    const client = fakeClient(RAW_PAYLOAD);
    const result = await runReport('ZR_TEST', { format: 'csv' }, client);
    expect(result.output).toContain('|');
    expect(result.formatted).not.toContain('|');
  });
});

describe('run-report --param (S-4)', () => {
  it('forwards each param NAME=VALUE to the SAP-side handler', async () => {
    const post = vi.fn(async () => ({ status: 'success', data: JSON.parse(RAW_PAYLOAD), error: null }));
    const client = { post } as unknown as IcfClient;
    await runReport(
      'ZR_TEST',
      { params: [{ name: 'P_USER', value: 'DEVELOPER' }, { name: 'P_MAX', value: '10' }] },
      client,
    );
    expect(post).toHaveBeenCalledWith('/run/report', {
      report: 'ZR_TEST',
      params: [
        { name: 'P_USER', value: 'DEVELOPER' },
        { name: 'P_MAX', value: '10' },
      ],
    });
  });

  it('uppercases the param name', async () => {
    const post = vi.fn(async () => ({ status: 'success', data: JSON.parse(RAW_PAYLOAD), error: null }));
    const client = { post } as unknown as IcfClient;
    await runReport('ZR_TEST', { params: [{ name: 'p_user', value: 'DEV' }] }, client);
    expect(post).toHaveBeenCalledWith('/run/report', {
      report: 'ZR_TEST',
      params: [{ name: 'P_USER', value: 'DEV' }],
    });
  });

  it('rejects an invalid param name (non-DDIC identifier)', async () => {
    const client = fakeClient(RAW_PAYLOAD);
    await expect(
      runReport('ZR_TEST', { params: [{ name: "BAD'; DROP", value: 'x' }] }, client),
    ).rejects.toBeInstanceOf(CliError);
  });

  it('rejects an empty value', async () => {
    const client = fakeClient(RAW_PAYLOAD);
    await expect(
      runReport('ZR_TEST', { params: [{ name: 'P_X', value: '' }] }, client),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('returns the forwarded params in data.params (round-trip verification)', async () => {
    const payload = JSON.stringify({
      report: 'ZR_TEST',
      variant: '',
      params: [
        { name: 'P_USER', value: 'DEVELOPER' },
        { name: 'P_MAX', value: '10' },
      ],
      lines: ['|a|b|', '|1|2|'],
      output: '',
      lineCount: 2,
      truncated: false,
      durationMs: 1,
    });
    const result = await runReport('ZR_TEST', { params: [{ name: 'P_USER', value: 'DEVELOPER' }, { name: 'P_MAX', value: '10' }] }, fakeClient(payload));
    expect(result.params).toEqual([
      { name: 'P_USER', value: 'DEVELOPER' },
      { name: 'P_MAX', value: '10' },
    ]);
  });
});