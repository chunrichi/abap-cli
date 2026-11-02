/**
 * HTTP (SICF node) delete through the bundled ICF service (`DELETE /http/<name>`).
 *
 * SICF nodes are not ADT objects, so the generic lock → delete → unlock path
 * cannot reach them. The ICF handler resolves the URL node, refuses roots,
 * nodes with children and transportable services, then calls
 * `cl_icf_tree=>delete_node` (after clearing the application customizing rows
 * the API does not remove itself). Only local (`$`-prefixed) packages are
 * deletable — the ICF context cannot record a removal in a transport request,
 * so transaction SICF stays canonical for transported services.
 */
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import type { DeleteOptions, DeleteResult } from './delete.js';

/** SICF node names are ICFNAME (15 characters); a `/`-prefixed input is a URL path. */
const HTTP_NODE_NAME_MAX_LENGTH = 15;

export async function runDeleteHttp(objectName: string, opts: DeleteOptions): Promise<DeleteResult> {
  const name = objectName.trim();
  const isPath = name.startsWith('/');
  if (!name || name.includes(' ') || (!isPath && name.length > HTTP_NODE_NAME_MAX_LENGTH)) {
    throw new CliError(
      'HTTP_SERVICE_INVALID',
      isPath
        ? `HTTP service path must not contain whitespace (got "${objectName}")`
        : `SICF node name must be 1-${HTTP_NODE_NAME_MAX_LENGTH} characters without whitespace (got "${objectName}")`,
      { object: name, type: 'HTTP', example: 'abap delete ZCLI_TC_HTTP --type HTTP --yes' },
    );
  }

  const icf = await IcfClient.create();
  let resp;
  try {
    resp = await icf.deleteHttp<{ name: string; type: string; action: string }>(name);
  } catch (error: unknown) {
    // A 404 SICF answer surfaces as a CliError from the ICF client; keep the
    // generic not-found contract for agents (`OBJECT_NOT_FOUND`, exit 8).
    if (error instanceof CliError && error.code === 'HTTP_OBJECT_NOT_FOUND') {
      throw new CliError('OBJECT_NOT_FOUND', `HTTP ${name} does not exist`, {
        object: name,
        type: 'HTTP',
        nextSteps: ['Verify the SICF node exists in the target system (transaction SICF).'],
      });
    }
    throw error;
  }
  if (resp.status !== 'success' || !resp.data) {
    const rawCode = resp.error?.code;
    // A missing node is the generic not-found error (`OBJECT_NOT_FOUND`, exit 8);
    // every other DELETE rejection carries its own actionable code.
    const code: ErrorCode = rawCode === 'HTTP_OBJECT_NOT_FOUND'
      ? 'OBJECT_NOT_FOUND'
      : ((rawCode ?? 'HTTP_DELETE_FAILED') as ErrorCode);
    throw new CliError(code, resp.error?.message ?? `Failed to delete HTTP ${name}`, {
      object: name,
      type: 'HTTP',
      details: resp.error?.details,
      ...(code === 'OBJECT_NOT_FOUND'
        ? { nextSteps: ['Verify the SICF node exists in the target system (transaction SICF).'] }
        : {}),
    });
  }

  const deletedName = resp.data.name || name;
  return {
    data: {
      object: deletedName,
      type: 'HTTP',
      deleted: true,
      ...(opts.tr ? { transport: opts.tr } : {}),
      lockReleased: true,
    },
    human: `Deleted HTTP ${deletedName}`,
  };
}
