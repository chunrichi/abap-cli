/**
 * Shared helpers for the JOBD (application job definition) flows.
 *
 * JOBD has no ADT resource: create/pull/push/delete all go through the bundled
 * ICF service `/jobd/<name>`. Local ('$'-prefixed) packages are transport-free;
 * anything else must carry an explicit transport request, matching the other
 * ICF write paths (`VIEW`, `SHLP`, `XSLT`).
 */
import { CliError } from '../../output/json.js';
import { isLocalPackageName } from '../../core/transport.js';

/** Normalize and validate the JOBD transport rule from the package name. */
export function jobdTransportFor(
  packageName: string | undefined,
  tr: string | undefined,
  action: 'create' | 'update' | 'delete',
): string | undefined {
  if (isLocalPackageName(packageName)) {
    // Local objects are transport-free: a stray --tr must not reach SAP.
    return undefined;
  }
  const request = (tr ?? '').trim().toUpperCase();
  if (!request) {
    throw new CliError(
      'JOBD_TRANSPORT_REQUIRED',
      `JOBD ${action} in package ${packageName ?? '?'} requires --tr <request>`,
      {
        details: { packageName },
        nextSteps: [
          'Pass --tr <request> to record the change in a transportable request.',
          'Or move the job definition to a local package ($TMP) for scratch work.',
        ],
        example: `abap ${action === 'delete' ? 'delete' : action === 'create' ? 'create' : 'push'} --tr NDK900123`,
      },
    );
  }
  return request;
}
