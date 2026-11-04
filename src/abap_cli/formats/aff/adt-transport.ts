/**
 * AFF object operations over ADT blueSource resources (APLO / CHDO / EVTB / SMBC).
 *
 * `source/main` of these ADT resources *is* the object's official AFF JSON
 * document, so the transport is a verbatim document exchange — there is no
 * field mapping layer. This module owns the operation semantics shared by the
 * `*-aff.ts` flows and the CLI-side error contract:
 *
 *   create  = POST collection (metadata) + lock → PUT source/main → activate →
 *             unlock (the create body carries the AFF header description)
 *   pull    = GET metadata (package/description) + GET source/main
 *   push    = GET metadata (existence + package) + lock → PUT → activate → unlock
 *   delete  = GET metadata (package) + DELETE (no lock; `corrNr` for transports)
 *
 * The AFF document set of these types is a single file; multi-file local
 * bundles are rejected with an actionable error instead of silently dropping
 * companions. Activation failures keep SAP's messages
 * (`ACTIVATION_FAILED`, VALIDATION_ERROR/exit 7).
 */
import type { AdtClientWrapper } from '../../clients/adt-client.js';
import {
  mapAdtBlueSourceError,
  parseAdtBlueSourceMeta,
  type AdtBlueSourceMeta,
  type AdtBlueSourceType,
} from '../../clients/adt-blue-source.js';
import { CliError } from '../../output/json.js';
import type { AffBundleFile } from './bundle.js';

/** Project the pulled document + metadata (used by the pull/create flows). */
export interface AdtAffPullResult {
  /** `source/main` content — the official AFF JSON document, verbatim. */
  source: string;
  meta: AdtBlueSourceMeta;
}

/**
 * Activation failure keeps SAP's message list but adds the object identity the
 * flow needs (SAP reports the bare object name).
 */
function rethrowWriteError(
  type: AdtBlueSourceType,
  objectName: string,
  action: 'create' | 'update',
  error: unknown,
): never {
  if (error instanceof CliError && error.code === 'ACTIVATION_FAILED') {
    throw new CliError(
      'ACTIVATION_FAILED',
      `${type} ${objectName} was written but could not be activated: ${error.message}`,
      {
        type,
        object: objectName,
        details: error.details,
        ...(error.nextSteps ? { nextSteps: error.nextSteps } : {}),
        example: `abap pull ${objectName} --type ${type} --overwrite`,
      },
    );
  }
  mapAdtBlueSourceError(type, objectName, action, error);
}

/** Create + initial document write (the write activates the object). */
export async function createAdtAffObject(
  client: AdtClientWrapper,
  type: AdtBlueSourceType,
  req: {
    objectName: string;
    packageName: string;
    description: string;
    originalLanguage?: string;
    transport?: string;
    source: string;
  },
): Promise<void> {
  try {
    await client.createBlueSourceObject(type, req.objectName, {
      packageName: req.packageName,
      description: req.description,
      ...(req.originalLanguage ? { originalLanguage: req.originalLanguage } : {}),
      ...(req.transport ? { transport: req.transport } : {}),
    });
  } catch (error: unknown) {
    mapAdtBlueSourceError(type, req.objectName, 'create', error);
  }
  try {
    // The object header exists now; a save rejection is a document validation
    // failure (400) or an activation failure, not a duplicate-name error.
    await client.writeBlueSourceSource(type, req.objectName, req.source, {
      ...(req.transport ? { transport: req.transport } : {}),
      ...(req.originalLanguage ? { originalLanguage: req.originalLanguage } : {}),
    });
  } catch (error: unknown) {
    rethrowWriteError(type, req.objectName, 'create', error);
  }
}

/** Read the object's AFF document + metadata; 404 maps to `OBJECT_NOT_FOUND`. */
export async function pullAdtAffObject(
  client: AdtClientWrapper,
  type: AdtBlueSourceType,
  objectName: string,
): Promise<AdtAffPullResult> {
  let source: string;
  try {
    source = await client.getBlueSourceSource(type, objectName);
  } catch (error: unknown) {
    mapAdtBlueSourceError(type, objectName, 'read', error);
  }
  try {
    const meta = parseAdtBlueSourceMeta(type, await client.getBlueSourceObject(type, objectName));
    return { source, meta };
  } catch (error: unknown) {
    mapAdtBlueSourceError(type, objectName, 'read', error);
  }
}

/**
 * Read only the metadata (existence + package + description). `push` and
 * `delete` call this first so a missing object never turns into a create, and
 * so the transport rule sees the authoritative package.
 */
export async function readAdtAffMeta(
  client: AdtClientWrapper,
  type: AdtBlueSourceType,
  objectName: string,
  action: 'update' | 'delete',
): Promise<AdtBlueSourceMeta> {
  try {
    return parseAdtBlueSourceMeta(type, await client.getBlueSourceObject(type, objectName));
  } catch (error: unknown) {
    mapAdtBlueSourceError(type, objectName, action, error);
  }
}

/** Write the AFF document of an existing object (push). */
export async function pushAdtAffObject(
  client: AdtClientWrapper,
  type: AdtBlueSourceType,
  objectName: string,
  source: string,
  meta: { transport?: string; originalLanguage?: string; description?: string; masterLanguage?: string },
): Promise<void> {
  try {
    await client.writeBlueSourceSource(type, objectName, source, meta);
  } catch (error: unknown) {
    rethrowWriteError(type, objectName, 'update', error);
  }
}

/**
 * Delete the object. ADT DELETE needs no lock; transportable packages record
 * the removal through `corrNr`. A missing object is checked by the caller
 * (`readAdtAffMeta`) so it surfaces as OBJECT_NOT_FOUND before any write.
 */
export async function deleteAdtAffObject(
  client: AdtClientWrapper,
  type: AdtBlueSourceType,
  objectName: string,
  transport?: string,
): Promise<{ lockReleased: boolean }> {
  try {
    await client.deleteBlueSourceObject(type, objectName, transport);
  } catch (error: unknown) {
    mapAdtBlueSourceError(type, objectName, 'delete', error);
  }
  // ADT DELETE for these resources needs no edit lock, so no lock is left behind.
  return { lockReleased: true };
}

/**
 * The ADT blueSource AFF channel carries exactly one document per object.
 * A multi-file local bundle means the workspace mixes files of a type this
 * channel cannot represent, so fail loudly instead of dropping companions.
 */
export function requireSingleAffDocument(files: AffBundleFile[], type: string): AffBundleFile {
  if (files.length !== 1) {
    const names = files.map((file) => file.name).join(', ');
    throw new CliError(
      'VALIDATION_ERROR',
      `The ${type} ADT channel carries exactly one AFF document per object; the local bundle has ${files.length} files (${names})`,
      {
        type,
        details: { files: files.map((file) => file.name) },
        nextSteps: [
          `Keep only the object's canonical <object-token>.${type.toLowerCase()}.json file next to it.`,
          `Run \`abap pull <name> --type ${type} --overwrite\` to regenerate the canonical file set.`,
        ],
      },
    );
  }
  return files[0]!;
}
