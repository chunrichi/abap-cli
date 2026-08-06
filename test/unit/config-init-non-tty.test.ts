import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerConfigCommand } from '../../src/abap_cli/commands/config.js';
import { makeProgram, runCommand } from './cli-helper.js';

// Keep keychain out of the tests.
vi.mock('../../src/abap_cli/crypto/secrets.js', () => ({
  getPassword: vi.fn().mockResolvedValue(null),
  storePassword: vi.fn(),
  deletePassword: vi.fn(),
}));

const upsertSystem = vi.fn();
vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: () => null,
  listSystemNames: () => [],
  upsertSystem: (...args: unknown[]) => upsertSystem(...args),
  deleteSystem: vi.fn(),
  loadUserConfig: () => ({ systems: {} }),
  saveUserConfig: vi.fn(),
}));

describe('abap config non-interactive (FR-006, FR-022, SC-007)', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'init-'));
    upsertSystem.mockClear();
  });

  it('flagless abap config in non-TTY prints the subcommand help (exit 0) and does not mutate profiles', async () => {
    const program = makeProgram();
    registerConfigCommand(program);
    const res = await runCommand(program, ['config', '--json'], { cwd, isTTY: false });
    expect(res.exitCode).toBeUndefined(); // no process.exit — help returned normally
    expect(res.stdout).toMatch(/Usage: \S* config \[options\] \[command\]/);
    expect(upsertSystem).not.toHaveBeenCalled();
  });

  it('non-TTY abap config with full params rejects profile creation (FR-022) and never mutates profiles', async () => {
    const program = makeProgram();
    registerConfigCommand(program);
    const res = await runCommand(
      program,
      ['config', '--url', 'http://sap.example:50000', '--username', 'dev', '--password', 'pw', '--json'],
      { cwd, isTTY: false },
    );
    expect(res.exitCode).toBe(7); // VALIDATION_ERROR
    const parsed = JSON.parse(res.stderr);
    expect(parsed.error.code).toBe('VALIDATION_ERROR');
    expect(parsed.error.nextSteps.join(' ')).toContain('abap connection add');
    expect(upsertSystem).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(cwd, '.abap.json'))).toBe(false);
  });
});
