import { describe, expect, it } from 'vitest';
import { runRun, RUNNER_CLASS } from '../../src/abap_cli/flows/data/run.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';
import { CliError } from '../../src/abap_cli/output/json.js';

// Routing for `abap run`:
//   - no --method → AdtClientWrapper.runClass(className) directly with no params
//   - with --method → AdtClientWrapper.runClass(ZCL_ABAP_VIBE_RUNNER, wrapper-params)
//   - wrapper params: IV_TARGET_CLASS (uppercased), IV_METHOD_NAME, IV_ARGS_JSON,
//                     IV_TIMEOUT_MS (default 30000)
//   - success on classrun JSON path: route='classrun', raw output preserved,
//                                       parsed reflects JSON, exitCode honored
//   - success on wrapper JSON path: route='wrapper', parsed.result honored,
//                                      raw output preserved

function fakeClientWithCapture(
  stdout: string,
  onCall?: (name: string, params?: Array<{ name: string; value: string }>) => void,
): AdtClientWrapper {
  return {
    runClass: async (name: string, params?: Array<{ name: string; value: string }>) => {
      onCall?.(name, params);
      return stdout;
    },
  } as unknown as AdtClientWrapper;
}

describe('run-flow routing & wrapper', () => {
  describe('route selection', () => {
    it('calls runClass(className) directly with no params when --method is absent', async () => {
      let capturedName: string | undefined;
      let capturedParams: unknown;
      const client = fakeClientWithCapture('{"status":"ok"}', (n, p) => {
        capturedName = n;
        capturedParams = p;
      });
      await runRun('ZCL_FOO', {}, client);
      expect(capturedName).toBe('ZCL_FOO');
      expect(capturedParams).toBeUndefined();
    });

    it('routes via wrapper only when --method is present', async () => {
      let capturedName: string | undefined;
      let capturedParams: unknown;
      const client = fakeClientWithCapture(
        '{"status":"ok","method":"add","exitCode":0,"result":8}',
        (n, p) => {
          capturedName = n;
          capturedParams = p;
        },
      );
      await runRun('ZCL_FOO', { method: 'add' }, client);
      expect(capturedName).toBe('ZCL_ABAP_VIBE_RUNNER');
      expect(Array.isArray(capturedParams)).toBe(true);
      const params = capturedParams as Array<{ name: string; value: string }>;
      expect(params.find((p) => p.name === 'IV_TARGET_CLASS')?.value).toBe('ZCL_FOO');
      expect(params.find((p) => p.name === 'IV_METHOD_NAME')?.value).toBe('add');
    });

    it('rejects local class (~) before any SAP call', async () => {
      try {
        await runRun('ZCL_FOO~LCL_BAR', {});
        expect.fail('should have thrown');
      } catch (e) {
        const err = e as CliError;
        expect(err.code).toBe('LOCAL_CLASS_NOT_RUNNABLE');
        expect(err.message).toMatch(/~/);
      }
    });
  });

  describe('wrapper parameter mapping', () => {
    it('encodes method + args JSON as IV_TARGET_CLASS / IV_METHOD_NAME / IV_ARGS_JSON', async () => {
      let captured: Array<{ name: string; value: string }> | undefined;
      const client = fakeClientWithCapture(
        '{"status":"ok","method":"add","exitCode":0,"result":8}',
        (_n, p) => {
          captured = p as Array<{ name: string; value: string }>;
        },
      );
      await runRun('ZCL_FOO', { method: 'add', args: '{"a":3,"b":5}' }, client);
      const kv = Object.fromEntries(captured!.map((p) => [p.name, p.value]));
      expect(kv.IV_TARGET_CLASS).toBe('ZCL_FOO');
      expect(kv.IV_METHOD_NAME).toBe('add');
      expect(JSON.parse(kv.IV_ARGS_JSON)).toEqual({ a: 3, b: 5 });
    });

    it('uppercases target class', async () => {
      let captured: Array<{ name: string; value: string }> | undefined;
      const client = fakeClientWithCapture(
        '{"status":"ok","method":"x","exitCode":0,"result":null}',
        (_n, p) => {
          captured = p as Array<{ name: string; value: string }>;
        },
      );
      await runRun('zcl_lower', { method: 'x' }, client);
      expect(captured?.find((p) => p.name === 'IV_TARGET_CLASS')?.value).toBe('ZCL_LOWER');
    });

    it('encodes IV_TIMEOUT_MS as string', async () => {
      let captured: Array<{ name: string; value: string }> | undefined;
      const client = fakeClientWithCapture(
        '{"status":"ok","method":"x","exitCode":0,"result":null}',
        (_n, p) => {
          captured = p as Array<{ name: string; value: string }>;
        },
      );
      await runRun('ZCL_X', { method: 'x', timeout: 5000 }, client);
      expect(captured?.find((p) => p.name === 'IV_TIMEOUT_MS')?.value).toBe('5000');
    });

    it('defaults IV_TIMEOUT_MS to "30000" when --timeout is omitted', async () => {
      let captured: Array<{ name: string; value: string }> | undefined;
      const client = fakeClientWithCapture(
        '{"status":"ok","method":"x","exitCode":0,"result":null}',
        (_n, p) => {
          captured = p as Array<{ name: string; value: string }>;
        },
      );
      await runRun('ZCL_X', { method: 'x' }, client);
      expect(captured?.find((p) => p.name === 'IV_TIMEOUT_MS')?.value).toBe('30000');
      expect(RUNNER_CLASS).toBe('ZCL_ABAP_VIBE_RUNNER');
    });
  });

  describe('classrun JSON success (route=classrun)', () => {
    it('parses JSON ok output and preserves raw text in data.output', async () => {
      const raw = JSON.stringify({ status: 'ok', exitCode: 0, result: 42 });
      const client = fakeClientWithCapture(raw);
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
      const client = fakeClientWithCapture('{"status":"ok","exitCode":0}', (_n, p) => {
        captured = p;
      });
      await runRun('ZCL_MY_THING', {}, client);
      expect(captured).toBeUndefined();
    });

    it('preserves exitCode from JSON when present', async () => {
      const raw = JSON.stringify({ status: 'ok', exitCode: 7 });
      const client = fakeClientWithCapture(raw);
      const result = await runRun('ZCL_OK', {}, client);
      expect(result.exitCode).toBe(7);
    });
  });

  describe('wrapper JSON success (route=wrapper)', () => {
    it('routes to wrapper and parses ok output', async () => {
      const stdout = JSON.stringify({ status: 'ok', method: 'add', exitCode: 0, result: 8 });
      const client = fakeClientWithCapture(stdout);
      const result = await runRun('ZCL_FOO', { method: 'add', args: '{"a":3,"b":5}' }, client);
      expect(result.route).toBe('wrapper');
      expect(result.method).toBe('add');
      expect(result.exitCode).toBe(0);
      expect(result.parsed?.result).toBe(8);
    });

    it('returns parsed object when JSON output has more fields', async () => {
      const stdout = JSON.stringify({
        status: 'ok',
        method: 'compute',
        exitCode: 0,
        result: { rows: 3, total: 12 },
      });
      const client = fakeClientWithCapture(stdout);
      const result = await runRun('ZCL_Q', { method: 'compute' }, client);
      expect(result.parsed?.result).toEqual({ rows: 3, total: 12 });
    });

    it('preserves raw output text in data.output', async () => {
      const stdout = '{"status":"ok","method":"x","exitCode":0,"result":42}';
      const client = fakeClientWithCapture(stdout);
      const result = await runRun('ZCL_R', { method: 'x' }, client);
      expect(result.output).toBe(stdout);
    });
  });
});