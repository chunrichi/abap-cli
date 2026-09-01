/**
 * Extension-specific error factories.
 * Wraps CliError with extension-contextual details.
 */

import { CliError } from '../output/json.js';
import type { ErrorCode } from '../output/error-codes.js';

/**
 * Create a CONFIG_ERROR CliError for extension loading failures.
 * Used when: module not found, syntax error, timeout, recursion guard, path escape.
 * 027 US2/US3 — adds INVALID_PACKAGE_NAME / LOCKFILE_MISSING_ENTRY /
 * LOCKFILE_INTEGRITY_MISMATCH / INTEGRITY_UNRESOLVABLE reasons with
 * nextSteps hint to recover.
 */
export function extensionLoadFailed(
  nameOrPath: string,
  reason: string,
  extra?: Record<string, unknown>,
): CliError {
  const details: Record<string, unknown> = { extension: nameOrPath, reason };
  if (extra) Object.assign(details, extra);

  let message: string;
  switch (reason) {
    case 'path_escapes_allowlist':
      message =
        `Extension path '${nameOrPath}' escapes the allowed directories. ` +
        `Extensions must be under the project directory or ~/.abap-cli/extensions/.`;
      break;
    case 'recursion_overflow':
      message =
        `Extension '${nameOrPath}' hit the maximum loading depth (${extra?.maxDepth}). ` +
        `Check for circular dependencies.`;
      break;
    case 'load_timeout':
      message = `Extension '${nameOrPath}' failed to load within ${extra?.timeoutMs}ms.`;
      break;
    case 'INVALID_PACKAGE_NAME':
      message =
        `Extension package name '${nameOrPath}' is not a valid npm package name ` +
        `(${String(extra?.validationReason ?? 'invalid')}).`;
      break;
    case 'LOCKFILE_MISSING_ENTRY':
      message =
        `Extension '${nameOrPath}' is not recorded in extensions.lock.json. ` +
        `Run 'abap extensions lock --allow-unsigned' to add it, then commit the lockfile.`;
      break;
    case 'LOCKFILE_INTEGRITY_MISMATCH':
      message =
        `Extension '${nameOrPath}' integrity hash does not match extensions.lock.json ` +
        `(expected ${String(extra?.expected ?? '?')}, got ${String(extra?.actual ?? '?')}). ` +
        `Re-run 'abap extensions lock' after verifying the on-disk files.`;
      break;
    case 'INTEGRITY_UNRESOLVABLE':
      message =
        `Extension '${nameOrPath}' could not be resolved on disk. ` +
        `Re-run 'npm install' or refresh the lockfile with 'abap extensions lock --allow-unsigned'.`;
      break;
    default:
      message = `Extension '${nameOrPath}' failed to load: ${reason}.`;
  }

  return new CliError('EXTENSION_LOAD_FAILED', message, { details });
}

/**
 * Create a VALIDATION_ERROR CliError when a ValidationRule rejects a command.
 * Used in push-flow, select-flow, run-flow when registry.runValidation returns {ok: false}.
 */
export function extensionValidationFailed(
  ruleName: string,
  file: string,
  violation?: string,
): CliError {
  const details: Record<string, unknown> = { rule: ruleName, file };
  if (violation) details.violation = violation;
  const message = violation
    ? `ValidationRule '${ruleName}' rejected '${file}': ${violation}`
    : `ValidationRule '${ruleName}' rejected '${file}'.`;
  return new CliError('EXTENSION_VALIDATION_FAILED', message, { details });
}

/**
 * Create a VALIDATION_ERROR CliError when a `beforeCommand` hook vetoes a
 * command. Lets an extension gate or disable commands without touching core.
 */
export function extensionCommandBlocked(
  hookName: string,
  command: string,
  reason: string,
): CliError {
  return new CliError(
    'EXTENSION_COMMAND_BLOCKED',
    `Command '${command}' was blocked by '${hookName}': ${reason}`,
    { details: { hook: hookName, command, reason } },
  );
}
