/**
 * Error code constants — single source of truth.
 * Categorisation drives the exit-code mapper; the literal `code` value
 * stays backward-compatible with existing call sites.
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
  | 'LOCKED'           // exit 9 — LOCK_FAILED
  // 036-ttyp-msag-ddls: reserved-range categories with explicit exit codes.
  // Split from VALIDATION_ERROR so the agent/exit-channel tells the user
  // *which* validation failure happened (capability gap vs. semantic rejection).
  | 'DDLS_NOT_SUPPORTED' // exit 64 — DDLS requested on ECC release that lacks DDL sources
  | 'CHANNEL_DETECT';    // exit 65 — channel-detect could not classify the system profile

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
  | 'TLS_ERROR'           // NEW
  | 'AUTH_ERROR'          // NEW
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
  | 'TRANSPORT_NOT_FOUND'  // NEW
  | 'CREATE_FAILED'
  | 'DDIC_NOT_SUPPORTED'
  | 'DDIC_CREATE_FAILED'    // ICF /ddic/<type> POST failure (SAP_ERROR)
  | 'DDIC_OBJECT_NOT_FOUND' // ICF /ddic/<type>/<name> GET 404 (NOT_FOUND)
  | 'DDIC_TABL_FORMAT_UNSUPPORTED' // canonical TABL projection cannot represent the object (VALIDATION_ERROR)
  | 'DTEL_CATEGORY_UNSUPPORTED'    // DTEL dataTypeInformation.category not in {domain, predefinedType, typeRef} (VALIDATION_ERROR)
  | 'TYPE_NOT_SUPPORTED'
  | 'OVERWRITE_REQUIRED'   // NEW
  | 'PUSH_FAILED'
  | 'PULL_PARTIAL_FAILURE'  // some objects in a pull succeeded, others failed (VALIDATION_ERROR)
  | 'VALIDATION_ERROR'     // semantic rejection (exit 7)
  | 'OBJECT_EXISTS'        // normalized legacy code (USAGE/2), used by create.ts
  | 'FILE_EXISTS'          // normalized legacy code (USAGE/2), used by init.ts
  | 'COMMAND_MOVED'        // normalized legacy code (VALIDATION_ERROR/7); command retired (e.g. atc → check atc)
  // classrun runner error codes
  | 'METHOD_FAILED'           // target method raised cx_root (VALIDATION_ERROR)
  | 'METHOD_NOT_SUPPORTED'    // method signature not adapter-compatible (VALIDATION_ERROR)
  | 'CLASS_NOT_RUNNABLE'      // target class lacks if_oo_adt_classrun~main (VALIDATION_ERROR)
  | 'LOCAL_CLASS_NOT_RUNNABLE'// class name contains `~` (local class) (SAP_ERROR)
  | 'OBJECT_NOT_ACTIVE'       // target class is inactive (SAP_ERROR)
  | 'WRAPPER_NOT_DEPLOYED'    // ZCL_ABAP_VIBE_RUNNER missing on target system (NOT_FOUND)
  | 'TIMEOUT'                 // classrun exceeded --timeout (SAP_ERROR)
  | 'WRAPPER_INPUT_UNAVAILABLE' // SAP classrun endpoint does not inject method args (SAP_ERROR)
  // read-only table data query error codes
  | 'TABLE_NOT_FOUND'          // ICF /data/query — table/view does not exist (NOT_FOUND)
  | 'TABLE_TYPE_NOT_SUPPORTED' // ICF /data/query — pool/cluster/structure not queryable (VALIDATION_ERROR)
  | 'INVALID_FIELD'            // ICF /data/query — field not in table / explicit large-object projection (VALIDATION_ERROR)
  | 'INVALID_WHERE'            // ICF /data/query — where syntax/op/field/type/MANDT violation (VALIDATION_ERROR)
  | 'LIMIT_EXCEEDED'           // ICF /data/query — limit > 10000 or non-integer (VALIDATION_ERROR)
  | 'OFFSET_EXCEEDED'          // ICF /data/query — offset > 100000 or non-integer (VALIDATION_ERROR)
  | 'QUERY_FAILED'             // ICF /data/query — runtime dynamic SQL error (SAP_ERROR)
    // HTTP service (SICF node) error codes
    | 'HTTP_CREATE_FAILED'       // ICF /http/<name> POST failure (SAP_ERROR)
    | 'HTTP_OBJECT_NOT_FOUND'    // ICF /http/<name> GET 404 (NOT_FOUND)
  // extension loading and validation
  | 'EXTENSION_LOAD_FAILED'       // extension module failed to load (CONFIG_ERROR/exit 3)
  | 'EXTENSION_VALIDATION_FAILED' // extension shape check failed (VALIDATION_ERROR/exit 7)
  | 'EXTENSION_COMMAND_BLOCKED'  // a beforeCommand hook vetoed the command (VALIDATION_ERROR/exit 7)
  // abap-file-format three-piece TABL/STRU pull diagnostics
  | 'TABL_DDL_INVALID'          // DDL parse failure (VALIDATION_ERROR/exit 7)
  | 'TABL_ARTIFACT_INCOMPLETE'  // wire missing mainJson or ddicSource (VALIDATION_ERROR/exit 7)
  | 'TABL_DDL_PARSE_FAILED'     // 037: SAP 500 + abap.string(N) DDL parser bug (NOT_FOUND/exit 8)
  // tcode: ICF /tcode/<code> transaction lookup
  | 'TCODE_NOT_FOUND'           // TSTC entry does not exist (NOT_FOUND/exit 8)
  | 'TCODE_NOT_AUTHORIZED'      // S_TCODE authority check failed (AUTH_ERROR/exit 5)
  // 033-aff-canonical-validator: AFF validator/CLI errors
  | 'AFF_SCHEMA_MISSING'        // canonical schema file not found for a type (VALIDATION_ERROR/exit 7)
  | 'AFF_SCHEMA_INVALID'        // canonical schema file present but unparseable (VALIDATION_ERROR/exit 7)
  | 'AFF_SCHEMA_COMPILE_ERROR'  // ajv compile raised (VALIDATION_ERROR/exit 7)
  | 'AFF_FIXTURE_INVALID'       // a fixture failed schema validation (VALIDATION_ERROR/exit 7)  // 034-session-cookie-reuse
  | 'SESSION_JAR_DECRYPT_FAILED' // AES-GCM tag mismatch / corrupt blob / wrong system hash (VALIDATION_ERROR)
  | 'SESSION_INVALID'            // SAP 401/403/440 after cookie inject — caller should re-login (VALIDATION_ERROR)
  | 'SESSION_REUSE_UNSUPPORTED'  // cloud/BTP system: cookie reuse not applicable (VALIDATION_ERROR)
  // 036-ttyp-msag-ddls: channel detection failure / DDLS not supported on ECC
  | 'CHANNEL_DETECTION_FAILED'   // system profile could not be parsed (CONFIG_ERROR/exit 3) → see spec 036 FR-008 / US1-AS5
  | 'DDLS_NOT_SUPPORTED_ON_ECC'  // DDLS has no ICF fallback; ECC releases before DDL sources cannot serve CDS (VALIDATION_ERROR/exit 64 per spec 036 FR-008 / US4-AS4)
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
  DDIC_TABL_FORMAT_UNSUPPORTED: 'VALIDATION_ERROR',
  DTEL_CATEGORY_UNSUPPORTED: 'VALIDATION_ERROR',
  DDIC_CREATE_FAILED: 'SAP_ERROR',
  DDIC_OBJECT_NOT_FOUND: 'NOT_FOUND',
  TYPE_NOT_SUPPORTED: 'VALIDATION_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  PULL_PARTIAL_FAILURE: 'VALIDATION_ERROR',
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
  EXTENSION_COMMAND_BLOCKED: 'VALIDATION_ERROR',
  // 024-tabl-aff-pull
  TABL_DDL_INVALID: 'VALIDATION_ERROR',
  TABL_ARTIFACT_INCOMPLETE: 'VALIDATION_ERROR',
  TABL_DDL_PARSE_FAILED: 'NOT_FOUND',
  // tcode
  TCODE_NOT_FOUND: 'NOT_FOUND',
  TCODE_NOT_AUTHORIZED: 'AUTH_ERROR',
  // 033 AFF
  AFF_SCHEMA_MISSING: 'VALIDATION_ERROR',
  AFF_SCHEMA_INVALID: 'VALIDATION_ERROR',
  AFF_SCHEMA_COMPILE_ERROR: 'VALIDATION_ERROR',
  AFF_FIXTURE_INVALID: 'VALIDATION_ERROR',
  // 034-session-cookie-reuse
  SESSION_JAR_DECRYPT_FAILED: 'VALIDATION_ERROR',
  SESSION_INVALID: 'VALIDATION_ERROR',
  SESSION_REUSE_UNSUPPORTED: 'VALIDATION_ERROR',
  // 036-ttyp-msag-ddls: 2 reserved-range categories
  CHANNEL_DETECTION_FAILED: 'CHANNEL_DETECT',
  DDLS_NOT_SUPPORTED_ON_ECC: 'DDLS_NOT_SUPPORTED',
};

export function categoryOf(code: ErrorCode): ErrorCategory {
  return CATEGORY_OF_CODE[code];
}