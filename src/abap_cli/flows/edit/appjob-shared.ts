/**
 * Shared plumbing for the application-job flows (SAJC / SAJT).
 *
 * Local layout: one AFF JSON document per object —
 *   `<name>.sajc.json` (catalog entry) / `<name>.sajt.json` (template).
 *
 * The filename token must match the object name: a mismatch would create or
 * update a different object than the document describes.
 */
import * as path from 'node:path';
import { CliError } from '../../output/json.js';
import { affObjectToken, resolveFile } from '../../formats/file-resolver.js';
import { APPJOB_INFO, appJobSuffix } from '../../clients/appjob.js';
import type { AppJobType } from '../../formats/appjob/json.js';
import type { AdtClientWrapper } from '../../clients/adt-client.js';
import { wireFormatOfSchema, type AppJobWireFormat } from '../../formats/appjob/wire.js';

/** Expected local filename for an object, e.g. `zcli_catalog.sajc.json`. */
export function expectedAppJobFile(name: string, type: AppJobType): string {
  return `${affObjectToken(name)}${appJobSuffix(type)}`;
}

/**
 * Reject a mismatch between the command-line object name and the JSON filename.
 * Only used by `create`, where the object name is a separate argument; push
 * derives the name from the filename and cannot mismatch.
 */
export function assertAppJobFileName(name: string, type: AppJobType, filePath: string): void {
  const expected = expectedAppJobFile(name, type);
  if (path.basename(filePath).toLowerCase() !== expected.toLowerCase()) {
    throw new CliError('VALIDATION_ERROR', `File ${path.basename(filePath)} does not match object ${name}; expected ${expected}`, {
      object: name,
      type,
      nextSteps: [`Rename the document to ${expected}, or run create for the object named by the file.`],
      example: `abap create ${type} ${name} --file src/${expected} --package $TMP --yes`,
    });
  }
}

/** Maximum object-name length reported by the ADT type structure. */
export function assertAppJobNameLength(type: AppJobType, name: string): void {
  const max = APPJOB_INFO[type].maxNameLength;
  if (name.length > max) {
    throw new CliError(
      'VALIDATION_ERROR',
      `${type} ${name} exceeds the SAP name limit of ${max} characters`,
      {
        object: name,
        type,
        details: { maxNameLength: max, actualLength: name.length },
        nextSteps: [`Shorten the object name to ${max} characters or fewer.`],
        example: `abap create ${type} ${name.slice(0, max)} --file <file> --package $TMP --yes`,
      },
    );
  }
}

/** Derive the object name from a local JSON filename (push entry point). */
export function nameFromAppJobFile(type: AppJobType, file: string): string {
  const resolved = resolveFile(file);
  if (resolved.objectType !== type) {
    throw new CliError('VALIDATION_ERROR', `Expected a ${appJobSuffix(type)} file, got ${path.basename(file)}`, {
      file,
      type,
    });
  }
  if (resolved.format !== 'json') {
    throw new CliError('INVALID_ARGUMENT', `${path.basename(file)} is not an AFF JSON document`, { file, type });
  }
  return resolved.objectName;
}

/**
 * Ask the target system which JSON document model its ADT resources serve.
 * Used before every write: the local AFF v1 document is translated to the
 * release's model, and fields the legacy model cannot carry are rejected.
 */
export async function detectTargetWireFormat(client: AdtClientWrapper, type: AppJobType): Promise<AppJobWireFormat> {
  return wireFormatOfSchema(type, await client.getAppJobSchema(type));
}
