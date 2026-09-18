*"* class-relevant local types for ZCL_ABAP_VIBE_ICF
*"* type pools used by lcl_mime (skwf_io / skwf_url / wbmr_c_skwf_appl_name).
TYPE-POOLS: skwf, wbmr.

TYPES:
  BEGIN OF ty_root_data,
    service TYPE string,
    version TYPE string,
  END OF ty_root_data,
  BEGIN OF ty_root,
    status TYPE string,
    data   TYPE ty_root_data,
  END OF ty_root,
  BEGIN OF ty_error_body,
    code    TYPE string,
    message TYPE string,
    details TYPE string_table,
  END OF ty_error_body,
  BEGIN OF ty_error,
    status TYPE string,
    error  TYPE ty_error_body,
  END OF ty_error,
  BEGIN OF ty_remote_source_data,
    objectType  TYPE string,
    objectName  TYPE string,
    version     TYPE string,
    source      TYPE string,
  END OF ty_remote_source_data,
  BEGIN OF ty_remote_source,
    status TYPE string,
    data   TYPE ty_remote_source_data,
  END OF ty_remote_source,
  BEGIN OF ty_http_header_lang,
    language     TYPE string,
    description  TYPE string,
  END OF ty_http_header_lang,
  tt_http_header_lang TYPE STANDARD TABLE OF ty_http_header_lang WITH EMPTY KEY,
  BEGIN OF ty_http_header,
    description          TYPE string,
    original_language    TYPE string,
    abap_language_version TYPE string,
    description_by_lang  TYPE tt_http_header_lang,
  END OF ty_http_header,
  BEGIN OF ty_http_general_information,
    handler_class TYPE string,
    url           TYPE string,
    service_id    TYPE string,
  END OF ty_http_general_information,
  BEGIN OF ty_http_service_data,
    format_version       TYPE string,
    header                TYPE ty_http_header,
    general_information   TYPE ty_http_general_information,
  END OF ty_http_service_data,
  BEGIN OF ty_http_service,
    status TYPE string,
    data   TYPE ty_http_service_data,
  END OF ty_http_service,
  BEGIN OF ty_http_write_data,
    name   TYPE string,
    type   TYPE string,
    action TYPE string,
  END OF ty_http_write_data,
  BEGIN OF ty_http_write,
    status TYPE string,
    data   TYPE ty_http_write_data,
  END OF ty_http_write.

" ----- transaction-code lookup (configured entry program only) -----
TYPES:
  BEGIN OF ty_tcode_entry,
    program TYPE string,
    screen  TYPE string,
  END OF ty_tcode_entry,
  BEGIN OF ty_tcode_target,
    kind     TYPE string,
    name     TYPE string,
    resolved TYPE abap_bool,
  END OF ty_tcode_target,
  BEGIN OF ty_tcode_resolution_step,
    tcode    TYPE string,
    kind     TYPE string,
    name     TYPE string,
    screen   TYPE string,
    relation TYPE string,
  END OF ty_tcode_resolution_step,
  tt_tcode_resolution_step TYPE STANDARD TABLE OF ty_tcode_resolution_step WITH EMPTY KEY,
  BEGIN OF ty_tcode_data,
    tcode            TYPE string,
    description      TYPE string,
    entry            TYPE ty_tcode_entry,
    target           TYPE ty_tcode_target,
    resolution_state TYPE string,
    resolution_chain TYPE tt_tcode_resolution_step,
  END OF ty_tcode_data,
  BEGIN OF ty_tcode,
    status TYPE string,
    data   TYPE ty_tcode_data,
  END OF ty_tcode.

" ----- textpool helpers (RS_TEXTPOOL_READ / target-specific write) -----
TYPES:
  BEGIN OF ty_textpool_elem,
    id   TYPE string,
    text TYPE string,
  END OF ty_textpool_elem,
  tt_textpool_elem TYPE STANDARD TABLE OF ty_textpool_elem WITH EMPTY KEY,
  BEGIN OF ty_textpool_data,
    object   TYPE string,
    type     TYPE string,
    category TYPE string,
    elements TYPE tt_textpool_elem,
  END OF ty_textpool_data,
  BEGIN OF ty_textpool_get,
    status TYPE string,
    data   TYPE ty_textpool_data,
  END OF ty_textpool_get.

