import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import { makeProgram, runCommand } from './cli-helper.js';

import { runDoctorChecks } from '../../src/abap_cli/flows/setup/doctor-checks.js';

// The version env.install must report is the one statically read from the
// package.json this test process is running against.
const { version: pkgVersion } = createRequire(import.meta.url)('../../package.json') as { version: string };

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-'));
}

function writeSystems(dir: string, systems: Record<string, unknown>): string {
  const cliDir = path.join(dir, '.abap-cli');
  fs.mkdirSync(cliDir, { recursive: true });
  const configPath = path.join(cliDir, 'systems.json');
  fs.writeFileSync(configPath, JSON.stringify({ systems }, null, 2) + '\n');
  return configPath;
}

describe('doctor-checks (FR-001..005)', () => {
  let home: string;
  let cwd: string;

  beforeEach(() => {
    home = tmpDir();
    // Isolate the workspace check from any real .abap.json in the repo root.
    cwd = tmpDir();
  });

  it('healthy environment → all items ok and empty nextSteps (FR-001/FR-002)', async () => {
    writeSystems(home, {
      mock: { url: 'http://localhost:8080', client: '100', username: 'MOCKUSER', language: 'EN' },
    });
    // Workspace initialized so the config section is all ok.
    fs.writeFileSync(path.join(cwd, '.abap.json'), JSON.stringify({ system: 'mock' }, null, 2) + '\n');
    const report = await runDoctorChecks({ home, cwd });
    expect(report.environment.every((i) => i.status === 'ok')).toBe(true);
    expect(report.config.every((i) => i.status === 'ok')).toBe(true);
    expect(report.nextSteps).toEqual([]);
  });

  it('uninitialized workspace → config.workspace err + suggestion in nextSteps', async () => {
    writeSystems(home, {
      mock: { url: 'http://localhost:8080', client: '100', username: 'MOCKUSER', language: 'EN' },
    });
    const report = await runDoctorChecks({ home, cwd });
    const item = report.config.find((i) => i.key === 'config.workspace');
    expect(item?.status).toBe('err');
    expect(item?.suggestion).toContain('abap init');
    expect(report.nextSteps).toContain(item?.suggestion);
  });

  it('corrupt systems.json → config item err + suggestion in nextSteps, no throw ', async () => {
    const cliDir = path.join(home, '.abap-cli');
    fs.mkdirSync(cliDir, { recursive: true });
    const configPath = path.join(cliDir, 'systems.json');
    fs.writeFileSync(configPath, '{ not valid json');
    const report = await runDoctorChecks({ home, cwd });
    const env = report.environment.find((i) => i.key === 'env.config');
    expect(env?.status).toBe('err');
    expect(env?.suggestion).toBeTruthy();
    expect(report.nextSteps.length).toBeGreaterThan(0);
  });

  it('invalid profile → config item err ()', async () => {
    writeSystems(home, { bad: { url: 'not-a-url', username: 'x' } });
    const report = await runDoctorChecks({ home, cwd });
    const item = report.config.find((i) => i.key.startsWith('config.profile'));
    expect(item?.status).toBe('err');
  });

  it('--verbose adds per-item detail ()', async () => {
    writeSystems(home, {
      mock: { url: 'http://localhost:8080', client: '100', username: 'MOCKUSER', language: 'EN' },
    });
    const brief = await runDoctorChecks({ home, cwd });
    const verbose = await runDoctorChecks({ home, cwd, verbose: true });
    expect(brief.environment.every((i) => i.detail === undefined)).toBe(true);
    expect(verbose.environment.some((i) => i.detail !== undefined)).toBe(true);
  });

  it('env.install reports the loaded CLI version and install path, and never fails the run (F-20)', async () => {
    writeSystems(home, {
      mock: { url: 'http://localhost:8080', client: '100', username: 'MOCKUSER', language: 'EN' },
    });
    fs.writeFileSync(path.join(cwd, '.abap.json'), JSON.stringify({ system: 'mock' }, null, 2) + '\n');

    const brief = await runDoctorChecks({ home, cwd });
    const verbose = await runDoctorChecks({ home, cwd, verbose: true });

    for (const report of [brief, verbose]) {
      const item = report.environment.find((i) => i.key === 'env.install');
      expect(item).toBeDefined();
      // Diagnostic only: always ok, no suggestion, no nextSteps contribution.
      expect(item?.status).toBe('ok');
      expect(item?.message).toContain(pkgVersion);
      expect(item?.suggestion).toBeUndefined();
      expect(report.nextSteps).toEqual([]);
    }

    // Verbose detail carries the provenance: version, package.json and layout.
    const detail = verbose.environment.find((i) => i.key === 'env.install')?.detail ?? '';
    expect(detail).toContain(pkgVersion);
    expect(detail).toContain('package.json');
    expect(detail).toContain('layout');
    expect(brief.environment.find((i) => i.key === 'env.install')?.detail).toBeUndefined();
  });

  it('finds .abap.json in an ancestor directory when cwd has none', async () => {
    writeSystems(home, {
      mock: { url: 'http://localhost:8080', client: '100', username: 'MOCKUSER', language: 'EN' },
    });
    // Place .abap.json in the parent of cwd; cwd itself has none.
    const child = path.join(cwd, 'pkg', 'sub');
    fs.mkdirSync(child, { recursive: true });
    fs.writeFileSync(path.join(cwd, '.abap.json'), JSON.stringify({ system: 'mock' }, null, 2) + '\n');
    const report = await runDoctorChecks({ home, cwd: child });
    const item = report.config.find((i) => i.key === 'config.active');
    expect(item?.status).toBe('ok');
    expect(report.config.find((i) => i.key === 'config.workspace')).toBeUndefined();
  });

  it('child .abap.json wins over an ancestor .abap.json', async () => {
    writeSystems(home, {
      mock: { url: 'http://localhost:8080', client: '100', username: 'MOCKUSER', language: 'EN' },
      other: { url: 'http://localhost:8081', client: '100', username: 'MOCKUSER', language: 'EN' },
    });
    const child = path.join(cwd, 'pkg');
    fs.mkdirSync(child, { recursive: true });
    fs.writeFileSync(path.join(cwd, '.abap.json'), JSON.stringify({ system: 'mock' }, null, 2) + '\n');
    fs.writeFileSync(path.join(child, '.abap.json'), JSON.stringify({ system: 'other' }, null, 2) + '\n');
    const report = await runDoctorChecks({ home, cwd: child, verbose: true });
    const item = report.config.find((i) => i.key === 'config.active');
    expect(item?.status).toBe('ok');
    expect(item?.detail).toContain('other');
    expect(item?.detail).toContain('.abap.json');
  });
});

