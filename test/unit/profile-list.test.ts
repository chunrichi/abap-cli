import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerProfileCommand } from '../../src/abap_cli/commands/profile.js';
import { makeProgram, runCommand } from './cli-helper.js';

const profiles: Record<string, Record<string, unknown>> = {
  dev: {
    url: 'https://sap.example.com:44300',
    client: '100',
    username: 'DEV',
    language: 'EN',
    systemVersion: 'S4CORE 106',
    runtime: { tier: 'steampunk', icfSetupBlocked: false, source: 'none', probedAt: '2026-10-31T00:00:00Z' },
  },
  qa: {
    url: 'https://qa.example.com:44300',
    client: '200',
    username: 'QA',
    language: 'DE',
    unsupportedAuth: 'cert',
  },
};

vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: (name: string) => profiles[name] ?? null,
  listSystemNames: () => Object.keys(profiles),
  upsertSystem: vi.fn(),
  deleteSystem: vi.fn(),
  loadUserConfig: () => ({ systems: profiles }),
  saveUserConfig: vi.fn(),
}));

function parse(res: { stdout: string }): { data: { systems: Record<string, unknown>[] } } {
  return JSON.parse(res.stdout);
}

describe('abap profile list', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-list-'));
  });

  it('marks the workspace-bound profile as current and exposes client/language/cache', async () => {
    fs.writeFileSync(path.join(cwd, '.abap.json'), JSON.stringify({ system: 'dev', transport: 'DEVK900001', package: 'ZDEV' }));
    const program = makeProgram();
    registerProfileCommand(program);
    const res = await runCommand(program, ['profile', 'list', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const systems = parse(res).data.systems;
    const dev = systems.find((s) => s.name === 'dev');
    expect(dev).toMatchObject({
      client: '100',
      language: 'EN',
      current: true,
      systemVersion: 'S4CORE 106',
      runtimeTier: 'steampunk',
    });
    const qa = systems.find((s) => s.name === 'qa');
    expect(qa).toMatchObject({ client: '200', language: 'DE', unsupportedAuth: 'cert' });
    expect(qa?.current).toBeUndefined();
  });

  it('omits current when no workspace binding exists', async () => {
    const program = makeProgram();
    registerProfileCommand(program);
    const res = await runCommand(program, ['profile', 'list', '--json'], { cwd });
    const systems = parse(res).data.systems;
    expect(systems.every((s) => s.current === undefined)).toBe(true);
  });
});
