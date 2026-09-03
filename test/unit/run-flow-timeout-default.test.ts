import { describe, expect, it } from 'vitest';
import { runRun, validateTimeout, RUNNER_CLASS } from '../../src/abap_cli/flows/data/run.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';

// US3 acceptance 2 — default timeout 30000.

function fakeClient(stdout: string, onParams?: (p: Array<{ name: string; value: string }>) => void): AdtClientWrapper {
  return {
    runClass: async (_n: string, params?: Array<{ name: string; value: string }>) => {
      if (params) onParams?.(params);
      return stdout;
    },
  } as unknown as AdtClientWrapper;
}

describe('run-flow timeout default', () => {
  it('defaults --timeout to 30000 when omitted', () => {
    expect(validateTimeout(undefined)).toBe(30000);
    expect(validateTimeout('')).toBe(30000);
  });

  it('encodes IV_TIMEOUT_MS=30000 for wrapper route by default', async () => {
    let captured: Array<{ name: string; value: string }> | undefined;
    const client = fakeClient('{"status":"ok","method":"x","exitCode":0,"result":null}', (p) => {
      captured = p;
    });
    await runRun('ZCL_X', { method: 'x' }, client);
    expect(captured?.find((p) => p.name === 'IV_TIMEOUT_MS')?.value).toBe('30000');
    // Wrapper class constant is stable.
    expect(RUNNER_CLASS).toBe('ZCL_ABAP_VIBE_RUNNER');
  });
});