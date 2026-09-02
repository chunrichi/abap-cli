import { describe, expect, it } from 'vitest';
import { runRun } from '../../src/abap_cli/flows/data/run.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';

// US1 — classrun JSON OK path (T010). Spec acceptance 1-2.

function makeFakeClient(stdout: string, paramsCheck?: (params?: unknown) => void) {
  const fake = {
    runClass: async (name: string, params?: Array<{ name: string; value: string }>) => {
      paramsCheck?.(params);
      if (name === 'ZCL_ABAP_VIBE_RUNNER') {
        throw new Error('wrapper path should not be used here');
      }
      return stdout;
    },
  } as unknown as AdtClientWrapper;
  return fake;
}

describe('run-flow success (classrun JSON)', () => {
  it('parses JSON ok output and preserves raw text in data.output', async () => {
    const raw = JSON.stringify({ status: 'ok', exitCode: 0, result: 42 });
    const client = makeFakeClient(raw);
    const result = await runRun('ZCL_MOCK', {}, client);
    expect(result.route).toBe('classrun');
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe(raw);
    expect(result.parsed).toEqual({ status: 'ok', exitCode: 0, result: 42 });
    expect(result.parsed?.result).toBe(42);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.dryRun).toBe(false);
  });

  it('uses classrun route when --method is absent and passes no params', async () => {
    let captured: unknown;
    const client = makeFakeClient('{"status":"ok","exitCode":0}', (p) => (captured = p));
    await runRun('ZCL_MY_THING', {}, client);
    expect(captured).toBeUndefined();
  });

  it('preserves exitCode from JSON when present', async () => {
    const raw = JSON.stringify({ status: 'ok', exitCode: 7 });
    const client = makeFakeClient(raw);
    const result = await runRun('ZCL_OK', {}, client);
    expect(result.exitCode).toBe(7);
  });
});