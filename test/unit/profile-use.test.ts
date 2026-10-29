import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerProfileCommand } from '../../src/abap_cli/commands/profile.js';
import { makeProgram, runCommand } from './cli-helper.js';

vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: (name: string) =>
    name === 'real'
      ? { url: 'http://sap.example:50000', client: '001', username: 'dev', language: 'EN' }
      : null,
  listSystemNames: () => ['mock', 'real'],
  upsertSystem: vi.fn(),
  deleteSystem: vi.fn(),
  loadUserConfig: () => ({ systems: {} }),
  saveUserConfig: vi.fn(),
}));

describe('abap profile use (021: removed — moved to `abap init --profile`)', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sysuse-'));
  });

  it('`profile use` is no longer a registered subcommand (021: removed)', async () => {
    // The `use` subcommand was removed in 021; its functionality moved to
    // `abap init --profile <name>`. Asserting on the parent help list is
    // sufficient: an accidentally re-added `use` would re-appear here.
    const program = makeProgram();
    registerProfileCommand(program);
    const res = await runCommand(program, ['profile', '--help'], { cwd });
    expect(res.exitCode).not.toBe(1);
    expect(res.stdout).not.toMatch(/\buse\b/);
  });
});