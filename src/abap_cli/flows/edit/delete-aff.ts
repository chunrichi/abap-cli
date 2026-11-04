/**
 * Generic AFF delete. The transport depends on the type's channel:
 *
 *   - APLO / CHDO / EVTB / SMBC (`affChannel: 'adt-blue'`): read the blueSource
 *     metadata for existence + package, apply the transport rule, then
 *     `DELETE <objectUrl>` (`corrNr` for transportable packages). ADT needs no
 *     edit lock for these resources.
 *   - ENHO / ENHS (`affChannel: 'icf'`): read-only; SAP's AFF reference
 *     framework has no delete implementation for enhancement spots/
 *     implementations, so the dispatcher rejects the delete locally.
 */
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError } from '../../output/json.js';
import { deleteUnsupportedReasonFor } from '../../types/registry.js';
import { deleteAdtAffObject, readAdtAffMeta } from '../../formats/aff/adt-transport.js';
import {
  affChannelForType,
  affTransportFor,
  normalizeAffObjectName,
  requireAdtAffType,
  requireAffBundleType,
} from './aff-shared.js';
import type { DeleteOptions, DeleteResult } from './delete.js';

export async function runDeleteAff(objectName: string, typeArg: string, opts: DeleteOptions): Promise<DeleteResult> {
  const type = requireAffBundleType(typeArg);
  const channel = affChannelForType(type);
  const name = normalizeAffObjectName(objectName);

  if (channel === 'icf') {
    throw new CliError(
      'VALIDATION_ERROR',
      `Cannot delete ${type}: ${deleteUnsupportedReasonFor(type) ?? 'the ICF /aff channel is read-only for this type'}`,
      {
        type,
        object: name,
        nextSteps: ['Delete enhancement spots/implementations in Eclipse ADT/SEEF.'],
      },
    );
  }

  const adtType = requireAdtAffType(type);
  const client = await AdtClientWrapper.create();
  // Existence + package first: a missing object must never reach the DELETE.
  const meta = await readAdtAffMeta(client, adtType, name, 'delete');
  const transport = affTransportFor({ type, name, packageName: meta.packageName }, opts.tr, 'delete');
  const { lockReleased } = await deleteAdtAffObject(client, adtType, name, transport);

  return {
    data: {
      object: name,
      type,
      channel: 'adt',
      ...(meta.packageName ? { packageName: meta.packageName } : {}),
      deleted: true,
      ...(transport ? { transport } : {}),
      lockReleased,
    },
    human: `Deleted ${type} ${name} via ADT` + (transport ? ` (transport ${transport})` : ''),
  };
}
