import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: {
    create: async () => ({ get: mockGet }),
  },
}));

const probeAdtRuntime = vi.fn();
vi.mock('../../src/abap_cli/adc/runtime-probe.js', () => ({
  probeAdtRuntime: (...a: unknown[]) => probeAdtRuntime(...a),
  steampunkDeployHint: () => ['hint'],
}));

const loadConfig = vi.fn();
vi.mock('../../src/abap_cli/config/project-config.js', () => ({
  loadConfig: (...a: unknown[]) => loadConfig(...a),
  readCaCertificate: () => undefined,
}));

import { Command } from 'commander';
import { registerDeployCommand } from '../../src/abap_cli/commands/deploy.js';
import { CliError } from '../../src/abap_cli/output/json.js';

async function run(args: string[]): Promise<{ data: unknown; exitCode: number | undefined }> {
  const { data, meta, exitCode } = await runWithMeta(args);
  return { data, exitCode };
}

/** Full envelope access — used by tests that need to inspect meta.warnings
 *  (e.g. ICF_OUTDATED_DEADLOCK surfaced when remote gc_version is older
 *  than the bundled one). */
async function runWithMeta(args: string[]): Promise<{ data: unknown; meta: unknown; exitCode: number | undefined }> {
  const program = new Command().option('--json', 'json').exitOverride();
  registerDeployCommand(program);
  const stdoutLines: string[] = [];
  let exitCode: number | undefined;
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...a) => { stdoutLines.push(a.map(String).join(' ')); });
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* swallow */ });
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
    exitCode = code as number;
    throw new Error(`__exit_${code}`);
  });
  try {
    await program.parseAsync(args, { from: 'user' });
  } catch (e) {
    if (e instanceof Error && !e.message.startsWith('__exit_')) throw e;
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
  }
  const jsonLine = stdoutLines.find((l) => l.includes('"status"')) ?? stdoutLines.join('\n');
  // eslint-disable-next-line no-console
  let envelope: unknown;
  try { envelope = JSON.parse(jsonLine); } catch (e) {
    // eslint-disable-next-line no-console
    envelope = null;
  }
  const env = envelope as { data?: unknown; meta?: unknown } | null;
  return { data: env?.data, meta: env?.meta, exitCode };
}

describe('abap deploy status', () => {
  beforeEach(() => {
    probeAdtRuntime.mockReset();
    loadConfig.mockReset();
    loadConfig.mockResolvedValue({ systemName: 'btptrial', sap: { url: 'https://btp.example' } });
  });

  it('returns installed=false when not deployed (404 path)', async () => {
    mockGet.mockReset();
    probeAdtRuntime.mockResolvedValueOnce({ runtime: 'unknown', source: 'none', icfSetupBlocked: false });
    mockGet.mockRejectedValueOnce(new CliError('NOT_FOUND', 'not found', { details: { httpStatus: 404 } }));
    const { data, exitCode } = await run(['deploy', 'status', '--json']);
    // eslint-disable-next-line no-console
    expect(exitCode).toBeUndefined();
    const d = data as { installed: boolean; status: string; runtime: string; icfSetupBlocked: boolean };
    expect(d.installed).toBe(false);
    expect(d.status).toBe('not_deployed');
    expect(d.runtime).toBe('unknown');
    expect(d.icfSetupBlocked).toBe(false);
  });

  it('returns installed=true and match=true when remote version equals expected', async () => {
    mockGet.mockReset();
    probeAdtRuntime.mockResolvedValueOnce({ runtime: 'netweaver750', source: 'informationsystem', icfSetupBlocked: false });
    mockGet.mockResolvedValueOnce({ status: 'success', data: { version: '0.6.0' } });
    const { data } = await run(['deploy', 'status', '--json']);
    const d = data as { installed: boolean; match: boolean; remoteVersion: string; expectedVersion: string; runtime: string };
    expect(d.installed).toBe(true);
    expect(d.match).toBe(true);
    expect(d.remoteVersion).toBe('0.6.0');
    expect(d.runtime).toBe('netweaver750');
  });

  it('returns installed=true but match=false when version differs', async () => {
    mockGet.mockReset();
    probeAdtRuntime.mockResolvedValueOnce({ runtime: 'netweaver740', source: 'discovery', icfSetupBlocked: false });
    mockGet.mockResolvedValueOnce({ status: 'success', data: { version: '0.3.0' } });
    const { data, meta } = await runWithMeta(['deploy', 'status', '--json']);
    const d = data as { installed: boolean; match: boolean; remoteVersion: string };
    expect(d.installed).toBe(true);
    expect(d.match).toBe(false);
    expect(d.remoteVersion).toBe('0.3.0');
    // Outdated status must surface ICF_OUTDATED_DEADLOCK warning with the
    // three-step recovery path (transport list → release → re-deploy) so users
    // stuck in the deadlock get a concrete escape hatch.
    const warnings = (meta as { warnings?: { code: string; nextSteps?: string[]; details?: unknown }[] } | undefined)?.warnings ?? [];
    const deadlock = warnings.find((w) => w.code === 'ICF_OUTDATED_DEADLOCK');
    expect(deadlock).toBeTruthy();
    const details = deadlock?.details as { nextSteps?: string[] } | undefined;
    const steps = details?.nextSteps ?? [];
    expect(steps.some((s) => s.includes('transport list --open'))).toBe(true);
    expect(
      steps.some((s) => /\babap deploy --yes\b/.test(s)),
    ).toBe(true);
  });

  it('returns installed=false on unreachable (non-blocking)', async () => {
    mockGet.mockReset();
    probeAdtRuntime.mockResolvedValueOnce({ runtime: 'unknown', source: 'none', icfSetupBlocked: false });
    mockGet.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const { data } = await run(['deploy', 'status', '--json']);
    const d = data as { installed: boolean; status: string };
    expect(d.installed).toBe(false);
    expect(d.status).toBe('unreachable');
  });

  it('030: surfaces Steampunk runtime + icfSetupBlocked=true on trial', async () => {
    mockGet.mockReset();
    probeAdtRuntime.mockResolvedValueOnce({ runtime: 'steampunk', source: 'informationsystem', icfSetupBlocked: true, sapComponent: 'SAPBTP' });
    mockGet.mockRejectedValueOnce(new CliError('NOT_FOUND', 'not found', { details: { httpStatus: 404 } }));
    const { data } = await run(['deploy', 'status', '--json']);
    const d = data as { runtime: string; icfSetupBlocked: boolean; status: string };
    expect(d.runtime).toBe('steampunk');
    expect(d.icfSetupBlocked).toBe(true);
    expect(d.status).toBe('not_deployed');
  });
});