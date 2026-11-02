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

const NROB_NAME_MAX_LENGTH = 20;

export async function runDeleteNrob(objectName: string, opts: DeleteOptions): Promise<DeleteResult> {
  const name = objectName.trim().toUpperCase();
  if (!name || name.length > NROB_NAME_MAX_LENGTH) {
    throw new CliError(
      'NROB_NAME_INVALID',
      `NROB name must be 1-${NROB_NAME_MAX_LENGTH} characters (got "${objectName}")`,
      { object: name, type: 'NROB', example: 'abap delete ZCLI_TC_NROB --type NROB --yes' },
    );
  }

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
