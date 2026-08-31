import { loadUserConfig, upsertSystem, getSystem, type CachedRuntime, type SystemProfile } from './user-config.js';
import { probeAdtRuntime } from '../adc/runtime-probe.js';

/** 034: helper that fetches (or refreshes) the cached runtime for a profile.
 *
 *  Two modes:
 *   - `force=false` (default): return the cached `runtime` if present, else
 *     probe the network and cache the result. Cache TTL is implicit (last
 *     successful `profile test` or `init`).
 *   - `force=true`: always probe the network and overwrite the cache.
 *
 *  Never throws — runtime probe failures are returned as `tier: 'unknown'`
 *  with `icfSetupBlocked: false`. The caller (deploy-flow) treats 'unknown'
 *  as conservative on-prem fallback.
 */
export async function getOrProbeRuntime(name: string, opts: { force?: boolean } = {}): Promise<CachedRuntime | undefined> {
  if (!opts.force) {
    const cached = getSystem(name)?.runtime;
    if (cached) return cached;
  }
  const fresh = await probeAdtRuntime(name);
  if (!fresh || fresh.source === 'none') return undefined;
  const mapped: CachedRuntime = {
    tier: fresh.runtime,
    icfSetupBlocked: fresh.icfSetupBlocked,
    source: fresh.source,
    ...(fresh.sapComponent ? { sapComponent: fresh.sapComponent } : {}),
    ...(fresh.release ? { release: fresh.release } : {}),
    ...(fresh.apiCapabilities
      ? { apiCapabilities: fresh.apiCapabilities }
      : {}),
    probedAt: new Date().toISOString(),
  };
  // Best-effort write back; ignore failure so the in-memory result still flows.
  try {
    const profile = getSystem(name);
    if (profile) {
      const next: SystemProfile = { ...profile, runtime: mapped };
      upsertSystem(name, next);
    }
  } catch {
    // Cache is an optimisation — disk write failures should not break deploy.
  }
  return mapped;
}

/** 034: drop the runtime cache for a profile (used by `--no-runtime-cache`,
 *  manual `profile reset-runtime`, etc.). No-op when absent. */
export function clearRuntimeCache(name: string): void {
  const profile = getSystem(name);
  if (!profile || !profile.runtime) return;
  const { runtime: _drop, ...rest } = profile;
  upsertSystem(name, rest as SystemProfile);
}

/** 034: minimal load — read only the cached runtime without triggering a probe.
 *  Used by `extension deploy` and `init` when the caller wants the cache hit
 *  only (no network). Returns undefined when there is no cache entry. */
export function readCachedRuntime(name: string): CachedRuntime | undefined {
  return loadUserConfig().systems[name]?.runtime;
}