" ----- DDIC shared helpers (extracted from reference implementation) -----
TYPES:
  BEGIN OF ty_field,
    fieldName   TYPE fieldname,
    precField   TYPE dd03p-precfield,
    rollname    TYPE rollname,
    dataType    TYPE dd03p-datatype,
    length      TYPE dd03p-leng,
    decimals    TYPE dd03p-decimals,
    keyFlag     TYPE abap_bool,
    notNull     TYPE abap_bool,
    ddtext      TYPE dd03p-ddtext,
    refTable    TYPE dd03p-reftable,
    refField    TYPE dd03p-reffield,
    checkTable  TYPE dd03p-checktable,
  END OF ty_field,
  tt_field TYPE STANDARD TABLE OF ty_field WITH EMPTY KEY.

" 037 US1: AFF canonical wire shape. CLI sends nested payloads (DOMA
" `format.*`, DTEL `dataTypeInformation.*`, TABL/STRU `header.*` +
" `generalInformation.*`); the handlers deserialize these into the
" nested structs below. SAP-side single-side break: flat top-level
" fields are no longer accepted (CLI wire-to-local still tolerates
" flat as a back-compat shim for legacy readers).
TYPES:
  BEGIN OF ty_ddic_header,
    description            TYPE string,
    original_language      TYPE string,
    abap_language_version  TYPE string,
  END OF ty_ddic_header,
  BEGIN OF ty_tabl_general_information,
    delivery_class      TYPE string,
    data_class_category TYPE string,
    size_category       TYPE string,
    client_dependent    TYPE abap_bool,
    allow_maintenance   TYPE abap_bool,
  END OF ty_tabl_general_information.

  " P2.1: technical settings for apply_ddic_table_settings (TABT writeback).
  " Mirrors `tabt-v1.json#buffering` + `dbSpecificSettings`, plus the
  " apply-time fields (logChanges/translation) nested under
  " generalInformation but the plan flattens here for readability.
  TYPES:
    BEGIN OF ty_ddic_table_buffering,
      state                       TYPE string,
      type                        TYPE string,
      nr_of_key_flds4_generic_buff TYPE i,
    END OF ty_ddic_table_buffering,
    BEGIN OF ty_ddic_table_db_specific,
      storage_type TYPE string,
      load_unit    TYPE string,
    END OF ty_ddic_table_db_specific,
    BEGIN OF ty_ddic_table_settings,
      log_changes          TYPE abap_bool,
      writable_by_amdp     TYPE abap_bool,
      translation          TYPE string,
      buffering            TYPE ty_ddic_table_buffering,
      db_specific_settings TYPE ty_ddic_table_db_specific,
  END OF ty_ddic_table_settings,
  BEGIN OF ty_doma_format,
    data_type TYPE string,
    length    TYPE string,
    decimals  TYPE string,
    sign_flag TYPE string,
    lowercase TYPE string,
    conv_exit TYPE string,
  END OF ty_doma_format,
  BEGIN OF ty_doma_output,
    length TYPE string,
    style  TYPE string,
  END OF ty_doma_output,
  BEGIN OF ty_doma_fixed_value,
    fixed_value TYPE string,
    description TYPE string,
  END OF ty_doma_fixed_value,
  tt_doma_fixed_value TYPE STANDARD TABLE OF ty_doma_fixed_value WITH EMPTY KEY,
  BEGIN OF ty_dtel_data_type_info,
    category             TYPE string,
    type_name            TYPE string,
    predefined_data_type TYPE string,
    predefined_length    TYPE string,
    predefined_decimals  TYPE string,
  END OF ty_dtel_data_type_info.

" ----- read-only table data query (SE16N equivalent) -----
" Wire payload type (camelCase — matches /ui2/cl_json pretty_mode-camel_case).
TYPES:
  BEGIN OF ty_query_request,
    table    TYPE string,
    fields   TYPE string_table,
    where    TYPE string,
    limit    TYPE i,
    offset   TYPE i,
    orderby  TYPE string_table,
    countonly TYPE abap_bool,
  END OF ty_query_request,
  BEGIN OF ty_query_orderby,
    field     TYPE string,
    direction TYPE string,
  END OF ty_query_orderby,
  tt_query_orderby TYPE STANDARD TABLE OF ty_query_orderby WITH EMPTY KEY,
  BEGIN OF ty_query_field,
    name      TYPE string,
    dataType  TYPE string,
    length    TYPE i,
    decimals  TYPE i,
  END OF ty_query_field,
  tt_query_field TYPE STANDARD TABLE OF ty_query_field WITH EMPTY KEY,
  BEGIN OF ty_query_metadata,
    name           TYPE string,
    tabclass       TYPE string,
    clientDependent TYPE abap_bool,
    fields         TYPE tt_query_field,
    excludedFields TYPE string_table,
  END OF ty_query_metadata,
  BEGIN OF ty_where_condition,
    field     TYPE string,
    operator  TYPE string,
    value     TYPE string,
    valueKind TYPE string,    " 'string' | 'number'
    bindVar   TYPE string,    " host-variable name to embed in @-placeholder
  END OF ty_where_condition,
  tt_where_condition TYPE STANDARD TABLE OF ty_where_condition WITH EMPTY KEY.

