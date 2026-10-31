import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { makeProgram, runCommand } from './cli-helper.js';
import {
  runDoctorChecks,
  remainingIssues,
  applySafeFixes,
} from '../../src/abap_cli/flows/setup/doctor-checks.js';

/**
 * Machine contract for `abap doctor`:
 *   - `data.ok` is always present and false when any environment/config item errs
 *   - default behaviour stays exit 0 (read-only diagnosis)
 *   - `--strict` turns a not-ok report into CONFIG_ERROR / exit 3 (CI + agent gate)
 *   - `--fix --yes` reports structured `fixed` / `fixesApplied[]` / `remaining[]`,
 *     including the explicit empty `fixesApplied: []` when there was nothing to do
 *   - `nextSteps` collapses overlapping advice (missing systems.json and missing
 *     .abap.json are both repaired by `abap init`)
 */

// Pin the runtime so the suite does not depend on the Node.js of the machine.
const PATCHED_NODE = 'v22.23.4';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-contract-'));
}

function writeSystems(home: string, systems: Record<string, unknown>): void {
  const cliDir = path.join(home, '.abap-cli');
  fs.mkdirSync(cliDir, { recursive: true });
  fs.writeFileSync(path.join(cliDir, 'systems.json'), JSON.stringify({ systems }, null, 2) + '\n');
}

const PROFILE = { url: 'http://localhost:8080', client: '100', username: 'MOCKUSER', language: 'EN' };

function healthyHome(home: string): void {
  writeSystems(home, { mock: PROFILE });
}

describe('doctor report contract', () => {
  let home: string;
  let cwd: string;

  beforeEach(() => {
    home = tmpDir();
    cwd = tmpDir(); // isolated from the repo's .abap.json
  });

  it('ok=false when the config file and the workspace config are both missing, with deduped nextSteps', async () => {
    const report = await runDoctorChecks({ home, cwd, nodeVersion: PATCHED_NODE });

    expect(report.ok).toBe(false);
    expect(report.environment.find((i) => i.key === 'env.config')?.status).toBe('err');
    expect(report.config.find((i) => i.key === 'config.workspace')?.status).toBe('err');

    // Both findings are repaired by `abap init`; the advice must appear once.
    expect(report.nextSteps).toHaveLength(1);
    expect(report.nextSteps[0]).toContain('abap init');
  });

  it('ok=true for a healthy environment and initialized workspace', async () => {
    healthyHome(home);
    fs.writeFileSync(path.join(cwd, '.abap.json'), JSON.stringify({ system: 'mock' }) + '\n');
    const report = await runDoctorChecks({ home, cwd, nodeVersion: PATCHED_NODE });
    expect(report.ok).toBe(true);
    expect(report.nextSteps).toEqual([]);
  });

  it('ok=false when only the workspace config is missing', async () => {
    healthyHome(home);
    const report = await runDoctorChecks({ home, cwd, nodeVersion: PATCHED_NODE });
    expect(report.ok).toBe(false);
    expect(report.config.find((i) => i.key === 'config.workspace')?.status).toBe('err');
    expect(report.config.find((i) => i.key === 'config.active')).toBeUndefined();
    expect(report.nextSteps).toHaveLength(1);
  });

  it('ok=false when an environment check errs', async () => {
    healthyHome(home);
    fs.writeFileSync(path.join(cwd, '.abap.json'), JSON.stringify({ system: 'mock' }) + '\n');
    const report = await runDoctorChecks({ home, cwd, nodeVersion: 'v22.23.3' });
    expect(report.ok).toBe(false);
    expect(report.environment.find((i) => i.key === 'env.node')?.status).toBe('err');
  });

  it('remainingIssues() mirrors every err item with its next step', async () => {
    const report = await runDoctorChecks({ home, cwd, nodeVersion: PATCHED_NODE });
    const remaining = remainingIssues(report);
    expect(remaining.map((r) => r.key)).toEqual(['env.config', 'config.workspace']);
    for (const item of remaining) {
      expect(item.message).toBeTruthy();
      expect(item.nextStep).toContain('abap init');
    }
  });

  it('applySafeFixes() returns structured fixes and is idempotent', () => {
    const first = applySafeFixes(home);
    expect(first).toHaveLength(1);
    expect(first[0]).toEqual({
      id: 'config-dir',
      action: 'Created the CLI config directory with 0700 permissions.',
      target: '~/.abap-cli',
      reversible: true,
    });
    expect(fs.existsSync(path.join(home, '.abap-cli'))).toBe(true);
    expect(applySafeFixes(home)).toEqual([]);
  });
});

