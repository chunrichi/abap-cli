import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerInitCommand } from '../../src/abap_cli/commands/init.js';
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

describe('abap init non-interactive (FR-006, FR-022, SC-007)', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'init-'));
    upsertSystem.mockClear();
  });

  it('flagless init in non-TTY fails fast with USAGE (exit 2) and no menu', async () => {
    const program = makeProgram();
    registerInitCommand(program);
    const res = await runCommand(program, ['init', '--json'], { cwd, isTTY: false });
    expect(res.exitCode).toBe(2);
    expect(res.stdout).toBe('');
    const parsed = JSON.parse(res.stderr);
    expect(parsed.status).toBe('error');
    expect(parsed.error.code).toBe('USAGE');
    expect(parsed.error.nextSteps.length).toBeGreaterThan(0);
    expect(parsed.error.example).toBeTruthy();
    expect(upsertSystem).not.toHaveBeenCalled();
  });

  it('non-TTY init with full params rejects profile creation (FR-022) and never mutates profiles', async () => {
    const program = makeProgram();
    registerInitCommand(program);
    const res = await runCommand(
      program,
      ['init', '--url', 'http://sap.example:50000', '--username', 'dev', '--password', 'pw', '--json'],
      { cwd, isTTY: false },
    );
    expect(res.exitCode).toBe(7); // VALIDATION_ERROR
    const parsed = JSON.parse(res.stderr);
    expect(parsed.error.code).toBe('VALIDATION_ERROR');
    expect(parsed.error.nextSteps.join(' ')).toContain('abap connection set');
    expect(upsertSystem).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(cwd, '.abap.json'))).toBe(false);
  });
});
