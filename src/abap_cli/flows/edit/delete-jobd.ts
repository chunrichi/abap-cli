/**
 * JOBD (application job definition, SM36) delete through the bundled ICF
 * service (`DELETE /jobd/<name>`).
 *
 * The ICF handler removes the STJR_JOBD_ROOT / STJR_JOBD_TREP rows and the
 * TADIR entry, recording the removal in the request for transportable
 * packages. The object's package is read first so local packages stay
 * transport-free and non-local ones demand --tr.
 */
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { JOB_DEFINITION_NAME_MAX_LENGTH } from '../../formats/jobd/json.js';
import type { DeleteOptions, DeleteResult } from './delete.js';
import { jobdTransportFor } from './jobd-shared.js';

export async function runDeleteJobd(objectName: string, opts: DeleteOptions): Promise<DeleteResult> {
  const name = objectName.trim().toUpperCase();
  if (!name || name.length > JOB_DEFINITION_NAME_MAX_LENGTH) {
    throw new CliError('JOBD_NAME_INVALID', `JOBD name must be 1-${JOB_DEFINITION_NAME_MAX_LENGTH} characters (got "${objectName}")`, {
      object: name,
      type: 'JOBD',
      example: 'abap delete ZCLI_TC_JOBD_DAILY --type JOBD --yes',
    });
  }

  const icf = await IcfClient.create();
  const probe = await icf.getJobd<{ package?: string }>(name);
  if (probe.status !== 'success' || !probe.data) {
    if (probe.error?.code === 'JOBD_NOT_FOUND') {
      throw new CliError('OBJECT_NOT_FOUND', `JOBD ${name} does not exist`, {
        object: name,
        type: 'JOBD',
        nextSteps: ['Verify the job definition exists in the target system (SM36).'],
      });
    }
    throw new CliError((probe.error?.code ?? 'SAP_ERROR') as ErrorCode, probe.error?.message ?? `Failed to read JOBD ${name}`, {
      object: name,
      type: 'JOBD',
    });
  }

  const packageName = probe.data.package;
  const transport = jobdTransportFor(packageName, opts.tr, 'delete');

  const resp = await icf.deleteJobd<{ name: string; action: string }>(name, {
    ...(transport ? { transportRequest: transport } : {}),
  });
  if (resp.status !== 'success' || !resp.data) {
    throw new CliError((resp.error?.code ?? 'JOBD_WRITE_FAILED') as ErrorCode, resp.error?.message ?? `Failed to delete JOBD ${name}`, {
      object: name,
      type: 'JOBD',
      details: resp.error?.details,
      nextSteps: ['Re-run after fixing the cause above.'],
    });
  }

  return {
    data: {
      object: name,
      type: 'JOBD',
      ...(packageName ? { packageName } : {}),
      deleted: true,
      ...(transport ? { transport } : {}),
      lockReleased: true,
    },
    human: `Deleted JOBD ${name}`,
  };
}
