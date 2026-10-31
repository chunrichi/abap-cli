/**
 * — `abap run` source fingerprint.
 *
 * The fingerprint surfaces which SAP-side version of a class was
 * actually executed. Without it, callers could not detect the F-02
 * regression (an inactive version left over from a `push` failure).
 *
 * The probe reads ADT's `/sap/bc/adt/repository/inactiveobjects`
 * endpoint. The test suite mocks the wrapper's `inactiveObjects()` and
 * `runClass()` methods to drive each branch deterministically.
 */
import { describe, expect, it, vi } from 'vitest';
import { runRun } from '../../src/abap_cli/flows/data/run.js';
import type { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';

function fakeClient(stdout: string, inactiveObjects: unknown): AdtClientWrapper {
  return {
    runClass: async () => stdout,
    inactiveObjects: async () => inactiveObjects,
  } as unknown as AdtClientWrapper;
}

describe('run-flow source fingerprint', () => {
  it('reports no inactive version when the inactive-objects feed is empty', async () => {
    const client = fakeClient('{"ok":true,"exit":0,"output":"hello"}', []);
    const result = await runRun('ZCL_FOO', { method: undefined }, client);
    expect(result.sourceFingerprint).toBeDefined();
    expect(result.sourceFingerprint?.objectName).toBe('ZCL_FOO');
    expect(result.sourceFingerprint?.hasInactiveVersion).toBe(false);
    expect(result.sourceFingerprint?.activeChangedAt).toBeNull();
    expect(result.sourceFingerprint?.activeChangedBy).toBeNull();
    expect(result.sourceFingerprint?.source).toBe('inactive-objects');
    expect(result.sourceFingerprint?.unavailable).toBeUndefined();
  });

  it('flags hasInactiveVersion: true when the feed contains the class', async () => {
    const client = fakeClient('{"ok":true,"exit":0,"output":"hello"}', [
      { object: { 'adtcore:name': 'ZCL_FOO', 'adtcore:uri': '/sap/bc/adt/oo/classes/zcl_foo' },
        'meta:changed_at': '2026-09-18T10:00:00Z',
        'meta:changed_by': 'DEVELOPER' },
    ]);
    const result = await runRun('ZCL_FOO', { method: undefined }, client);
    expect(result.sourceFingerprint?.hasInactiveVersion).toBe(true);
    expect(result.sourceFingerprint?.activeChangedAt).toBe('2026-09-18T10:00:00Z');
    expect(result.sourceFingerprint?.activeChangedBy).toBe('DEVELOPER');
  });

  it('matches by URI suffix when adtcore:name is absent (older SAP releases)', async () => {
    const client = fakeClient('{"ok":true,"exit":0,"output":"hello"}', [
      { object: { 'adtcore:uri': '/path/to/oo/classes/zcl_foo' } },
    ]);
    const result = await runRun('ZCL_FOO', { method: undefined }, client);
    expect(result.sourceFingerprint?.hasInactiveVersion).toBe(true);
  });

  it('surfaces unavailable: true when inactiveObjects throws', async () => {
    const client = {
      runClass: async () => '{"ok":true,"exit":0,"output":"hello"}',
      inactiveObjects: vi.fn(async () => {
        throw new Error('endpoint not deployed');
      }),
    } as unknown as AdtClientWrapper;
    const result = await runRun('ZCL_FOO', { method: undefined }, client);
    expect(result.sourceFingerprint?.unavailable).toBe(true);
    expect(result.sourceFingerprint?.hasInactiveVersion).toBe(false);
  });

  it('uppercases the objectName in the fingerprint', async () => {
    const client = fakeClient('{"ok":true,"exit":0,"output":"hello"}', []);
    const result = await runRun('zcl_foo', { method: undefined }, client);
    expect(result.sourceFingerprint?.objectName).toBe('ZCL_FOO');
  });

  it('runs the fingerprint probe in parallel with the classrun (timing)', async () => {
    // The fingerprint probe is awaited AFTER the run completes, so even
    // when inactiveObjects throws the run output is preserved. This
    // guards against an F-02-style "probe failure masks real output"
    // regression.
    const client = {
      runClass: async () => '{"ok":true,"exit":0,"output":"hello"}',
      inactiveObjects: vi.fn(async () => {
        // Throw AFTER runClass returns to simulate the inactive-objects
        // endpoint being flaky. The run output must still be present.
        throw new Error('transient ICF 503');
      }),
    } as unknown as AdtClientWrapper;
    const result = await runRun('ZCL_FOO', { method: undefined }, client);
    expect(result.output).toContain('hello');
    expect(result.sourceFingerprint?.unavailable).toBe(true);
  });
});