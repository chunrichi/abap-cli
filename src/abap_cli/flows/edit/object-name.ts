/**
 * Shared object-name normalization + validation for the edit flows.
 *
 * Extracted from the three call sites that used to carry byte-identical
 * copies (`flows/edit/create.ts`, `create-local.ts`, `create-fugr-func.ts`)
 * during the split. Keeping one copy matters because the rules are
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
/**
 * Package (DEVC) name segment. Packages may start with `$` (local packages)
 * and otherwise use the ABAP name character set. Namespaces are handled by
 * {@link NAMESPACED_OBJECT_NAME}.
 */
export const PACKAGE_NAME_SEGMENT = /^\$?[A-Z][A-Z0-9_]*$/;

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

/**
 * Validate a package (DEVC) name: at most 30 characters, `$`-prefixed local
 * names or /<NS>/<NAME> namespaces. The software-component rule (LOCAL names
 * must start with `$` or `TEST`) is enforced separately by the create flow
 * because it depends on the resolved software component.
 */
export function validatePackageName(packageName: string): void {
  const namespaced = packageName.startsWith('/');
  let reason: string;
  if (!packageName) {
    reason = 'name is empty';
  } else if (packageName.length > OBJECT_NAME_MAX_LENGTH) {
    reason = `name is ${packageName.length} characters; SAP object names are at most ${OBJECT_NAME_MAX_LENGTH}`;
  } else if (namespaced ? !NAMESPACED_OBJECT_NAME.test(packageName) : !PACKAGE_NAME_SEGMENT.test(packageName)) {
    reason = namespaced
      ? 'namespaced names must look like /<NS>/<NAME> with a namespace of up to 10 characters and only A-Z 0-9 _'
      : 'name must start with a letter or $ and contain only A-Z, 0-9 and _';
  } else {
    return;
  }
  throw new CliError('VALIDATION_ERROR', `Invalid package name '${packageName}': ${reason}`, {
    object: packageName,
    details: [reason],
    nextSteps: [
      `Use at most ${OBJECT_NAME_MAX_LENGTH} characters, e.g. ZPKG_MY_PACKAGE (local: $MY_PACKAGE or TEST_MY_PACKAGE).`,
    ],
  });
}

/**
 * Number range object name limit: SAP stores it in `TNRO-NROBJ`, which is
 * CHAR 10 (domain `NROBJ`). A longer name is silently truncated by the ABAP
 * layer instead of failing, so `create` / `delete` reject it client-side.
 */
export const NROB_NAME_MAX_LENGTH = 10;

/**
 * Normalize and validate a number range object name. Returns the uppercased
 * name; throws `NROB_NAME_INVALID` (VALIDATION_ERROR / exit 7) when it is empty
 * or above the `TNRO-NROBJ` length.
 */
export function normalizeNrobName(objectName: string, example = 'ZCLI_TCNR1'): string {
  const name = normalizeName(objectName);
  if (!name || name.length > NROB_NAME_MAX_LENGTH) {
    throw new CliError(
      'NROB_NAME_INVALID',
      `NROB name must be 1-${NROB_NAME_MAX_LENGTH} characters (got "${objectName}")`,
      {
        object: name,
        type: 'NROB',
        nextSteps: [
          `SAP stores the number range object name in TNRO-NROBJ (CHAR ${NROB_NAME_MAX_LENGTH}); longer names are silently truncated.`,
        ],
        example: `abap delete ${example} --type NROB --yes`,
      },
    );
  }
  return name;
}
