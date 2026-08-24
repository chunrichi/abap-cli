import { describe, expect, it, vi, beforeEach } from 'vitest';

const getSystem = vi.fn();
vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: (...a: unknown[]) => getSystem(...a),
  listSystemNames: () => [],
  upsertSystem: vi.fn(),
  deleteSystem: vi.fn(),
  loadUserConfig: () => ({ systems: {} }),
  saveUserConfig: vi.fn(),
}));

const getPassword = vi.fn().mockResolvedValue('pw');
vi.mock('../../src/abap_cli/config/secrets.js', () => ({
  getPassword: (...a: unknown[]) => getPassword(...a),
  storePassword: vi.fn(),
  deletePassword: vi.fn(),
}));

vi.mock('../../src/abap_cli/auth/adapter.js', () => ({
  buildAuth: vi.fn().mockResolvedValue({
    passwordOrFetcher: 'pw',
    options: { headers: {} },
  }),
}));

const request = vi.fn();
vi.mock('abap-adt-api', () => ({
  ADTClient: vi.fn().mockImplementation(() => ({
    login: vi.fn().mockResolvedValue(undefined),
    httpClient: { request: (...a: unknown[]) => request(...a) },
  })),
}));

import { probeAdtRuntime, steampunkDeployHint } from '../../src/abap_cli/adc/runtime-probe.js';

function makeAtom(opts: { sapComponent?: string; release?: string; hasIcf?: boolean; body?: string }): string {
  if (opts.body) return opts.body;
  const lines: string[] = ['<?xml version="1.0" encoding="utf-8"?>'];
  lines.push('<service xmlns="http://www.w3.org/2007/app" xmlns:atom="http://www.w3.org/2005/Atom"');
  if (opts.sapComponent) lines.push(`  sap-component="${opts.sapComponent}"`);
  if (opts.release) lines.push(`  sap:rel="${opts.release}"`);
  lines.push('>');
  if (opts.hasIcf) {
    lines.push('  <workspace>');
    lines.push('    <collection href="/sap/bc/adt/icf/sicf" />');
    lines.push('  </workspace>');
  }
  lines.push('</service>');
  return lines.join('\n');
}

describe('probeAdtRuntime — 030 ADT runtime tier detection', () => {
  beforeEach(() => {
    request.mockReset();
    getSystem.mockReset();
    getSystem.mockReturnValue({ url: 'https://sap.example:50000', username: 'dev', client: '001', language: 'EN', auth: { method: 'basic' } });
  });

  it('classifies Steampunk from informationsystem sap-component=BTP', async () => {
    request.mockResolvedValueOnce(makeAtom({ sapComponent: 'SAPBTP', release: 'BTP_2024' }));
    const r = await probeAdtRuntime('btptrial');
    expect(r.runtime).toBe('steampunk');
    expect(r.icfSetupBlocked).toBe(true);
    expect(r.sapComponent).toBe('SAPBTP');
    expect(r.release).toBe('BTP_2024');
    expect(r.source).toBe('informationsystem');
  });

  it('classifies Steampunk from sap-component=ABAPENV (case-insensitive)', async () => {
    request.mockResolvedValueOnce(makeAtom({ sapComponent: 'ABAPENV_CF' }));
    const r = await probeAdtRuntime('btptrial');
    expect(r.runtime).toBe('steampunk');
    expect(r.icfSetupBlocked).toBe(true);
  });

  it('classifies netweaver750 from sap-component=S4CORE', async () => {
    request.mockResolvedValueOnce(makeAtom({ sapComponent: 'S4CORE', release: '756' }));
    const r = await probeAdtRuntime('s4prem');
    expect(r.runtime).toBe('netweaver750');
    expect(r.icfSetupBlocked).toBe(false);
  });

  it('classifies netweaver740 from sap-component=SAP_ABA (classic ECC)', async () => {
    request.mockResolvedValueOnce(makeAtom({ sapComponent: 'SAP_ABA', release: '75' }));
    const r = await probeAdtRuntime('eccdev');
    expect(r.runtime).toBe('netweaver740');
    expect(r.icfSetupBlocked).toBe(false);
  });

  it('falls back to discovery when informationsystem returns unknown sap-component', async () => {
    request.mockResolvedValueOnce(makeAtom({ sapComponent: 'UNKNOWN_PROD' }));
    request.mockResolvedValueOnce(makeAtom({ hasIcf: true }));
    const r = await probeAdtRuntime('eccdev');
    expect(r.runtime).toBe('netweaver750');
    expect(r.source).toBe('discovery');
  });

  it('discovery with no icf collection + BTP markers → steampunk', async () => {
    request.mockResolvedValueOnce(makeAtom({ sapComponent: 'CUSTOM' }));
    request.mockResolvedValueOnce(
      makeAtom({ body: '<?xml version="1.0"?><service sap-component="SAPBTP"><workspace /></service>' }),
    );
    const r = await probeAdtRuntime('btptrial');
    expect(r.runtime).toBe('steampunk');
    expect(r.icfSetupBlocked).toBe(true);
  });

  it('discovery with no icf collection + no markers → netweaver740 fallback', async () => {
    request.mockResolvedValueOnce(makeAtom({ sapComponent: 'CUSTOM' }));
    request.mockResolvedValueOnce(makeAtom({}));
    const r = await probeAdtRuntime('eccdev');
    expect(r.runtime).toBe('netweaver740');
    expect(r.source).toBe('discovery');
  });

  it('returns unknown when both endpoints fail', async () => {
    request.mockRejectedValueOnce(new Error('404 not found'));
    request.mockRejectedValueOnce(new Error('connection reset'));
    const r = await probeAdtRuntime('eccdev');
    expect(r.runtime).toBe('unknown');
    expect(r.source).toBe('none');
    expect(r.error).toBeDefined();
  });

  it('returns error envelope when profile is missing', async () => {
    getSystem.mockReturnValueOnce(undefined);
    const r = await probeAdtRuntime('missing');
    expect(r.runtime).toBe('unknown');
    expect(r.error?.code).toBe('CONFIG_ERROR');
  });
});

describe('steampunkDeployHint — 030 BTP Cockpit destination guide', () => {
  it('includes destination URL trimmed from trailing slashes', () => {
    const lines = steampunkDeployHint('https://btp-trial.hanatrial.ondemand.com/');
    expect(lines.join('\n')).toContain('https://btp-trial.hanatrial.ondemand.com/sap/zabap_vibe');
    expect(lines.join('\n')).toContain('Cloud Foundry');
    expect(lines.join('\n')).toContain('Connectivity → Destinations');
  });

  it('includes curl verification step with /sap/zabap_vibe/ path', () => {
    const lines = steampunkDeployHint('https://trial.example');
    expect(lines.join('\n')).toContain('curl https://trial.example/sap/zabap_vibe/');
  });
});