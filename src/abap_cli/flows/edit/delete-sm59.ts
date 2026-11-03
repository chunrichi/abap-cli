/**
 * SM59 (HTTP destination) delete through the bundled ICF service
 * (`DELETE /sm59/<name>`).
 *
 * The SAP handler removes the RFCDES / RFCDOC rows through the SM59
 * maintenance API. Destinations are client-independent system-table entries:
 * there is no package to read and no transport request to record, so `--tr` is
 * rejected instead of being silently ignored.
 */
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import type { DeleteOptions, DeleteResult } from './delete.js';
import { rejectSm59PackageAndTransport, validateSm59Name } from './sm59-shared.js';

export async function runDeleteSm59(objectName: string, opts: DeleteOptions): Promise<DeleteResult> {
  const name = validateSm59Name(objectName);
  rejectSm59PackageAndTransport({ tr: opts.tr }, 'delete');

  const icf = await IcfClient.create();
  const resp = await icf.deleteSm59<{ name: string; type: string; action: string }>(name);
  if (resp.status !== 'success' || !resp.data) {
    if (resp.error?.code === 'SM59_OBJECT_NOT_FOUND') {
      throw new CliError('OBJECT_NOT_FOUND', `SM59 ${name} does not exist`, {
        object: name,
        type: 'SM59',
        nextSteps: ['Verify the destination exists in the target system (transaction SM59).'],
        example: `abap delete ${name} --type SM59 --yes`,
      });
    }
    if (resp.error?.code === 'SM59_TYPE_NOT_SUPPORTED') {
      throw new CliError(
        'SM59_TYPE_NOT_SUPPORTED',
        resp.error.message ?? `SM59 ${name} is not an HTTP destination (RFCTYPE='G')`,
        {
          object: name,
          type: 'SM59',
          details: resp.error.details,
          nextSteps: ["Only HTTP connections to external server (RFCTYPE=G) can be deleted by this type."],
        },
      );
    }
    throw new CliError((resp.error?.code ?? 'SM59_WRITE_FAILED') as ErrorCode, resp.error?.message ?? `Failed to delete SM59 ${name}`, {
      object: name,
      type: 'SM59',
      details: resp.error?.details,
      nextSteps: ['Re-run after fixing the cause above.'],
    });
  }

  return {
    data: {
      object: name,
      type: 'SM59',
      deleted: true,
      lockReleased: true,
    },
    human: `Deleted SM59 ${name}`,
  };
}
