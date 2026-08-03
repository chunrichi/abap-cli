/**
 * Error code constants — single source of truth (FR-008).
 * Categorisation drives the exit-code mapper; the literal `code` value
 * stays backward-compatible with existing call sites (FR-011).
 */

export type ErrorCategory =
  | 'USAGE'            // exit 2 — bad flag combination, missing positional
  | 'CONFIG_ERROR'     // exit 3 — missing/invalid config or profile
  | 'TLS_ERROR'        // exit 4 — TLS handshake failure
  | 'AUTH_ERROR'       // exit 5 — HTTP 401/403 from SAP
  | 'SAP_ERROR'        // exit 6 — server error / ICF status='error'
  | 'VALIDATION_ERROR' // exit 7 — semantic rejection (see below)
  | 'NOT_FOUND'        // exit 8 — OBJECT_NOT_FOUND, AMBIGUOUS_OBJECT
  | 'LOCKED';          // exit 9 — LOCK_FAILED

/**
 * Sub-codes are emitted as the `code` value to preserve backward compatibility
 * with existing callers. `UNLOCK_WARNING` is a non-fatal warning — it is never
 * emitted via renderError/printError; see push-flow.ts for its success-side
 * handling.
 */
export type ErrorCode =
  // Top-level categories
  | 'CONFIG_ERROR'
  | 'SAP_ERROR'
  | 'TLS_ERROR'           // NEW (FR-010)
  | 'AUTH_ERROR'          // NEW (FR-010)
  // Legacy categories
  | 'USAGE'
  | 'INVALID_ARGUMENT'
  | 'FILE_PARSE_ERROR'
  // Not-found family
  | 'OBJECT_NOT_FOUND'
  | 'AMBIGUOUS_OBJECT'
  // Locked family
  | 'LOCK_FAILED'
  | 'UNLOCK_WARNING'      // warning, not an error
  // Semantic-rejection family
  | 'ACTIVATION_FAILED'
  | 'SYNTAX_ERROR'
  | 'NO_TRANSPORT'
  | 'TRANSPORT_CREATE_FAILED'
  | 'TRANSPORT_NOT_FOUND'  // NEW (US-7 scenario 4)
  | 'CREATE_FAILED'
  | 'DDIC_NOT_SUPPORTED'
  | 'TYPE_NOT_SUPPORTED'
  | 'NOT_IMPLEMENTED'
  | 'OVERWRITE_REQUIRED'   // NEW (FR-018)
  | 'PUSH_FAILED'
  | 'OBJECT_EXISTS'        // legacy, used by create.ts
  | 'FILE_EXISTS';         // legacy, used by init.ts

const CATEGORY_OF_CODE: Record<ErrorCode, ErrorCategory> = {
  CONFIG_ERROR: 'CONFIG_ERROR',
  SAP_ERROR: 'SAP_ERROR',
  TLS_ERROR: 'TLS_ERROR',
  AUTH_ERROR: 'AUTH_ERROR',
  USAGE: 'USAGE',
  INVALID_ARGUMENT: 'USAGE',
  FILE_PARSE_ERROR: 'USAGE',
  OVERWRITE_REQUIRED: 'USAGE',
  OBJECT_NOT_FOUND: 'NOT_FOUND',
  AMBIGUOUS_OBJECT: 'NOT_FOUND',
  LOCK_FAILED: 'LOCKED',
  UNLOCK_WARNING: 'USAGE', // not emitted via error path; placeholder for type
  ACTIVATION_FAILED: 'VALIDATION_ERROR',
  SYNTAX_ERROR: 'VALIDATION_ERROR',
  NO_TRANSPORT: 'VALIDATION_ERROR',
  TRANSPORT_CREATE_FAILED: 'VALIDATION_ERROR',
  TRANSPORT_NOT_FOUND: 'VALIDATION_ERROR',
  CREATE_FAILED: 'VALIDATION_ERROR',
  DDIC_NOT_SUPPORTED: 'VALIDATION_ERROR',
  TYPE_NOT_SUPPORTED: 'VALIDATION_ERROR',
  OBJECT_EXISTS: 'USAGE',
  FILE_EXISTS: 'USAGE',
  NOT_IMPLEMENTED: 'VALIDATION_ERROR',
  PUSH_FAILED: 'VALIDATION_ERROR',
};

export function categoryOf(code: ErrorCode): ErrorCategory {
  return CATEGORY_OF_CODE[code];
}