" select wire payloads: rows is a partial-JSON piece (native values,
" uppercase field names via pretty_mode-none); envelope is camelCase.
TYPES:
  BEGIN OF ty_select_result_data,
    table           TYPE string,
    object_type     TYPE string,
    fields          TYPE string_table,
    rows            TYPE /ui2/cl_json=>json,
    row_count       TYPE i,
    truncated       TYPE abap_bool,
    excluded_fields TYPE string_table,
    duration_ms     TYPE i,
  END OF ty_select_result_data,
  BEGIN OF ty_select_result,
    status TYPE string,
    data   TYPE ty_select_result_data,
  END OF ty_select_result,
  BEGIN OF ty_select_count_data,
    table       TYPE string,
    count       TYPE i,
    duration_ms TYPE i,
  END OF ty_select_count_data,
  BEGIN OF ty_select_count,
    status TYPE string,
    data   TYPE ty_select_count_data,
  END OF ty_select_count.

" ----- DDIC operations (POST create/overwrite, GET pull) -----
TYPES:
  BEGIN OF ty_ddic_create_data,
    name   TYPE string,
    type   TYPE string,
    action TYPE string,
  END OF ty_ddic_create_data,
  BEGIN OF ty_ddic_create,
    status TYPE string,
    data   TYPE ty_ddic_create_data,
  END OF ty_ddic_create,
  BEGIN OF ty_ddic_get,
    status TYPE string,
    data   TYPE REF TO data,
  END OF ty_ddic_get.
" DDIC GET (pull) wire payloads — component names target the camelCase wire
" (field_name → fieldName etc.); booleans are abap_bool (→ JSON true/false).
TYPES:
  BEGIN OF ty_ddic_field_out,
    field_name TYPE string,
    rollname   TYPE string,
    data_type  TYPE string,
    length     TYPE i,
    decimals   TYPE i,
    key_flag   TYPE abap_bool,
    not_null   TYPE abap_bool,
  END OF ty_ddic_field_out,
  tt_ddic_field_out TYPE STANDARD TABLE OF ty_ddic_field_out WITH EMPTY KEY,
  BEGIN OF ty_ddic_field_out_stru,
    field_name TYPE string,
    rollname   TYPE string,
    data_type  TYPE string,
    length     TYPE i,
    decimals   TYPE i,
    key_flag   TYPE abap_bool,
  END OF ty_ddic_field_out_stru,
  tt_ddic_field_out_stru TYPE STANDARD TABLE OF ty_ddic_field_out_stru WITH EMPTY KEY,
  " 037 US1: read-side payloads mirror AFF nested wire so the ICF client
  " can consume `format.*` / `dataTypeInformation.*` without remapping.
  BEGIN OF ty_ddic_get_doma_data,
    name        TYPE string,
    type        TYPE string,
    description TYPE string,
    format      TYPE ty_doma_format,
  END OF ty_ddic_get_doma_data,
  BEGIN OF ty_ddic_get_dtel_data,
    name                  TYPE string,
    type                  TYPE string,
    description           TYPE string,
    data_type_information TYPE ty_dtel_data_type_info,
    short_text            TYPE string,
    medium_text           TYPE string,
    long_text             TYPE string,
    header_text           TYPE string,
  END OF ty_ddic_get_dtel_data,
  BEGIN OF ty_ddic_get_tabl_data,
    name             TYPE string,
    type             TYPE string,
    description      TYPE string,
    delivery_class   TYPE string,
    data_class       TYPE string,
    size_category    TYPE string,
    client_dependent TYPE abap_bool,
    fields           TYPE tt_ddic_field_out,
  END OF ty_ddic_get_tabl_data,
  BEGIN OF ty_ddic_get_stru_data,
    name        TYPE string,
    type        TYPE string,
    description TYPE string,
    fields      TYPE tt_ddic_field_out_stru,
  END OF ty_ddic_get_stru_data.

