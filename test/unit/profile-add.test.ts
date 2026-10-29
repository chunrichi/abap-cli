import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerProfileCommand } from '../../src/abap_cli/commands/profile.js';
import { makeProgram, runCommand } from './cli-helper.js';

const upsertSystem = vi.fn();
const storePassword = vi.fn(async () => '');
const deletePassword = vi.fn(async () => '');

vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: (name: string) =>
    name === 'existing'
      ? { url: 'http://sap.example:50000', client: '001', username: 'dev', language: 'EN' }
      : null,
  listSystemNames: () => ['existing'],
  upsertSystem: (...args: unknown[]) => upsertSystem(...args),
  deleteSystem: vi.fn(),
  loadUserConfig: () => ({ systems: {} }),
  saveUserConfig: vi.fn(),
}));

vi.mock('../../src/abap_cli/config/secrets.js', () => ({
  storePassword: (...args: unknown[]) => storePassword(...args),
  deletePassword: (...args: unknown[]) => deletePassword(...args),
  getPassword: vi.fn(async () => null),
}));

function parseData(res: { stdout: string }): { status: string; data: Record<string, unknown> } {
  return JSON.parse(res.stdout);
}

describe('abap profile add', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'connadd-'));
    vi.clearAllMocks();
  });

  it('creates a new profile from --url/--username/--client/--language', async () => {
    const program = makeProgram();
    registerProfileCommand(program);
    const res = await runCommand(
      program,
      ['profile', 'add', 'dev', '--url', 'http://sap.example:50000', '--username', 'DEV', '--client', '100', '--language', 'EN', '--json'],
      { cwd },
    );
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res).data;
    expect(data.system).toMatchObject({ name: 'dev', url: 'http://sap.example:50000', username: 'DEV', client: '100' });
    expect(upsertSystem).toHaveBeenCalledWith('dev', expect.objectContaining({ url: 'http://sap.example:50000' }));
  });

  it('stores the password in the keychain when --password is given', async () => {
    const program = makeProgram();
    registerProfileCommand(program);
    const res = await runCommand(
      program,
      ['profile', 'add', 'qa', '--url', 'http://sap.example:50000', '--username', 'QA', '--password', 'secret', '--json'],
      { cwd },
    );
    expect(res.exitCode).toBeUndefined();
    expect(storePassword).toHaveBeenCalledWith('qa', 'secret');
    expect(parseData(res).data.passwordUpdated).toBe(true);
  });

  it('refuses to create a profile that already exists (CONFIG_ERROR)', async () => {
    const program = makeProgram();
    registerProfileCommand(program);
    const res = await runCommand(program, ['profile', 'add', 'existing', '--url', 'http://x', '--username', 'u', '--json'], { cwd });
    expect(res.exitCode).not.toBe(0);
    const err = JSON.parse(res.stderr);
    expect(err.error.code).toBe('CONFIG_ERROR');
    expect(err.error.message).toContain('already exists');
    expect(upsertSystem).not.toHaveBeenCalled();
  });

  it('non-interactive without field options → USAGE error', async () => {
    const program = makeProgram();
    registerProfileCommand(program);
    const res = await runCommand(program, ['profile', 'add', 'dev', '--json'], { cwd });
    expect(res.exitCode).not.toBe(0);
    const err = JSON.parse(res.stderr);
    expect(err.error.code).toBe('USAGE');
    expect(err.error.message).toContain('abap profile add <name> --url');
  });

  it('missing url/username → INVALID_ARGUMENT from validation', async () => {
    const program = makeProgram();
    registerProfileCommand(program);
    const res = await runCommand(program, ['profile', 'add', 'dev', '--client', '100', '--json'], { cwd });
    expect(res.exitCode).not.toBe(0);
    const err = JSON.parse(res.stderr);
    expect(err.error.code).toBe('INVALID_ARGUMENT');
    expect(upsertSystem).not.toHaveBeenCalled();
  });
});
