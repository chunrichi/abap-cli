/**
 * Authorization-family `delete` flow (AUTH / SUSC / SUCU / SUSH / SUSO) through
 * the bundled ICF service (`DELETE /auth/<sub>/<name>`).
 *
 * The object's package is read first: `$` local packages stay transport-free,
 * everything else demands `--tr`. The SAP handler owns the type-specific
 * where-used / authorization checks and refuses illegal deletes with an
 * actionable error.
 */
import { IcfClient, type AuthQuery } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import type { AuthTypeSpec } from '../../formats/auth/spec.js';
import type { DeleteOptions, DeleteResult } from './delete.js';
import { authTransportFor, readSidePackage, rethrowAuthIcfError } from './auth-shared.js';

interface AuthDeleteResponse {
  name?: string;
  type?: string;
  action?: string;
  package?: string;
}

export async function runDeleteAuth<TLocal>(spec: AuthTypeSpec<TLocal>, objectName: string, opts: DeleteOptions): Promise<DeleteResult> {
  const name = spec.normalizeName(objectName);
  if (opts.regenerateProfiles && spec.type !== 'SUSO') {
    throw new CliError('VALIDATION_ERROR', '--regenerate-profiles is only valid for SUSO', {
      type: spec.type,
      object: name,
    });
  }

  const icf = await IcfClient.create();
  let probe;
  try {
    probe = await icf.getAuth<Record<string, unknown>>(spec.route, name);
  } catch (error: unknown) {
    rethrowAuthIcfError(spec, error, { action: 'read', objectName: name });
  }
  const packageName = readSidePackage(probe.data);
  const transport = authTransportFor(spec, packageName, opts.tr, 'delete');
  const query: AuthQuery = {
    ...(transport ? { transportRequest: transport } : {}),
    ...(opts.regenerateProfiles ? { regenerateProfiles: true } : {}),
  };

  let resp;
  try {
    resp = await icf.deleteAuth<AuthDeleteResponse>(spec.route, name, query);
  } catch (error: unknown) {
    rethrowAuthIcfError(spec, error, { action: 'delete', objectName: name });
  }
  if (resp.status !== 'success' || !resp.data) {
    throw new CliError((resp.error?.code ?? `${spec.type}_DELETE_FAILED`) as ErrorCode, resp.error?.message ?? `Failed to delete ${spec.type} ${name}`, {
      type: spec.type,
      object: name,
      details: resp.error?.details,
      nextSteps: ['Re-run after fixing the cause above.'],
    });
  }

  return {
    data: {
      object: name,
      type: spec.type,
      ...(packageName ? { packageName } : {}),
      deleted: true,
      ...(transport ? { transport } : {}),
      lockReleased: true,
    },
    human: `Deleted ${spec.type} ${name}`,
  };
}
