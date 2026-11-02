/**
 * NROB delete through the bundled ICF service (`DELETE /ddic/nrob/<name>`).
 *
 * Number range objects have no ADT delete endpoint; the ICF handler removes
 * the intervals and calls `NUMBER_RANGE_OBJECT_DELETE`. Only `$`-prefixed
 * local objects are accepted — the ICF context cannot record a removal in a
 * transport request.
 */
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import type { DeleteOptions, DeleteResult } from './delete.js';
import { normalizeNrobName } from './object-name.js';

export async function runDeleteNrob(objectName: string, opts: DeleteOptions): Promise<DeleteResult> {
  // Same TNRO-NROBJ length gate as create; a longer name would silently
  // truncate SAP-side and delete the wrong (or no) object.
  const name = normalizeNrobName(objectName);

  const icf = await IcfClient.create();
  const resp = await icf.deleteDdic<{ name: string; type: string; action: string }>('nrob', name);
  if (resp.status !== 'success' || !resp.data) {
    const code = (resp.error?.code === 'DDIC_OBJECT_NOT_FOUND'
      ? 'OBJECT_NOT_FOUND'
      : resp.error?.code ?? 'NROB_DELETE_FAILED') as ErrorCode;
    throw new CliError(code, resp.error?.message ?? `Failed to delete NROB ${name}`, {
      object: name,
      type: 'NROB',
      details: resp.error?.details,
    });
  }

  return {
    data: {
      object: name,
      type: 'NROB',
      deleted: true,
      ...(opts.tr ? { transport: opts.tr } : {}),
      lockReleased: true,
    },
    human: `Deleted NROB ${name}`,
  };
}
