/**
 * Shared helpers for the UCON RFC service (SRFC) and OAuth 2.0 profile (OA2P)
 * flows.
 *
 * Both types are TADIR objects managed through the bundled ICF service
 * (`/srfc/<name>`, `/oa2p/<name>`). Their names are CHAR 30 object keys, so the
 * local name rule is the same; the file-name guard reuses the AFF token form so
 * the file name and the SAP-side key stay in sync.
 */
import * as path from 'node:path';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { affObjectToken } from '../../formats/file-resolver.js';

/** Characters neither UCON RFC service ids nor OA2C profile names may carry. */
const UCON_NAME_FORBIDDEN = /[\s\x00-\x1f\x7f]/;

export interface UconNameSpec {
  /** User-facing type code (SRFC / OA2P). */
  type: string;
  /** Human label used in messages ("UCON RFC service" / "OAuth2 profile"). */
  label: string;
  /** SAP-side key length (both are CHAR 30). */
  maxLength: number;
  /** `abap create` example shown in the error. */
  example: string;
}

/** Uppercase + trim a UCON object name (both keys are case-insensitive). */
export function normalizeUconName(name: string): string {
  return name.trim().toUpperCase();
}

/**
 * Validate and normalize a UCON object name: 1..maxLength characters after
 * trim + uppercase, no whitespace or control characters.
 *
 * @throws CliError <TYPE>_NAME_INVALID (VALIDATION_ERROR / exit 7)
 */
export function validateUconName(objectName: string, spec: UconNameSpec): string {
  const name = normalizeUconName(objectName);
  const nextSteps = [
    `Use 1-${spec.maxLength} characters without whitespace or control characters.`,
    'Names are case-insensitive; the CLI stores them uppercase.',
  ];
  if (!name) {
    throw new CliError(`${spec.type}_NAME_INVALID` as ErrorCode, `${spec.label} name must not be empty`, {
      object: name,
      type: spec.type,
      nextSteps,
      example: spec.example,
    });
  }
  if (name.length > spec.maxLength) {
    throw new CliError(
      `${spec.type}_NAME_INVALID` as ErrorCode,
      `${spec.label} name must be at most ${spec.maxLength} characters (got ${name.length})`,
      { object: name, type: spec.type, nextSteps },
    );
  }
  if (UCON_NAME_FORBIDDEN.test(name)) {
    throw new CliError(
      `${spec.type}_NAME_INVALID` as ErrorCode,
      `${spec.label} name must not contain whitespace or control characters: "${objectName}"`,
      { object: name, type: spec.type, nextSteps },
    );
  }
  return name;
}

/**
 * The local document carries no `name` field (the file name is the identity,
 * matching the AFF HTTP / TRAN convention), so create/push must reject a file
 * whose name token does not match the object. Otherwise `create SRFC FOO
 * --file bar.srfc.json` would silently define FOO from a document pulled for
 * BAR, and `pull FOO` would write it under a different file name.
 *
 * @throws CliError INVALID_ARGUMENT (VALIDATION_ERROR / exit 7)
 */
export function assertUconFileNameMatches(
  name: string,
  filePath: string,
  spec: { type: string; label: string; suffix: string },
  outFile?: string,
): void {
  const expected = `${affObjectToken(name)}.${spec.suffix}`.toLowerCase();
  const actual = path.basename(filePath).toLowerCase();
  if (actual !== expected) {
    throw new CliError(
      'INVALID_ARGUMENT',
      `--file name does not match the ${spec.label} name: expected ${expected} (got ${path.basename(filePath)})`,
      {
        file: outFile ?? path.basename(filePath),
        object: name,
        type: spec.type,
        nextSteps: [
          `Rename the file to <name>.${spec.suffix} so the AFF file name and the ${spec.label} stay in sync.`,
        ],
        example: `abap create ${spec.type} ${name} --file src/${affObjectToken(name)}.${spec.suffix} --package '$TMP' --yes`,
      },
    );
  }
}
