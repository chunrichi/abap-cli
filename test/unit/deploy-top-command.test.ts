/**
 * Top-level `deploy` command.
 *
 * Validates:
 * - `abap deploy` is registered with the canonical option surface.
 * - `abap deploy status` is registered as a subcommand.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { registerDeployCommand } from '../../src/abap_cli/commands/deploy.js';
import { makeProgram, runCommand } from './cli-helper.js';

const deployBundled = vi.fn(async () => ({
  files: [],
  forced: false,
  dryRun: true,
  icfNode: { status: 'planned' as const },
}));

vi.mock('../../src/abap_cli/flows/edit/deploy.js', () => ({
  deployBundled: (...args: unknown[]) => deployBundled(...args),
}));

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      getConfig: () => ({ sap: { username: 'MOCKUSER' }, transport: 'TRN001', package: '$TMP' }),
      userTransports: async () => ({ workbench: [], customizing: [] }),
    }),
  },
}));

const mockGet = vi.fn();
vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: {
    create: async () => ({ get: mockGet }),
  },
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

function programWithDeploy(): import('commander').Command {
  const p = makeProgram();
  registerDeployCommand(p);
  return p;
}

describe('abap deploy command', () => {
  beforeEach(() => {
    deployBundled.mockClear();
    mockGet.mockReset();
    probeAdtRuntime.mockReset();
    loadConfig.mockReset();
  });

  it('registers `deploy` as a top-level command with a `status` subcommand', () => {
    const p = programWithDeploy();
    const names = p.commands.map((c) => c.name());
    expect(names).toContain('deploy');
    const deploy = p.commands.find((c) => c.name() === 'deploy');
    const subNames = deploy?.commands.map((c) => c.name()) ?? [];
    expect(subNames).toContain('status');
  });

  it('accepts the canonical --package $TMP default without --tr', async () => {
    const res = await runCommand(programWithDeploy(), ['deploy', '--dry-run', '--json']);
    expect(deployBundled).toHaveBeenCalledTimes(1);
    expect(deployBundled.mock.calls[0]![1]).toMatchObject({ dryRun: true });
    expect(stdoutHasError(res.stdout)).toBe(false);
  });

  it('rejects --package ZFOO without --tr (NO_TRANSPORT)', async () => {
    const res = await runCommand(programWithDeploy(), ['deploy', '--dry-run', '--package', 'ZFOO', '--json']);
    expect(deployBundled).not.toHaveBeenCalled();
    expect(res.stderr).toMatch(/"code"\s*:\s*"NO_TRANSPORT"/);
    expect(res.exitCode).toBe(7);
  });

  it('rejects --package $TMP combined with --tr (ICF dead-lock guard)', async () => {
    const res = await runCommand(programWithDeploy(), ['deploy', '--dry-run', '--package', '$TMP', '--tr', 'NDK123456', '--json']);
    expect(deployBundled).not.toHaveBeenCalled();
    expect(res.stderr).toMatch(/"code"\s*:\s*"NO_TRANSPORT"/);
  });

  it('runs `deploy status` through the same action', async () => {
    mockGet.mockResolvedValueOnce({ status: 'success', data: { version: '0.6.0' } });
    probeAdtRuntime.mockResolvedValueOnce({ runtime: 'netweaver750', source: 'informationsystem', icfSetupBlocked: false });
    loadConfig.mockResolvedValueOnce({ systemName: 'btptrial', sap: { url: 'https://btp.example' } });
    const res = await runCommand(programWithDeploy(), ['deploy', 'status', '--json']);
    const parsed = JSON.parse(res.stdout.trim()) as { data?: { installed?: boolean } };
    expect(parsed.data?.installed).toBe(true);
  });
});

function stdoutHasError(stdout: string): boolean {
  if (!stdout) return false;
  try {
    const parsed = JSON.parse(stdout.trim());
    return parsed?.status === 'error';
  } catch {
    return false;
  }
}
