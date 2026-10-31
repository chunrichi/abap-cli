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
  // reserved-range categories with explicit exit codes.
  // Split from VALIDATION_ERROR so the agent/exit-channel tells the user
  // *which* validation failure happened (capability gap vs. semantic rejection).
  | 'DDLS_NOT_SUPPORTED' // exit 64 - DDLS requested on ECC release that lacks DDL sources
  | 'CHANNEL_DETECT';   // exit 65 - channel-detect could not classify the system profile
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
  | 'TABT_VALIDATION_FAILED'       // .tabl.settings.json failed tabt-v1.json enum validation (VALIDATION_ERROR)
  | 'TYPE_NOT_SUPPORTED'
  | 'OVERWRITE_REQUIRED'   // NEW
  | 'MISSING_TRANSPORT'    // NEW — delete requires --tr for non-$TMP packages
  | 'DELETE_FAILED'        // NEW — abap delete general failure (lock/delete/unlock cycle)
  | 'PUSH_FAILED'
  | 'TEST_FAILED'           // ABAP Unit run reported failing tests (VALIDATION_ERROR)
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
  // F-16 report runner (ICF /run/report)
  | 'REPORT_NOT_FOUND'         // target program is not in TRDIR (NOT_FOUND)
  | 'REPORT_NOT_EXECUTABLE'    // target exists but is not an executable report (VALIDATION_ERROR)
  | 'REPORT_RUN_FAILED'        // SUBMIT failed or list conversion failed (SAP_ERROR)
  | 'REPORT_NO_LIST_OUTPUT'    // report produced no capturable list (SAP_ERROR)
  | 'TABLE_TYPE_NOT_SUPPORTED' // ICF /data/query — pool/cluster/structure not queryable (VALIDATION_ERROR)
  | 'INVALID_FIELD'            // ICF /data/query — field not in table / explicit large-object projection (VALIDATION_ERROR)
  | 'INVALID_WHERE'            // ICF /data/query — where syntax/op/field/type/MANDT violation (VALIDATION_ERROR)
  | 'LIMIT_EXCEEDED'           // ICF /data/query — limit > 10000 or non-integer (VALIDATION_ERROR)
  | 'OFFSET_EXCEEDED'          // ICF /data/query — offset > 100000 or non-integer (VALIDATION_ERROR)
  | 'QUERY_FAILED'             // ICF /data/query — runtime dynamic SQL error (SAP_ERROR)
    // HTTP service (SICF node) error codes
    | 'HTTP_CREATE_FAILED'       // ICF /http/<name> POST failure (SAP_ERROR)
    | 'HTTP_OBJECT_NOT_FOUND'    // ICF /http/<name> GET 404 (NOT_FOUND)
  // abap-file-format three-piece TABL/STRU pull diagnostics
  | 'TABL_DDL_INVALID'          // DDL parse failure (VALIDATION_ERROR/exit 7)
  | 'TABL_ARTIFACT_INCOMPLETE'  // wire missing mainJson or ddicSource (VALIDATION_ERROR/exit 7)
  | 'TABL_DDL_PARSE_FAILED'     // SAP 500 + abap.string(N) DDL parser bug (NOT_FOUND/exit 8)
  // tcode: ICF /tcode/<code> transaction lookup
  | 'TCODE_NOT_FOUND'           // TSTC entry does not exist (NOT_FOUND/exit 8)
  | 'TCODE_NOT_AUTHORIZED'      // S_TCODE authority check failed (AUTH_ERROR/exit 5)
  // TRAN (SE93 transaction code) ICF /tran route
  | 'TRAN_OBJECT_NOT_FOUND'      // TSTC/TADIR entry does not exist (NOT_FOUND/exit 8)
  | 'TRAN_INVALID_PAYLOAD'       // malformed wire JSON body (VALIDATION_ERROR)
  | 'TRAN_NAME_MISMATCH'         // payload name differs from the URL transaction (VALIDATION_ERROR)
  | 'TRAN_SERVICE_INVALID'       // path/name malformed (VALIDATION_ERROR)
  | 'TRAN_TYPE_INVALID'          // unknown transactionType / illegal_type from the insert FM (VALIDATION_ERROR)
  | 'TRAN_DESCRIPTION_REQUIRED'  // header.description missing (VALIDATION_ERROR)
  | 'TRAN_DESCRIPTION_TOO_LONG'  // header.description above the AFF limit (VALIDATION_ERROR)
  | 'TRAN_PROGRAM_REQUIRED'      // dialog/report transaction without a program (VALIDATION_ERROR)
  | 'TRAN_DYNNR_INVALID'         // dynpro value is not 1-4 digits (VALIDATION_ERROR)
  | 'TRAN_PARENT_REQUIRED'       // parameter/variant transaction without a core transaction (VALIDATION_ERROR)
  | 'TRAN_VARIANT_REQUIRED'      // variant transaction without a variant name (VALIDATION_ERROR)
  | 'TRAN_TRANSPORT_REQUIRED'    // transportable package write/delete without a request (VALIDATION_ERROR)
  | 'TRAN_OO_NOT_SUPPORTED'      // OO transactions cannot be written through RPY_TRANSACTION_INSERT (VALIDATION_ERROR)
  | 'TRAN_DELETE_UNSUPPORTED'    // transported transactions must be deleted in SE93 (VALIDATION_ERROR)
  | 'TRAN_NOT_AUTHORIZED'        // RS_CORR_INSERT permission_failure (AUTH_ERROR/exit 5)
  | 'TRAN_WRITE_CANCELLED'       // insert FM cancelled by a SAP dialog (SAP_ERROR)
  | 'TRAN_PACKAGE_INVALID'       // RS_CORR_INSERT unknown object class/package (VALIDATION_ERROR)
  | 'TRAN_PACKAGE_ASSIGN_FAILED' // RS_CORR_INSERT failed (SAP_ERROR)
  | 'TRAN_NAME_NOT_ALLOWED'      // insert FM name_not_allowed (VALIDATION_ERROR)
  | 'TRAN_NAME_CONFLICT'         // insert FM name_conflict (VALIDATION_ERROR)
  | 'TRAN_OBJECT_INCONSISTENT'   // insert FM object_inconsistent (SAP_ERROR)
  | 'TRAN_DB_ACCESS_ERROR'       // insert FM db_access_error (SAP_ERROR)
  | 'TRAN_WRITE_FAILED'          // insert FM failed / row not persisted (SAP_ERROR)
  | 'TRAN_TSTCC_WRITE_FAILED'    // TSTCC user-interface attributes not persisted (SAP_ERROR)
  | 'TRAN_AUTH_WRITE_FAILED'     // TSTCA start authorization not persisted (SAP_ERROR)
  | 'TRAN_TADIR_DELETE_FAILED'   // TADIR entry not removed on delete (SAP_ERROR)
  // VIEW (database view) ICF route — local-extension view-v1 document
  | 'VIEW_INVALID_PAYLOAD'      // malformed JSON body / not a view-v1 document (VALIDATION_ERROR)
  | 'VIEW_NAME_INVALID'         // name empty, >16 chars, whitespace, or payload/URL mismatch (VALIDATION_ERROR)
  | 'VIEW_TYPE_INVALID'         // unknown viewClass (VALIDATION_ERROR)
  | 'VIEW_REQUIRED_FIELD'       // missing header.description / tables / fields / join fields (VALIDATION_ERROR)
  | 'VIEW_TABLE_NOT_FOUND'      // tables[] references a table that does not exist (NOT_FOUND)
  | 'VIEW_FIELD_INVALID'        // field does not exist in its table or is not declared (VALIDATION_ERROR)
  | 'VIEW_INCONSISTENT'         // DDIF_VIEW_PUT view_inconsistent (VALIDATION_ERROR)
  | 'VIEW_WRITE_REFUSED'        // DDIF_VIEW_PUT put_refused — illegal projection/name conflict (VALIDATION_ERROR)
  | 'VIEW_WRITE_FAILED'         // DDIF_VIEW_PUT failure / package assignment failure (SAP_ERROR)
  | 'VIEW_ACTIVATION_FAILED'    // DDIF_VIEW_ACTIVATE failed (SAP_ERROR)
  | 'VIEW_NOT_AUTHORIZED'       // RS_CORR_INSERT permission_failure / delete permission (AUTH_ERROR)
  | 'VIEW_TRANSPORT_REQUIRED'   // non-$TMP write without a valid transport request (VALIDATION_ERROR)
  | 'VIEW_PACKAGE_ASSIGN_FAILED'// RS_CORR_INSERT failed for another reason (SAP_ERROR)
  | 'VIEW_DELETE_UNSUPPORTED'   // delete of a transported view via ICF (VALIDATION_ERROR)
  | 'VIEW_DELETE_FAILED'        // RS_DD_DELETE_OBJ failure (SAP_ERROR)
  // SHLP (search help) ICF route — local-extension shlp-v1 document
  | 'SHLP_INVALID_PAYLOAD'      // malformed JSON body / not a shlp-v1 document (VALIDATION_ERROR)
  | 'SHLP_NAME_INVALID'         // name empty, >30 chars, whitespace, or payload/URL mismatch (VALIDATION_ERROR)
  | 'SHLP_KIND_INVALID'         // kind is neither elementary nor collective (VALIDATION_ERROR)
  | 'SHLP_REQUIRED_FIELD'       // missing header.description / parameters / includedSearchHelps / mappings (VALIDATION_ERROR)
  | 'SHLP_SELECTION_METHOD_NOT_FOUND' // elementary selectionMethod does not exist in DD02L (NOT_FOUND)
  | 'SHLP_FIELD_INVALID'        // parameter/mapping field invalid or not derivable (VALIDATION_ERROR)
  | 'SHLP_INCLUDED_NOT_FOUND'   // included search help does not exist (NOT_FOUND)
  | 'SHLP_INCONSISTENT'         // DDIF_SHLP_PUT shlp_inconsistent (VALIDATION_ERROR)
  | 'SHLP_WRITE_REFUSED'        // DDIF_SHLP_PUT put_refused (VALIDATION_ERROR)
  | 'SHLP_WRITE_FAILED'         // DDIF_SHLP_PUT failure / package assignment failure (SAP_ERROR)
  | 'SHLP_ACTIVATION_FAILED'    // DDIF_SHLP_ACTIVATE failed (SAP_ERROR)
  | 'SHLP_NOT_AUTHORIZED'       // RS_CORR_INSERT permission_failure / delete permission (AUTH_ERROR)
  | 'SHLP_TRANSPORT_REQUIRED'   // non-$TMP write without a valid transport request (VALIDATION_ERROR)
  | 'SHLP_PACKAGE_ASSIGN_FAILED'// RS_CORR_INSERT failed for another reason (SAP_ERROR)
  | 'SHLP_DELETE_UNSUPPORTED'   // delete of a transported search help via ICF (VALIDATION_ERROR)
  | 'SHLP_DELETE_FAILED'        // RS_DD_DELETE_OBJ failure (SAP_ERROR)
  // AFF validator/CLI errors
  | 'AFF_SCHEMA_MISSING'        // canonical schema file not found for a type (VALIDATION_ERROR/exit 7)
  | 'AFF_SCHEMA_INVALID'        // canonical schema file present but unparseable (VALIDATION_ERROR/exit 7)
  | 'AFF_SCHEMA_COMPILE_ERROR'  // ajv compile raised (VALIDATION_ERROR/exit 7)
  | 'AFF_FIXTURE_INVALID'       // a fixture failed schema validation (VALIDATION_ERROR/exit 7)
  | 'DOCU_PUSH_FAILED'          // ICF POST /ddic/<type>/<name>/docu failure (SAP_ERROR/exit 6)
  | 'SESSION_JAR_DECRYPT_FAILED' // AES-GCM tag mismatch / corrupt blob / wrong system hash (VALIDATION_ERROR)
  | 'SESSION_INVALID'            // SAP 401/403/440 after cookie inject — caller should re-login (VALIDATION_ERROR)
  | 'SESSION_REUSE_UNSUPPORTED'  // cloud/BTP system: cookie reuse not applicable (VALIDATION_ERROR)
  // channel detection failure / DDLS not supported on ECC
  | 'CHANNEL_DETECTION_FAILED'   // system profile could not be parsed (CONFIG_ERROR/exit 3)
  | 'DDLS_NOT_SUPPORTED_ON_ECC'  // DDLS has no ICF fallback; ECC releases before DDL sources cannot serve CDS
  // ENQU (lock object) / NROB (number range object) ICF routes
  | 'ENQU_CREATE_FAILED'         // ICF /ddic/enqu POST failure (SAP_ERROR)
  | 'ENQU_PUSH_FAILED'           // ICF /ddic/enqu POST failure during push (SAP_ERROR)
  | 'NROB_CREATE_FAILED'         // ICF /ddic/nrob POST failure (SAP_ERROR)
  | 'NROB_PUSH_FAILED'           // ICF /ddic/nrob POST failure during push (SAP_ERROR)
  | 'ENQU_NOT_IMPLEMENTED'       // ICF handler accepts /ddic/enqu but the SAP-side read/write is not deployed yet (SAP_ERROR)
  | 'NROB_NOT_IMPLEMENTED'       // ICF handler accepts /ddic/nrob but the SAP-side read/write is not deployed yet (SAP_ERROR)
  // bundled-service deploy: dev-class merge into the handler class
  | 'DEPLOY_MANIFEST_INVALID'   // abap/deploy.json missing or inconsistent with abap/src (VALIDATION_ERROR)
  | 'DEPLOY_MERGE_FAILED'       // source split / dependency cycle / rename leftover (VALIDATION_ERROR)
  // XSLT (transformation program) ICF /xslt/<name> route
  | 'XSLT_OBJECT_NOT_FOUND'     // GET/DELETE unknown transformation (NOT_FOUND)
  | 'XSLT_CREATE_FAILED'        // create_new_from_string failed (SAP_ERROR)
  | 'XSLT_PUSH_FAILED'          // ICF POST failure during push (SAP_ERROR)
  | 'XSLT_DELETE_FAILED'        // delete/save cycle failed (SAP_ERROR)
  | 'XSLT_LOAD_FAILED'          // load/attributes failure (SAP_ERROR)
  | 'XSLT_WRITE_CANCELLED'      // save/lock cancelled (SAP_ERROR)
  | 'XSLT_NOT_AUTHORIZED'       // create_new_from_string not_authorized (AUTH_ERROR)
  | 'XSLT_ACTIVATION_FAILED'    // activate reported syntax/generation errors (VALIDATION_ERROR)
  | 'XSLT_INVALID_PAYLOAD'      // malformed wire JSON body (VALIDATION_ERROR)
  | 'XSLT_SERVICE_INVALID'      // missing/invalid transformation name in the URL (VALIDATION_ERROR)
  | 'XSLT_NAME_INVALID'         // transformation name longer than 30 chars / contains blanks (VALIDATION_ERROR)
  | 'XSLT_NAME_MISMATCH'        // payload name differs from the URL transformation (VALIDATION_ERROR)
  | 'XSLT_DESCRIPTION_REQUIRED' // header.description missing (VALIDATION_ERROR)
  | 'XSLT_DESCRIPTION_TOO_LONG' // header.description above the AFF limit (VALIDATION_ERROR)
  | 'XSLT_SOURCE_REQUIRED'      // source (the .xslt.xml content) missing (VALIDATION_ERROR)
  | 'XSLT_SOURCE_LINE_TOO_LONG' // source line above O2PAGELINE-LINE CHAR 255 (VALIDATION_ERROR)
  | 'XSLT_TRANSPORT_REQUIRED'   // transportable package write/delete without a request (VALIDATION_ERROR)
  | 'XSLT_OBJECT_EXISTS'        // create_new_from_string object_already_existing (SAP_ERROR)
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
  MISSING_TRANSPORT: 'USAGE',
  DELETE_FAILED: 'SAP_ERROR',
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
  TABT_VALIDATION_FAILED: 'VALIDATION_ERROR',
  DDIC_CREATE_FAILED: 'SAP_ERROR',
  DDIC_OBJECT_NOT_FOUND: 'NOT_FOUND',
  TYPE_NOT_SUPPORTED: 'VALIDATION_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  PULL_PARTIAL_FAILURE: 'VALIDATION_ERROR',
  OBJECT_EXISTS: 'USAGE',
  FILE_EXISTS: 'USAGE',
  PUSH_FAILED: 'VALIDATION_ERROR',
  TEST_FAILED: 'VALIDATION_ERROR',
  COMMAND_MOVED: 'VALIDATION_ERROR',
  // mappings
  METHOD_FAILED: 'VALIDATION_ERROR',
  METHOD_NOT_SUPPORTED: 'VALIDATION_ERROR',
  CLASS_NOT_RUNNABLE: 'VALIDATION_ERROR',
  LOCAL_CLASS_NOT_RUNNABLE: 'SAP_ERROR',
  OBJECT_NOT_ACTIVE: 'SAP_ERROR',
  WRAPPER_NOT_DEPLOYED: 'NOT_FOUND',
  TIMEOUT: 'SAP_ERROR',
  WRAPPER_INPUT_UNAVAILABLE: 'SAP_ERROR',
  // mappings
  TABLE_NOT_FOUND: 'NOT_FOUND',
  REPORT_NOT_FOUND: 'NOT_FOUND',
  REPORT_NOT_EXECUTABLE: 'VALIDATION_ERROR',
  REPORT_RUN_FAILED: 'SAP_ERROR',
  REPORT_NO_LIST_OUTPUT: 'SAP_ERROR',
  TABLE_TYPE_NOT_SUPPORTED: 'VALIDATION_ERROR',
  INVALID_FIELD: 'VALIDATION_ERROR',
  INVALID_WHERE: 'VALIDATION_ERROR',
  LIMIT_EXCEEDED: 'VALIDATION_ERROR',
  OFFSET_EXCEEDED: 'VALIDATION_ERROR',
  QUERY_FAILED: 'SAP_ERROR',
  // mappings
  HTTP_CREATE_FAILED: 'SAP_ERROR',
  HTTP_OBJECT_NOT_FOUND: 'NOT_FOUND',
  // — ENQU / NROB ICF routes
  ENQU_CREATE_FAILED: 'SAP_ERROR',
  ENQU_PUSH_FAILED: 'SAP_ERROR',
  NROB_CREATE_FAILED: 'SAP_ERROR',
  NROB_PUSH_FAILED: 'SAP_ERROR',
  ENQU_NOT_IMPLEMENTED: 'SAP_ERROR',
  NROB_NOT_IMPLEMENTED: 'SAP_ERROR',
  TABL_DDL_INVALID: 'VALIDATION_ERROR',
  TABL_ARTIFACT_INCOMPLETE: 'VALIDATION_ERROR',
  TABL_DDL_PARSE_FAILED: 'NOT_FOUND',
  // tcode
  TCODE_NOT_FOUND: 'NOT_FOUND',
  TCODE_NOT_AUTHORIZED: 'AUTH_ERROR',
  // TRAN
  TRAN_OBJECT_NOT_FOUND: 'NOT_FOUND',
  TRAN_INVALID_PAYLOAD: 'VALIDATION_ERROR',
  TRAN_NAME_MISMATCH: 'VALIDATION_ERROR',
  TRAN_SERVICE_INVALID: 'VALIDATION_ERROR',
  TRAN_TYPE_INVALID: 'VALIDATION_ERROR',
  TRAN_DESCRIPTION_REQUIRED: 'VALIDATION_ERROR',
  TRAN_DESCRIPTION_TOO_LONG: 'VALIDATION_ERROR',
  TRAN_PROGRAM_REQUIRED: 'VALIDATION_ERROR',
  TRAN_DYNNR_INVALID: 'VALIDATION_ERROR',
  TRAN_PARENT_REQUIRED: 'VALIDATION_ERROR',
  TRAN_VARIANT_REQUIRED: 'VALIDATION_ERROR',
  TRAN_TRANSPORT_REQUIRED: 'VALIDATION_ERROR',
  TRAN_OO_NOT_SUPPORTED: 'VALIDATION_ERROR',
  TRAN_DELETE_UNSUPPORTED: 'VALIDATION_ERROR',
  TRAN_NOT_AUTHORIZED: 'AUTH_ERROR',
  TRAN_WRITE_CANCELLED: 'SAP_ERROR',
  TRAN_PACKAGE_INVALID: 'VALIDATION_ERROR',
  TRAN_PACKAGE_ASSIGN_FAILED: 'SAP_ERROR',
  TRAN_NAME_NOT_ALLOWED: 'VALIDATION_ERROR',
  TRAN_NAME_CONFLICT: 'VALIDATION_ERROR',
  TRAN_OBJECT_INCONSISTENT: 'SAP_ERROR',
  TRAN_DB_ACCESS_ERROR: 'SAP_ERROR',
  TRAN_WRITE_FAILED: 'SAP_ERROR',
  TRAN_TSTCC_WRITE_FAILED: 'SAP_ERROR',
  TRAN_AUTH_WRITE_FAILED: 'SAP_ERROR',
  TRAN_TADIR_DELETE_FAILED: 'SAP_ERROR',
  // VIEW
  VIEW_INVALID_PAYLOAD: 'VALIDATION_ERROR',
  VIEW_NAME_INVALID: 'VALIDATION_ERROR',
  VIEW_TYPE_INVALID: 'VALIDATION_ERROR',
  VIEW_REQUIRED_FIELD: 'VALIDATION_ERROR',
  VIEW_TABLE_NOT_FOUND: 'NOT_FOUND',
  VIEW_FIELD_INVALID: 'VALIDATION_ERROR',
  VIEW_INCONSISTENT: 'VALIDATION_ERROR',
  VIEW_WRITE_REFUSED: 'VALIDATION_ERROR',
  VIEW_WRITE_FAILED: 'SAP_ERROR',
  VIEW_ACTIVATION_FAILED: 'SAP_ERROR',
  VIEW_NOT_AUTHORIZED: 'AUTH_ERROR',
  VIEW_TRANSPORT_REQUIRED: 'VALIDATION_ERROR',
  VIEW_PACKAGE_ASSIGN_FAILED: 'SAP_ERROR',
  VIEW_DELETE_UNSUPPORTED: 'VALIDATION_ERROR',
  VIEW_DELETE_FAILED: 'SAP_ERROR',
  // SHLP
  SHLP_INVALID_PAYLOAD: 'VALIDATION_ERROR',
  SHLP_NAME_INVALID: 'VALIDATION_ERROR',
  SHLP_KIND_INVALID: 'VALIDATION_ERROR',
  SHLP_REQUIRED_FIELD: 'VALIDATION_ERROR',
  SHLP_SELECTION_METHOD_NOT_FOUND: 'NOT_FOUND',
  SHLP_FIELD_INVALID: 'VALIDATION_ERROR',
  SHLP_INCLUDED_NOT_FOUND: 'NOT_FOUND',
  SHLP_INCONSISTENT: 'VALIDATION_ERROR',
  SHLP_WRITE_REFUSED: 'VALIDATION_ERROR',
  SHLP_WRITE_FAILED: 'SAP_ERROR',
  SHLP_ACTIVATION_FAILED: 'SAP_ERROR',
  SHLP_NOT_AUTHORIZED: 'AUTH_ERROR',
  SHLP_TRANSPORT_REQUIRED: 'VALIDATION_ERROR',
  SHLP_PACKAGE_ASSIGN_FAILED: 'SAP_ERROR',
  SHLP_DELETE_UNSUPPORTED: 'VALIDATION_ERROR',
  SHLP_DELETE_FAILED: 'SAP_ERROR',
  // AFF
  AFF_SCHEMA_MISSING: 'VALIDATION_ERROR',
  AFF_SCHEMA_INVALID: 'VALIDATION_ERROR',
  AFF_SCHEMA_COMPILE_ERROR: 'VALIDATION_ERROR',
  AFF_FIXTURE_INVALID: 'VALIDATION_ERROR',
  DOCU_PUSH_FAILED: 'SAP_ERROR',
  SESSION_JAR_DECRYPT_FAILED: 'VALIDATION_ERROR',
  SESSION_INVALID: 'VALIDATION_ERROR',
  SESSION_REUSE_UNSUPPORTED: 'VALIDATION_ERROR',
  // 2 reserved-range categories
  CHANNEL_DETECTION_FAILED: 'CHANNEL_DETECT',
  DDLS_NOT_SUPPORTED_ON_ECC: 'DDLS_NOT_SUPPORTED',
  // bundled-service deploy merge
  DEPLOY_MANIFEST_INVALID: 'VALIDATION_ERROR',
  DEPLOY_MERGE_FAILED: 'VALIDATION_ERROR',
  // XSLT
  XSLT_OBJECT_NOT_FOUND: 'NOT_FOUND',
  XSLT_CREATE_FAILED: 'SAP_ERROR',
  XSLT_PUSH_FAILED: 'SAP_ERROR',
  XSLT_DELETE_FAILED: 'SAP_ERROR',
  XSLT_LOAD_FAILED: 'SAP_ERROR',
  XSLT_WRITE_CANCELLED: 'SAP_ERROR',
  XSLT_NOT_AUTHORIZED: 'AUTH_ERROR',
  XSLT_ACTIVATION_FAILED: 'VALIDATION_ERROR',
  XSLT_INVALID_PAYLOAD: 'VALIDATION_ERROR',
  XSLT_SERVICE_INVALID: 'VALIDATION_ERROR',
  XSLT_NAME_INVALID: 'VALIDATION_ERROR',
  XSLT_NAME_MISMATCH: 'VALIDATION_ERROR',
  XSLT_DESCRIPTION_REQUIRED: 'VALIDATION_ERROR',
  XSLT_DESCRIPTION_TOO_LONG: 'VALIDATION_ERROR',
  XSLT_SOURCE_REQUIRED: 'VALIDATION_ERROR',
  XSLT_SOURCE_LINE_TOO_LONG: 'VALIDATION_ERROR',
  XSLT_TRANSPORT_REQUIRED: 'VALIDATION_ERROR',
  XSLT_OBJECT_EXISTS: 'SAP_ERROR',
};

export function categoryOf(code: ErrorCode): ErrorCategory {
  return CATEGORY_OF_CODE[code];
}