import { describe, expect, it, vi, beforeEach } from 'vitest';

const getSystem = vi.fn();
const upsertSystem = vi.fn();
const loadUserConfig = vi.fn();
vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: (...a: unknown[]) => getSystem(...a),
  upsertSystem: (...a: unknown[]) => upsertSystem(...a),
  loadUserConfig: (...a: unknown[]) => loadUserConfig(...a),
}));

const probeAdtRuntime = vi.fn();
vi.mock('../../src/abap_cli/adc/runtime-probe.js', () => ({
  probeAdtRuntime: (...a: unknown[]) => probeAdtRuntime(...a),
}));

import {
  getOrProbeRuntime,
  readCachedRuntime,
  clearRuntimeCache,
} from '../../src/abap_cli/config/runtime-cache.js';

describe('runtime-cache — 034 ADT runtime cache helpers', () => {
  beforeEach(() => {
    getSystem.mockReset();
    upsertSystem.mockReset();
    loadUserConfig.mockReset();
    probeAdtRuntime.mockReset();
  });

  it('returns undefined when the cache is empty and probe fails', async () => {
    getSystem.mockReturnValue({ url: 'https://x', username: 'u', auth: { method: 'basic' } });
    probeAdtRuntime.mockResolvedValueOnce({
      runtime: 'unknown',
      source: 'none',
      icfSetupBlocked: false,
      error: { code: 'SAP_ERROR', message: 'down' },
    });
    const r = await getOrProbeRuntime('mock');
    expect(r).toBeUndefined();
    expect(upsertSystem).not.toHaveBeenCalled();
  });

  it('probes the network on a cache miss and writes the result back to the profile', async () => {
    const profile = { url: 'https://x', username: 'u', auth: { method: 'basic' } };
    getSystem.mockReturnValue(profile);
    probeAdtRuntime.mockResolvedValueOnce({
      runtime: 'steampunk',
      source: 'discovery',
      icfSetupBlocked: true,
      apiCapabilities: {
        icf: { available: false },
        httpService: { available: true },
        steampunkMarkers: ['steampunk', 'hana.ondemand'],
      },
    });
    const r = await getOrProbeRuntime('btptrial');
    expect(r?.tier).toBe('steampunk');
    expect(r?.icfSetupBlocked).toBe(true);
    expect(r?.apiCapabilities?.httpService.available).toBe(true);
    expect(upsertSystem).toHaveBeenCalledTimes(1);
    const [name, written] = upsertSystem.mock.calls[0];
    expect(name).toBe('btptrial');
    expect((written as { runtime: { tier: string } }).runtime.tier).toBe('steampunk');
  });

  it('reuses the cached runtime without probing (no network)', async () => {
    const cached = {
      tier: 'netweaver750' as const,
      icfSetupBlocked: false,
      source: 'discovery' as const,
      probedAt: '2026-08-25T00:00:00.000Z',
    };
    getSystem.mockReturnValue({ url: 'https://x', username: 'u', auth: { method: 'basic' }, runtime: cached });
    const r = await getOrProbeRuntime('nwh750');
    expect(r).toEqual(cached);
    expect(probeAdtRuntime).not.toHaveBeenCalled();
    expect(upsertSystem).not.toHaveBeenCalled();
  });

  it('force=true bypasses the cache and re-probes', async () => {
    getSystem.mockReturnValue({
      url: 'https://x', username: 'u', auth: { method: 'basic' },
      runtime: { tier: 'unknown', icfSetupBlocked: false, source: 'discovery', probedAt: 'old' },
    });
    probeAdtRuntime.mockResolvedValueOnce({
      runtime: 'netweaver740',
      source: 'discovery',
      icfSetupBlocked: false,
    });
    const r = await getOrProbeRuntime('nwh740', { force: true });
    expect(r?.tier).toBe('netweaver740');
    expect(probeAdtRuntime).toHaveBeenCalledTimes(1);
  });

  it('readCachedRuntime does not probe and returns undefined when absent', () => {
    loadUserConfig.mockReturnValue({ systems: { real: { url: 'x', username: 'u', auth: { method: 'basic' } } } });
    expect(readCachedRuntime('real')).toBeUndefined();
    expect(probeAdtRuntime).not.toHaveBeenCalled();
  });

  it('clearRuntimeCache drops the runtime field without touching other profile fields', () => {
    getSystem.mockReturnValue({
      url: 'https://x', username: 'u', auth: { method: 'basic' },
      runtime: { tier: 'steampunk', icfSetupBlocked: true, source: 'discovery', probedAt: 'now' },
    });
    clearRuntimeCache('btptrial');
    expect(upsertSystem).toHaveBeenCalledTimes(1);
    const [, written] = upsertSystem.mock.calls[0];
    expect((written as { runtime?: unknown }).runtime).toBeUndefined();
  });

  it('clearRuntimeCache is a no-op when there is no cached runtime', () => {
    getSystem.mockReturnValue({ url: 'https://x', username: 'u', auth: { method: 'basic' } });
    clearRuntimeCache('real');
    expect(upsertSystem).not.toHaveBeenCalled();
  });
});