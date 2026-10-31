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

function parseData(res: { stdout: string }): {
  status: string;
  data: Record<string, unknown>;
  meta?: { warnings?: { code: string }[] };
} {
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

  it('normalizes a pasted browser URL to its origin and warns', async () => {
    const program = makeProgram();
    registerProfileCommand(program);
    const res = await runCommand(
      program,
      ['profile', 'add', 'dev', '--url', 'https://sap.example.com:44300/sap/bc/ui2/flp?sap-client=100', '--username', 'DEV', '--json'],
      { cwd },
    );
    expect(res.exitCode).toBeUndefined();
    expect(upsertSystem).toHaveBeenCalledWith('dev', expect.objectContaining({ url: 'https://sap.example.com:44300' }));
    const parsed = parseData(res);
    expect(parsed.data.system).toMatchObject({ url: 'https://sap.example.com:44300' });
    expect(parsed.meta.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'URL_NORMALIZED' })]),
    );
  });

  it('rejects an URL with embedded credentials', async () => {
    const program = makeProgram();
    registerProfileCommand(program);
    const res = await runCommand(
      program,
      ['profile', 'add', 'dev', '--url', 'https://user:secret@sap.example.com', '--username', 'DEV', '--json'],
      { cwd },
    );
    expect(res.exitCode).toBe(2);
    const err = JSON.parse(res.stderr);
    expect(err.error.code).toBe('INVALID_ARGUMENT');
    expect(err.error.message).toContain('embed credentials');
    expect(upsertSystem).not.toHaveBeenCalled();
  });

  it('rejects an invalid profile name before touching the store', async () => {
    const program = makeProgram();
    registerProfileCommand(program);
    const res = await runCommand(
      program,
      ['profile', 'add', 'my profile', '--url', 'http://sap.example:50000', '--username', 'DEV', '--json'],
      { cwd },
    );
    expect(res.exitCode).toBe(2);
    const err = JSON.parse(res.stderr);
    expect(err.error.code).toBe('INVALID_ARGUMENT');
    expect(err.error.message).toContain('Invalid profile name');
    expect(upsertSystem).not.toHaveBeenCalled();
  });

  it('reports the profile as unverified with next steps', async () => {
    const program = makeProgram();
    registerProfileCommand(program);
    const res = await runCommand(
      program,
      ['profile', 'add', 'dev', '--url', 'http://sap.example:50000', '--username', 'DEV', '--json'],
      { cwd },
    );
    const data = parseData(res).data;
    expect(data.verified).toBe(false);
    expect(data.nextSteps).toEqual(['abap profile test dev', 'abap init --profile dev']);
  });

  it('prints a subcommand schema for `profile add --schema`', async () => {
    const program = makeProgram();
    registerProfileCommand(program);
    const res = await runCommand(program, ['profile', 'add', '--schema', '--json'], { cwd });
    const parsed = parseData(res);
    expect(parsed.data.command).toBe('profile add');
    expect(parsed.data.arguments).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'name', required: true })]));
    expect(parsed.data.options).toEqual(expect.arrayContaining([expect.objectContaining({ name: '--url' })]));
  });
});
