/**
 * ENQU delete through the bundled ICF service (`DELETE /ddic/enqu/<name>`).
 *
 * Lock objects have no ADT delete endpoint; the ICF handler runs
 * `DDIF_ENQU_ACTIVATE` + `RS_DD_DELETE_OBJ` (objtype `L`). Only `$`-prefixed
 * local objects are accepted — the ICF context cannot record a removal in a
 * transport request.
 */
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import type { DeleteOptions, DeleteResult } from './delete.js';

const ENQU_NAME_MAX_LENGTH = 16;

export async function runDeleteEnqu(objectName: string, opts: DeleteOptions): Promise<DeleteResult> {
  const name = objectName.trim().toUpperCase();
  if (!name || name.length > ENQU_NAME_MAX_LENGTH) {
    throw new CliError(
      'ENQU_NAME_INVALID',
      `ENQU name must be 1-${ENQU_NAME_MAX_LENGTH} characters (got "${objectName}")`,
      { object: name, type: 'ENQU', example: 'abap delete ZCLI_TC_ENQU --type ENQU --yes' },
    );
  }

  const icf = await IcfClient.create();
  const resp = await icf.deleteDdic<{ name: string; type: string; action: string }>('enqu', name);
  if (resp.status !== 'success' || !resp.data) {
    const code = (resp.error?.code === 'DDIC_OBJECT_NOT_FOUND'
      ? 'OBJECT_NOT_FOUND'
      : resp.error?.code ?? 'ENQU_DELETE_FAILED') as ErrorCode;
    throw new CliError(code, resp.error?.message ?? `Failed to delete ENQU ${name}`, {
      object: name,
      type: 'ENQU',
      details: resp.error?.details,
    });
  }

  return {
    data: {
      object: name,
      type: 'ENQU',
      deleted: true,
      ...(opts.tr ? { transport: opts.tr } : {}),
      lockReleased: true,
    },
    human: `Deleted ENQU ${name}`,
  };
}