describe('abap doctor command ()', () => {
  // Command layer: use doMock so --fix never touches the real home dir, while
  // the unit describe above keeps the real runDoctorChecks implementation.
  const runDoctorChecksMock = vi.fn();
  const applySafeFixesMock = vi.fn(() => ['recreated ~/.abap-cli with 0700 perms']);
  let registerCmd: (p: ReturnType<typeof makeProgram>) => void;

  beforeEach(async () => {
    vi.doMock('../../src/abap_cli/flows/setup/doctor-checks.js', () => ({
      runDoctorChecks: runDoctorChecksMock,
      applySafeFixes: applySafeFixesMock,
    }));
    runDoctorChecksMock.mockResolvedValue({
      environment: [{ key: 'env.node', status: 'ok', message: '' }],
      config: [],
      connection: [],
      nextSteps: [],
    });
    const cmd = await import('../../src/abap_cli/commands/doctor.js');
    registerCmd = cmd.registerDoctorCommand;
  });

  it('--fix without --yes in non-TTY → VALIDATION_ERROR exit 7, zero changes ', async () => {
    const program = makeProgram();
    registerCmd(program);
    const res = await runCommand(program, ['doctor', '--fix', '--json'], {});
    const parsed = JSON.parse(res.stderr);
    expect(parsed.status).toBe('error');
    expect(parsed.error.code).toBe('VALIDATION_ERROR');
    expect(applySafeFixesMock).not.toHaveBeenCalled();
  });

  it('--fix --yes applies only safe fixes and reports fixesApplied ', async () => {
    const program = makeProgram();
    registerCmd(program);
    const res = await runCommand(program, ['doctor', '--fix', '--yes', '--json'], {});
    expect(res.exitCode).toBeUndefined();
    const parsed = JSON.parse(res.stdout);
    expect(parsed.status).toBe('success');
    expect(Array.isArray(parsed.data.fixesApplied)).toBe(true);
    expect(parsed.data.fixesApplied.length).toBeGreaterThan(0);
    expect(applySafeFixesMock).toHaveBeenCalled();
  });
});
