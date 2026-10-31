import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerInitCommand } from '../../src/abap_cli/commands/init.js';
import { makeProgram, runCommand } from './cli-helper.js';

// Keep keychain out of the tests.
vi.mock('../../src/abap_cli/config/secrets.js', () => ({
  getPassword: vi.fn().mockResolvedValue('pw'),
  storePassword: vi.fn(),
  deletePassword: vi.fn(),
}));

// One existing profile so `--profile dev` resolves.
vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: (name: string) =>
    name === 'dev'
      ? { url: 'https://sap.example.com:44300', client: '100', username: 'DEV', language: 'EN' }
      : null,
  listSystemNames: () => ['dev'],
  upsertSystem: vi.fn(),
  deleteSystem: vi.fn(),
  loadUserConfig: () => ({ systems: {} }),
  saveUserConfig: vi.fn(),
}));

// Network-free ICF deployment check.
vi.mock('../../src/abap_cli/clients/icf-version.js', () => ({
  ICF_SERVICE_VERSION: '1.0.0',
  checkIcfDeployment: vi.fn().mockResolvedValue({ status: 'current', remoteVersion: '1.0.0', expectedVersion: '1.0.0' }),
}));

function readConfig(cwd: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(cwd, '.abap.json'), 'utf-8'));
}

function writeConfig(cwd: string, config: Record<string, unknown>): void {
  fs.writeFileSync(path.join(cwd, '.abap.json'), JSON.stringify(config, null, 2) + '\n');
}

describe('abap init field updates and merge', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'init-fields-'));
  });

  it('updates --tr/--package/--source-dir without --profile and preserves other keys', async () => {
    writeConfig(cwd, { system: 'dev', transport: 'OLD999999', package: 'ZOLD', sourceDir: 'src', extra: 'kept' });
    const program = makeProgram();
    registerInitCommand(program);
    const res = await runCommand(
      program,
      ['init', '--tr', 'NEW900001', '--package', 'ZNEW', '--source-dir', 'src2', '--yes', '--json'],
      { cwd, isTTY: false },
    );
    expect(res.exitCode).toBeUndefined();
    expect(readConfig(cwd)).toMatchObject({
      system: 'dev',
      transport: 'NEW900001',
      package: 'ZNEW',
      sourceDir: 'src2',
      extra: 'kept',
    });
    const data = JSON.parse(res.stdout).data;
    expect(data).toMatchObject({ system: 'dev', transport: 'NEW900001', package: 'ZNEW', sourceDir: 'src2' });
  });

  it('merges a partial update and keeps untouched keys', async () => {
    writeConfig(cwd, { system: 'dev', transport: 'OLD999999', package: 'ZOLD', sourceDir: 'src' });
    const program = makeProgram();
    registerInitCommand(program);
    await runCommand(program, ['init', '--package', 'ZNEW', '--yes', '--json'], { cwd, isTTY: false });
    expect(readConfig(cwd)).toEqual({
      system: 'dev',
      transport: 'OLD999999',
      package: 'ZNEW',
      sourceDir: 'src',
    });
  });

  it('fails with CONFIG_ERROR when no .abap.json exists', async () => {
    const program = makeProgram();
    registerInitCommand(program);
    const res = await runCommand(program, ['init', '--package', 'ZNEW', '--yes', '--json'], { cwd, isTTY: false });
    expect(res.exitCode).toBe(3);
    expect(JSON.parse(res.stderr).error.code).toBe('CONFIG_ERROR');
  });

  it('--profile binds and keeps an existing sourceDir (write path merges)', async () => {
    writeConfig(cwd, { system: 'old', transport: 'OLD999999', package: 'ZOLD', sourceDir: 'src' });
    const program = makeProgram();
    registerInitCommand(program);
    const res = await runCommand(
      program,
      ['init', '--profile', 'dev', '--tr', 'NEW900001', '--package', 'ZNEW', '--yes', '--json'],
      { cwd, isTTY: false },
    );
    expect(res.exitCode).toBeUndefined();
    expect(readConfig(cwd)).toMatchObject({
      system: 'dev',
      transport: 'NEW900001',
      package: 'ZNEW',
      sourceDir: 'src',
    });
  });

  it('--profile with --source-dir writes it', async () => {
    writeConfig(cwd, { system: 'old', transport: 'OLD999999', package: 'ZOLD' });
    const program = makeProgram();
    registerInitCommand(program);
    await runCommand(
      program,
      ['init', '--profile', 'dev', '--package', 'ZNEW', '--source-dir', 'app/src', '--yes', '--json'],
      { cwd, isTTY: false },
    );
    expect(readConfig(cwd)).toMatchObject({ system: 'dev', package: 'ZNEW', sourceDir: 'app/src' });
  });

  it('--profile rebind preserves transport/package/sourceDir when flags are omitted', async () => {
    writeConfig(cwd, { system: 'old', transport: 'OLD999999', package: 'ZOLD', sourceDir: 'src' });
    const program = makeProgram();
    registerInitCommand(program);
    const res = await runCommand(program, ['init', '--profile', 'dev', '--yes', '--json'], { cwd, isTTY: false });
    expect(res.exitCode).toBeUndefined();
    expect(readConfig(cwd)).toEqual({
      system: 'dev',
      transport: 'OLD999999',
      package: 'ZOLD',
      sourceDir: 'src',
    });
  });
});
