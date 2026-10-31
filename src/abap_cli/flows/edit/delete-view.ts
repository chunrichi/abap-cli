/**
 * VIEW delete through the bundled ICF service (`DELETE /ddic/view/<name>`).
 *
 * Views have no ADT delete endpoint, so the ICF handler runs the
 * DDIF-safe path (`RS_DD_DELETE_OBJ` with `no_ask`, after activating an
 * inactive-only version). Transported views are rejected: the ICF context
 * cannot record a removal in a transport request, so SE11 stays canonical.
 */
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { VIEW_NAME_MAX_LENGTH } from '../../formats/view/json.js';
import type { DeleteOptions, DeleteResult } from './delete.js';

export async function runDeleteView(objectName: string, opts: DeleteOptions): Promise<DeleteResult> {
  const name = objectName.trim().toUpperCase();
  if (!name || name.length > VIEW_NAME_MAX_LENGTH) {
    throw new CliError('VIEW_NAME_INVALID', `VIEW name must be 1-${VIEW_NAME_MAX_LENGTH} characters (got "${objectName}")`, {
      object: name,
      type: 'VIEW',
      example: `abap delete ZCLI_TC_DEMO --type VIEW --yes`,
    });
  }

  const icf = await IcfClient.create();
  const probe = await icf.getDdic<{ package?: string }>('view', name);
  if (probe.status !== 'success' || !probe.data) {
    if (probe.error?.code === 'DDIC_OBJECT_NOT_FOUND') {
      throw new CliError('OBJECT_NOT_FOUND', `VIEW ${name} does not exist`, {
        object: name,
        type: 'VIEW',
        nextSteps: ['Verify the view exists in the target system.'],
      });
    }
    throw new CliError((probe.error?.code ?? 'SAP_ERROR') as ErrorCode, probe.error?.message ?? `Failed to read VIEW ${name}`, {
      object: name,
      type: 'VIEW',
    });
  }

  const packageName = probe.data.package;
  const isLocal = (packageName ?? '').trim().toUpperCase() === '$TMP';
  if (!isLocal) {
    throw new CliError('VIEW_DELETE_UNSUPPORTED', `VIEW ${name} is in package ${packageName ?? '?'}; delete transportable views in SE11 so the deletion is recorded in a transport request`, {
      object: name,
      type: 'VIEW',
      details: { object: name, type: 'VIEW', packageName },
      nextSteps: [
        'Open the view in SE11 and delete it there (or use a transport of copies).',
        'Only $TMP views can be deleted through the bundled ICF service.',
      ],
    });
  }

  const resp = await icf.deleteDdic<{ name: string; type: string; action: string }>('view', name);
  if (resp.status !== 'success' || !resp.data) {
    throw new CliError((resp.error?.code ?? 'VIEW_DELETE_FAILED') as ErrorCode, resp.error?.message ?? `Failed to delete VIEW ${name}`, {
      object: name,
      type: 'VIEW',
      details: resp.error?.details,
      nextSteps: ['Re-run after fixing the cause above.'],
    });
  }

  return {
    data: {
      object: name,
      type: 'VIEW',
      ...(packageName ? { packageName } : {}),
      deleted: true,
      ...(opts.tr ? { transport: opts.tr } : {}),
      lockReleased: true,
    },
    human: `Deleted VIEW ${name}`,
  };
}
