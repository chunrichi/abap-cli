/**
 * Shared plumbing for the CDS technical object flows (DTDC / DTEB / DSFD / DSFI).
 *
 * Local layout:
 *   source types  `<name>.<type>.json` + `<name>.<type>.acds` (the source sidecar)
 *   DSFI          `<name>.dsfi.json` (single JSON document; no sidecar)
 *
 * The JSON filename token must match the object name — a mismatch would create
 * or update a different object than the document describes.
 */
import * as path from 'node:path';
import { CliError } from '../../output/json.js';
import { affObjectToken } from '../../formats/file-resolver.js';
import { hasCdsSourceSidecar, type CdsTechType } from '../../formats/cds-tech/json.js';

/** Suffix of the AFF metadata document for one type (e.g. `.dtdc.json`). */
export function cdsJsonSuffix(type: CdsTechType): string {
  return `.${type.toLowerCase()}.json`;
}

/** Suffix of the source sidecar for one type (e.g. `.dtdc.acds`). */
export function cdsSidecarSuffix(type: CdsTechType): string {
  return `.${type.toLowerCase()}.acds`;
}

/** Expected metadata filename for an object, e.g. `zcli_foo.dtdc.json`. */
export function expectedCdsJsonFile(name: string, type: CdsTechType): string {
  return `${affObjectToken(name)}${cdsJsonSuffix(type)}`;
}

/** Source sidecar path next to a metadata document (source types only). */
export function cdsSidecarPath(jsonPath: string, type: CdsTechType): string {
  const suffix = cdsJsonSuffix(type);
  return jsonPath.toLowerCase().endsWith(suffix)
    ? jsonPath.slice(0, -suffix.length) + cdsSidecarSuffix(type)
    : `${jsonPath}.acds`;
}

/**
 * Reject a mismatch between the command-line object name and the JSON filename.
 * Only used by `create`, where the object name is a separate argument; push
 * derives the name from the filename and cannot mismatch.
 */
export function assertCdsFileName(name: string, type: CdsTechType, filePath: string): void {
  const expected = expectedCdsJsonFile(name, type);
  if (path.basename(filePath).toLowerCase() !== expected.toLowerCase()) {
    throw new CliError('VALIDATION_ERROR', `File ${path.basename(filePath)} does not match object ${name}; expected ${expected}`, {
      object: name,
      type,
      nextSteps: [`Rename the document to ${expected}, or run create for the object named by the file.`],
      example: `abap create ${type} ${name} --file src/${expected} --package $TMP --yes`,
    });
  }
}

/** True when the type needs a `.acds` source sidecar. */
export function sidecarRequired(type: CdsTechType): boolean {
  return hasCdsSourceSidecar(type);
}
