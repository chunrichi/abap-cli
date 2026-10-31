/**
 * DEVC (package) delete flow.
 *
 * Packages differ from every other ADT object in the delete contract:
 *   - no lock/unlock cycle — `DELETE /sap/bc/adt/packages/<name>` must run on
 *     an *unlocked* package; passing a lock handle is rejected with
 *     "package is locked" (verified on S/4HANA);
 *   - transportability is decided by the package's software component: LOCAL
 *     packages are never transported, everything else needs `--tr`.
 *
 * The package is read first so the transport rule can be applied before the
 * destructive request and so a missing package surfaces as OBJECT_NOT_FOUND.
 */
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError } from '../../output/json.js';
import { wireToLocal, isLocalSoftwareComponent } from '../../formats/devc/json.js';
import { normalizeName } from './object-name.js';
import type { DeleteOptions, DeleteResult } from './delete.js';

export async function runDeleteDevc(objectName: string, opts: DeleteOptions): Promise<DeleteResult> {
  if (!opts.yes) {
    throw new CliError('USAGE', 'Deleting a package requires --yes to confirm', {
      nextSteps: ['Re-run with --yes: `abap delete <package> --type DEVC --yes`.'],
      example: `abap delete ${objectName} --type DEVC --yes`,
    });
  }

  const name = normalizeName(objectName);
  const client = await AdtClientWrapper.create();
  // Read first: existence check + software component (transport rule).
  const doc = wireToLocal(await client.getPackage(name));
  const info = doc.generalInformation;
  const softwareComponent = info?.softwareComponent ?? '';
  const isLocal =
    isLocalSoftwareComponent(softwareComponent) || name.startsWith('$') || name.startsWith('TEST');
  if (!isLocal && !opts.tr) {
    throw new CliError(
      'MISSING_TRANSPORT',
      `Package ${name} is transportable (software component ${softwareComponent || '?'}); --tr is required`,
      {
        object: name,
        type: 'DEVC',
        details: { softwareComponent, superPackage: info?.superPackage },
        nextSteps: [
          'Pass --tr <request> to record the deletion in a transportable change.',
          'Or delete local scratch packages only (software component LOCAL).',
        ],
        example: `abap delete ${name} --type DEVC --tr NDK900123 --yes`,
      },
    );
  }

  try {
    await client.deletePackage(name, opts.tr);
  } catch (error: unknown) {
    if (error instanceof CliError && error.code === 'OBJECT_NOT_FOUND') throw error;
    const message = error instanceof Error ? error.message : String(error);
    // SAP rejects the delete with "package is locked" when an earlier ADT
    // session (typically the one that created the package) still holds the
    // enqueue lock. A fresh login has no lock and can delete it, so drop the
    // reused session once and retry.
    if (/locked|已锁定/i.test(message)) {
      await client.logout();
      try {
        await client.deletePackage(name, opts.tr);
      } catch (retryError: unknown) {
        throw wrapDeleteFailed(retryError, name, info);
      }
    } else {
      throw wrapDeleteFailed(error, name, info);
    }
  }

  return {
    data: {
      object: name,
      type: 'DEVC',
      packageName: info?.superPackage,
      deleted: true,
      ...(opts.tr ? { transport: opts.tr } : {}),
      // Packages are deleted without an ADT lock, so there is nothing to release.
      lockReleased: false,
    },
    human: `Deleted DEVC ${name}` + (opts.tr ? ` (transport ${opts.tr})` : ''),
  };
}

/** Wrap a package-delete failure as DELETE_FAILED with the package context. */
function wrapDeleteFailed(
  error: unknown,
  name: string,
  info: ReturnType<typeof wireToLocal>['generalInformation'],
): CliError {
  if (error instanceof CliError && error.code === 'OBJECT_NOT_FOUND') return error;
  const message = error instanceof Error ? error.message : String(error);
  return new CliError('DELETE_FAILED', `Failed to delete DEVC ${name}: ${message}`, {
    object: name,
    type: 'DEVC',
    details: { superPackage: info?.superPackage, softwareComponent: info?.softwareComponent, sapErrorBody: message },
    nextSteps: [
      'Packages can only be deleted when empty (no sub-packages, no objects).',
      'A lock held by another user or session blocks the delete — check SM12 and retry.',
    ],
  });
}