" ----- Transaction Code (SE93) CRUD over abap-file-format tran-v1 -----
TYPES:
  BEGIN OF ty_tran_dialog,
    program_name          TYPE string,
    program_dynnr         TYPE string,
    stv_maintenance_mode  TYPE string,
  END OF ty_tran_dialog,
  BEGIN OF ty_tran_pv,
    parameter_name  TYPE string,
    parameter_value TYPE string,
  END OF ty_tran_pv,
  tt_tran_pv TYPE STANDARD TABLE OF ty_tran_pv WITH EMPTY KEY,
  BEGIN OF ty_tran_param,
    par_parent_transaction_code TYPE string,
    skip_initial_screen_mode    TYPE string,
    parameter_values            TYPE tt_tran_pv,
  END OF ty_tran_param,
  BEGIN OF ty_tran_report,
    report_name         TYPE string,
    report_dynnr        TYPE string,
    report_variant_name TYPE string,
  END OF ty_tran_report,
  BEGIN OF ty_tran_oo,
    local_in_program_indi     TYPE abap_bool,
    class_program_name        TYPE string,
    class_name                TYPE string,
    method_name               TYPE string,
    oo_transaction_model_indi TYPE abap_bool,
    update_mode               TYPE string,
  END OF ty_tran_oo,
  BEGIN OF ty_tran_variant,
    var_parent_transaction_code  TYPE string,
    transaction_variant_ci_indi  TYPE abap_bool,
    transaction_ci_variant_name  TYPE string,
    transaction_variant_name     TYPE string,
  END OF ty_tran_variant,
  BEGIN OF ty_tran_general,
    transaction_type      TYPE string,
    lock_status           TYPE string,
    dialog_transaction    TYPE ty_tran_dialog,
    parameter_transaction TYPE ty_tran_param,
    report_transaction    TYPE ty_tran_report,
    oo_transaction        TYPE ty_tran_oo,
    variant_transaction   TYPE ty_tran_variant,
  END OF ty_tran_general,
  BEGIN OF ty_tran_service,
    application_name TYPE string,
    application_type TYPE string,
    program_id       TYPE string,
    object_type      TYPE string,
    object_name      TYPE string,
    service_type     TYPE string,
    service          TYPE string,
  END OF ty_tran_service,
  tt_tran_service TYPE STANDARD TABLE OF ty_tran_service WITH EMPTY KEY,
  BEGIN OF ty_tran_rel,
    relationship_type TYPE string,
    related_tcode     TYPE string,
  END OF ty_tran_rel,
  tt_tran_rel TYPE STANDARD TABLE OF ty_tran_rel WITH EMPTY KEY,
  BEGIN OF ty_tran_srv_rel,
    relationship_type        TYPE string,
    related_application_type TYPE string,
    related_application_name TYPE string,
    program_id               TYPE string,
    object_type              TYPE string,
    object_name              TYPE string,
    service_type             TYPE string,
    service                  TYPE string,
  END OF ty_tran_srv_rel,
  tt_tran_srv_rel TYPE STANDARD TABLE OF ty_tran_srv_rel WITH EMPTY KEY,
  BEGIN OF ty_tran_ui,
    inheritance_mode  TYPE string,
    ui_classification TYPE string,
    iac_service_name  TYPE string,
    pervasive_mode    TYPE string,
    webgui_mode       TYPE string,
    platin_mode       TYPE string,
    win32_mode        TYPE string,
  END OF ty_tran_ui,
  BEGIN OF ty_tran_user_interface,
    ui_attributes TYPE ty_tran_ui,
  END OF ty_tran_user_interface,
  BEGIN OF ty_tran_sao_fv,
    auth_field_name  TYPE string,
    auth_field_value TYPE string,
  END OF ty_tran_sao_fv,
  tt_tran_sao_fv TYPE STANDARD TABLE OF ty_tran_sao_fv WITH EMPTY KEY,
  BEGIN OF ty_tran_sao,
    auth_object_name         TYPE string,
    auth_object_field_values TYPE tt_tran_sao_fv,
  END OF ty_tran_sao,
  BEGIN OF ty_tran_ad_fv,
    auth_field_name       TYPE string,
    auth_field_low_value  TYPE string,
    auth_field_high_value TYPE string,
  END OF ty_tran_ad_fv,
  tt_tran_ad_fv TYPE STANDARD TABLE OF ty_tran_ad_fv WITH EMPTY KEY,
  BEGIN OF ty_tran_ad_ao,
    auth_object_name         TYPE string,
    maintenance_status       TYPE string,
    documentation            TYPE string,
    auth_object_field_values TYPE tt_tran_ad_fv,
  END OF ty_tran_ad_ao,
  tt_tran_ad_ao TYPE STANDARD TABLE OF ty_tran_ad_ao WITH EMPTY KEY,
  BEGIN OF ty_tran_ad,
    maintenance_mode        TYPE string,
    default_values_required TYPE string,
    inheritance_mode        TYPE string,
    documentation           TYPE string,
    auth_objects            TYPE tt_tran_ad_ao,
  END OF ty_tran_ad,
  BEGIN OF ty_tran_auth,
    start_authorization_object TYPE ty_tran_sao,
    authorization_defaults     TYPE ty_tran_ad,
  END OF ty_tran_auth,
  BEGIN OF ty_tran_header,
    description           TYPE string,
    original_language     TYPE string,
    abap_language_version TYPE string,
  END OF ty_tran_header,
  BEGIN OF ty_tran_data,
    format_version            TYPE string,
    header                    TYPE ty_tran_header,
    general_information       TYPE ty_tran_general,
    transaction_services      TYPE tt_tran_service,
    transaction_relationships TYPE tt_tran_rel,
    service_relationships     TYPE tt_tran_srv_rel,
    user_interface            TYPE ty_tran_user_interface,
    authorizations            TYPE ty_tran_auth,
  END OF ty_tran_data,
  BEGIN OF ty_tran_write,
    name   TYPE string,
    type   TYPE string,
    action TYPE string,
  END OF ty_tran_write,
  BEGIN OF ty_tran_service_response,
    status TYPE string,
    data   TYPE ty_tran_data,
  END OF ty_tran_service_response,
  BEGIN OF ty_tran_write_response,
    status TYPE string,
    data   TYPE ty_tran_write,
  END OF ty_tran_write_response.

