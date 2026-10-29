import { describe, expect, it, vi } from 'vitest';
import {
  runRun,
  validateTimeout,
  withTimeout,
  RUNNER_CLASS,
} from '../../src/abap_cli/flows/data/run.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';
import { CliError } from '../../src/abap_cli/output/json.js';

// Timeout handling for `abap run`:
//   - validation: integer in [100, 600000]; default 30000 (used as
//     IV_TIMEOUT_MS in the wrapper body)
//   - SAP-side: wrapper returns {code:'TIMEOUT'} → CLI TIMEOUT error
//   - CLI-side guard: withTimeout wraps the SAP promise, rejects on deadline
//     (with AbortController.abort()), passes quick resolutions through

function fakeClient(stdout: string): AdtClientWrapper {
  return { runClass: async () => stdout } as unknown as AdtClientWrapper;
}

describe('run-flow timeout', () => {
  describe('validation & default', () => {
    it('defaults --timeout to 30000 when omitted', () => {
      expect(validateTimeout(undefined)).toBe(30000);
      expect(validateTimeout('')).toBe(30000);
    });

    it('rejects values below 100ms', () => {
      expect(() => validateTimeout(50)).toThrow(CliError);
      expect(() => validateTimeout(0)).toThrow(CliError);
      expect(() => validateTimeout(-100)).toThrow(CliError);
    });

    it('rejects values above 600000ms', () => {
      expect(() => validateTimeout(700000)).toThrow(CliError);
    });

    it('rejects non-numeric strings', () => {
      expect(() => validateTimeout('abc')).toThrow(CliError);
    });

    it('rejects non-integer floats', () => {
      expect(() => validateTimeout(123.456)).toThrow(CliError);
    });

    it('runRun throws INVALID_ARGUMENT for an invalid timeout before SAP call', async () => {
      try {
        await runRun('ZCL_X', { timeout: 50 }, {
          runClass: async () => {
            throw new Error('should not be called');
          },
        } as unknown as never);
        expect.fail('should have thrown');
      } catch (e) {
        expect((e as CliError).code).toBe('INVALID_ARGUMENT');
      }
    });
  });

  describe('default 30000 flows through to wrapper IV_TIMEOUT_MS', () => {
    it('encodes IV_TIMEOUT_MS=30000 for wrapper route by default', async () => {
      let captured: Array<{ name: string; value: string }> | undefined;
      const client = {
        runClass: async (
          _name: string,
          params?: Array<{ name: string; value: string }>,
        ) => {
          captured = params;
          return '{"status":"ok","method":"x","exitCode":0,"result":null}';
        },
      } as unknown as AdtClientWrapper;
      await runRun('ZCL_X', { method: 'x' }, client);
      expect(captured?.find((p) => p.name === 'IV_TIMEOUT_MS')?.value).toBe('30000');
      // Wrapper class constant is stable.
      expect(RUNNER_CLASS).toBe('ZCL_ABAP_VIBE_RUNNER');
    });
  });

  describe('SAP-side timeout (wrapper returns TIMEOUT envelope)', () => {
    it('maps SAP-side wrapper TIMEOUT envelope to TIMEOUT error', async () => {
      const stdout = JSON.stringify({
        status: 'error',
        code: 'TIMEOUT',
        message: 'exceeded 2000ms',
        durationMs: 2100,
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
  });

  describe('CLI-side guard (withTimeout)', () => {
    it('rejects a hanging promise after ms', async () => {
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

    it('lets a quick resolution pass through unchanged', async () => {
      const result = await withTimeout(Promise.resolve('ok'), 5000, { className: 'ZCL_FAST' });
      expect(result).toBe('ok');
    });

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
});