describe('abap doctor command contract', () => {
  const runDoctorChecksMock = vi.fn();
  const applySafeFixesMock = vi.fn();
  let registerCmd: (program: ReturnType<typeof makeProgram>) => void;
  let schema: typeof import('../../src/abap_cli/commands/doctor.js').SCHEMA;

  const notOkReport = {
    ok: false,
    environment: [{ key: 'env.config', status: 'err', message: 'Config file not found', suggestion: 'Run "abap init".' }],
    config: [{ key: 'config.workspace', status: 'err', message: 'No workspace config', suggestion: 'Run "abap init".' }],
    nextSteps: ['Run "abap init".'],
  };
  const okReport = {
    ok: true,
    environment: [{ key: 'env.config', status: 'ok', message: '' }],
    config: [{ key: 'config.active', status: 'ok', message: '' }],
    nextSteps: [],
  };

  beforeEach(async () => {
    vi.doMock('../../src/abap_cli/flows/setup/doctor-checks.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/abap_cli/flows/setup/doctor-checks.js')>();
      return { ...actual, runDoctorChecks: runDoctorChecksMock, applySafeFixes: applySafeFixesMock };
    });
    runDoctorChecksMock.mockReset();
    applySafeFixesMock.mockReset();
    const mod = await import('../../src/abap_cli/commands/doctor.js');
    registerCmd = mod.registerDoctorCommand;
    schema = mod.SCHEMA;
  });

  afterEach(() => {
    vi.doUnmock('../../src/abap_cli/flows/setup/doctor-checks.js');
  });

  async function run(args: string[]) {
    const program = makeProgram();
    registerCmd(program);
    return runCommand(program, args, { isTTY: false });
  }

  it('default run reports ok:false but keeps exit 0 (read-only diagnosis)', async () => {
    runDoctorChecksMock.mockResolvedValue(notOkReport);
    const res = await run(['doctor', '--json']);
    expect(res.exitCode).toBeUndefined();
    const parsed = JSON.parse(res.stdout);
    expect(parsed.status).toBe('success');
    expect(parsed.data.ok).toBe(false);
    expect(parsed.data.nextSteps).toEqual(['Run "abap init".']);
    expect(res.stderr).toBe('');
  });

  it('--strict fails with CONFIG_ERROR / exit 3 when ok=false', async () => {
    runDoctorChecksMock.mockResolvedValue(notOkReport);
    const res = await run(['doctor', '--strict', '--json']);
    expect(res.exitCode).toBe(3);
    expect(res.stdout).toBe('');
    const parsed = JSON.parse(res.stderr);
    expect(parsed.status).toBe('error');
    expect(parsed.error.code).toBe('CONFIG_ERROR');
    expect(parsed.error.category).toBe('CONFIG_ERROR');
    expect(parsed.error.details.ok).toBe(false);
    expect(parsed.error.details.issues.map((i: { key: string }) => i.key)).toEqual(['env.config', 'config.workspace']);
    expect(parsed.error.nextSteps).toEqual(['Run "abap init".']);
  });

  it('--strict succeeds (exit 0) when ok=true', async () => {
    runDoctorChecksMock.mockResolvedValue(okReport);
    const res = await run(['doctor', '--strict', '--json']);
    expect(res.exitCode).toBeUndefined();
    expect(JSON.parse(res.stdout).data.ok).toBe(true);
  });

  it('--fix --yes reports structured fixed/fixesApplied/remaining', async () => {
    applySafeFixesMock.mockReturnValue([
      { id: 'config-dir', action: 'Created the CLI config directory with 0700 permissions.', target: '~/.abap-cli', reversible: true },
    ]);
    // Re-diagnosis after the fix still finds the workspace config missing.
    runDoctorChecksMock.mockResolvedValue({
      ok: false,
      environment: [{ key: 'env.config', status: 'ok', message: '' }],
      config: [{ key: 'config.workspace', status: 'err', message: 'No workspace config', suggestion: 'Run "abap init".' }],
      nextSteps: ['Run "abap init".'],
    });
    const res = await run(['doctor', '--fix', '--yes', '--json']);
    expect(res.exitCode).toBeUndefined();
    const data = JSON.parse(res.stdout).data;
    expect(data.fixed).toBe(1);
    expect(data.fixesApplied).toEqual([
      { id: 'config-dir', action: 'Created the CLI config directory with 0700 permissions.', target: '~/.abap-cli', reversible: true },
    ]);
    expect(data.remaining).toEqual([
      { key: 'config.workspace', message: 'No workspace config', nextStep: 'Run "abap init".' },
    ]);
  });

  it('--fix --yes keeps the explicit empty fixesApplied[] and fixed:0 when nothing could be fixed', async () => {
    applySafeFixesMock.mockReturnValue([]);
    runDoctorChecksMock.mockResolvedValue(notOkReport);
    const res = await run(['doctor', '--fix', '--yes', '--json']);
    const data = JSON.parse(res.stdout).data;
    expect(data.fixed).toBe(0);
    expect(data.fixesApplied).toEqual([]);
    expect(data.remaining).toHaveLength(2);
  });

  it('--fix without --yes in non-TTY is still a VALIDATION_ERROR exit 7', async () => {
    const res = await run(['doctor', '--fix', '--json']);
    expect(res.exitCode).toBe(7);
    expect(JSON.parse(res.stderr).error.code).toBe('VALIDATION_ERROR');
    expect(applySafeFixesMock).not.toHaveBeenCalled();
  });

  it('schema declares --strict and the CONFIG_ERROR contract', () => {
    expect(schema.options.map((o) => o.name)).toContain('--strict');
    expect(schema.globalOptions).toContain('--pretty-json');
    expect(schema.errors).toContainEqual({ code: 'CONFIG_ERROR', category: 'CONFIG_ERROR', exitCode: 3 });
  });
});
