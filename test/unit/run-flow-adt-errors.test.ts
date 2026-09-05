import { describe, expect, it } from 'vitest';
import { runRun } from '../../src/abap_cli/flows/data/run.js';
import { CliError } from '../../src/abap_cli/output/json.js';

// US4 acceptance 4 — errors thrown by AdtClientWrapper._call (TLS/AUTH) pass
// through unchanged; run-flow does not re-map them. This is the boundary
// between transport-layer failures and protocol-layer error envelopes.

describe('run-flow ADT wrapper failures', () => {
  it('lets AUTH_ERROR from the client wrapper pass through', async () => {
    const client = {
      runClass: async () => {
        throw new CliError('AUTH_ERROR', '401 Unauthorized');
      },
    } as never;
    try {
      await runRun('ZCL_FOO', { method: 'x' }, client);
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as CliError).code).toBe('AUTH_ERROR');
    }
  });

  it('lets TLS_ERROR from the client wrapper pass through', async () => {
    const client = {
      runClass: async () => {
        throw new CliError('TLS_ERROR', 'self-signed certificate');
      },
    } as never;
    try {
      await runRun('ZCL_FOO', {}, client);
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as CliError).code).toBe('TLS_ERROR');
    }
  });
});