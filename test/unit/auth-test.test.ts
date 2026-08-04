import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { registerAuthCommand } from '../../src/abap_cli/commands/auth.js';
import { makeProgram, runCommand } from './cli-helper.js';

const probeSystemMock = vi.fn();

// Fake probe — no network access in unit tests; each test sets the resolved value.
vi.mock('../../src/abap_cli/clients/probe.js', () => ({
  probeSystem: (...args: unknown[]) => probeSystemMock(...args),
}));

vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: () => null,
  listSystemNames: () => ['mock'],
  loadUserConfig: () => ({ systems: {} }),
  saveUserConfig: vi.fn(),
  upsertSystem: vi.fn(),
  deleteSystem: vi.fn(),
}));

const ALL_OK = {
  tls: { ok: true, skipped: true },
  auth: { ok: true },
  adt: { ok: true },
  icf: { ok: true },
};

describe('abap auth test (FR-006..010)', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(process.cwd(), 'tmp', 'authtest-'));
    probeSystemMock.mockReset();
    process.exitCode = undefined;
  });

  /** Run and return the result plus the command-set process.exitCode (FR-008). */
  async function runAuth(args: string[], isTTY = false) {
    const program = makeProgram();
    registerAuthCommand(program);
    const res = await runCommand(program, args, { cwd, isTTY });
    return { ...res, exitCode: res.exitCode ?? process.exitCode };
  }

  it('healthy system → exactly tls/auth/adt/icf all ok, exit 0 (FR-006, SC-003)', async () => {
    probeSystemMock.mockResolvedValue(ALL_OK);
    const res = await runAuth(['auth', 'test', '--system', 'mock', '--json']);
    expect(res.exitCode).toBeUndefined();
    const parsed = JSON.parse(res.stdout);
    expect(parsed.status).toBe('success');
    expect(Object.keys(parsed.data).sort()).toEqual(['adt', 'auth', 'icf', 'tls']);
    for (const layer of ['tls', 'auth', 'adt', 'icf']) {
      expect(parsed.data[layer].ok).toBe(true);
    }
    expect(probeSystemMock).toHaveBeenCalledWith('mock');
  });

  it('auth failure → auth err with credential nextSteps, adt/icf skipped, exit 5 (FR-007/FR-008, SC-003)', async () => {
    probeSystemMock.mockResolvedValue({
      tls: { ok: true, skipped: true },
      auth: {
        ok: false,
        error: { code: 'AUTH_ERROR', message: '401 Unauthorized' },
        nextSteps: ['abap system set mock --password <new>'],
      },
      adt: { ok: false, skipped: true, error: { code: 'SKIPPED', message: 'Skipped because a prerequisite layer failed.' } },
      icf: { ok: false, skipped: true, error: { code: 'SKIPPED', message: 'Skipped because a prerequisite layer failed.' } },
    });
    const res = await runAuth(['auth', 'test', '--system', 'mock', '--json']);
    expect(res.exitCode).toBe(5);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.status).toBe('success');
    expect(parsed.data.auth.ok).toBe(false);
    expect(parsed.data.auth.error.code).toBe('AUTH_ERROR');
    expect(parsed.data.auth.nextSteps.length).toBeGreaterThan(0);
    expect(parsed.data.adt.skipped).toBe(true);
    expect(parsed.data.icf.skipped).toBe(true);
  });

  it('TLS failure → tls err with TLS nextSteps, other layers still reported, exit 4 (FR-008, SC-003)', async () => {
    probeSystemMock.mockResolvedValue({
      tls: {
        ok: false,
        error: { code: 'TLS_ERROR', message: 'self-signed certificate' },
        nextSteps: ['abap system set mock --ca <pem> or --insecure'],
      },
      auth: { ok: false, skipped: true, error: { code: 'SKIPPED', message: 'Skipped because a prerequisite layer failed.' } },
      adt: { ok: false, skipped: true, error: { code: 'SKIPPED', message: 'Skipped because a prerequisite layer failed.' } },
      icf: { ok: false, skipped: true, error: { code: 'SKIPPED', message: 'Skipped because a prerequisite layer failed.' } },
    });
    const res = await runAuth(['auth', 'test', '--system', 'mock', '--json']);
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

  it('icf failure → icf err reported, exit 6 (FR-008)', async () => {
    probeSystemMock.mockResolvedValue({
      tls: { ok: true, skipped: true },
      auth: { ok: true },
      adt: { ok: true },
      icf: { ok: false, error: { code: 'SAP_ERROR', message: 'Request failed with status code 500' } },
    });
    const res = await runAuth(['auth', 'test', '--system', 'mock', '--json']);
    expect(res.exitCode).toBe(6);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.data.icf.ok).toBe(false);
    expect(parsed.data.icf.error.code).toBe('SAP_ERROR');
  });

  it('unknown system → CONFIG_ERROR exit 3 with nextSteps (FR-009)', async () => {
    probeSystemMock.mockRejectedValue(
      new (await import('../../src/abap_cli/output/json.js')).CliError('CONFIG_ERROR', "System profile 'nope' not found.", {
        nextSteps: ["Run 'abap system set nope ...' to create the profile."],
      }),
    );
    const res = await runAuth(['auth', 'test', '--system', 'nope', '--json']);
    expect(res.exitCode).toBe(3);
    const parsed = JSON.parse(res.stderr);
    expect(parsed.status).toBe('error');
    expect(parsed.error.code).toBe('CONFIG_ERROR');
  });

  it('--verbose passes through and output still honors --json (FR-010)', async () => {
    probeSystemMock.mockResolvedValue(ALL_OK);
    const res = await runAuth(['auth', 'test', '--system', 'mock', '--verbose', '--json']);
    expect(res.exitCode).toBeUndefined();
    const parsed = JSON.parse(res.stdout);
    expect(parsed.status).toBe('success');
  });

  it('missing --system → USAGE error (FR-006)', async () => {
    const res = await runAuth(['auth', 'test', '--json']);
    expect(res.exitCode).toBe(2);
  });
});
