/**
 * F-19 — `abap deploy status` must distinguish a failed probe from a confirmed
 * absence. A timeout / connection error means the answer is UNKNOWN
 * (`installed: null`, `probeFailed: true`), not `installed: false`; only an
 * explicit 404 / not-found establishes "not deployed".
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: { create: async () => ({ get: mockGet }) },
}));

const probeAdtRuntime = vi.fn();
vi.mock('../../src/abap_cli/adc/runtime-probe.js', () => ({
  probeAdtRuntime: (...a: unknown[]) => probeAdtRuntime(...a),
  steampunkDeployHint: () => ['hint'],
}));

const loadConfig = vi.fn();
vi.mock('../../src/abap_cli/config/project-config.js', () => ({
  loadConfig: (...a: unknown[]) => loadConfig(...a),
  readCaCertificate: () => undefined,
}));

import { checkIcfDeployment } from '../../src/abap_cli/clients/icf-version.js';
import { CliError } from '../../src/abap_cli/output/json.js';
import { registerDeployCommand } from '../../src/abap_cli/commands/deploy.js';
import { makeProgram, runCommand } from './cli-helper.js';

describe('checkIcfDeployment — probe failure vs confirmed absence (F-19)', () => {
  beforeEach(() => {
    mockGet.mockReset();
    probeAdtRuntime.mockReset();
  });

  it('404 → not_deployed (positively established), probeFailed unset', async () => {
    mockGet.mockRejectedValueOnce(new CliError('NOT_FOUND', 'not found', { details: { httpStatus: 404 } }));
    const info = await checkIcfDeployment();
    expect(info.status).toBe('not_deployed');
    expect(info.probeFailed).not.toBe(true);
  });

  it('an explicit not-found envelope (no httpStatus) is still a confirmed absence', async () => {
    mockGet.mockRejectedValueOnce(new CliError('OBJECT_NOT_FOUND', 'service node missing'));
    const info = await checkIcfDeployment();
    expect(info.status).toBe('not_deployed');
    expect(info.probeFailed).not.toBe(true);
  });

  it('connection error → unreachable + probeFailed:true (absence NOT confirmed)', async () => {
    mockGet.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const info = await checkIcfDeployment();
    expect(info.status).toBe('unreachable');
    expect(info.probeFailed).toBe(true);
    expect(info.error?.message).toBe('ECONNREFUSED');
  });

  it('timeout → unreachable + probeFailed:true', async () => {
    mockGet.mockRejectedValueOnce(new CliError('TIMEOUT', 'probe timed out'));
    const info = await checkIcfDeployment();
    expect(info.status).toBe('unreachable');
    expect(info.probeFailed).toBe(true);
  });

  it('5xx → unreachable + probeFailed:true (not a false absence)', async () => {
    mockGet.mockRejectedValueOnce(
      new CliError('SAP_ERROR', 'ICF request failed: 503', { details: { httpStatus: 503 } }),
    );
    const info = await checkIcfDeployment();
    expect(info.status).toBe('unreachable');
    expect(info.probeFailed).toBe(true);
  });

  it('200 + version → current, probeFailed unset', async () => {
    mockGet.mockResolvedValueOnce({ status: 'success', data: { version: '0.6.0' } });
    const info = await checkIcfDeployment();
    expect(info.status).toBe('current');
    expect(info.probeFailed).not.toBe(true);
  });
});

describe('abap deploy status — degraded probe signal (F-19)', () => {
  beforeEach(() => {
    mockGet.mockReset();
    probeAdtRuntime.mockReset();
    probeAdtRuntime.mockResolvedValue({ runtime: 'unknown', source: 'none', icfSetupBlocked: false });
    loadConfig.mockReset();
    loadConfig.mockResolvedValue({ systemName: 'dev', sap: { url: 'https://sap.example' } });
  });

  function program() {
    const p = makeProgram();
    registerDeployCommand(p);
    return p;
  }

  it('reports installed:null + probeFailed and keeps the existing data fields', async () => {
    mockGet.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    const res = await runCommand(program(), ['deploy', 'status', '--json']);
    const env = JSON.parse(res.stdout.trim());
    expect(env.data.installed).toBeNull();
    expect(env.data.probeFailed).toBe(true);
    // Back-compat: every pre-existing key stays present.
    expect(env.data).toMatchObject({
      status: 'unreachable',
      remoteVersion: null,
      match: false,
      runtime: 'unknown',
      icfSetupBlocked: false,
    });
    expect(typeof env.data.expectedVersion).toBe('string');
    expect(env.meta.warnings.some((w: { code: string }) => w.code === 'ICF_CHECK_DEGRADED')).toBe(true);
  });

  it('human output states this is a probe failure and does not mean ADT is unavailable', async () => {
    mockGet.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    const res = await runCommand(program(), ['deploy', 'status']);
    expect(res.stdout).toMatch(/probe failure/i);
    expect(res.stdout).toMatch(/does NOT mean/i);
    expect(res.stdout).toMatch(/ADT is unavailable/i);
  });

  it('still reports installed:false only for a confirmed 404', async () => {
    mockGet.mockRejectedValueOnce(new CliError('NOT_FOUND', 'not found', { details: { httpStatus: 404 } }));
    const res = await runCommand(program(), ['deploy', 'status', '--json']);
    const env = JSON.parse(res.stdout.trim());
    expect(env.data.installed).toBe(false);
    expect(env.data.status).toBe('not_deployed');
    expect(env.data.probeFailed).toBe(false);
  });
});
