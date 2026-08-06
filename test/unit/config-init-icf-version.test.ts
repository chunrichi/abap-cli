import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerConfigCommand } from '../../src/abap_cli/commands/config.js';
import { makeProgram, runCommand } from './cli-helper.js';

// Keep keychain out of the tests.
vi.mock('../../src/abap_cli/config/secrets.js', () => ({
  getPassword: vi.fn().mockResolvedValue('pw'),
  storePassword: vi.fn(),
  deletePassword: vi.fn(),
}));

const getSystem = vi.fn();
vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: (...a: unknown[]) => getSystem(...a),
  listSystemNames: () => [],
  upsertSystem: vi.fn(),
  deleteSystem: vi.fn(),
  loadUserConfig: () => ({ systems: {} }),
  saveUserConfig: vi.fn(),
}));

// ICF deployment check — control all four states without real HTTP.
const checkIcfDeployment = vi.fn();
vi.mock('../../src/abap_cli/icf/service-version.js', () => ({
  checkIcfDeployment: (...a: unknown[]) => checkIcfDeployment(...a),
  ICF_SERVICE_VERSION: '0.1.0',
}));

describe('abap config ICF deployment check (US4, FR-012..FR-015, SC-004/005)', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'init-icf-'));
    getSystem.mockReturnValue({ url: 'https://sap.example:50000', username: 'dev', client: '001', language: 'EN' });
    checkIcfDeployment.mockReset();
  });

  async function runInitWithIcf(icf: unknown): Promise<{ exitCode?: number; stdout: string }> {
    checkIcfDeployment.mockResolvedValue(icf);
    const program = makeProgram();
    registerConfigCommand(program);
    const res = await runCommand(program, ['config', '--system', 'dev', '--json'], { cwd, isTTY: false });
    return { exitCode: res.exitCode, stdout: res.stdout };
  }

  it('not_deployed → data.icf.status="not_deployed", init succeeds (FR-014)', async () => {
    const { stdout } = await runInitWithIcf({ status: 'not_deployed', expectedVersion: '0.1.0' });
    const parsed = JSON.parse(stdout);
    expect(parsed.status).toBe('success');
    expect(parsed.data.icf.status).toBe('not_deployed');
  });

  it('current → data.icf.status="current" with remote/expected versions (FR-013)', async () => {
    const { stdout } = await runInitWithIcf({ status: 'current', remoteVersion: '0.1.0', expectedVersion: '0.1.0' });
    const parsed = JSON.parse(stdout);
    expect(parsed.status).toBe('success');
    expect(parsed.data.icf.status).toBe('current');
    expect(parsed.data.icf.remoteVersion).toBe('0.1.0');
    expect(parsed.data.icf.expectedVersion).toBe('0.1.0');
  });

  it('outdated → data.icf.status="outdated" with remote/expected, init still succeeds (FR-013)', async () => {
    const { stdout } = await runInitWithIcf({ status: 'outdated', remoteVersion: '0.0.9', expectedVersion: '0.1.0' });
    const parsed = JSON.parse(stdout);
    expect(parsed.status).toBe('success');
    expect(parsed.data.icf.status).toBe('outdated');
    expect(parsed.data.icf.remoteVersion).toBe('0.0.9');
  });

  it('unreachable → degraded warning in meta.warnings, init still succeeds (FR-015, SC-005)', async () => {
    const { stdout } = await runInitWithIcf({
      status: 'unreachable',
      expectedVersion: '0.1.0',
      error: { code: 'SAP_ERROR', message: 'connection refused' },
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.status).toBe('success');
    expect(parsed.data.icf.status).toBe('unreachable');
    const warnings = parsed.meta.warnings ?? [];
    expect(warnings.some((w: { code: string }) => w.code === 'ICF_CHECK_DEGRADED')).toBe(true);
  });
});
