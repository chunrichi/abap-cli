import { IcfClient } from '../clients/icf-client.js';
import { CliError } from '../output/json.js';

/** Bundled expected version of the zabap_vibe ICF service (FR-013).
 *  Bumped 0.1.0 → 0.2.0 in 014 (DDIC CRUD + textpool support);
 *  bumped 0.2.0 → 0.3.0 in 016 (read-only table data query support);
 *  FR-027: root version check stays backward compatible. */
export const ICF_SERVICE_VERSION = '0.3.0';

export type IcfDeploymentStatus = 'not_deployed' | 'current' | 'outdated' | 'unreachable';

export interface IcfDeploymentInfo {
  status: IcfDeploymentStatus;
  remoteVersion?: string;
  expectedVersion: string;
  error?: { code: string; message: string };
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
 */
export async function checkIcfDeployment(): Promise<IcfDeploymentInfo> {
  let remoteVersion: string | undefined;
  try {
    remoteVersion = await readRemoteVersion();
  } catch (error) {
    // 404 → not deployed; everything else → unreachable (degraded, non-blocking).
    const httpStatus =
      error instanceof CliError && error.details
        ? (error.details.httpStatus as number | undefined)
        : undefined;
    if (httpStatus === 404) {
      return { status: 'not_deployed', expectedVersion: ICF_SERVICE_VERSION };
    }
    const code = error instanceof CliError ? error.code : 'SAP_ERROR';
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'unreachable', expectedVersion: ICF_SERVICE_VERSION, error: { code, message } };
  }
  // 200 without a version → unknown, prompt overwrite rather than crash (edge case).
  if (remoteVersion === undefined) {
    return { status: 'outdated', expectedVersion: ICF_SERVICE_VERSION };
  }
  return {
    status: compareVersions(remoteVersion, ICF_SERVICE_VERSION),
    remoteVersion,
    expectedVersion: ICF_SERVICE_VERSION,
  };
}
