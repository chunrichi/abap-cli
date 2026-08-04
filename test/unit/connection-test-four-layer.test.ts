import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerConnectionCommand } from '../../src/abap_cli/commands/connection.js';
import { makeProgram, runCommand } from './cli-helper.js';

// Fake probe — no network access in unit tests.
vi.mock('../../src/abap_cli/clients/probe.js', () => ({
  probeSystem: vi.fn().mockResolvedValue({
    tls: { ok: true, skipped: true },
    auth: { ok: true },
    adt: { ok: true },
    icf: { ok: false, error: { code: 'SAP_ERROR', message: 'Request failed with status code 404' } },
  }),
}));

vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: () => ({ url: 'http://sap.example:50000', client: '001', username: 'dev', language: 'EN' }),
  listSystemNames: () => ['real'],
  upsertSystem: vi.fn(),
  deleteSystem: vi.fn(),
  loadUserConfig: () => ({ systems: {} }),
  saveUserConfig: vi.fn(),
}));

describe('abap connection test (FR-024)', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'systest-'));
  });

  it('returns the four-layer payload with ok/error per layer', async () => {
    const program = makeProgram();
    registerConnectionCommand(program);
    const res = await runCommand(program, ['connection', 'test', 'real', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const parsed = JSON.parse(res.stdout);
    expect(parsed.status).toBe('success');
    for (const layer of ['tls', 'auth', 'adt', 'icf']) {
      expect(parsed.data[layer]).toBeDefined();
      expect(typeof parsed.data[layer].ok).toBe('boolean');
    }
    expect(parsed.data.tls.ok).toBe(true);
    expect(parsed.data.icf.ok).toBe(false);
    expect(parsed.data.icf.error.code).toBe('SAP_ERROR');
  });
});
