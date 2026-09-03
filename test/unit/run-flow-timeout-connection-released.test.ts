import { describe, expect, it, vi } from 'vitest';
import { withTimeout } from '../../src/abap_cli/flows/data/run.js';
import { CliError } from '../../src/abap_cli/output/json.js';

// US3 acceptance 4 — timeout triggers abort(); connection released.

describe('run-flow timeout releases connection', () => {
  it('calls AbortController.abort() when the guard fires', async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
    const hanging = new Promise<string>(() => {});
    try {
      await withTimeout(hanging, 100, { className: 'ZCL_HANG' });
    } catch (e) {
      expect((e as CliError).code).toBe('TIMEOUT');
    }
    expect(abortSpy).toHaveBeenCalled();
    abortSpy.mockRestore();
  });

  it('does NOT call abort() when the promise resolves in time', async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
    const result = await withTimeout(Promise.resolve('fast'), 1000, { className: 'ZCL_FAST' });
    expect(result).toBe('fast');
    expect(abortSpy).not.toHaveBeenCalled();
    abortSpy.mockRestore();
  });
});