" ----- MIME Repository folder/resource operations -----
" Backed by CL_MIME_REPOSITORY_API (SE80 MIME repository); the classic
" SCMS_R_*/SCMS_UPLOAD_FILE function modules do not exist on S/4HANA.
" Request wire payloads are camelCase (via /ui2/cl_json pretty_mode-camel_case):
"   folder create: { path, package, description, transportRequest }
"   folder delete: { path }            (recursive/transport come from query)
"   resource push: { path, contentBase64, transportRequest }
TYPES:
  BEGIN OF ty_mime_folder_create,
    path              TYPE string,
    package           TYPE string,
    description       TYPE string,
    transport_request TYPE string,
  END OF ty_mime_folder_create,
  BEGIN OF ty_mime_folder_delete,
    path TYPE string,
  END OF ty_mime_folder_delete,
  BEGIN OF ty_mime_resource_upload,
    path              TYPE string,
    content_base64    TYPE string,
    transport_request TYPE string,
  END OF ty_mime_resource_upload,
  BEGIN OF ty_mime_folder_data,
    path   TYPE string,
    kind   TYPE string,
    action TYPE string,
  END OF ty_mime_folder_data,
  BEGIN OF ty_mime_folder_write,
    status TYPE string,
    data   TYPE ty_mime_folder_data,
  END OF ty_mime_folder_write,
  BEGIN OF ty_mime_delete_data,
    path   TYPE string,
    action TYPE string,
  END OF ty_mime_delete_data,
  BEGIN OF ty_mime_delete_write,
    status TYPE string,
    data   TYPE ty_mime_delete_data,
  END OF ty_mime_delete_write,
  BEGIN OF ty_mime_resource_data,
    path TYPE string,
  END OF ty_mime_resource_data,
  BEGIN OF ty_mime_resource_write,
    status TYPE string,
    data   TYPE ty_mime_resource_data,
  END OF ty_mime_resource_write.

