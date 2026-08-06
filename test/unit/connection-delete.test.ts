import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerConnectionCommand } from '../../src/abap_cli/commands/connection.js';
import { makeProgram, runCommand } from './cli-helper.js';

const deleteSystem = vi.fn();
const deletePassword = vi.fn(async () => '');

vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: (name: string) =>
    name === 'existing'
      ? { url: 'http://sap.example:50000', client: '001', username: 'dev', language: 'EN' }
      : null,
  listSystemNames: () => ['existing'],
  upsertSystem: vi.fn(),
  deleteSystem: (...args: unknown[]) => deleteSystem(...args),
  loadUserConfig: () => ({ systems: {} }),
  saveUserConfig: vi.fn(),
}));

vi.mock('../../src/abap_cli/config/secrets.js', () => ({
  storePassword: vi.fn(async () => ''),
  deletePassword: (...args: unknown[]) => deletePassword(...args),
  getPassword: vi.fn(async () => null),
}));

describe('abap connection delete', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'conndel-'));
    vi.clearAllMocks();
  });

  it('non-interactive delete without --yes fails with VALIDATION_ERROR', async () => {
    const program = makeProgram();
    registerConnectionCommand(program);
    const res = await runCommand(program, ['connection', 'delete', 'existing', '--json'], { cwd });
    const err = JSON.parse(res.stderr);
    expect(err.error.code).toBe('VALIDATION_ERROR');
    expect(deleteSystem).not.toHaveBeenCalled();
  });

  it('non-interactive delete with --yes deletes the profile and password', async () => {
    const program = makeProgram();
    registerConnectionCommand(program);
    const res = await runCommand(program, ['connection', 'delete', 'existing', '--yes', '--json'], { cwd });
    const data = JSON.parse(res.stdout).data;
    expect(res.exitCode).toBeUndefined();
    expect(data).toMatchObject({ deleted: 'existing', passwordCleaned: true });
    expect(deleteSystem).toHaveBeenCalledWith('existing');
    expect(deletePassword).toHaveBeenCalledWith('existing');
  });

  it('deleting an unknown profile fails with CONFIG_ERROR', async () => {
    const program = makeProgram();
    registerConnectionCommand(program);
    const res = await runCommand(program, ['connection', 'delete', 'nope', '--yes', '--json'], { cwd });
    const err = JSON.parse(res.stderr);
    expect(err.error.code).toBe('CONFIG_ERROR');
    expect(deleteSystem).not.toHaveBeenCalled();
  });
});
