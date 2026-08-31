import { IcfClient } from '../clients/icf-client.js';
import { CliError } from '../output/json.js';
import { probeAdtRuntime, type AdtRuntime } from '../adc/runtime-probe.js';

/** Bundled expected version of the zabap_vibe ICF service.
 *  Bumped 0.1.0 → 0.2.0 for DDIC CRUD + textpool support;
 *  bumped 0.2.0 → 0.3.0 for read-only table data query support;
 *  bumped 0.3.0 → 0.4.0 for select rows native-typed values;
 *  bumped 0.4.0 → 0.5.0 for TABL/STRU pull via zcl_abap_vibe_tabl_format,
 *  abap-file-format three-piece layout (main + ddic + settings.json).
 *  Root version check stays backward compatible. */
export const ICF_SERVICE_VERSION = '0.5.0';

export type IcfDeploymentStatus = 'not_deployed' | 'current' | 'outdated' | 'unreachable';

export interface IcfDeploymentInfo {
  status: IcfDeploymentStatus;
  remoteVersion?: string;
  expectedVersion: string;
  error?: { code: string; message: string };
  /** 030: detected ADT runtime tier (steampunk → icfSetupBlocked=true). */
  runtime?: AdtRuntime;
  /** 030: true when system blocks cl_icf_tree (Steampunk whitelist). */
  icfSetupBlocked?: boolean;
}

/**
 * Read the deployed service version from the ICF root endpoint.
 * Returns undefined when the response has no usable version field.
 */
export async function readRemoteVersion(): Promise<string | undefined> {
  const client = await IcfClient.create();
  const resp = await client.get<{ service?: unknown; version?: unknown }>('/');
  if (resp.status !== 'success' || !resp.data) return undefined;
  const v = resp.data.version;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function compareVersions(remote: string, expected: string): 'current' | 'outdated' {
  return remote === expected ? 'current' : 'outdated';
}

/**
 * Probe ICF deployment state (FR-012..FR-015, four states).
 * Never throws: not_deployed / unreachable are reported, not raised.
 *
// When `profileName` is provided, also detects ADT runtime tier
 * (steampunk → icfSetupBlocked=true). The runtime probe runs in parallel
 * with the version probe so latency stays at ~1 round-trip.
 */
export async function checkIcfDeployment(profileName?: string): Promise<IcfDeploymentInfo> {
  const runtimeProbe = profileName ? probeAdtRuntime(profileName).catch(() => undefined) : Promise.resolve(undefined);
  let remoteVersion: string | undefined;
  try {
    remoteVersion = await readRemoteVersion();
  } catch (error) {
    // 404 → not deployed; everything else → unreachable (degraded, non-blocking).
    const httpStatus =
      error instanceof CliError && error.details
        ? (error.details.httpStatus as number | undefined)
        : undefined;
    const runtime = await runtimeProbe;
    if (httpStatus === 404) {
      return {
        status: 'not_deployed',
        expectedVersion: ICF_SERVICE_VERSION,
        ...(runtime ? { runtime: runtime.runtime, icfSetupBlocked: runtime.icfSetupBlocked } : {}),
      };
    }
    const code = error instanceof CliError ? error.code : 'SAP_ERROR';
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'unreachable',
      expectedVersion: ICF_SERVICE_VERSION,
      error: { code, message },
      ...(runtime ? { runtime: runtime.runtime, icfSetupBlocked: runtime.icfSetupBlocked } : {}),
    };
  }
  // 200 without a version → unknown, prompt overwrite rather than crash (edge case).
  if (remoteVersion === undefined) {
    const runtime = await runtimeProbe;
    return {
      status: 'outdated',
      expectedVersion: ICF_SERVICE_VERSION,
      ...(runtime ? { runtime: runtime.runtime, icfSetupBlocked: runtime.icfSetupBlocked } : {}),
    };
  }
  const runtime = await runtimeProbe;
  return {
    status: compareVersions(remoteVersion, ICF_SERVICE_VERSION),
    remoteVersion,
    expectedVersion: ICF_SERVICE_VERSION,
    ...(runtime ? { runtime: runtime.runtime, icfSetupBlocked: runtime.icfSetupBlocked } : {}),
  };
}