CLASS lcl_response DEFINITION.
  PUBLIC SECTION.
    CONSTANTS gc_service TYPE string VALUE 'abap_cli'.
    CONSTANTS gc_version TYPE string VALUE '0.6.0'.

    CLASS-METHODS handle_root
      IMPORTING io_server TYPE REF TO if_http_server
                iv_method TYPE string.

    CLASS-METHODS handle_class_check
      IMPORTING io_server TYPE REF TO if_http_server.

    " ----- routing + helpers -----
    CLASS-METHODS respond_json
      IMPORTING io_server  TYPE REF TO if_http_server
                iv_status  TYPE i
                iv_reason  TYPE string
                is_payload TYPE any.
    CLASS-METHODS respond_error
      IMPORTING io_server  TYPE REF TO if_http_server
                iv_status  TYPE i
                iv_reason  TYPE string
                iv_code    TYPE string
                iv_msg     TYPE string
                iv_details TYPE any OPTIONAL.
    CLASS-METHODS escape_probe_needed
      RETURNING VALUE(rv_needed) TYPE abap_bool.
    CLASS-METHODS escape_json_string
      IMPORTING iv_value TYPE string
      RETURNING VALUE(rv_value) TYPE string.
    CLASS-METHODS escape_json_strings
      CHANGING cv_data TYPE any.
    CLASS-METHODS query_param
      IMPORTING iv_query TYPE string
                iv_name  TYPE string
      RETURNING VALUE(rv_value) TYPE string.
  PRIVATE SECTION.
    " vhcala4hci deploys an old /UI2/CL_JSON that does NOT escape JSON
    " string values — probe once and escape ourselves when needed.
    CLASS-DATA gv_escape_needed TYPE abap_bool.
    " Single JSON generation entries (build success/error responses via these).
    CLASS-METHODS serialize_response
      IMPORTING is_payload TYPE any
      RETURNING VALUE(rv_json) TYPE string.
    CLASS-METHODS serialize_error
      IMPORTING iv_code    TYPE string
                iv_message TYPE string
                iv_details TYPE any OPTIONAL
      RETURNING VALUE(rv_json) TYPE string.
ENDCLASS.

CLASS lcl_mime DEFINITION.
  PUBLIC SECTION.

    CLASS-METHODS dispatch_mime
      IMPORTING io_server TYPE REF TO if_http_server
                iv_path   TYPE string
                iv_method TYPE string
                iv_body   TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS respond_mime_error
      IMPORTING io_server TYPE REF TO if_http_server
                is_error  TYPE ty_error.
    CLASS-METHODS validate_mime_path
      IMPORTING iv_path TYPE string
      RETURNING VALUE(rv_error) TYPE string.
    " Deterministic URL existence check: walks the MIME path segment-wise with
    " folder-scoped SKWF namespace lookups (the same resolution create_folder
    " uses). CL_MIME_REPOSITORY_API's own get_io_for_url raises inconsistent
    " error codes for missing roots vs missing nested folders.
    CLASS-METHODS mime_url_exists
      IMPORTING iv_url TYPE string
      RETURNING VALUE(rv_exists) TYPE abap_bool.
    CLASS-METHODS mime_create_folder
      IMPORTING iv_body   TYPE string
      EXPORTING es_payload TYPE ty_mime_folder_write
                ev_error   TYPE ty_error.
    CLASS-METHODS mime_delete_folder
      IMPORTING iv_body      TYPE string
                iv_recursive TYPE abap_bool
                iv_transport TYPE trkorr
      EXPORTING es_payload   TYPE ty_mime_delete_write
                ev_error     TYPE ty_error.
    CLASS-METHODS mime_upload_resource
      IMPORTING iv_body   TYPE string
      EXPORTING es_payload TYPE ty_mime_resource_write
                ev_error   TYPE ty_error.
    CLASS-METHODS mime_last_sap_message
      RETURNING VALUE(rv_message) TYPE string.
ENDCLASS.

CLASS lcl_http DEFINITION.
  PUBLIC SECTION.
    CLASS-METHODS dispatch_http
      IMPORTING io_server   TYPE REF TO if_http_server
                iv_path     TYPE string
                iv_method   TYPE string
                iv_body     TYPE string.
  PRIVATE SECTION.
    " Reflect the ABAP language version of a handler class. Returns 'cloudDevelopment'
    " or 'standard'; falls back to 'standard' when the class cannot be introspected
    " (e.g. not yet activated, no RTTI access, or handler is empty).
    CLASS-METHODS resolve_handler_lang_version
      IMPORTING iv_class_name TYPE string
      RETURNING VALUE(rv_version) TYPE string.
ENDCLASS.

