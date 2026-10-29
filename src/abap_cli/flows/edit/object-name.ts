/**
 * Shared object-name normalization + validation for the edit flows.
 *
 * Extracted from the three call sites that used to carry byte-identical
 * copies (`flows/edit/create.ts`, `create-local.ts`, `create-fugr-func.ts`)
 * during the Phase 3 split. Keeping one copy matters because the rules are
 * user-facing: the length limit and legal-character set must stay in sync
 * with what SAP accepts.
 */
import { CliError } from '../../output/json.js';

/** SAP object names are at most 30 characters. */
export const OBJECT_NAME_MAX_LENGTH = 30;
/** Legal chars for a non-namespaced segment; matches what SAP accepts in $TMP. */
export const OBJECT_NAME_SEGMENT = /^[A-Z0-9_]+$/;
/** Namespaced object names: /<NS up to 10>/<name>; total length ≤ 30 (incl. slashes). */
export const NAMESPACED_OBJECT_NAME = /^\/[A-Z0-9_]{1,10}\/[A-Z0-9_]+$/;

/** Uppercase + trim an object name (SAP names are case-insensitive). */
export function normalizeName(name: string): string {
  return name.trim().toUpperCase();
}

/**
 * Local fail-fast object-name validation, mirroring DDIC's client-side name
 * checks (VALIDATION_ERROR / exit 7). Runs on the uppercased name before any
 * SAP round-trip. Deliberately does NOT enforce a Z/Y prefix: $TMP accepts
 * names like A123, so only truly illegal shapes are rejected.
 *
 * @param example Optional example name used in `nextSteps` when the caller
 *   has a more relevant one (e.g. a function group).
 */
export function validateObjectName(objectName: string, example = 'ZCL_MY_CLASS'): void {
  const namespaced = objectName.startsWith('/');
  let reason: string;
  if (!objectName) {
    reason = 'name is empty';
  } else if (objectName.length > OBJECT_NAME_MAX_LENGTH) {
    reason = `name is ${objectName.length} characters; SAP object names are at most ${OBJECT_NAME_MAX_LENGTH}`;
  } else if (namespaced ? !NAMESPACED_OBJECT_NAME.test(objectName) : !OBJECT_NAME_SEGMENT.test(objectName)) {
    reason = namespaced
      ? 'namespaced names must look like /<NS>/<NAME> with a namespace of up to 10 characters and only A-Z 0-9 _'
      : 'name may only contain A-Z, 0-9 and _ (no spaces or punctuation)';
  } else {
    return;
  }
  throw new CliError('VALIDATION_ERROR', `Invalid object name '${objectName}': ${reason}`, {
    object: objectName,
    details: [reason],
    nextSteps: [
      `Use at most ${OBJECT_NAME_MAX_LENGTH} characters from A-Z 0-9 _ (namespaced: /<NS>/<NAME>), e.g. ${example}.`,
    ],
  });
}
