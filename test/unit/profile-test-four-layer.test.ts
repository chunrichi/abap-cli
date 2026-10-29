import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerProfileCommand } from '../../src/abap_cli/commands/profile.js';
import { makeProgram, runCommand } from './cli-helper.js';

const probeSystemMock = vi.fn();

// Fake probe — no network access in unit tests; each test sets the resolved value.
vi.mock('../../src/abap_cli/clients/probe.js', () => ({
  probeSystem: (...args: unknown[]) => probeSystemMock(...args),
}));

vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: () => ({ url: 'http://sap.example:50000', client: '001', username: 'dev', language: 'EN' }),
  listSystemNames: () => ['real'],
  upsertSystem: vi.fn(),
  deleteSystem: vi.fn(),
  loadUserConfig: () => ({ systems: {} }),
  saveUserConfig: vi.fn(),
}));

const ALL_OK = {
  tls: { ok: true, skipped: true },
  auth: { ok: true },
  adt: { ok: true },
  icf: { ok: true },
};

const SKIPPED = (): { ok: boolean; skipped: true; error: { code: string; message: string } } => ({
  ok: false,
  skipped: true,
  error: { code: 'SKIPPED', message: 'Skipped because a prerequisite layer failed.' },
});

describe('abap profile test (FR-024 exit codes)', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'systest-'));
    probeSystemMock.mockReset();
    process.exitCode = undefined;
  });

  /** Run and return the result plus the command-set process.exitCode (). */
  async function runTest(args: string[]) {
    const program = makeProgram();
    registerProfileCommand(program);
    const res = await runCommand(program, args, { cwd });
    return { ...res, exitCode: res.exitCode ?? process.exitCode };
  }

  it('returns the four-layer payload with ok/error per layer, exit 0 when healthy', async () => {
    probeSystemMock.mockResolvedValue(ALL_OK);
    const res = await runTest(['profile', 'test', 'real', '--json']);
    expect(res.exitCode).toBeUndefined();
    const parsed = JSON.parse(res.stdout);
    expect(parsed.status).toBe('success');
    for (const layer of ['tls', 'auth', 'adt', 'icf']) {
      expect(parsed.data[layer]).toBeDefined();
      expect(typeof parsed.data[layer].ok).toBe('boolean');
      expect(parsed.data[layer].ok).toBe(true);
    }
    expect(probeSystemMock).toHaveBeenCalledWith('real');
  });

  it('auth failure → auth err with nextSteps, adt/icf skipped, exit 5 ()', async () => {
    probeSystemMock.mockResolvedValue({
      tls: { ok: true, skipped: true },
      auth: {
        ok: false,
        error: { code: 'AUTH_ERROR', message: '401 Unauthorized' },
        nextSteps: ['abap profile set real --password <new>'],
      },
      adt: SKIPPED(),
      icf: SKIPPED(),
    });
    const res = await runTest(['profile', 'test', 'real', '--json']);
    expect(res.exitCode).toBe(5);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.status).toBe('success');
    expect(parsed.data.auth.ok).toBe(false);
    expect(parsed.data.auth.error.code).toBe('AUTH_ERROR');
    expect(parsed.data.auth.nextSteps.length).toBeGreaterThan(0);
    expect(parsed.data.adt.skipped).toBe(true);
    expect(parsed.data.icf.skipped).toBe(true);
  });

  it('TLS failure → tls err, remaining layers still reported, exit 4 ()', async () => {
    probeSystemMock.mockResolvedValue({
      tls: {
        ok: false,
        error: { code: 'TLS_ERROR', message: 'self-signed certificate' },
        nextSteps: ['abap profile set real --ca <pem> or --insecure'],
      },
      auth: SKIPPED(),
      adt: SKIPPED(),
      icf: SKIPPED(),
    });
    const res = await runTest(['profile', 'test', 'real', '--json']);
    expect(res.exitCode).toBe(4);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.data.tls.ok).toBe(false);
    expect(parsed.data.tls.error.code).toBe('TLS_ERROR');
    expect(parsed.data.tls.nextSteps.length).toBeGreaterThan(0);
    // Remaining layers still present (partial results, not a crash).
    for (const layer of ['auth', 'adt', 'icf']) {
      expect(parsed.data[layer]).toBeDefined();
    }
  });

  it('icf failure → icf err reported, exit 6 ()', async () => {
    probeSystemMock.mockResolvedValue({
      tls: { ok: true, skipped: true },
      auth: { ok: true },
      adt: { ok: true },
      icf: { ok: false, error: { code: 'SAP_ERROR', message: 'Request failed with status code 404' } },
    });
    const res = await runTest(['profile', 'test', 'real', '--json']);
    expect(res.exitCode).toBe(6);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.data.icf.ok).toBe(false);
    expect(parsed.data.icf.error.code).toBe('SAP_ERROR');
  });

  it('unknown system → CONFIG_ERROR exit 3 with nextSteps', async () => {
    probeSystemMock.mockRejectedValue(
      new (await import('../../src/abap_cli/output/json.js')).CliError('CONFIG_ERROR', "Connection profile 'nope' not found.", {
        nextSteps: ["Run 'abap profile set nope ...' to create the profile."],
      }),
    );
    const res = await runTest(['profile', 'test', 'nope', '--json']);
    expect(res.exitCode).toBe(3);
    const parsed = JSON.parse(res.stderr);
    expect(parsed.status).toBe('error');
    expect(parsed.error.code).toBe('CONFIG_ERROR');
  });
});
