import { describe, expect, it } from 'vitest';
import { runRun, withTimeout } from '../../src/abap_cli/flows/run-flow.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';
import { CliError } from '../../src/abap_cli/output/json.js';

// US3 — timeout guard (T035). SC-002.

function fakeClient(stdout: string | Promise<string>): AdtClientWrapper {
  return { runClass: async () => stdout } as unknown as AdtClientWrapper;
}

describe('run-flow timeout', () => {
  it('maps SAP-side wrapper TIMEOUT envelope to TIMEOUT error', async () => {
    const stdout = JSON.stringify({
      status: 'error', code: 'TIMEOUT',
      message: 'exceeded 2000ms', durationMs: 2100,
    });
    try {
      await runRun('ZCL_SLOW', { method: 'x', timeout: 2000 }, fakeClient(stdout));
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as CliError;
      expect(err.code).toBe('TIMEOUT');
      expect(err.message).toMatch(/exceeded/);
    }
  });

  it('CLI-side guard: withTimeout rejects a hanging promise after ms', async () => {
    const hanging = new Promise<string>(() => {});
    const t0 = Date.now();
    try {
      await withTimeout(hanging, 300, { className: 'ZCL_HANG' });
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as CliError;
      const elapsed = Date.now() - t0;
      expect(err.code).toBe('TIMEOUT');
      expect(elapsed).toBeGreaterThanOrEqual(250);
      expect(elapsed).toBeLessThan(2000);
    }
  });

  it('CLI-side guard: quick resolution passes through unchanged', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 5000, { className: 'ZCL_FAST' });
    expect(result).toBe('ok');
  });
});