import { describe, expect, it } from 'vitest';
import { runRun } from '../../src/abap_cli/flows/data/run.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';
import { CliError } from '../../src/abap_cli/output/json.js';

// Real-SAP limitation — classrun endpoint may not inject method args.
// When the wrapper echoes a heartbeat (no `method` field) for a --method
// request, the CLI must surface WRAPPER_INPUT_UNAVAILABLE instead of
// silently reporting the heartbeat as the method result.

function fakeClient(stdout: string): AdtClientWrapper {
  return { runClass: async () => stdout } as unknown as AdtClientWrapper;
}

const HEARTBEAT = JSON.stringify({
  status: 'ok', exitCode: 0, message: 'classrun heartbeat', version: '0.7.0',
});

describe('run-flow wrapper input unavailable', () => {
  it('--method request that returns a heartbeat → WRAPPER_INPUT_UNAVAILABLE (exit 6)', async () => {
    try {
      await runRun('ZCL_X', { method: 'add', args: '{"a":3}' }, fakeClient(HEARTBEAT));
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as CliError;
      expect(err.code).toBe('WRAPPER_INPUT_UNAVAILABLE');
      expect(err.nextSteps?.some((s) => s.includes('classrun'))).toBe(true);
    }
  });

  it('real method result (with method field) is NOT mistaken for heartbeat', async () => {
    const ok = JSON.stringify({ status: 'ok', method: 'add', exitCode: 0, result: 8 });
    const result = await runRun('ZCL_X', { method: 'add' }, fakeClient(ok));
    expect(result.parsed?.result).toBe(8);
  });

  it('heartbeat without --method is still a normal classrun result', async () => {
    const result = await runRun('ZCL_ABAP_VIBE_RUNNER', {}, fakeClient(HEARTBEAT));
    expect(result.parsed?.message).toBe('classrun heartbeat');
    expect(result.route).toBe('classrun');
  });
});