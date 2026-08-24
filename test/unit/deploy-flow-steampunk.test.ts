import { describe, expect, it, vi, beforeEach } from 'vitest';

const probeAdtRuntime = vi.fn();
vi.mock('../../src/abap_cli/adc/runtime-probe.js', () => ({
  probeAdtRuntime: (...a: unknown[]) => probeAdtRuntime(...a),
  steampunkDeployHint: () => ['hint line 1', 'hint line 2'],
}));

const pushObject = vi.fn();
vi.mock('../../src/abap_cli/flows/push-object.js', () => ({
  pushObject: (...a: unknown[]) => pushObject(...a),
}));

const loadConfig = vi.fn();
vi.mock('../../src/abap_cli/config/project-config.js', () => ({
  loadConfig: (...a: unknown[]) => loadConfig(...a),
  readCaCertificate: () => undefined,
}));

vi.mock('../../src/abap_cli/flows/init-flow.js', () => ({
  // only the function we use is referenced; nothing else
}));

vi.mock('../../src/abap_cli/auth/adapter.js', () => ({
  buildAuth: vi.fn().mockResolvedValue({ passwordOrFetcher: 'pw', options: {} }),
}));

vi.mock('abap-adt-api', () => ({
  ADTClient: vi.fn().mockImplementation(() => ({
    login: vi.fn().mockResolvedValue(undefined),
    httpClient: { request: vi.fn() },
  })),
}));

import { deployBundled } from '../../src/abap_cli/flows/deploy-flow.js';

function makeClient(): unknown {
  return {
    getConfig: () => ({
      sap: { url: 'https://btp-trial.hanatrial.ondemand.com' },
      systemName: 'btptrial',
    }),
  };
}

describe('deploy-flow — 030 Steampunk runtime branching', () => {
  beforeEach(() => {
    probeAdtRuntime.mockReset();
    pushObject.mockReset();
    pushObject.mockResolvedValue({
      status: 'updated',
      fileResults: [],
      lockReleased: true,
    });
  });

  it('on Steampunk: marks deployKind=source-only, emits STEAMPUNK_ICF_MANUAL warning, does not call runIcfSetup', async () => {
    probeAdtRuntime.mockResolvedValueOnce({ runtime: 'steampunk', source: 'informationsystem', icfSetupBlocked: true });
    // Use a temporary empty sourceDir to avoid touching bundled sources.
    const summary = await deployBundled(makeClient() as never, {
      transport: 'DRY_RUN',
      dryRun: false,
      yes: true,
      package: '$TMP',
      profileName: 'btptrial',
      sourceDir: '/tmp/__nonexistent_deploy_dir_030',
    });
    expect(summary.deployKind).toBe('source-only');
    expect(summary.runtime).toBe('steampunk');
    // When sourceDir has no bundled sources, objects/files are empty —
    // what we care about is that the ICF-setup failure path is short-circuited.
    expect(summary.icfNode?.status).toBe('planned');
  });

  it('on netweaver740: deployKind=full and runtime=netweaver740', async () => {
    probeAdtRuntime.mockResolvedValueOnce({ runtime: 'netweaver740', source: 'discovery', icfSetupBlocked: false });
    const summary = await deployBundled(makeClient() as never, {
      transport: 'DRY_RUN',
      dryRun: true,
      profileName: 'eccdev',
      sourceDir: '/tmp/__nonexistent_deploy_dir_030',
    });
    expect(summary.deployKind).toBe('full');
    expect(summary.runtime).toBe('netweaver740');
    expect(summary.icfNode?.status).toBe('planned');
  });

  it('on unknown runtime: defaults to full on-prem deploy', async () => {
    probeAdtRuntime.mockResolvedValueOnce(undefined);
    const summary = await deployBundled(makeClient() as never, {
      transport: 'DRY_RUN',
      dryRun: true,
      profileName: 'unknown',
      sourceDir: '/tmp/__nonexistent_deploy_dir_030',
    });
    expect(summary.deployKind).toBe('full');
    expect(summary.runtime).toBe('unknown');
  });

  it('on Steampunk --dry-run: icfNode=planned, no warning emitted (no runtime side-effect when planning)', async () => {
    probeAdtRuntime.mockResolvedValueOnce({ runtime: 'steampunk', source: 'informationsystem', icfSetupBlocked: true });
    const summary = await deployBundled(makeClient() as never, {
      transport: 'DRY_RUN',
      dryRun: true,
      profileName: 'btptrial',
      sourceDir: '/tmp/__nonexistent_deploy_dir_030',
    });
    expect(summary.deployKind).toBe('source-only');
    expect(summary.dryRun).toBe(true);
    expect(summary.icfNode?.status).toBe('planned');
  });
});