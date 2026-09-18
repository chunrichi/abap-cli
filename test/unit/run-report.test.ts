/**
 * F-16 — `abap run-report <report>`.
 *
 * ADT has no classrun equivalent for reports, so this goes through the bundled
 * ICF service (`POST /run/report`), which SUBMITs the report with default
 * selection values and returns the captured list. The flow is unit-tested with a
 * stub ICF client; the live path is covered by running a real report on A4H.
 */
import { describe, expect, it, vi } from 'vitest';
import { formatRunReportHuman, runReport } from '../../src/abap_cli/flows/data/run-report.js';
import { CliError } from '../../src/abap_cli/output/json.js';
import type { IcfClient } from '../../src/abap_cli/clients/icf-client.js';

function stubClient(response: unknown) {
  const post = vi.fn(async () => response);
  return { client: { post } as unknown as IcfClient, post };
}

describe('runReport', () => {
  it('posts to /run/report and shapes the captured list', async () => {
    const { client, post } = stubClient({
      status: 'success',
      data: {
        report: 'ZR_MY_REPORT',
        lines: ['HELLO', 'COUNT         42'],
        output: 'HELLO\nCOUNT         42\n',
        lineCount: 2,
        truncated: false,
        durationMs: 12,
      },
    });
    const result = await runReport('zr_my_report', {}, client);
    expect(post).toHaveBeenCalledWith('/run/report', { report: 'ZR_MY_REPORT' });
    expect(result.report).toBe('ZR_MY_REPORT');
    expect(result.lines).toEqual(['HELLO', 'COUNT         42']);
    expect(result.output).toContain('HELLO');
    expect(result.lineCount).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('passes an optional variant through', async () => {
    const { client, post } = stubClient({ status: 'success', data: { report: 'ZR', lines: [] } });
    await runReport('ZR', { variant: 'var1' }, client);
    expect(post).toHaveBeenCalledWith('/run/report', { report: 'ZR', variant: 'VAR1' });
  });

  it('validates the report name without touching SAP', async () => {
    const { client, post } = stubClient({ status: 'success', data: {} });
    await expect(runReport('', {}, client)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(runReport('ZR; DROP', {}, client)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(post).not.toHaveBeenCalled();
  });

  it('maps known server error codes and their guidance', async () => {
    const { client } = stubClient({
      status: 'error',
      data: null,
      error: { code: 'REPORT_NO_LIST_OUTPUT', message: 'ZR produced no capturable list output' },
    });
    let caught: CliError | undefined;
    try {
      await runReport('ZR', {}, client);
    } catch (error) {
      caught = error as CliError;
    }
    expect(caught?.code).toBe('REPORT_NO_LIST_OUTPUT');
    expect((caught?.nextSteps ?? []).join('\n')).toContain('abap run');
  });

  it('falls back to SAP_ERROR for an unmapped server code', async () => {
    const { client } = stubClient({
      status: 'error',
      data: null,
      error: { code: 'SOMETHING_NEW', message: 'boom' },
    });
    let caught: CliError | undefined;
    try {
      await runReport('ZR', {}, client);
    } catch (error) {
      caught = error as CliError;
    }
    expect(caught?.code).toBe('SAP_ERROR');
    expect(caught?.details?.sapCode).toBe('SOMETHING_NEW');
  });

  it('explains how to supply mandatory selection parameters on a run failure', async () => {
    const { client } = stubClient({
      status: 'error',
      data: null,
      error: { code: 'REPORT_RUN_FAILED', message: 'submit failed' },
    });
    let caught: CliError | undefined;
    try {
      await runReport('ZR_MY_REPORT', {}, client);
    } catch (error) {
      caught = error as CliError;
    }
    expect((caught?.nextSteps ?? []).join('\n')).toContain('--variant');
  });
});

describe('formatRunReportHuman', () => {
  it('prints the list plus a summary header', () => {
    const human = formatRunReportHuman({
      report: 'ZR_MY_REPORT',
      lines: ['HELLO'],
      output: 'HELLO\n',
      lineCount: 1,
      truncated: false,
      durationMs: 5,
    });
    expect(human.split('\n')[0]).toBe('Report ZR_MY_REPORT: 1 line(s)');
    expect(human).toContain('HELLO');
  });

  it('flags truncated output and shows the variant', () => {
    const human = formatRunReportHuman({
      report: 'ZR',
      variant: 'VAR1',
      lines: ['x'],
      output: 'x',
      lineCount: 1,
      truncated: true,
      durationMs: 5,
    });
    expect(human).toContain('variant VAR1');
    expect(human).toContain('truncated');
  });
});
