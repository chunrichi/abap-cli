import { describe, expect, it } from 'vitest';
import { runRun } from '../../src/abap_cli/flows/run-flow.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';

// FR-001 / FR-003 — no --method route uses AdtClientWrapper.runClass(name) directly.

function fakeClient(
  stdout: string,
  onCall: (name: string, params?: Array<{ name: string; value: string }>) => void,
): AdtClientWrapper {
  return {
    runClass: async (name: string, params?: Array<{ name: string; value: string }>) => {
      onCall(name, params);
      return stdout;
    },
  } as unknown as AdtClientWrapper;
}

describe('run-flow classrun (no --method)', () => {
  it('calls runClass(className) directly with no params when --method is absent', async () => {
    let capturedName: string | undefined;
    let capturedParams: unknown;
    const client = fakeClient('{"status":"ok"}', (n, p) => {
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
    const client = fakeClient('{"status":"ok","method":"add","exitCode":0,"result":8}', (n, p) => {
      capturedName = n;
      capturedParams = p;
    });
    await runRun('ZCL_FOO', { method: 'add' }, client);
    expect(capturedName).toBe('ZCL_ABAP_VIBE_RUNNER');
    expect(Array.isArray(capturedParams)).toBe(true);
    const params = capturedParams as Array<{ name: string; value: string }>;
    expect(params.find((p) => p.name === 'IV_TARGET_CLASS')?.value).toBe('ZCL_FOO');
    expect(params.find((p) => p.name === 'IV_METHOD_NAME')?.value).toBe('add');
  });
});