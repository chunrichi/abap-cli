/**
 * Extension-specific error factories (FR-008).
 * Wraps CliError with extension-contextual details.
 */

import { CliError } from '../output/json.js';
import type { ErrorCode } from '../output/error-codes.js';

/**
 * Create a CONFIG_ERROR CliError for extension loading failures.
 * Used when: module not found, syntax error, timeout, recursion guard, path escape.
 */
export function extensionLoadFailed(
  nameOrPath: string,
  reason: string,
  extra?: Record<string, unknown>,
): CliError {
  const details: Record<string, unknown> = { extension: nameOrPath, reason };
  if (extra) Object.assign(details, extra);
  const message =
    reason === 'path_escapes_allowlist'
      ? `Extension path '${nameOrPath}' escapes the allowed directories. ` +
        `Extensions must be under the project directory or ~/.abap-cli/extensions/.`
      : reason === 'recursion_overflow'
        ? `Extension '${nameOrPath}' hit the maximum loading depth (${extra?.maxDepth}). ` +
          `Check for circular dependencies.`
        : reason === 'load_timeout'
          ? `Extension '${nameOrPath}' failed to load within ${extra?.timeoutMs}ms.`
          : `Extension '${nameOrPath}' failed to load: ${reason}.`;

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
