import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerConnectionCommand } from '../../src/abap_cli/commands/connection.js';
import { makeProgram, runCommand } from './cli-helper.js';

// Isolate the user-config store from the real ~/.abap-cli/systems.json.
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

describe('abap connection use (FR-023)', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sysuse-'));
    fs.writeFileSync(
      path.join(cwd, '.abap.json'),
      JSON.stringify({ system: 'mock', transport: 'TRN001', package: 'ZPKG' }, null, 2) + '\n',
    );
  });

  it('switches the workspace system and preserves other fields', async () => {
    const program = makeProgram();
    registerConnectionCommand(program);
    const res = await runCommand(program, ['connection', 'use', 'real', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const parsed = JSON.parse(res.stdout);
    expect(parsed.status).toBe('success');
    expect(parsed.data.system).toBe('real');
    const written = JSON.parse(fs.readFileSync(path.join(cwd, '.abap.json'), 'utf-8'));
    expect(written.system).toBe('real');
    expect(written.transport).toBe('TRN001');
    expect(written.package).toBe('ZPKG');
  });

  it('errors with CONFIG_ERROR (exit 3) for a missing profile', async () => {
    const program = makeProgram();
    registerConnectionCommand(program);
    const res = await runCommand(program, ['connection', 'use', 'ghost', '--json'], { cwd });
    expect(res.exitCode).toBe(3);
    const parsed = JSON.parse(res.stderr);
    expect(parsed.status).toBe('error');
    expect(parsed.error.code).toBe('CONFIG_ERROR');
    expect(parsed.error.nextSteps.length).toBeGreaterThan(0);
  });
});
