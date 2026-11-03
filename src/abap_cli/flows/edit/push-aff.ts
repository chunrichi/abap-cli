/**
 * Generic AFF push (update only). The transport depends on the type's channel:
 *
 *   - APLO / CHDO / EVTB / SMBC (`affChannel: 'adt-blue'`): GET the blueSource
 *     metadata first (existence + package), apply the transport rule, then
 *     lock → PUT `source/main` → activate → unlock. The AFF header description
 *     is synced into the metadata under the same lock, using the object's
 *     existing master language so the logon language never rewrites it.
 *   - ENHO / ENHS (`affChannel: 'icf'`): read-only. The dispatcher rejects the
 *     push before this flow runs (registry `pushUnsupportedReason`).
 *
 * `push` never creates: a missing object is reported with a `create` pointer.
 */
import type { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError } from '../../output/json.js';
import { collectWarning } from '../../output/meta.js';
import { isLocalPackageName } from '../../core/transport.js';
import { createUnsupportedReasonFor } from '../../types/registry.js';
import { resolveFile } from '../../formats/file-resolver.js';
import { affHeaderInfo, parseAffMainDocument } from '../../formats/aff/bundle.js';
import { pushAdtAffObject, readAdtAffMeta, requireSingleAffDocument } from '../../formats/aff/adt-transport.js';
import {
  affChannelForType,
  affTransportFor,
  readLocalAffBundle,
  requireAdtAffType,
  requireAffBundleType,
} from './aff-shared.js';
import type { JsonPushTarget, PushFileOptions, PushOneResult } from './push-types.js';

/** `--atomic` phase-1 gate: local discovery + schema validation, no SAP call. */
export async function validateAffBundleFile(file: string, objectType: string): Promise<void> {
  const resolved = resolveFile(file);
  await readLocalAffBundle(file, objectType, resolved.objectName);
}

export async function pushAffFile(
  client: AdtClientWrapper,
  resolved: JsonPushTarget,
  file: string,
  opts: PushFileOptions,
): Promise<PushOneResult> {
  const type = requireAffBundleType(resolved.objectType);
  const channel = affChannelForType(type);
  const local = await readLocalAffBundle(file, type, resolved.objectName);

  if (opts.activate === false) {
    throw new CliError('VALIDATION_ERROR', `${type} AFF writes save and activate in one step; --no-activate is not supported`, {
      type,
      object: local.name,
      file: local.file,
      nextSteps: ['Drop --no-activate: the object is saved/active as soon as the AFF write succeeds.'],
    });
  }

  if (channel === 'icf') {
    throw new CliError(
      'VALIDATION_ERROR',
      `Cannot push ${type}: ${createUnsupportedReasonFor(type) ?? 'the ICF /aff channel is read-only for this type'}`,
      {
        type,
        object: local.name,
        file: local.file,
        nextSteps: [
          'The AFF reference framework has no update implementation for this type; edit it in Eclipse ADT/SEEF.',
        ],
      },
    );
  }

  const adtType = requireAdtAffType(type);
  const docFile = requireSingleAffDocument(local.files, type);
  const header = affHeaderInfo(parseAffMainDocument(local.files, local.name, type));

  // Existence + authoritative package: push updates only, and the transport
  // rule needs the package the object already lives in.
  const remote = await readAdtAffMeta(client, adtType, local.name, 'update');
  if (isLocalPackageName(remote.packageName) && opts.tr) {
    collectWarning(
      'PUSH_TR_IGNORED_TMP',
      `${remote.packageName} object ${local.name} is transport-free; ignoring --tr ${opts.tr}`,
      { object: local.name, tr: opts.tr },
    );
  }
  const transport = affTransportFor({ type, name: local.name, packageName: remote.packageName }, opts.tr, 'update');
  const masterLanguage = remote.originalLanguage ? remote.originalLanguage.toUpperCase() : undefined;

  await pushAdtAffObject(client, adtType, local.name, docFile.content, {
    ...(transport ? { transport } : {}),
    ...(header.originalLanguage ? { originalLanguage: header.originalLanguage } : {}),
    // Description sync is optional and only meaningful when the object already
    // has metadata (push always does): use the existing master language so a
    // non-EN logon profile cannot rewrite the object's original language.
    ...(header.description !== undefined && masterLanguage
      ? { description: header.description, masterLanguage }
      : {}),
  });
  return { transport: transport ?? '', status: 'written', channel: 'adt' };
}
