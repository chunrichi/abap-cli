/**
 * `abap profile show / test / set` on a profile whose stored auth method was
 * removed: show surfaces it, test refuses to connect with a migration hint,
 * and set (the documented migration step) writes a plain basic profile.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerProfileCommand } from '../../src/abap_cli/commands/profile.js';
import { makeProgram, runCommand } from './cli-helper.js';

const systems: Record<string, Record<string, unknown>> = {
  basic: { url: 'http://sap.example:50000', client: '001', username: 'dev', language: 'EN' },
  legacy: {
    url: 'http://sap.example:50000',
    client: '001',
    username: 'dev',
    language: 'EN',
    unsupportedAuth: 'cert',
  },
};

const upsertSystem = vi.fn((name: string, profile: Record<string, unknown>) => {
  systems[name] = { ...profile };
});
const storePassword = vi.fn(async () => '');

vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: (name: string) => systems[name] ?? null,
  listSystemNames: () => Object.keys(systems),
  upsertSystem: (...args: unknown[]) => upsertSystem(...(args as [string, Record<string, unknown>])),
  deleteSystem: vi.fn(),
  loadUserConfig: () => ({ systems }),
  saveUserConfig: vi.fn(),
}));

vi.mock('../../src/abap_cli/config/secrets.js', () => ({
  storePassword: (...args: unknown[]) => storePassword(...(args as [string, string])),
  getPassword: vi.fn(async () => null),
  deletePassword: vi.fn(async () => true),
}));

describe('profile flows with a removed auth method on disk', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-auth-'));
    vi.clearAllMocks();
    systems.legacy = {
      url: 'http://sap.example:50000',
      client: '001',
      username: 'dev',
      language: 'EN',
      unsupportedAuth: 'cert',
    };
  });

  async function runProfile(args: string[]) {
    const program = makeProgram();
    registerProfileCommand(program);
    return runCommand(program, ['profile', ...args, '--json'], { cwd });
  }

  it('show reports the legacy auth method without failing', async () => {
    const res = await runProfile(['show', 'legacy']);
    expect(res.exitCode).toBeUndefined();
    const detail = JSON.parse(res.stdout).data.system;
    expect(detail.unsupportedAuth).toBe('cert');
  });

  it('test refuses to connect with a CONFIG_ERROR migration hint', async () => {
    const res = await runProfile(['test', 'legacy']);
    expect(res.exitCode).toBe(3);
    const err = JSON.parse(res.stderr);
    expect(err.error.code).toBe('CONFIG_ERROR');
    expect(err.error.message).toContain("removed 'cert' auth method");
    expect(err.error.nextSteps.join(' ')).toContain('abap profile set legacy --password');
  });

  it('set --password migrates the entry to a plain basic profile', async () => {
    const res = await runProfile(['set', 'legacy', '--password', 'newpass']);
    expect(res.exitCode).toBeUndefined();
    expect(storePassword).toHaveBeenCalledWith('legacy', 'newpass');
    expect(upsertSystem).toHaveBeenCalled();
    const written = upsertSystem.mock.calls[0]![1];
    expect(written).not.toHaveProperty('unsupportedAuth');
    expect(systems.legacy).not.toHaveProperty('unsupportedAuth');
  });
});
