/**
 * Error code constants — single source of truth (FR-008).
 * Categorisation drives the exit-code mapper; the literal `code` value
 * stays backward-compatible with existing call sites (FR-011).
 */

export type ErrorCategory =
  | 'UNKNOWN'          // exit 1 — generic fallback for unmapped exceptions
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
 * with existing callers. `UNLOCK_WARNING` is a WarningCode (meta.warnings),
 * not an error — see output/meta.ts and push-flow.ts's onWarning callback.
 */
export type ErrorCode =
  // Top-level categories
  | 'UNKNOWN'             // NEW — unmapped exception fallback (exit 1)
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
  | 'NOT_FOUND'
  // Locked family
  | 'LOCK_FAILED'
  | 'LOCKED'
  // Semantic-rejection family
  | 'ACTIVATION_FAILED'
  | 'SYNTAX_ERROR'
  | 'NO_TRANSPORT'
  | 'TRANSPORT_CREATE_FAILED'
  | 'TRANSPORT_NOT_FOUND'  // NEW (US-7 scenario 4)
  | 'CREATE_FAILED'
  | 'DDIC_NOT_SUPPORTED'
  | 'DDIC_CREATE_FAILED'    // 014: ICF /ddic/<type> POST failure (SAP_ERROR)
  | 'DDIC_OBJECT_NOT_FOUND' // 014: ICF /ddic/<type>/<name> GET 404 (NOT_FOUND)
  | 'TYPE_NOT_SUPPORTED'
  | 'OVERWRITE_REQUIRED'   // NEW (FR-018)
  | 'PUSH_FAILED'
  | 'VALIDATION_ERROR'     // semantic rejection (exit 7); see contracts §3
  | 'OBJECT_EXISTS'        // normalized legacy code (USAGE/2), used by create.ts
  | 'FILE_EXISTS'          // normalized legacy code (USAGE/2), used by init.ts
  | 'COMMAND_MOVED'        // normalized legacy code (VALIDATION_ERROR/7); command retired (e.g. atc → check atc)
  // 015-abap-run: classrun runner error codes
  | 'METHOD_FAILED'           // 015: target method raised cx_root (VALIDATION_ERROR)
  | 'METHOD_NOT_SUPPORTED'    // 015: method signature not adapter-compatible (VALIDATION_ERROR)
  | 'CLASS_NOT_RUNNABLE'      // 015: target class lacks if_oo_adt_classrun~main (VALIDATION_ERROR)
  | 'LOCAL_CLASS_NOT_RUNNABLE'// 015: class name contains `~` (local class) (SAP_ERROR)
  | 'OBJECT_NOT_ACTIVE'       // 015: target class is inactive (SAP_ERROR)
  | 'WRAPPER_NOT_DEPLOYED'    // 015: ZCL_ABAP_VIBE_RUNNER missing on target system (NOT_FOUND)
  | 'TIMEOUT'                 // 015: classrun exceeded --timeout (SAP_ERROR)
  | 'WRAPPER_INPUT_UNAVAILABLE' // 015: SAP classrun endpoint does not inject method args (SAP_ERROR)
  // 016-abap-select: read-only table data query error codes
  | 'TABLE_NOT_FOUND'          // 016: ICF /data/query — table/view does not exist (NOT_FOUND)
  | 'TABLE_TYPE_NOT_SUPPORTED' // 016: ICF /data/query — pool/cluster/structure not queryable (VALIDATION_ERROR)
  | 'INVALID_FIELD'            // 016: ICF /data/query — field not in table / explicit large-object projection (VALIDATION_ERROR)
  | 'INVALID_WHERE'            // 016: ICF /data/query — where syntax/op/field/type/MANDT violation (VALIDATION_ERROR)
  | 'LIMIT_EXCEEDED'           // 016: ICF /data/query — limit > 10000 or non-integer (VALIDATION_ERROR)
  | 'OFFSET_EXCEEDED'          // 016: ICF /data/query — offset > 100000 or non-integer (VALIDATION_ERROR)
  | 'QUERY_FAILED'             // 016: ICF /data/query — runtime dynamic SQL error (SAP_ERROR)
    // 022-http: HTTP service (SICF node) error codes
    | 'HTTP_CREATE_FAILED'       // 022: ICF /http/<name> POST failure (SAP_ERROR)
    | 'HTTP_OBJECT_NOT_FOUND'    // 022: ICF /http/<name> GET 404 (NOT_FOUND)
  // 023-extension-mechanism: extension loading and validation
  | 'EXTENSION_LOAD_FAILED'       // extension module failed to load (CONFIG_ERROR/exit 3)
  | 'EXTENSION_VALIDATION_FAILED' // extension shape check failed (VALIDATION_ERROR/exit 7)
  ;

const CATEGORY_OF_CODE: Record<ErrorCode, ErrorCategory> = {
  UNKNOWN: 'UNKNOWN',
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
  NOT_FOUND: 'NOT_FOUND',
  LOCK_FAILED: 'LOCKED',
  LOCKED: 'LOCKED',
  ACTIVATION_FAILED: 'VALIDATION_ERROR',
  SYNTAX_ERROR: 'VALIDATION_ERROR',
  NO_TRANSPORT: 'VALIDATION_ERROR',
  TRANSPORT_CREATE_FAILED: 'VALIDATION_ERROR',
  TRANSPORT_NOT_FOUND: 'VALIDATION_ERROR',
  CREATE_FAILED: 'VALIDATION_ERROR',
  DDIC_NOT_SUPPORTED: 'VALIDATION_ERROR',
  DDIC_CREATE_FAILED: 'SAP_ERROR',
  DDIC_OBJECT_NOT_FOUND: 'NOT_FOUND',
  TYPE_NOT_SUPPORTED: 'VALIDATION_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  OBJECT_EXISTS: 'USAGE',
  FILE_EXISTS: 'USAGE',
  PUSH_FAILED: 'VALIDATION_ERROR',
  COMMAND_MOVED: 'VALIDATION_ERROR',
  // 015-abap-run mappings
  METHOD_FAILED: 'VALIDATION_ERROR',
  METHOD_NOT_SUPPORTED: 'VALIDATION_ERROR',
  CLASS_NOT_RUNNABLE: 'VALIDATION_ERROR',
  LOCAL_CLASS_NOT_RUNNABLE: 'SAP_ERROR',
  OBJECT_NOT_ACTIVE: 'SAP_ERROR',
  WRAPPER_NOT_DEPLOYED: 'NOT_FOUND',
  TIMEOUT: 'SAP_ERROR',
  WRAPPER_INPUT_UNAVAILABLE: 'SAP_ERROR',
  // 016-abap-select mappings
  TABLE_NOT_FOUND: 'NOT_FOUND',
  TABLE_TYPE_NOT_SUPPORTED: 'VALIDATION_ERROR',
  INVALID_FIELD: 'VALIDATION_ERROR',
  INVALID_WHERE: 'VALIDATION_ERROR',
  LIMIT_EXCEEDED: 'VALIDATION_ERROR',
  OFFSET_EXCEEDED: 'VALIDATION_ERROR',
  QUERY_FAILED: 'SAP_ERROR',
  // 022-http mappings
  HTTP_CREATE_FAILED: 'SAP_ERROR',
  HTTP_OBJECT_NOT_FOUND: 'NOT_FOUND',
  // 023-extension-mechanism
  EXTENSION_LOAD_FAILED: 'CONFIG_ERROR',
  EXTENSION_VALIDATION_FAILED: 'VALIDATION_ERROR',
};

export function categoryOf(code: ErrorCode): ErrorCategory {
  return CATEGORY_OF_CODE[code];
}