CLASS lcl_ddic DEFINITION.
  PUBLIC SECTION.

    " ----- DDIC + textpool dispatchers (inlined per user adjustment) -----
    CLASS-METHODS dispatch_ddic
      IMPORTING io_server   TYPE REF TO if_http_server
                iv_path     TYPE string
                iv_method   TYPE string
                iv_body     TYPE string.
  PRIVATE SECTION.

    CLASS-METHODS get_uuid
      RETURNING VALUE(rv_uuid) TYPE sysuuid-c.

    CLASS-METHODS build_table_header
      IMPORTING iv_table_name     TYPE tabname
                iv_description    TYPE ddtext
                iv_tabclass       TYPE dd02l-tabclass DEFAULT 'TRANSP'
                iv_delivery_class TYPE dd02v-contflag DEFAULT 'A'
                iv_data_class     TYPE dd09l-tabart DEFAULT 'APPL0'
                iv_size_category  TYPE dd09l-tabkat DEFAULT '0'
                iv_exclass        TYPE dd02v-exclass DEFAULT '2'
      EXPORTING es_object_new     TYPE coms_gox_def_header
                et_object_new     TYPE comt_gox_def_header
                et_bapireturn     TYPE bapirettab.

    CLASS-METHODS build_field_entries
      IMPORTING iv_parent_key TYPE comt_gox_key_guid
                iv_table_name TYPE tabname
                it_fields     TYPE tt_field
                iv_start_pos  TYPE i DEFAULT 1
      EXPORTING et_object_new TYPE comt_gox_def_header
                et_bapireturn TYPE bapirettab.
    " P2.1: TABT writeback - apply buffering/storageType/loadUnit/logChanges/translation
    " to an existing TABL via DDIF_TABL_GET + DDIF_TABL_PUT. The wire payload
    " nested `is_settings-general_information-*` paths; this type keeps them flat.
    CLASS-METHODS apply_ddic_table_settings
      IMPORTING iv_name     TYPE tabname
                iv_payload  TYPE string
                is_settings TYPE ty_ddic_table_settings
      EXPORTING ev_error    TYPE ty_error.

    CLASS-METHODS create_ddic_table
      IMPORTING iv_name    TYPE tabname
                iv_payload TYPE string
                iv_package TYPE devclass
                iv_request TYPE trkorr
      EXPORTING es_payload TYPE ty_ddic_create
                ev_error   TYPE ty_error.

    CLASS-METHODS create_ddic_structure
      IMPORTING iv_name    TYPE tabname
                iv_payload TYPE string
                iv_package TYPE devclass
                iv_request TYPE trkorr
      EXPORTING es_payload TYPE ty_ddic_create
                ev_error   TYPE ty_error.

    CLASS-METHODS create_ddic_data_element
      IMPORTING iv_name    TYPE rollname
                iv_payload TYPE string
                iv_package TYPE devclass
                iv_request TYPE trkorr
      EXPORTING es_payload TYPE ty_ddic_create
                ev_error   TYPE ty_error.

    CLASS-METHODS create_ddic_domain
      IMPORTING iv_name    TYPE domname
                iv_payload TYPE string
                iv_package TYPE devclass
                iv_request TYPE trkorr
      EXPORTING es_payload TYPE ty_ddic_create
                ev_error   TYPE ty_error.

    CLASS-METHODS create_ddic_enqu
      IMPORTING iv_name    TYPE viewname
                iv_payload TYPE string
                iv_package TYPE devclass
                iv_request TYPE trkorr
      EXPORTING es_payload TYPE ty_ddic_create
                ev_error   TYPE ty_error.

    CLASS-METHODS language_key_from_code
      IMPORTING iv_code       TYPE string
      RETURNING VALUE(rv_key) TYPE sy-langu.

    CLASS-METHODS enqmode_from_lock_mode
      IMPORTING iv_lock_mode      TYPE string
      RETURNING VALUE(rv_enqmode) TYPE dd27p-enqmode.

    CLASS-METHODS create_ddic_nrob
      IMPORTING iv_name    TYPE nrobj
                iv_payload TYPE string
                iv_package TYPE devclass
                iv_request TYPE trkorr
      EXPORTING es_payload TYPE ty_ddic_create
                ev_error   TYPE ty_error.

    CLASS-METHODS get_ddic_object
      IMPORTING iv_type    TYPE string
                iv_name    TYPE string
      EXPORTING es_payload TYPE REF TO data
                ev_error   TYPE ty_error.

    " 036: ICF fallback writes for the two types ECC EHP5/6 cannot serve via ADT.
    CLASS-METHODS write_ddic_table_type
      IMPORTING iv_name    TYPE ttypename
                iv_payload TYPE string
                iv_package TYPE devclass
                iv_request TYPE trkorr
      EXPORTING es_payload TYPE ty_ddic_create
                ev_error   TYPE ty_error.

    CLASS-METHODS write_ddic_message_class
      IMPORTING iv_name    TYPE arbgb
                iv_payload TYPE string
                iv_package TYPE devclass
                iv_request TYPE trkorr
      EXPORTING es_payload TYPE ty_ddic_create
                ev_error   TYPE ty_error.
ENDCLASS.

