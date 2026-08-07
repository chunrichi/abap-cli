import { describe, expect, it } from 'vitest';
import { runRun } from '../../src/abap_cli/flows/run-flow.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';

// FR-002 / FR-005 — wrapper body params are encoded correctly.

function fakeClient(stdout: string, onCall?: (params?: unknown) => void) {
  return {
    runClass: async (_n: string, params?: Array<{ name: string; value: string }>) => {
      onCall?.(params);
      return stdout;
    },
  } as unknown as AdtClientWrapper;
}

describe('run-flow wrapper args mapping', () => {
  it('encodes method + args JSON as IV_TARGET_CLASS / IV_METHOD_NAME / IV_ARGS_JSON', async () => {
    let captured: Array<{ name: string; value: string }> | undefined;
    const client = fakeClient('{"status":"ok","method":"add","exitCode":0,"result":8}', (p) => {
      captured = p as Array<{ name: string; value: string }>;
    });
    await runRun('ZCL_FOO', { method: 'add', args: '{"a":3,"b":5}' }, client);
    expect(captured).toBeDefined();
    const kv = Object.fromEntries(captured!.map((p) => [p.name, p.value]));
    expect(kv.IV_TARGET_CLASS).toBe('ZCL_FOO');
    expect(kv.IV_METHOD_NAME).toBe('add');
    expect(JSON.parse(kv.IV_ARGS_JSON)).toEqual({ a: 3, b: 5 });
  });

  it('uppercases target class', async () => {
    let captured: Array<{ name: string; value: string }> | undefined;
    const client = fakeClient('{"status":"ok","method":"x","exitCode":0,"result":null}', (p) => {
      captured = p as Array<{ name: string; value: string }>;
    });
    await runRun('zcl_lower', { method: 'x' }, client);
    expect(captured?.find((p) => p.name === 'IV_TARGET_CLASS')?.value).toBe('ZCL_LOWER');
  });

  it('encodes IV_TIMEOUT_MS as string', async () => {
    let captured: Array<{ name: string; value: string }> | undefined;
    const client = fakeClient('{"status":"ok","method":"x","exitCode":0,"result":null}', (p) => {
      captured = p as Array<{ name: string; value: string }>;
    });
    await runRun('ZCL_X', { method: 'x', timeout: 5000 }, client);
    expect(captured?.find((p) => p.name === 'IV_TIMEOUT_MS')?.value).toBe('5000');
  });
});