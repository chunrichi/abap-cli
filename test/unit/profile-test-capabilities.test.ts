/**
 * Spec 036 T036-007: profile test must expose `data.capabilities.{ttyp,msag,ddls}`
 * + `data.ddlSourceSupported`. This file complements profile-test-four-layer
 * by asserting the *new* shape fields; we mock `probeSystem` to return both
 * the four-layer payload and the capabilities snapshot.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerProfileCommand } from '../../src/abap_cli/commands/profile.js';
import { makeProgram, runCommand } from './cli-helper.js';

const probeSystemMock = vi.fn();

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

describe('abap profile test (036 capabilities surface)', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'systest-cap-'));
    probeSystemMock.mockReset();
    process.exitCode = undefined;
  });
  async function runTest(args: string[]) {
    const program = makeProgram();
    registerProfileCommand(program);
    return runCommand(program, args, { cwd });
  }

  it('returns the per-type capability matrix (ttyp/msag/ddls) + ddlSourceSupported', async () => {
    probeSystemMock.mockResolvedValue({
      tls: { ok: true, skipped: true },
      auth: { ok: true },
      adt: { ok: true },
      icf: { ok: true },
      capabilities: {
        ttyp: { adt: 'ok', icf: 'ok', supported: true },
        msag: { adt: 'ok', icf: 'ok', supported: true },
        ddls: { adt: 'ok', icf: 'absent', supported: true },
      },
      ddlSourceSupported: true,
    });
    const res = await runTest(['profile', 'test', 'real', '--json']);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.data.capabilities).toBeDefined();
    expect(parsed.data.capabilities.ttyp.adt).toBe('ok');
    expect(parsed.data.capabilities.ttyp.icf).toBe('ok');
    expect(parsed.data.capabilities.ttyp.supported).toBe(true);
    expect(parsed.data.capabilities.msag.adt).toBe('ok');
    expect(parsed.data.capabilities.ddls.icf).toBe('absent'); // no ICF fallback on purpose
    expect(parsed.data.capabilities.ddls.supported).toBe(true);
    expect(parsed.data.ddlSourceSupported).toBe(true);
  });

  it('surfaces ddlSourceSupported=false when the kernel is too old', async () => {
    probeSystemMock.mockResolvedValue({
      tls: { ok: true, skipped: true },
      auth: { ok: true },
      adt: { ok: true },
      icf: { ok: true },
      capabilities: {
        ttyp: { adt: 'ok', icf: 'ok', supported: true },
        msag: { adt: 'ok', icf: 'ok', supported: true },
        ddls: { adt: 'absent', icf: 'absent', supported: false },
      },
      ddlSourceSupported: false,
    });
    const res = await runTest(['profile', 'test', 'real', '--json']);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.data.ddlSourceSupported).toBe(false);
    expect(parsed.data.capabilities.ddls.supported).toBe(false);
    expect(parsed.data.capabilities.ddls.adt).toBe('absent');
  });

  it('omits capabilities when neither ADT nor ICF succeeded', async () => {
    probeSystemMock.mockResolvedValue({
      tls: { ok: false, error: { code: 'TLS_ERROR', message: 'x' } },
      auth: { ok: false, skipped: true, error: { code: 'SKIPPED', message: 'skipped' } },
      adt: { ok: false, skipped: true, error: { code: 'SKIPPED', message: 'skipped' } },
      icf: { ok: false, skipped: true, error: { code: 'SKIPPED', message: 'skipped' } },
    });
    const res = await runTest(['profile', 'test', 'real', '--json']);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.data.capabilities).toBeUndefined();
    expect(parsed.data.ddlSourceSupported).toBeUndefined();
  });
});
