import { describe, expect, it } from 'vitest';
import { runRun } from '../../src/abap_cli/flows/data/run.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';

// US2 acceptance 1 — wrapper path success.

function fakeClient(stdout: string, onCall?: (name: string, params?: unknown) => void) {
  return {
    runClass: async (name: string, params?: Array<{ name: string; value: string }>) => {
      onCall?.(name, params);
      return stdout;
    },
  } as unknown as AdtClientWrapper;
}

describe('run-flow wrapper success', () => {
  it('routes to wrapper and parses ok output', async () => {
    const stdout = JSON.stringify({ status: 'ok', method: 'add', exitCode: 0, result: 8 });
    const client = fakeClient(stdout);
    const result = await runRun('ZCL_FOO', { method: 'add', args: '{"a":3,"b":5}' }, client);
    expect(result.route).toBe('wrapper');
    expect(result.method).toBe('add');
    expect(result.exitCode).toBe(0);
    expect(result.parsed?.result).toBe(8);
  });

  it('returns parsed object when JSON output has more fields', async () => {
    const stdout = JSON.stringify({
      status: 'ok', method: 'compute', exitCode: 0,
      result: { rows: 3, total: 12 },
    });
    const client = fakeClient(stdout);
    const result = await runRun('ZCL_Q', { method: 'compute' }, client);
    expect(result.parsed?.result).toEqual({ rows: 3, total: 12 });
  });

  it('preserves raw output text in data.output', async () => {
    const stdout = '{"status":"ok","method":"x","exitCode":0,"result":42}';
    const client = fakeClient(stdout);
    const result = await runRun('ZCL_R', { method: 'x' }, client);
    expect(result.output).toBe(stdout);
  });
});