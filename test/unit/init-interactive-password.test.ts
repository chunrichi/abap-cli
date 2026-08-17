import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerInitCommand } from '../../src/abap_cli/commands/init.js';
import { makeProgram, runCommand } from './cli-helper.js';

const storePassword = vi.fn(async () => '');
const getPassword = vi.fn(async () => null);
vi.mock('../../src/abap_cli/config/secrets.js', () => ({
  storePassword: (...args: unknown[]) => storePassword(...args),
  getPassword: (...args: unknown[]) => getPassword(...args),
  deletePassword: vi.fn(async () => true),
}));

const upsertSystem = vi.fn();
vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: (name: string) =>
    name === 'real'
      ? { url: 'http://sap.example:50000', client: '001', username: 'dev', language: 'EN' }
      : null,
  listSystemNames: () => ['real'],
  upsertSystem: (...args: unknown[]) => upsertSystem(...args),
  deleteSystem: vi.fn(),
  loadUserConfig: () => ({ systems: {} }),
  saveUserConfig: vi.fn(),
}));

// Scripted @clack prompts: select 'real', use stored password, then typed answers.
const selectMock = vi.fn(async () => 'real');
const confirmMock = vi.fn(async () => true);
const passwordMock = vi.fn(async () => 'secret123');
const textMock = vi.fn(async () => '');
vi.mock('@clack/prompts', () => ({
  select: (...args: unknown[]) => selectMock(...args),
  confirm: (...args: unknown[]) => confirmMock(...args),
  password: (...args: unknown[]) => passwordMock(...args),
  text: (...args: unknown[]) => textMock(...args),
  isCancel: (v: unknown) => v === Symbol.for('clack-cancel'),
}));

describe('abap init interactive — stored-password fallback', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'init-int-'));
    vi.clearAllMocks();
    getPassword.mockResolvedValue(null);
  });

  it('when no stored password exists, the typed password is persisted to the keychain', async () => {
    const program = makeProgram();
    registerInitCommand(program);
    const res = await runCommand(program, ['init', 'init', '--json'], { cwd, isTTY: true });
    expect(res.exitCode).toBeUndefined();

    // Asked to use the stored password, found none, typed a new one.
    expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ message: 'Use stored password?' }));
    expect(passwordMock).toHaveBeenCalledWith({ message: 'Password for real' });
    // The fallback-typed password is persisted so later runs find it.
    expect(storePassword).toHaveBeenCalledWith('real', 'secret123');

    const written = JSON.parse(fs.readFileSync(path.join(cwd, '.abap.json'), 'utf-8'));
    expect(written.system).toBe('real');
  });

  it('when a stored password exists, it is used without re-prompting for a password', async () => {
    getPassword.mockResolvedValue('stored-pw');
    const program = makeProgram();
    registerInitCommand(program);
    const res = await runCommand(program, ['init', 'init', '--json'], { cwd, isTTY: true });
    expect(res.exitCode).toBeUndefined();
    expect(passwordMock).not.toHaveBeenCalled();
    expect(storePassword).not.toHaveBeenCalled();
  });
});
