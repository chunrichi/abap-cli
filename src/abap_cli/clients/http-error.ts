import axios from 'axios';
import { CliError, type CliErrorOptions } from '../output/json.js';
import type { ErrorCode } from '../output/error-codes.js';
// Side-effect import: ensures all auth strategies are registered before
// `getAuthHints()` is called (each strategies/*.ts calls `registerStrategy`
// at module load). Required when http-error.ts is imported before the CLI
// commands have pulled in adapter.ts.
import '../auth/registry-bootstrap.js';
import { getAuthHints as lookupAuthHints } from '../auth/strategy.js';

/** Node TLS error codes — see [research §4](../../../../specs/008-cli-foundation/research.md). */
const TLS_ERROR_CODES = new Set<string>([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_REVOKED',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
]);

const TLS_NEXT_STEPS = [
  "Run 'abap profile set <name> --ca <pem>' to trust a private CA.",
  "For self-signed dev systems only: 'abap profile set <name> --insecure'.",
];
const TLS_EXAMPLE = 'abap profile set <name> --ca ./sap-dev-ca.pem';
const TLS_REFERENCE = 'skills/abap-setup/references/errors.md#tls_error';
const AUTH_REFERENCE = 'skills/abap-setup/references/errors.md#auth_error';
const SAP_ERROR_REFERENCE = 'skills/abap-setup/references/errors.md#sap_error';

/**
 * Choose the "what now?" hint for a 401/403 based on the auth method actually
 * used to log in. The hint set is owned by the registered AuthStrategy, so
 * new methods just declare their own `hints` and this file stays untouched.
 * Unknown / unset method falls back to the generic basic-auth guidance.
 */
const authHints = lookupAuthHints;

/**
 * Classify any thrown value from an HTTP client into a CliError with the right
 * ErrorCode and the canonical nextSteps/example for that category.
 *
 * Detection happens on `error.code` (Node system errors propagated through
 * axios's `error.cause` chain) and `error.response.status` — never by
 * string-matching the response body. The optional `context.authMethod` lets
 * the classifier pick cert-specific guidance on 401/403 (025).
 */
export function classifyHttpError(
  error: unknown,
  context?: { name?: string; authMethod?: string },
): CliError {
  // abap-adt-api wraps AxiosError into HttpClientException with a `status`
  // number field, or AdtErrorException with the status on `.err`. Normalise
  // both here so TLS/auth/sap detection sees the numeric HTTP status.
  const httpEx = error as { status?: unknown; err?: unknown; message?: string; code?: string };
  const status =
    typeof httpEx.status === 'number'
      ? httpEx.status
      : typeof httpEx.err === 'number'
        ? httpEx.err
        : undefined;

  if (
    status !== undefined &&
    !axios.isAxiosError(error)
  ) {
    // TLS handshake failures surface as AdtHttpException with status 0 and the
    // Node system error code (e.g. DEPTH_ZERO_SELF_SIGNED_CERT) on `code`.
    // Classify those before treating the numeric status as an HTTP response.
    if (httpEx.code && TLS_ERROR_CODES.has(httpEx.code)) {
      return new CliError('TLS_ERROR', httpEx.message || 'TLS handshake failed', {
        details: { cause: httpEx.code, ...(context?.name ? { system: context.name } : {}) },
        nextSteps: TLS_NEXT_STEPS,
        example: TLS_EXAMPLE,
        references: TLS_REFERENCE,
      });
    }
    if (status === 401 || status === 403) {
      const hints = authHints(context?.authMethod);
      return new CliError('AUTH_ERROR', httpEx.message || 'authentication failed', {
        details: { httpStatus: status, ...(context?.name ? { system: context.name, authMethod: context.authMethod } : { authMethod: context?.authMethod }) },
        nextSteps: hints.nextSteps,
        example: hints.example,
        references: AUTH_REFERENCE,
      });
    }
    const opts: CliErrorOptions = {
      details: { httpStatus: status, ...(context?.name ? { system: context.name } : {}) },
      references: SAP_ERROR_REFERENCE,
    };
    return new CliError('SAP_ERROR', httpEx.message || `HTTP ${status}`, opts);
  }

  // Non-Axios Node system errors (TLS, ECONNRESET, etc.) — sometimes arrive
  // directly without the AxiosError wrapper, e.g. when thrown by https.Agent.
  if (error instanceof Error && !axios.isAxiosError(error)) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code && TLS_ERROR_CODES.has(code)) {
      return new CliError('TLS_ERROR', error.message, {
        references: TLS_REFERENCE,
      });
    }
  }

  if (axios.isAxiosError(error)) {
    // Inspect error.cause (axios wraps the underlying TLS error there).
    const cause = error.cause as NodeJS.ErrnoException | undefined;
    if (cause?.code && TLS_ERROR_CODES.has(cause.code)) {
      return new CliError('TLS_ERROR', cause.message || error.message, {
        details: { cause: cause.code, ...(context?.name ? { system: context.name } : {}) },
        nextSteps: TLS_NEXT_STEPS,
        example: TLS_EXAMPLE,
        references: TLS_REFERENCE,
      });
    }
    const status = error.response?.status;
    if (status === 401 || status === 403) {
      const body = error.response?.data as { message?: string } | undefined;
      const hints = authHints(context?.authMethod);
      return new CliError('AUTH_ERROR', body?.message || error.message, {
        details: { httpStatus: status, ...(context?.name ? { system: context.name, authMethod: context.authMethod } : { authMethod: context?.authMethod }) },
        nextSteps: hints.nextSteps,
        example: hints.example,
        references: AUTH_REFERENCE,
      });
    }
    if (typeof status === 'number') {
      const body = error.response?.data as { message?: string } | undefined;
      const opts: CliErrorOptions = {
        details: { httpStatus: status, ...(context?.name ? { system: context.name } : {}) },
        references: SAP_ERROR_REFERENCE,
      };
      if (error.response?.statusText) opts.details = { ...opts.details, httpStatusText: error.response.statusText };
      return new CliError('SAP_ERROR', body?.message || error.message, opts);
    }
  }

  // Fallback — re-throw the original error as SAP_ERROR.
  const msg = error instanceof Error ? error.message : String(error);
  return new CliError('SAP_ERROR', msg, context?.name ? { details: { system: context.name }, references: SAP_ERROR_REFERENCE } : { references: SAP_ERROR_REFERENCE });
}

/** Convenience: does this error originate from a TLS handshake? */
export function isTlsErrorCode(code: string | undefined): boolean {
  return !!code && TLS_ERROR_CODES.has(code);
}

/** Exported for tests. */
export const TLS_ERROR_CODE_LIST: readonly string[] = Array.from(TLS_ERROR_CODES);

/** Re-export the type for downstream files. */
export type { ErrorCode };