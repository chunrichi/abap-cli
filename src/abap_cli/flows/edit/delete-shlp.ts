/**
 * SHLP delete through the bundled ICF service (`DELETE /ddic/shlp/<name>`).
 *
 * Shlps have no ADT delete endpoint, so the ICF handler runs the
 * DDIF-safe path (`RS_DD_DELETE_OBJ` with `no_ask`, after activating an
 * inactive-only version). Transported shlps are rejected: the ICF context
 * cannot record a removal in a transport request, so SE11 stays canonical.
 */
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { SHLP_NAME_MAX_LENGTH } from '../../formats/shlp/json.js';
import type { DeleteOptions, DeleteResult } from './delete.js';

export async function runDeleteShlp(objectName: string, opts: DeleteOptions): Promise<DeleteResult> {
  const name = objectName.trim().toUpperCase();
  if (!name || name.length > SHLP_NAME_MAX_LENGTH) {
    throw new CliError('SHLP_NAME_INVALID', `SHLP name must be 1-${SHLP_NAME_MAX_LENGTH} characters (got "${objectName}")`, {
      object: name,
      type: 'SHLP',
      example: `abap delete ZCLI_TC_DEMO --type SHLP --yes`,
    });
  }

  const icf = await IcfClient.create();
  const probe = await icf.getDdic<{ package?: string }>('shlp', name);
  if (probe.status !== 'success' || !probe.data) {
    if (probe.error?.code === 'DDIC_OBJECT_NOT_FOUND') {
      throw new CliError('OBJECT_NOT_FOUND', `SHLP ${name} does not exist`, {
        object: name,
        type: 'SHLP',
        nextSteps: ['Verify the shlp exists in the target system.'],
      });
    }
    throw new CliError((probe.error?.code ?? 'SAP_ERROR') as ErrorCode, probe.error?.message ?? `Failed to read SHLP ${name}`, {
      object: name,
      type: 'SHLP',
    });
  }

  const packageName = probe.data.package;
  const isLocal = (packageName ?? '').trim().toUpperCase() === '$TMP';
  if (!isLocal) {
    throw new CliError('SHLP_DELETE_UNSUPPORTED', `SHLP ${name} is in package ${packageName ?? '?'}; delete transportable shlps in SE11 so the deletion is recorded in a transport request`, {
      object: name,
      type: 'SHLP',
      details: { object: name, type: 'SHLP', packageName },
      nextSteps: [
        'Open the shlp in SE11 and delete it there (or use a transport of copies).',
        'Only $TMP shlps can be deleted through the bundled ICF service.',
      ],
    });
  }

  const resp = await icf.deleteDdic<{ name: string; type: string; action: string }>('shlp', name);
  if (resp.status !== 'success' || !resp.data) {
    throw new CliError((resp.error?.code ?? 'SHLP_DELETE_FAILED') as ErrorCode, resp.error?.message ?? `Failed to delete SHLP ${name}`, {
      object: name,
      type: 'SHLP',
      details: resp.error?.details,
      nextSteps: ['Re-run after fixing the cause above.'],
    });
  }

  return {
    data: {
      object: name,
      type: 'SHLP',
      ...(packageName ? { packageName } : {}),
      deleted: true,
      ...(opts.tr ? { transport: opts.tr } : {}),
      lockReleased: true,
    },
    human: `Deleted SHLP ${name}`,
  };
}
