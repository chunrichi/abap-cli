/**
 * abap deploy command — commander-level behavior for `--package` default and
 * `--tr` requirement rules.
 *
 * - default `--package` is `$TMP` (local, transport-free)
 * - `--tr` is optional when `--package` is `$TMP`
 * - `--tr` is required when `--package` is anything else → NO_TRANSPORT
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

function program() {
  const p = makeProgram();
  registerDeployCommand(p);
  return p;
}

describe('abap deploy command — --package default and --tr rules', () => {
  beforeEach(() => {
    deployBundled.mockClear();
  });

  it('defaults --package to $TMP and runs without --tr', async () => {
    const res = await runCommand(program(), ['deploy', '--dry-run', '--json']);
    expect(deployBundled).toHaveBeenCalledTimes(1);
    const [, opts] = deployBundled.mock.calls[0]!;
    expect(opts).toMatchObject({ dryRun: true });
  });

  it('omitting --tr with --package $TMP is accepted', async () => {
    const res = await runCommand(program(), ['deploy', '--dry-run', '--package', '$TMP', '--json']);
    expect(deployBundled).toHaveBeenCalledTimes(1);
    expect(stdoutHasError(res.stdout)).toBe(false);
  });

  it('rejects --package ZFOO without --tr with NO_TRANSPORT', async () => {
    const res = await runCommand(program(), ['deploy', '--dry-run', '--package', 'ZFOO', '--json']);
    expect(deployBundled).not.toHaveBeenCalled();
    expect(res.stderr).toMatch(/"code"\s*:\s*"NO_TRANSPORT"/);
    expect(res.exitCode).toBe(7);
  });

  it('accepts --package ZFOO with --tr', async () => {
    const res = await runCommand(program(), ['deploy', '--dry-run', '--package', 'ZFOO', '--tr', 'NDK123456', '--json']);
    expect(deployBundled).toHaveBeenCalledTimes(1);
    const [, opts] = deployBundled.mock.calls[0]!;
    expect(opts.transport).toBe('NDK123456');
    expect(stdoutHasError(res.stdout)).toBe(false);
  });

  // Regression: combining --package $TMP with --tr used to silently use the
  // user-supplied transport, which is exactly how the ICF source update got
  // parked in a transport and the local $TMP object stayed at the old
  // gc_version forever (an "outdated" dead-lock even after re-deploying).
  // Force NO_TRANSPORT instead so the user picks one path.
  it('rejects --package $TMP combined with --tr (ICF dead-lock guard)', async () => {
    const res = await runCommand(program(), ['deploy', '--dry-run', '--package', '$TMP', '--tr', 'NDK123456', '--json']);
    expect(deployBundled).not.toHaveBeenCalled();
    expect(res.stderr).toMatch(/"code"\s*:\s*"NO_TRANSPORT"/);
    expect(res.exitCode).toBe(7);
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