CLASS lcl_textpool DEFINITION.
  PUBLIC SECTION.
    CLASS-METHODS dispatch_textpool
      IMPORTING io_server   TYPE REF TO if_http_server
                iv_path     TYPE string
                iv_method   TYPE string.
  PRIVATE SECTION.

    CLASS-METHODS get_textpool_elements
      IMPORTING iv_category TYPE string
                iv_object   TYPE string
                iv_objtype  TYPE string
      EXPORTING es_payload  TYPE ty_textpool_get
                ev_error    TYPE ty_error.
ENDCLASS.

CLASS lcl_tcode DEFINITION.
  PUBLIC SECTION.

    CLASS-METHODS dispatch_tcode
      IMPORTING io_server TYPE REF TO if_http_server
                iv_path   TYPE string
                iv_method TYPE string.

    CLASS-METHODS dispatch_tran
      IMPORTING io_server TYPE REF TO if_http_server
                iv_path   TYPE string
                iv_method TYPE string
                iv_body   TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS read_tcode
      IMPORTING iv_tcode   TYPE tstc-tcode
      EXPORTING es_payload TYPE ty_tcode
                ev_error   TYPE ty_error.
    CLASS-METHODS read_tran_tstc
      IMPORTING iv_tcode TYPE tstc-tcode
      RETURNING VALUE(es_tstc) TYPE tstc.
    CLASS-METHODS build_tran_payload
      IMPORTING iv_tcode    TYPE tstc-tcode
      RETURNING VALUE(es_payload) TYPE ty_tran_data.
ENDCLASS.

CLASS lcl_data DEFINITION.
  PUBLIC SECTION.

    " Constants for the query engine.
    CONSTANTS:
      gc_query_limit_max  TYPE i VALUE 10000,
      gc_query_offset_max TYPE i VALUE 100000,
      gc_query_limit_def  TYPE i VALUE 100.

    " Large-object datatype set — STRG/RSTR/LCHR/LRAW are excluded from output when
    " --fields is not specified, and rejected explicitly when it is.
    CONSTANTS:
      gc_large_object_types TYPE string VALUE 'STRG|RSTR|LCHR|LRAW'.

    CLASS-METHODS dispatch_data
      IMPORTING io_server TYPE REF TO if_http_server
                iv_path   TYPE string
                iv_method TYPE string
                iv_body   TYPE string.
  PRIVATE SECTION.

    CLASS-METHODS parse_data_query
      IMPORTING iv_body       TYPE string
      EXPORTING VALUE(es_req) TYPE ty_query_request
                VALUE(ev_ok)  TYPE abap_bool
                VALUE(ev_err_code) TYPE string
                VALUE(ev_err_msg)  TYPE string
                VALUE(ev_err_details) TYPE string.

    CLASS-METHODS read_table_metadata
      IMPORTING iv_name       TYPE clike
      EXPORTING VALUE(es_meta) TYPE ty_query_metadata
                VALUE(ev_ok)   TYPE abap_bool
                VALUE(ev_err_code) TYPE string
                VALUE(ev_err_msg)  TYPE string
                VALUE(ev_err_details) TYPE string
                VALUE(ev_err_http)  TYPE i.

    CLASS-METHODS parse_where_clause
      IMPORTING iv_where      TYPE string
                it_fields     TYPE tt_query_field
      EXPORTING VALUE(et_conditions) TYPE tt_where_condition
                VALUE(ev_ok)   TYPE abap_bool
                VALUE(ev_err_code) TYPE string
                VALUE(ev_err_msg)  TYPE string
                VALUE(ev_err_offset) TYPE i.
    CLASS-METHODS execute_select
      IMPORTING is_meta      TYPE ty_query_metadata
                iv_fields_csv TYPE string
                it_where      TYPE tt_where_condition
                it_orderby    TYPE tt_query_orderby
                iv_limit      TYPE i
                iv_offset     TYPE i
      EXPORTING es_payload   TYPE ty_select_result
                ev_error     TYPE ty_error.

    CLASS-METHODS execute_count
      IMPORTING is_meta      TYPE ty_query_metadata
                it_where      TYPE tt_where_condition
      EXPORTING es_payload   TYPE ty_select_count
                ev_error     TYPE ty_error.
ENDCLASS.

CLASS lcl_version DEFINITION.
  PUBLIC SECTION.
    CLASS-METHODS dispatch_version_management
      IMPORTING io_server TYPE REF TO if_http_server
                iv_path   TYPE string
                iv_method TYPE string.
ENDCLASS.
