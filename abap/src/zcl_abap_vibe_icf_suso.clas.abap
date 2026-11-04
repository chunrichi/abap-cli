CLASS zcl_abap_vibe_icf_suso DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS dispatch
      IMPORTING io_server TYPE REF TO if_http_server
                iv_path   TYPE string
                iv_method TYPE string
                iv_body   TYPE string.
  PRIVATE SECTION.
    " ----- constants -----
    CONSTANTS:
      gc_longtext_id  TYPE dokil-id   VALUE 'UO',
      gc_tadir_object TYPE trobjtype  VALUE 'SUSO',
      gc_read_act     TYPE activ_auth VALUE '03',
      gc_create_act   TYPE activ_auth VALUE '01',
      gc_delete_act   TYPE activ_auth VALUE '06'.

    " ----- wire document (camelCase JSON, AFF-shaped suso-v1) -----
    TYPES:
      BEGIN OF ty_header,
        description           TYPE string,
        original_language     TYPE string,
        abap_language_version TYPE string,
      END OF ty_header,
      BEGIN OF ty_general_information,
        object_class TYPE string,
        field_block  TYPE string,
        conversion   TYPE abap_bool,
      END OF ty_general_information,
      BEGIN OF ty_field,
        authorization_field TYPE string,
      END OF ty_field,
      tt_field TYPE STANDARD TABLE OF ty_field WITH EMPTY KEY,
      BEGIN OF ty_activity,
        activity TYPE string,
      END OF ty_activity,
      tt_activity TYPE STANDARD TABLE OF ty_activity WITH EMPTY KEY,
      BEGIN OF ty_object_attributes,
        criticality                TYPE string,
        class_copy_to_default_data TYPE string,
      END OF ty_object_attributes,
      BEGIN OF ty_sap_new_value,
        release     TYPE string,
        line_number TYPE string,
        field       TYPE string,
        low         TYPE string,
        high        TYPE string,
      END OF ty_sap_new_value,
      tt_sap_new_value TYPE STANDARD TABLE OF ty_sap_new_value WITH EMPTY KEY,
      BEGIN OF ty_sap_new_relevance,
        is_relevant_to_sap_new TYPE abap_bool,
        values                 TYPE tt_sap_new_value,
      END OF ty_sap_new_relevance,
      BEGIN OF ty_cds_classification,
        usage_in_own_auth_context     TYPE string,
        usage_in_privileged_bdef_mode TYPE string,
      END OF ty_cds_classification,
      BEGIN OF ty_document,
        format_version              TYPE string,
        header                      TYPE ty_header,
        general_information         TYPE ty_general_information,
        authorization_fields        TYPE tt_field,
        permitted_activities        TYPE tt_activity,
        object_attributes           TYPE ty_object_attributes,
        sap_new_relevance           TYPE ty_sap_new_relevance,
        classification_for_cds_bdef TYPE ty_cds_classification,
        long_text                   TYPE string,
      END OF ty_document,
      BEGIN OF ty_get_data,
        format_version              TYPE string,
        header                      TYPE ty_header,
        general_information         TYPE ty_general_information,
        authorization_fields        TYPE tt_field,
        permitted_activities        TYPE tt_activity,
        object_attributes           TYPE ty_object_attributes,
        sap_new_relevance           TYPE ty_sap_new_relevance,
        classification_for_cds_bdef TYPE ty_cds_classification,
        long_text                   TYPE string,
        name                        TYPE string,
        package                     TYPE string,
      END OF ty_get_data,
      BEGIN OF ty_get_payload,
        status TYPE string,
        data   TYPE ty_get_data,
      END OF ty_get_payload,
      BEGIN OF ty_write_data,
        name                        TYPE string,
        type                        TYPE string,
        action                      TYPE string,
        package                     TYPE string,
        activated                   TYPE abap_bool,
        profiles_regenerated        TYPE abap_bool,
        profiles_regeneration_error TYPE string,
      END OF ty_write_data,
      BEGIN OF ty_write_payload,
        status TYPE string,
        data   TYPE ty_write_data,
      END OF ty_write_payload.

    " ----- SAP payload assembled from the document -----
    TYPES:
      BEGIN OF ty_sap_payload,
        head        TYPE susr_s_tobj_head,
        fields      TYPE susr_t_xufield,
        activities  TYPE cl_suso_gen=>tt_activity,
        sapnew_rel  TYPE if_su21_adt_object=>tt_tobjvor,
        sapnew_val  TYPE if_su21_adt_object=>tt_tobjvordat,
        trace_flag  TYPE tobjvorflg-flag2,
        criticality TYPE tobjvorflg-flag3,
        own_context TYPE tobjvorflg-flag4,
        privileged  TYPE tobjvorflg-flag5,
        fblock      TYPE tobj-fblock,
        conversion  TYPE tobj-conversion,
        language    TYPE sy-langu,
        long_text   TYPE string,
      END OF ty_sap_payload.

    " ----- entry points per HTTP method -----
    CLASS-METHODS dispatch_post
      IMPORTING io_server TYPE REF TO if_http_server
                iv_name   TYPE string
                iv_query  TYPE string
                iv_body   TYPE string.

    CLASS-METHODS dispatch_put
      IMPORTING io_server TYPE REF TO if_http_server
                iv_name   TYPE string
                iv_query  TYPE string
                iv_body   TYPE string.

    CLASS-METHODS dispatch_delete
      IMPORTING io_server TYPE REF TO if_http_server
                iv_name   TYPE string
                iv_query  TYPE string.

    " ----- request parsing / document validation -----
    CLASS-METHODS route_name
      IMPORTING iv_path TYPE string
      EXPORTING ev_name TYPE string
                ev_ok   TYPE abap_bool
                ev_code TYPE string
                ev_msg  TYPE string.

    CLASS-METHODS validate_name
      IMPORTING iv_name TYPE string
      EXPORTING ev_ok   TYPE abap_bool
                ev_code TYPE string
                ev_msg  TYPE string.

    CLASS-METHODS parse_document
      IMPORTING iv_body TYPE string
      CHANGING  cs_doc  TYPE ty_document
      RETURNING VALUE(rv_ok) TYPE abap_bool.

    CLASS-METHODS validate_document
      IMPORTING is_doc TYPE ty_document
      EXPORTING ev_ok  TYPE abap_bool
                ev_code TYPE string
                ev_msg  TYPE string.

    CLASS-METHODS document_to_sap
      IMPORTING iv_name TYPE string
                is_doc  TYPE ty_document
      EXPORTING ev_ok   TYPE abap_bool
                ev_msg  TYPE string
      CHANGING  cs_sap  TYPE ty_sap_payload.

    " ----- SAP read helpers -----
    CLASS-METHODS read_document
      IMPORTING iv_name   TYPE string
      EXPORTING ev_found  TYPE abap_bool
                ev_denied TYPE abap_bool
                es_data   TYPE ty_get_data.

    CLASS-METHODS read_long_text
      IMPORTING iv_name  TYPE string
                iv_langu TYPE sy-langu
      RETURNING VALUE(rv_text) TYPE string.

    CLASS-METHODS read_short_text
      IMPORTING iv_name  TYPE string
                iv_langu TYPE sy-langu
      RETURNING VALUE(rv_text) TYPE string.

    CLASS-METHODS write_long_text
      IMPORTING iv_name  TYPE string
                iv_langu TYPE sy-langu
                iv_text  TYPE string
      EXPORTING ev_ok    TYPE abap_bool
                ev_msg   TYPE string.

    " ----- SAP write helpers -----
    CLASS-METHODS fix_text_language
      IMPORTING iv_name    TYPE string
                iv_langu   TYPE sy-langu
                iv_text    TYPE string
                iv_prev_zh TYPE string.

    CLASS-METHODS sync_direct_fields
      IMPORTING iv_name TYPE string
                is_doc  TYPE ty_document
                is_sap  TYPE ty_sap_payload
      EXPORTING ev_ok   TYPE abap_bool
                ev_msg  TYPE string.

    CLASS-METHODS master_language
      IMPORTING iv_name TYPE string
      RETURNING VALUE(rv_langu) TYPE sy-langu.

    CLASS-METHODS package_of_name
      IMPORTING iv_name TYPE string
      RETURNING VALUE(rv_package) TYPE devclass.

    CLASS-METHODS tadir_masterlang
      IMPORTING iv_name  TYPE string
                iv_langu TYPE sy-langu.

    CLASS-METHODS sap_language
      IMPORTING iv_iso TYPE string
      RETURNING VALUE(rv_langu) TYPE sy-langu.

    CLASS-METHODS iso_language
      IMPORTING iv_langu TYPE sy-langu
      RETURNING VALUE(rv_iso) TYPE string.

    " ----- profile regeneration (SAP_ALL/SAP_NEW; explicit opt-in only) -----
    CLASS-METHODS regen_requested
      IMPORTING iv_query TYPE string
      RETURNING VALUE(rv_regen) TYPE abap_bool.

    CLASS-METHODS regen_preflight
      EXPORTING ev_ok        TYPE abap_bool
                ev_http_code TYPE i
                ev_code      TYPE string
                ev_msg       TYPE string.

    CLASS-METHODS regenerate_profiles
      IMPORTING iv_name TYPE string
      EXPORTING ev_ok   TYPE abap_bool
                ev_msg  TYPE string.

    " ----- attribute mapping (document enum <-> DB flag) -----
    CLASS-METHODS trace_to_db
      IMPORTING iv_value TYPE string
      RETURNING VALUE(rv_flag) TYPE char1.

    CLASS-METHODS trace_from_db
      IMPORTING iv_flag TYPE string
      RETURNING VALUE(rv_value) TYPE string.

    CLASS-METHODS criticality_to_db
      IMPORTING iv_value TYPE string
      RETURNING VALUE(rv_flag) TYPE char1.

    CLASS-METHODS criticality_from_db
      IMPORTING iv_flag TYPE string
      RETURNING VALUE(rv_value) TYPE string.

    CLASS-METHODS own_context_to_db
      IMPORTING iv_value TYPE string
      RETURNING VALUE(rv_flag) TYPE char1.

    CLASS-METHODS own_context_from_db
      IMPORTING iv_flag TYPE string
      RETURNING VALUE(rv_value) TYPE string.

    CLASS-METHODS privileged_to_db
      IMPORTING iv_value TYPE string
      RETURNING VALUE(rv_flag) TYPE char1.

    CLASS-METHODS privileged_from_db
      IMPORTING iv_flag TYPE string
      RETURNING VALUE(rv_value) TYPE string.

    CLASS-METHODS language_version_to_db
      IMPORTING iv_value TYPE string
      RETURNING VALUE(rv_value) TYPE abap_language_version.

    CLASS-METHODS language_version_from_db
      IMPORTING iv_value TYPE abap_language_version
      RETURNING VALUE(rv_value) TYPE string.

    " ----- error mapping / responses -----
    CLASS-METHODS write_error_http
      IMPORTING iv_rc TYPE sy-subrc
      RETURNING VALUE(rv_http) TYPE i.

    CLASS-METHODS write_error_code
      IMPORTING iv_rc TYPE sy-subrc
      RETURNING VALUE(rv_code) TYPE string.

    CLASS-METHODS write_error_message
      IMPORTING iv_rc TYPE sy-subrc
      RETURNING VALUE(rv_msg) TYPE string.

    CLASS-METHODS delete_error
      IMPORTING iv_rc TYPE sy-subrc
      EXPORTING ev_http TYPE i
                ev_code TYPE string
                ev_msg  TYPE string.

    CLASS-METHODS respond_corr_error
      IMPORTING io_server    TYPE REF TO if_http_server
                iv_http_code TYPE i
                iv_code      TYPE string
                iv_msg       TYPE string.

    CLASS-METHODS respond_read
      IMPORTING io_server TYPE REF TO if_http_server
                is_data   TYPE ty_get_data.

    CLASS-METHODS respond_write
      IMPORTING io_server       TYPE REF TO if_http_server
                iv_name         TYPE string
                iv_action       TYPE string
                iv_package      TYPE devclass
                iv_regen        TYPE abap_bool
                iv_regen_error  TYPE string.

    CLASS-METHODS error_message
      RETURNING VALUE(rv_msg) TYPE string.
ENDCLASS.

CLASS zcl_abap_vibe_icf_suso IMPLEMENTATION.
  METHOD dispatch.
    DATA lv_query TYPE string.
    lv_query = io_server->request->get_header_field( '~query_string' ).

    DATA lv_name TYPE string.
    DATA lv_ok TYPE abap_bool.
    DATA lv_code TYPE string.
    DATA lv_msg TYPE string.
    route_name( EXPORTING iv_path = iv_path
                IMPORTING ev_name = lv_name ev_ok = lv_ok
                          ev_code = lv_code ev_msg = lv_msg ).
    IF lv_ok = abap_false.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 400 iv_code = lv_code iv_msg = lv_msg ).
      RETURN.
    ENDIF.

    CASE iv_method.
      WHEN 'GET'.
        DATA ls_get TYPE ty_get_data.
        DATA lv_found TYPE abap_bool.
        DATA lv_denied TYPE abap_bool.
        read_document( EXPORTING iv_name = lv_name
                       IMPORTING ev_found = lv_found ev_denied = lv_denied
                                 es_data = ls_get ).
        IF lv_found = abap_false.
          zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                         iv_status = 404 iv_code = 'SUSO_NOT_FOUND'
                         iv_msg = |SUSO { lv_name } does not exist| ).
          RETURN.
        ENDIF.
        IF lv_denied = abap_true.
          zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                         iv_status = 403 iv_code = 'SUSO_NOT_AUTHORIZED'
                         iv_msg = |no display authorization for SUSO { lv_name }| ).
          RETURN.
        ENDIF.
        respond_read( io_server = io_server is_data = ls_get ).
      WHEN 'POST'.
        dispatch_post( io_server = io_server iv_name = lv_name
                       iv_query = lv_query iv_body = iv_body ).
      WHEN 'PUT'.
        dispatch_put( io_server = io_server iv_name = lv_name
                      iv_query = lv_query iv_body = iv_body ).
      WHEN 'DELETE'.
        dispatch_delete( io_server = io_server iv_name = lv_name iv_query = lv_query ).
      WHEN OTHERS.
        zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                       iv_status = 405 iv_code = 'METHOD_NOT_ALLOWED'
                       iv_msg = 'only GET/POST/PUT/DELETE are supported on /auth/suso' ).
    ENDCASE.
  ENDMETHOD.

  METHOD dispatch_post.
    DATA lv_ok TYPE abap_bool.
    DATA lv_code TYPE string.
    DATA lv_msg TYPE string.

    DATA ls_doc TYPE ty_document.
    IF parse_document( EXPORTING iv_body = iv_body CHANGING cs_doc = ls_doc ) = abap_false.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 400 iv_code = 'SUSO_INVALID_PAYLOAD'
                     iv_msg = 'request body is not a valid suso-v1 JSON document' ).
      RETURN.
    ENDIF.
    validate_document( EXPORTING is_doc = ls_doc
                       IMPORTING ev_ok = lv_ok ev_code = lv_code ev_msg = lv_msg ).
    IF lv_ok = abap_false.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 400 iv_code = lv_code iv_msg = lv_msg ).
      RETURN.
    ENDIF.

    " Create is the only creating path: an existing object is a conflict.
    DATA lv_exists TYPE tobj-objct.
    SELECT SINGLE objct FROM tobj INTO @lv_exists WHERE objct = @iv_name.
    IF sy-subrc = 0.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 409 iv_code = 'SUSO_ALREADY_EXISTS'
                     iv_msg = |SUSO { iv_name } already exists; use push to update it| ).
      RETURN.
    ENDIF.

    DATA lv_package TYPE devclass.
    lv_package = zcl_abap_vibe_icf_auth_common=>query_package( iv_query ).
    IF lv_package IS INITIAL.
      lv_package = '$TMP'.
    ENDIF.
    DATA lv_transport TYPE trkorr.
    lv_transport = zcl_abap_vibe_icf_auth_common=>query_transport( iv_query ).

    " Local package: transport-free; everything else needs an explicit request.
    DATA lv_rule_code TYPE string.
    DATA lv_rule_msg TYPE string.
    zcl_abap_vibe_icf_auth_common=>transport_rule( EXPORTING iv_package = lv_package
                                                             iv_transport = lv_transport
                                                             iv_verb = 'POST'
                                                             iv_prefix = 'SUSO'
                                                   IMPORTING ev_code = lv_rule_code
                                                             ev_msg = lv_rule_msg ).
    IF lv_rule_code IS NOT INITIAL.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 400 iv_code = lv_rule_code iv_msg = lv_rule_msg ).
      RETURN.
    ENDIF.

    " Opt-in profile regeneration is pre-flighted before any write, so a
    " refused regeneration never leaves a half-created object behind.
    DATA lv_regen TYPE abap_bool.
    lv_regen = regen_requested( iv_query ).
    IF lv_regen = abap_true.
      DATA lv_pre_http TYPE i.
      regen_preflight( IMPORTING ev_ok = lv_ok ev_http_code = lv_pre_http
                                 ev_code = lv_code ev_msg = lv_msg ).
      IF lv_ok = abap_false.
        zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                       iv_status = lv_pre_http iv_code = lv_code iv_msg = lv_msg ).
        RETURN.
      ENDIF.
    ENDIF.

    DATA ls_sap TYPE ty_sap_payload.
    document_to_sap( EXPORTING iv_name = iv_name is_doc = ls_doc
                     IMPORTING ev_ok = lv_ok ev_msg = lv_msg
                     CHANGING  cs_sap = ls_sap ).
    IF lv_ok = abap_false.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 400 iv_code = 'SUSO_INVALID_PAYLOAD'
                     iv_msg = lv_msg ).
      RETURN.
    ENDIF.

    " TADIR + package/transport first (same order as the other ICF writes).
    DATA lv_author TYPE sy-uname.
    DATA lv_corr_http TYPE i.
    DATA lv_corr_code TYPE string.
    DATA lv_corr_msg TYPE string.
    zcl_abap_vibe_icf_auth_common=>corr_insert(
        EXPORTING iv_tadir_object = gc_tadir_object
                  iv_name         = iv_name
                  iv_package      = lv_package
                  iv_transport    = lv_transport
                  iv_mode         = 'I'
                  iv_prefix       = 'SUSO'
        IMPORTING ev_author        = lv_author
                  ev_http_code     = lv_corr_http
                  ev_code          = lv_corr_code
                  ev_msg           = lv_corr_msg ).
    IF lv_corr_code IS NOT INITIAL.
      respond_corr_error( io_server = io_server iv_http_code = lv_corr_http
                          iv_code = lv_corr_code iv_msg = lv_corr_msg ).
      RETURN.
    ENDIF.
    tadir_masterlang( iv_name = iv_name iv_langu = ls_sap-language ).

    " Keep a pre-existing session-language text so the fixup below can
    " restore it when the document language differs from the session language.
    DATA lv_prev_zh TYPE string.
    lv_prev_zh = read_short_text( iv_name = iv_name iv_langu = sy-langu ).

    DATA lo_suso TYPE REF TO cl_suso_gen.
    CREATE OBJECT lo_suso.
    DATA lv_rc TYPE sy-subrc.
    lv_rc = lo_suso->suso_dark_update( iv_no_cts     = abap_true
                                       is_data_ext   = ls_sap-head
                                       it_auth_field = ls_sap-fields
                                       it_activity   = ls_sap-activities
                                       it_sapnew_rel = ls_sap-sapnew_rel
                                       it_sapnew_val = ls_sap-sapnew_val ).
    IF lv_rc <> 0.
      " A failed create must leave no TADIR residue behind.
      zcl_abap_vibe_icf_auth_common=>tadir_delete( iv_tadir_object = gc_tadir_object
                                                   iv_name = iv_name
                                                   iv_package = lv_package
                                                   iv_transport = lv_transport ).
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = write_error_http( lv_rc )
                     iv_code = write_error_code( lv_rc )
                     iv_msg = write_error_message( lv_rc ) ).
      RETURN.
    ENDIF.

    " Post-write fixups for fields the dark API does not persist or does not
    " know (documented narrow exception in the design note).
    fix_text_language( iv_name = iv_name iv_langu = ls_sap-language
                       iv_text = CONV string( ls_sap-head-ttext )
                       iv_prev_zh = lv_prev_zh ).
    sync_direct_fields( EXPORTING iv_name = iv_name is_doc = ls_doc is_sap = ls_sap
                        IMPORTING ev_ok = lv_ok ev_msg = lv_msg ).
    IF lv_ok = abap_false.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 500 iv_code = 'SUSO_WRITE_FAILED'
                     iv_msg = |SUSO { iv_name } was created but the attribute write failed: { lv_msg }| ).
      RETURN.
    ENDIF.
    write_long_text( EXPORTING iv_name = iv_name iv_langu = ls_sap-language
                               iv_text = ls_sap-long_text
                     IMPORTING ev_ok = lv_ok ev_msg = lv_msg ).
    IF lv_ok = abap_false.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 500 iv_code = 'SUSO_WRITE_FAILED'
                     iv_msg = |SUSO { iv_name } was created but the long text write failed: { lv_msg }| ).
      RETURN.
    ENDIF.

    DATA lv_regen_msg TYPE string.
    IF lv_regen = abap_true.
      regenerate_profiles( EXPORTING iv_name = iv_name
                           IMPORTING ev_ok = lv_ok ev_msg = lv_regen_msg ).
    ENDIF.
    respond_write( io_server = io_server iv_name = iv_name iv_action = 'created'
                   iv_package = lv_package iv_regen = lv_regen
                   iv_regen_error = lv_regen_msg ).
  ENDMETHOD.

  METHOD dispatch_put.
    DATA lv_ok TYPE abap_bool.
    DATA lv_code TYPE string.
    DATA lv_msg TYPE string.

    DATA lv_exists TYPE tobj-objct.
    SELECT SINGLE objct FROM tobj INTO @lv_exists WHERE objct = @iv_name.
    IF sy-subrc <> 0.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 404 iv_code = 'SUSO_NOT_FOUND'
                     iv_msg = |SUSO { iv_name } does not exist; push updates existing objects only| ).
      RETURN.
    ENDIF.

    DATA ls_doc TYPE ty_document.
    IF parse_document( EXPORTING iv_body = iv_body CHANGING cs_doc = ls_doc ) = abap_false.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 400 iv_code = 'SUSO_INVALID_PAYLOAD'
                     iv_msg = 'request body is not a valid suso-v1 JSON document' ).
      RETURN.
    ENDIF.
    validate_document( EXPORTING is_doc = ls_doc
                       IMPORTING ev_ok = lv_ok ev_code = lv_code ev_msg = lv_msg ).
    IF lv_ok = abap_false.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 400 iv_code = lv_code iv_msg = lv_msg ).
      RETURN.
    ENDIF.

    DATA lv_package TYPE devclass.
    lv_package = package_of_name( iv_name ).
    DATA lv_transport TYPE trkorr.
    lv_transport = zcl_abap_vibe_icf_auth_common=>query_transport( iv_query ).
    DATA lv_rule_code TYPE string.
    DATA lv_rule_msg TYPE string.
    zcl_abap_vibe_icf_auth_common=>transport_rule( EXPORTING iv_package = lv_package
                                                             iv_transport = lv_transport
                                                             iv_verb = 'PUT'
                                                             iv_prefix = 'SUSO'
                                                   IMPORTING ev_code = lv_rule_code
                                                             ev_msg = lv_rule_msg ).
    IF lv_rule_code IS NOT INITIAL.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 400 iv_code = lv_rule_code iv_msg = lv_rule_msg ).
      RETURN.
    ENDIF.

    DATA lv_regen TYPE abap_bool.
    lv_regen = regen_requested( iv_query ).
    IF lv_regen = abap_true.
      DATA lv_pre_http TYPE i.
      regen_preflight( IMPORTING ev_ok = lv_ok ev_http_code = lv_pre_http
                                 ev_code = lv_code ev_msg = lv_msg ).
      IF lv_ok = abap_false.
        zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                       iv_status = lv_pre_http iv_code = lv_code iv_msg = lv_msg ).
        RETURN.
      ENDIF.
    ENDIF.

    DATA ls_sap TYPE ty_sap_payload.
    document_to_sap( EXPORTING iv_name = iv_name is_doc = ls_doc
                     IMPORTING ev_ok = lv_ok ev_msg = lv_msg
                     CHANGING  cs_sap = ls_sap ).
    IF lv_ok = abap_false.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 400 iv_code = 'SUSO_INVALID_PAYLOAD'
                     iv_msg = lv_msg ).
      RETURN.
    ENDIF.

    " Record the change in the request of a transportable package; a local
    " package stays transport-free (the rule above accepted it without --tr).
    DATA lv_author TYPE sy-uname.
    DATA lv_corr_http TYPE i.
    DATA lv_corr_code TYPE string.
    DATA lv_corr_msg TYPE string.
    zcl_abap_vibe_icf_auth_common=>corr_insert(
        EXPORTING iv_tadir_object = gc_tadir_object
                  iv_name         = iv_name
                  iv_package      = lv_package
                  iv_transport    = lv_transport
                  iv_mode         = 'I'
                  iv_prefix       = 'SUSO'
        IMPORTING ev_author        = lv_author
                  ev_http_code     = lv_corr_http
                  ev_code          = lv_corr_code
                  ev_msg           = lv_corr_msg ).
    IF lv_corr_code IS NOT INITIAL.
      respond_corr_error( io_server = io_server iv_http_code = lv_corr_http
                          iv_code = lv_corr_code iv_msg = lv_corr_msg ).
      RETURN.
    ENDIF.
    tadir_masterlang( iv_name = iv_name iv_langu = ls_sap-language ).

    DATA lv_prev_zh TYPE string.
    lv_prev_zh = read_short_text( iv_name = iv_name iv_langu = sy-langu ).

    DATA lo_suso TYPE REF TO cl_suso_gen.
    CREATE OBJECT lo_suso.
    DATA lv_rc TYPE sy-subrc.
    lv_rc = lo_suso->suso_dark_update( iv_no_cts     = abap_true
                                       is_data_ext   = ls_sap-head
                                       it_auth_field = ls_sap-fields
                                       it_activity   = ls_sap-activities
                                       it_sapnew_rel = ls_sap-sapnew_rel
                                       it_sapnew_val = ls_sap-sapnew_val ).
    IF lv_rc <> 0.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = write_error_http( lv_rc )
                     iv_code = write_error_code( lv_rc )
                     iv_msg = write_error_message( lv_rc ) ).
      RETURN.
    ENDIF.

    fix_text_language( iv_name = iv_name iv_langu = ls_sap-language
                       iv_text = CONV string( ls_sap-head-ttext )
                       iv_prev_zh = lv_prev_zh ).
    sync_direct_fields( EXPORTING iv_name = iv_name is_doc = ls_doc is_sap = ls_sap
                        IMPORTING ev_ok = lv_ok ev_msg = lv_msg ).
    IF lv_ok = abap_false.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 500 iv_code = 'SUSO_WRITE_FAILED'
                     iv_msg = |SUSO { iv_name } was updated but the attribute write failed: { lv_msg }| ).
      RETURN.
    ENDIF.
    write_long_text( EXPORTING iv_name = iv_name iv_langu = ls_sap-language
                               iv_text = ls_sap-long_text
                     IMPORTING ev_ok = lv_ok ev_msg = lv_msg ).
    IF lv_ok = abap_false.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 500 iv_code = 'SUSO_WRITE_FAILED'
                     iv_msg = |SUSO { iv_name } was updated but the long text write failed: { lv_msg }| ).
      RETURN.
    ENDIF.

    DATA lv_regen_msg TYPE string.
    IF lv_regen = abap_true.
      regenerate_profiles( EXPORTING iv_name = iv_name
                           IMPORTING ev_ok = lv_ok ev_msg = lv_regen_msg ).
    ENDIF.
    respond_write( io_server = io_server iv_name = iv_name iv_action = 'updated'
                   iv_package = lv_package iv_regen = lv_regen
                   iv_regen_error = lv_regen_msg ).
  ENDMETHOD.

  METHOD dispatch_delete.
    DATA lv_exists TYPE tobj-objct.
    SELECT SINGLE objct FROM tobj INTO @lv_exists WHERE objct = @iv_name.
    IF sy-subrc <> 0.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 404 iv_code = 'SUSO_NOT_FOUND'
                     iv_msg = |SUSO { iv_name } does not exist| ).
      RETURN.
    ENDIF.

    DATA lv_package TYPE devclass.
    lv_package = package_of_name( iv_name ).
    DATA lv_transport TYPE trkorr.
    lv_transport = zcl_abap_vibe_icf_auth_common=>query_transport( iv_query ).
    DATA lv_rule_code TYPE string.
    DATA lv_rule_msg TYPE string.
    zcl_abap_vibe_icf_auth_common=>transport_rule( EXPORTING iv_package = lv_package
                                                             iv_transport = lv_transport
                                                             iv_verb = 'DELETE'
                                                             iv_prefix = 'SUSO'
                                                   IMPORTING ev_code = lv_rule_code
                                                             ev_msg = lv_rule_msg ).
    IF lv_rule_code IS NOT INITIAL.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 400 iv_code = lv_rule_code iv_msg = lv_rule_msg ).
      RETURN.
    ENDIF.

    " abapGit pre_check port: SAP's own edit mode decides whether the object
    " may be deleted (where-used in authorizations/roles/transactions,
    " delivered objects and missing authorization all end up != '06').
    DATA lo_suso TYPE REF TO cl_suso_gen.
    CREATE OBJECT lo_suso.
    DATA lv_object TYPE xuobject.
    lv_object = iv_name.
    DATA lv_mode TYPE activ_auth.
    lo_suso->get_suso_edit_mode( EXPORTING id_object = lv_object
                                           id_planed_act = gc_delete_act
                                 IMPORTING ed_mode_head = lv_mode ).
    IF lv_mode <> gc_delete_act.
      DATA lv_refuse_msg TYPE string.
      lv_refuse_msg = error_message( ).
      IF lv_refuse_msg IS INITIAL.
        lv_refuse_msg = |SUSO { iv_name } cannot be deleted; check where-used in SU21|.
      ENDIF.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 409 iv_code = 'SUSO_DELETE_REFUSED'
                     iv_msg = lv_refuse_msg ).
      RETURN.
    ENDIF.

    " Where-used pre-check (authorizations, transactions, cross references and
    " delivered objects): CHECK_SUSO_GEN mode 06 is the same check SU21 runs
    " before a delete; the dark API's edit-mode check alone does not list
    " where-used references of local objects.
    DATA lv_where_used_rc TYPE sy-subrc.
    lo_suso->check_suso_gen( EXPORTING id_mode   = gc_delete_act
                                       id_objct  = lv_object
                             IMPORTING ed_return = lv_where_used_rc ).
    IF lv_where_used_rc <> 0.
      DATA lv_used_msg TYPE string.
      lv_used_msg = error_message( ).
      IF lv_used_msg IS INITIAL.
        lv_used_msg = |SUSO { iv_name } is used and cannot be deleted; check where-used in SU21|.
      ENDIF.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 409 iv_code = 'SUSO_DELETE_REFUSED'
                     iv_msg = lv_used_msg ).
      RETURN.
    ENDIF.

    DATA lv_regen TYPE abap_bool.
    lv_regen = regen_requested( iv_query ).
    IF lv_regen = abap_true.
      DATA lv_ok TYPE abap_bool.
      DATA lv_pre_http TYPE i.
      DATA lv_code TYPE string.
      DATA lv_msg TYPE string.
      regen_preflight( IMPORTING ev_ok = lv_ok ev_http_code = lv_pre_http
                                 ev_code = lv_code ev_msg = lv_msg ).
      IF lv_ok = abap_false.
        zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                       iv_status = lv_pre_http iv_code = lv_code iv_msg = lv_msg ).
        RETURN.
      ENDIF.
    ENDIF.

    " Record the object in the request of a transportable package before the
    " delete so the removal is transported; $TMP stays transport-free.
    IF zcl_abap_vibe_icf_types=>is_local_package( lv_package ) = abap_false.
      DATA lv_author TYPE sy-uname.
      DATA lv_corr_http TYPE i.
      DATA lv_corr_code TYPE string.
      DATA lv_corr_msg TYPE string.
      zcl_abap_vibe_icf_auth_common=>corr_insert(
          EXPORTING iv_tadir_object = gc_tadir_object
                    iv_name         = iv_name
                    iv_package      = lv_package
                    iv_transport    = lv_transport
                    iv_mode         = 'I'
                    iv_prefix       = 'SUSO'
          IMPORTING ev_author        = lv_author
                    ev_http_code     = lv_corr_http
                    ev_code          = lv_corr_code
                    ev_msg           = lv_corr_msg ).
      IF lv_corr_code IS NOT INITIAL.
        respond_corr_error( io_server = io_server iv_http_code = lv_corr_http
                            iv_code = lv_corr_code iv_msg = lv_corr_msg ).
        RETURN.
      ENDIF.
    ENDIF.

    DATA lv_rc TYPE sy-subrc.
    lv_rc = lo_suso->suso_dark_delete( id_object = lv_object
                                       id_del_trc = abap_true
                                       id_no_cts = abap_true ).
    IF lv_rc <> 0.
      DATA lv_del_http TYPE i.
      DATA lv_del_code TYPE string.
      DATA lv_del_msg TYPE string.
      delete_error( EXPORTING iv_rc = lv_rc
                    IMPORTING ev_http = lv_del_http ev_code = lv_del_code
                              ev_msg = lv_del_msg ).
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = lv_del_http iv_code = lv_del_code iv_msg = lv_del_msg ).
      RETURN.
    ENDIF.

    zcl_abap_vibe_icf_auth_common=>tadir_delete( iv_tadir_object = gc_tadir_object
                                                 iv_name = iv_name
                                                 iv_package = lv_package
                                                 iv_transport = lv_transport ).

    DATA lv_regen_ok TYPE abap_bool.
    DATA lv_regen_msg TYPE string.
    IF lv_regen = abap_true.
      regenerate_profiles( EXPORTING iv_name = iv_name
                           IMPORTING ev_ok = lv_regen_ok ev_msg = lv_regen_msg ).
    ENDIF.
    respond_write( io_server = io_server iv_name = iv_name iv_action = 'deleted'
                   iv_package = lv_package iv_regen = lv_regen
                   iv_regen_error = lv_regen_msg ).
  ENDMETHOD.

  METHOD route_name.
    CLEAR: ev_name, ev_ok, ev_code, ev_msg.
    FIND REGEX '^/auth/suso/(.+)$' IN iv_path IGNORING CASE SUBMATCHES ev_name.
    IF sy-subrc <> 0 OR ev_name IS INITIAL.
      ev_code = 'SUSO_NAME_INVALID'.
      ev_msg = 'object name is required: /auth/suso/<name>'.
      RETURN.
    ENDIF.
    ev_name = cl_http_utility=>if_http_utility~unescape_url( escaped = ev_name ).
    ev_name = to_upper( condense( val = ev_name del = ` ` ) ).
    validate_name( EXPORTING iv_name = ev_name
                   IMPORTING ev_ok = ev_ok ev_code = ev_code ev_msg = ev_msg ).
  ENDMETHOD.

  METHOD validate_name.
    CLEAR: ev_ok, ev_code, ev_msg.
    IF iv_name IS INITIAL OR strlen( iv_name ) > 10.
      ev_code = 'SUSO_NAME_INVALID'.
      ev_msg = |SUSO name must be 1..10 characters (XUOBJECT); got '{ iv_name }'|.
      RETURN.
    ENDIF.
    IF NOT ( iv_name CO 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_/' ).
      ev_code = 'SUSO_NAME_INVALID'.
      ev_msg = |SUSO name may only contain A-Z, 0-9, _ and / (got '{ iv_name }')|.
      RETURN.
    ENDIF.
    ev_ok = abap_true.
  ENDMETHOD.

  METHOD parse_document.
    rv_ok = zcl_abap_vibe_icf_auth_common=>parse_body( EXPORTING iv_body = iv_body
                                                       CHANGING  cs_doc  = cs_doc ).
  ENDMETHOD.

  METHOD validate_document.
    CLEAR: ev_ok, ev_code, ev_msg.
    ev_ok = abap_true.

    IF is_doc-format_version <> '1'.
      ev_ok = abap_false.
      ev_code = 'SUSO_INVALID_PAYLOAD'.
      ev_msg = 'formatVersion must be "1"'.
      RETURN.
    ENDIF.

    DATA lv_text TYPE string.
    " header
    lv_text = condense( val = is_doc-header-description ).
    IF lv_text IS INITIAL.
      ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
      ev_msg = 'header.description is required'. RETURN.
    ENDIF.
    IF strlen( lv_text ) > 60.
      ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
      ev_msg = |header.description must not exceed 60 characters (TOBJT-TTEXT)|. RETURN.
    ENDIF.
    DATA lv_iso TYPE string.
    lv_iso = to_upper( condense( val = is_doc-header-original_language ) ).
    IF lv_iso IS NOT INITIAL.
      DATA lv_langu TYPE sy-langu.
      lv_langu = sap_language( lv_iso ).
      IF lv_langu IS INITIAL.
        ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
        ev_msg = |header.originalLanguage '{ lv_iso }' is not a known ISO language code|. RETURN.
      ENDIF.
    ENDIF.
    DATA lv_version TYPE string.
    lv_version = to_lower( condense( val = is_doc-header-abap_language_version ) ).
    IF lv_version IS NOT INITIAL AND lv_version <> 'standard'
       AND lv_version <> 'keyuser' AND lv_version <> 'clouddevelopment'.
      ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
      ev_msg = |header.abapLanguageVersion must be standard, keyUser or cloudDevelopment (got '{ lv_version }')|. RETURN.
    ENDIF.

    " generalInformation
    DATA lv_class TYPE string.
    lv_class = to_upper( condense( val = is_doc-general_information-object_class ) ).
    IF lv_class IS INITIAL.
      ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
      ev_msg = 'generalInformation.objectClass is required'. RETURN.
    ENDIF.
    IF strlen( lv_class ) > 4.
      " TOBJ-OCLSS is CHAR4, but delivered values are stored unpadded and come
      " back as e.g. 'AIF' in the wire document.
      ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
      ev_msg = |generalInformation.objectClass must be 1..4 characters (XUOBJCLASS); got '{ lv_class }'|. RETURN.
    ENDIF.
    IF NOT ( lv_class CO 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_/' ).
      ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
      ev_msg = |generalInformation.objectClass may only contain A-Z, 0-9, _ and / (got '{ lv_class }')|. RETURN.
    ENDIF.
    DATA lv_class_found TYPE tobct-oclss.
    SELECT SINGLE oclss FROM tobct INTO @lv_class_found WHERE oclss = @lv_class.
    IF sy-subrc <> 0.
      ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
      ev_msg = |object class '{ lv_class }' does not exist (TOBCT); choose an existing class|. RETURN.
    ENDIF.
    DATA lv_fblock TYPE string.
    lv_fblock = to_upper( condense( val = is_doc-general_information-field_block ) ).
    IF strlen( lv_fblock ) > 8.
      ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
      ev_msg = |generalInformation.fieldBlock must not exceed 8 characters (TOBJ-FBLOCK)|. RETURN.
    ENDIF.

    " authorizationFields
    DATA lv_field_count TYPE i.
    lv_field_count = lines( is_doc-authorization_fields ).
    IF lv_field_count = 0.
      ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
      ev_msg = 'authorizationFields must contain at least one field'. RETURN.
    ENDIF.
    IF lv_field_count > 10.
      ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
      ev_msg = |authorizationFields must not contain more than 10 fields (got { lv_field_count })|. RETURN.
    ENDIF.
    DATA lt_seen TYPE STANDARD TABLE OF xufield WITH EMPTY KEY.
    DATA lv_has_actvt TYPE abap_bool.
    LOOP AT is_doc-authorization_fields INTO DATA(ls_field).
      DATA lv_field TYPE string.
      lv_field = to_upper( condense( val = ls_field-authorization_field ) ).
      IF lv_field IS INITIAL OR strlen( lv_field ) > 10.
        ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
        ev_msg = |authorizationFields[{ sy-tabix }].authorizationField must be 1..10 characters|. RETURN.
      ENDIF.
      IF NOT ( lv_field CO 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_/' ).
        ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
        ev_msg = |authorization field '{ lv_field }' may only contain A-Z, 0-9, _ and /|. RETURN.
      ENDIF.
      READ TABLE lt_seen TRANSPORTING NO FIELDS WITH KEY table_line = lv_field.
      IF sy-subrc = 0.
        ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
        ev_msg = |authorization field '{ lv_field }' is listed more than once|. RETURN.
      ENDIF.
      APPEND lv_field TO lt_seen.
      IF lv_field = 'ACTVT'.
        lv_has_actvt = abap_true.
      ENDIF.
      DATA lv_fld_found TYPE authx-fieldname.
      SELECT SINGLE fieldname FROM authx INTO @lv_fld_found WHERE fieldname = @lv_field.
      IF sy-subrc <> 0.
        ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
        ev_msg = |authorization field '{ lv_field }' does not exist (AUTHX)|. RETURN.
      ENDIF.
    ENDLOOP.

    " permittedActivities
    LOOP AT is_doc-permitted_activities INTO DATA(ls_activity).
      DATA lv_act TYPE string.
      lv_act = to_upper( condense( val = ls_activity-activity ) ).
      IF strlen( lv_act ) <> 2 OR NOT ( lv_act CO 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' ).
        ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
        ev_msg = |permittedActivities[{ sy-tabix }].activity must be a 2-character ACTIV_AUTH value|. RETURN.
      ENDIF.
      IF lv_has_actvt = abap_false.
        ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
        ev_msg = 'permittedActivities requires ACTVT in authorizationFields'. RETURN.
      ENDIF.
      DATA lv_act_found TYPE tact-actvt.
      SELECT SINGLE actvt FROM tact INTO @lv_act_found WHERE actvt = @lv_act.
      IF sy-subrc <> 0.
        ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
        ev_msg = |activity '{ lv_act }' does not exist (TACT)|. RETURN.
      ENDIF.
    ENDLOOP.

    " object attributes / CDS classification
    DATA lv_crit TYPE string.
    lv_crit = to_lower( condense( val = is_doc-object_attributes-criticality ) ).
    IF lv_crit IS NOT INITIAL AND lv_crit <> 'notspecified'
       AND lv_crit <> 'critical' AND lv_crit <> 'notcritical'.
      ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
      ev_msg = |objectAttributes.criticality must be critical, notCritical or notSpecified (got '{ lv_crit }')|. RETURN.
    ENDIF.
    DATA lv_trace TYPE string.
    lv_trace = to_lower( condense( val = is_doc-object_attributes-class_copy_to_default_data ) ).
    IF lv_trace IS NOT INITIAL AND lv_trace <> 'withoutrestriction'
       AND lv_trace <> 'ifinsameapplcomponent' AND lv_trace <> 'ifinsamesoftwarecomponent'
       AND lv_trace <> 'ifinsamesoftwarepackage' AND lv_trace <> 'notcopiedfromtracedata'.
      ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
      ev_msg = |objectAttributes.classCopyToDefaultData '{ lv_trace }' is not supported|. RETURN.
    ENDIF.
    DATA lv_own TYPE string.
    lv_own = to_lower( condense( val = is_doc-classification_for_cds_bdef-usage_in_own_auth_context ) ).
    IF lv_own IS NOT INITIAL AND lv_own <> 'notspecified'
       AND lv_own <> 'notallowed' AND lv_own <> 'allowed' AND lv_own <> 'insamesoftwarecomponent'.
      ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
      ev_msg = |classificationForCdsBdef.usageInOwnAuthContext '{ lv_own }' is not supported|. RETURN.
    ENDIF.
    DATA lv_priv TYPE string.
    lv_priv = to_lower( condense( val = is_doc-classification_for_cds_bdef-usage_in_privileged_bdef_mode ) ).
    IF lv_priv IS NOT INITIAL AND lv_priv <> 'notspecified'
       AND lv_priv <> 'notallowed' AND lv_priv <> 'allowed'.
      ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
      ev_msg = |classificationForCdsBdef.usageInPrivilegedBdefMode '{ lv_priv }' is not supported|. RETURN.
    ENDIF.

    " sapNewRelevance
    IF is_doc-sap_new_relevance-is_relevant_to_sap_new = abap_true
       AND lines( is_doc-sap_new_relevance-values ) = 0.
      ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
      ev_msg = 'sapNewRelevance.values is required when isRelevantToSapNew is true'. RETURN.
    ENDIF.
    LOOP AT is_doc-sap_new_relevance-values INTO DATA(ls_value).
      DATA lv_release TYPE string.
      lv_release = to_upper( condense( val = ls_value-release ) ).
      IF lv_release IS INITIAL OR strlen( lv_release ) > 4.
        ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
        ev_msg = |sapNewRelevance.values[{ sy-tabix }].release must be 1..4 characters (SYSAPRL)|. RETURN.
      ENDIF.
      DATA lv_lfdnr TYPE string.
      lv_lfdnr = condense( val = ls_value-line_number ).
      IF strlen( lv_lfdnr ) > 3.
        ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
        ev_msg = |sapNewRelevance.values[{ sy-tabix }].lineNumber must not exceed 3 characters|. RETURN.
      ENDIF.
      DATA lv_value_field TYPE string.
      lv_value_field = to_upper( condense( val = ls_value-field ) ).
      IF lv_value_field IS NOT INITIAL.
        IF strlen( lv_value_field ) > 10.
          ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
          ev_msg = |sapNewRelevance.values[{ sy-tabix }].field must not exceed 10 characters|. RETURN.
        ENDIF.
        SELECT SINGLE fieldname FROM authx INTO @lv_fld_found WHERE fieldname = @lv_value_field.
        IF sy-subrc <> 0.
          ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
          ev_msg = |sapNewRelevance.values[{ sy-tabix }].field '{ lv_value_field }' does not exist (AUTHX)|. RETURN.
        ENDIF.
      ENDIF.
      IF strlen( ls_value-low ) > 40 OR strlen( ls_value-high ) > 40.
        ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
        ev_msg = |sapNewRelevance.values[{ sy-tabix }].low/high must not exceed 40 characters (XUVAL)|. RETURN.
      ENDIF.
    ENDLOOP.

    " longText: raw DOKU lines, 72 characters per line (DOKTL-DOKTEXT)
    IF is_doc-long_text IS NOT INITIAL.
      DATA lv_longtext TYPE string.
      lv_longtext = is_doc-long_text.
      REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>cr_lf
        IN lv_longtext WITH cl_abap_char_utilities=>newline.
      SPLIT lv_longtext AT cl_abap_char_utilities=>newline INTO TABLE DATA(lt_lines).
      LOOP AT lt_lines INTO DATA(lv_line).
        IF strlen( lv_line ) > 72.
          ev_ok = abap_false. ev_code = 'SUSO_INVALID_PAYLOAD'.
          ev_msg = |longText line { sy-tabix } exceeds 72 characters (DOCU long-text lines are 72 chars)|. RETURN.
        ENDIF.
      ENDLOOP.
    ENDIF.
  ENDMETHOD.

  METHOD document_to_sap.
    CLEAR: cs_sap, ev_ok, ev_msg.

    " Language: the document language is the language of the short text and
    " of the long text; an empty originalLanguage means the session language.
    IF is_doc-header-original_language IS INITIAL.
      cs_sap-language = sy-langu.
    ELSE.
      cs_sap-language = sap_language( to_upper( condense( val = is_doc-header-original_language ) ) ).
      IF cs_sap-language IS INITIAL.
        cs_sap-language = sy-langu.
      ENDIF.
    ENDIF.

    cs_sap-head-objct = iv_name.
    cs_sap-head-oclss = to_upper( condense( val = is_doc-general_information-object_class ) ).
    cs_sap-head-ttext = is_doc-header-description.
    cs_sap-head-abap_language_version = language_version_to_db( is_doc-header-abap_language_version ).
    cs_sap-head-sap_new_flg = COND char1( WHEN is_doc-sap_new_relevance-is_relevant_to_sap_new = abap_true
                                          THEN 'X' ELSE '' ).
    cs_sap-trace_flag = trace_to_db( is_doc-object_attributes-class_copy_to_default_data ).
    cs_sap-head-su22_trc_flg = cs_sap-trace_flag.
    cs_sap-criticality = criticality_to_db( is_doc-object_attributes-criticality ).
    cs_sap-own_context = own_context_to_db(
                            is_doc-classification_for_cds_bdef-usage_in_own_auth_context ).
    cs_sap-privileged = privileged_to_db(
                            is_doc-classification_for_cds_bdef-usage_in_privileged_bdef_mode ).
    cs_sap-fblock = to_upper( condense( val = is_doc-general_information-field_block ) ).
    cs_sap-conversion = COND tobj-conversion(
                            WHEN is_doc-general_information-conversion = abap_true THEN 'X' ELSE '' ).
    cs_sap-long_text = is_doc-long_text.

    LOOP AT is_doc-authorization_fields INTO DATA(ls_field).
      DATA ls_xufield TYPE susr_s_xufield.
      ls_xufield-name = to_upper( condense( val = ls_field-authorization_field ) ).
      APPEND ls_xufield TO cs_sap-fields.
    ENDLOOP.

    LOOP AT is_doc-permitted_activities INTO DATA(ls_activity).
      DATA ls_sap_activity TYPE cl_suso_gen=>ty_activity.
      ls_sap_activity-actvt = to_upper( condense( val = ls_activity-activity ) ).
      DATA lv_ltext TYPE xutxt30.
      SELECT SINGLE ltext FROM tactt INTO @lv_ltext
        WHERE actvt = @ls_sap_activity-actvt AND spras = @cs_sap-language.
      ls_sap_activity-ltext = lv_ltext.
      APPEND ls_sap_activity TO cs_sap-activities.
    ENDLOOP.

    " SAP_NEW values: one TOBJVOR header line per release, one TOBJVORDAT line
    " per document value; the server-managed modifier/date/time are set now.
    DATA lv_last_release TYPE sysaprl.
    CLEAR lv_last_release.
    LOOP AT is_doc-sap_new_relevance-values INTO DATA(ls_value).
      DATA lv_release TYPE sysaprl.
      lv_release = to_upper( condense( val = ls_value-release ) ).
      IF lv_release IS INITIAL.
        CONTINUE.
      ENDIF.
      IF lv_release <> lv_last_release.
        DATA ls_rel TYPE tobjvor.
        ls_rel-objct = iv_name.
        ls_rel-release = lv_release.
        ls_rel-modifier = sy-uname.
        ls_rel-moddate = sy-datum.
        ls_rel-modtime = sy-uzeit.
        APPEND ls_rel TO cs_sap-sapnew_rel.
        lv_last_release = lv_release.
      ENDIF.
      DATA ls_val TYPE tobjvordat.
      ls_val-objct = iv_name.
      ls_val-release = lv_release.
      DATA lv_lfdnr TYPE string.
      lv_lfdnr = condense( val = ls_value-line_number ).
      IF lv_lfdnr IS INITIAL.
        lv_lfdnr = '000'.
      ELSEIF strlen( lv_lfdnr ) = 1.
        lv_lfdnr = '00' && lv_lfdnr.
      ELSEIF strlen( lv_lfdnr ) = 2.
        lv_lfdnr = '0' && lv_lfdnr.
      ENDIF.
      ls_val-lfdnr = lv_lfdnr.
      ls_val-field = to_upper( condense( val = ls_value-field ) ).
      ls_val-low = condense( val = ls_value-low ).
      ls_val-high = condense( val = ls_value-high ).
      APPEND ls_val TO cs_sap-sapnew_val.
    ENDLOOP.

    ev_ok = abap_true.
  ENDMETHOD.

  METHOD read_document.
    CLEAR: ev_found, ev_denied, es_data.
    DATA lo_suso TYPE REF TO cl_suso_gen.
    CREATE OBJECT lo_suso.
    DATA lv_object TYPE xuobject.
    lv_object = iv_name.

    DATA lv_failed TYPE abap_bool.
    lv_failed = lo_suso->suso_load_from_db( lv_object ).
    IF lv_failed = abap_true.
      ev_found = abap_false.
      RETURN.
    ENDIF.
    ev_found = abap_true.

    " Mirror the ADT select: reading a SUSO requires display authorization.
    IF lo_suso->suso_authority_check( id_objct = lv_object
                                      id_actvt = gc_read_act ) <> gc_read_act.
      ev_denied = abap_true.
      RETURN.
    ENDIF.

    DATA ls_head TYPE susr_s_tobj_head.
    DATA lt_fields TYPE susr_tt_tobj_fields.
    DATA lt_actvt TYPE cl_suso_gen=>tt_tactz.
    lo_suso->get_suso_from_buffer( IMPORTING es_tobj_head = ls_head
                                             et_fields    = lt_fields
                                             et_actvt     = lt_actvt ).

    es_data-format_version = '1'.
    es_data-name = iv_name.
    es_data-package = package_of_name( iv_name ).

    " Short text: prefer the object master language, fall back to the text in
    " the session language that SUSO_LOAD_FROM_DB put into the buffer.
    DATA lv_langu TYPE sy-langu.
    lv_langu = master_language( iv_name ).
    DATA lv_text TYPE string.
    lv_text = read_short_text( iv_name = iv_name iv_langu = lv_langu ).
    IF lv_text IS INITIAL AND ls_head-ttext IS NOT INITIAL.
      lv_text = ls_head-ttext.
      lv_langu = sy-langu.
    ENDIF.
    es_data-header-description = lv_text.
    es_data-header-original_language = iso_language( lv_langu ).

    DATA lv_language_version TYPE abap_language_version.
    SELECT SINGLE abap_language_version FROM tobj_attr INTO @lv_language_version
      WHERE objct = @iv_name.
    es_data-header-abap_language_version = language_version_from_db( lv_language_version ).

    DATA ls_tobj TYPE tobj.
    SELECT SINGLE * FROM tobj INTO @ls_tobj WHERE objct = @iv_name.
    IF sy-subrc = 0.
      es_data-general_information-object_class = ls_tobj-oclss.
      es_data-general_information-field_block = condense( val = ls_tobj-fblock ).
      es_data-general_information-conversion = boolc( ls_tobj-conversion = 'X' ).
    ELSE.
      es_data-general_information-object_class = ls_head-oclss.
    ENDIF.

    LOOP AT lt_fields INTO DATA(ls_field).
      APPEND VALUE #( authorization_field = ls_field-field ) TO es_data-authorization_fields.
    ENDLOOP.

    LOOP AT lt_actvt INTO DATA(ls_actvt).
      APPEND VALUE #( activity = condense( val = ls_actvt-actvt ) ) TO es_data-permitted_activities.
    ENDLOOP.

    DATA ls_flg TYPE tobjvorflg.
    SELECT SINGLE flag1, flag2, flag3, flag4, flag5 FROM tobjvorflg
      INTO CORRESPONDING FIELDS OF @ls_flg
      WHERE objct = @iv_name.
    DATA lv_flag2 TYPE string.
    DATA lv_flag3 TYPE string.
    DATA lv_flag4 TYPE string.
    DATA lv_flag5 TYPE string.
    lv_flag2 = ls_flg-flag2.
    lv_flag3 = ls_flg-flag3.
    lv_flag4 = ls_flg-flag4.
    lv_flag5 = ls_flg-flag5.
    es_data-object_attributes-criticality = criticality_from_db( lv_flag3 ).
    es_data-object_attributes-class_copy_to_default_data = trace_from_db( lv_flag2 ).
    es_data-sap_new_relevance-is_relevant_to_sap_new = boolc( ls_flg-flag1 = 'X' ).
    es_data-classification_for_cds_bdef-usage_in_own_auth_context =
        own_context_from_db( lv_flag4 ).
    es_data-classification_for_cds_bdef-usage_in_privileged_bdef_mode =
        privileged_from_db( lv_flag5 ).

    DATA lt_values TYPE STANDARD TABLE OF tobjvordat WITH EMPTY KEY.
    SELECT * FROM tobjvordat INTO TABLE @lt_values WHERE objct = @iv_name.
    SORT lt_values BY release lfdnr field low high.
    LOOP AT lt_values INTO DATA(ls_val).
      APPEND VALUE #( release     = condense( val = ls_val-release )
                      line_number = condense( val = ls_val-lfdnr )
                      field       = condense( val = ls_val-field )
                      low         = condense( val = ls_val-low )
                      high        = condense( val = ls_val-high ) )
        TO es_data-sap_new_relevance-values.
    ENDLOOP.

    es_data-long_text = read_long_text( iv_name = iv_name iv_langu = lv_langu ).
  ENDMETHOD.

  METHOD read_short_text.
    CLEAR rv_text.
    SELECT SINGLE ttext FROM tobjt INTO @rv_text
      WHERE object = @iv_name AND langu = @iv_langu.
    IF sy-subrc <> 0.
      CLEAR rv_text.
    ENDIF.
  ENDMETHOD.

  METHOD read_long_text.
    CLEAR rv_text.
    DATA lv_langu TYPE sy-langu.
    lv_langu = iv_langu.
    IF lv_langu IS INITIAL.
      lv_langu = sy-langu.
    ENDIF.
    DATA lv_object TYPE dokhl-object.
    lv_object = iv_name.
    DATA lt_lines TYPE tline_tab.
    CALL FUNCTION 'DOCU_GET'
      EXPORTING
        id     = gc_longtext_id
        langu  = lv_langu
        object = lv_object
      TABLES
        line   = lt_lines
      EXCEPTIONS
        OTHERS = 1.
    IF sy-subrc <> 0 OR lines( lt_lines ) = 0.
      IF lv_langu <> 'E'.
        CALL FUNCTION 'DOCU_GET'
          EXPORTING
            id     = gc_longtext_id
            langu  = 'E'
            object = lv_object
          TABLES
            line   = lt_lines
          EXCEPTIONS
            OTHERS = 1.
        IF sy-subrc <> 0.
          CLEAR lt_lines.
        ENDIF.
      ENDIF.
    ENDIF.
    LOOP AT lt_lines INTO DATA(ls_line).
      IF sy-tabix = 1.
        rv_text = ls_line-tdline.
      ELSE.
        rv_text = rv_text && cl_abap_char_utilities=>newline && ls_line-tdline.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD write_long_text.
    CLEAR: ev_ok, ev_msg.
    DATA lv_object TYPE dokhl-object.
    lv_object = iv_name.
    IF iv_text IS INITIAL.
      " Replace semantics: an empty longText removes the documentation.
      CALL FUNCTION 'DOKU_DELETE_ALL'
        EXPORTING
          doku_id            = gc_longtext_id
          doku_object        = lv_object
          suppress_transport = abap_true
        EXCEPTIONS
          OTHERS             = 1.
      ev_ok = abap_true.
      RETURN.
    ENDIF.
    DATA lv_text TYPE string.
    lv_text = iv_text.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>cr_lf
      IN lv_text WITH cl_abap_char_utilities=>newline.
    DATA lt_parts TYPE STANDARD TABLE OF string WITH EMPTY KEY.
    SPLIT lv_text AT cl_abap_char_utilities=>newline INTO TABLE lt_parts.
    DATA lt_lines TYPE tline_tab.
    LOOP AT lt_parts INTO DATA(lv_line).
      APPEND VALUE tline( tdformat = '' tdline = lv_line ) TO lt_lines.
    ENDLOOP.
    CALL FUNCTION 'DOCU_UPD'
      EXPORTING
        id     = gc_longtext_id
        langu  = iv_langu
        object = lv_object
      TABLES
        line   = lt_lines
      EXCEPTIONS
        OTHERS = 1.
    IF sy-subrc = 0.
      ev_ok = abap_true.
    ELSE.
      ev_msg = error_message( ).
      IF ev_msg IS INITIAL.
        ev_msg = |DOCU_UPD failed (sy-subrc { sy-subrc })|.
      ENDIF.
    ENDIF.
  ENDMETHOD.

  METHOD fix_text_language.
    " CL_SUSO_GEN always writes TOBJT in the session language. When the
    " document is written in another language, restore the session-language
    " text and write the document-language text directly.
    IF iv_langu IS INITIAL OR iv_langu = sy-langu.
      RETURN.
    ENDIF.
    DATA ls_tobjt TYPE tobjt.
    ls_tobjt-object = iv_name.
    ls_tobjt-langu = sy-langu.
    IF iv_prev_zh IS NOT INITIAL.
      ls_tobjt-ttext = iv_prev_zh.
      MODIFY tobjt FROM ls_tobjt.
    ELSE.
      DELETE FROM tobjt WHERE object = @iv_name AND langu = @sy-langu.
    ENDIF.
    CLEAR ls_tobjt.
    ls_tobjt-object = iv_name.
    ls_tobjt-langu = iv_langu.
    ls_tobjt-ttext = iv_text.
    MODIFY tobjt FROM ls_tobjt.
    COMMIT WORK.
  ENDMETHOD.

  METHOD sync_direct_fields.
    CLEAR: ev_ok, ev_msg.
    " TOBJVORFLG: the dark API only persists FLAG1/FLAG2; the criticality and
    " CDS classification flags must be written directly (narrow exception).
    DATA ls_flg TYPE tobjvorflg.
    ls_flg-objct = iv_name.
    ls_flg-flag1 = COND char1( WHEN is_doc-sap_new_relevance-is_relevant_to_sap_new = abap_true
                               THEN 'X' ELSE '' ).
    ls_flg-flag2 = is_sap-trace_flag.
    ls_flg-flag3 = is_sap-criticality.
    ls_flg-flag4 = is_sap-own_context.
    ls_flg-flag5 = is_sap-privileged.
    MODIFY tobjvorflg FROM ls_flg.

    " TOBJ-FBLOCK / CONVERSION are not part of the dark API's head structure.
    UPDATE tobj SET fblock = @is_sap-fblock, conversion = @is_sap-conversion
      WHERE objct = @iv_name.

    " TOBJVOR / TOBJVORDAT: full replace from the document (the dark update
    " only touches them when SAP_NEW relevance is set).
    DELETE FROM tobjvor WHERE objct = @iv_name.
    DELETE FROM tobjvordat WHERE objct = @iv_name.
    DATA lt_rel TYPE if_su21_adt_object=>tt_tobjvor.
    DATA lt_val TYPE if_su21_adt_object=>tt_tobjvordat.
    lt_rel = is_sap-sapnew_rel.
    lt_val = is_sap-sapnew_val.
    IF lt_rel IS NOT INITIAL.
      INSERT tobjvor FROM TABLE @lt_rel.
    ENDIF.
    IF lt_val IS NOT INITIAL.
      INSERT tobjvordat FROM TABLE @lt_val.
    ENDIF.
    COMMIT WORK.
    ev_ok = abap_true.
  ENDMETHOD.

  METHOD master_language.
    CLEAR rv_langu.
    SELECT SINGLE masterlang FROM tadir INTO @rv_langu
      WHERE pgmid = 'R3TR' AND object = 'SUSO' AND obj_name = @iv_name.
    IF sy-subrc <> 0 OR rv_langu IS INITIAL.
      rv_langu = sy-langu.
    ENDIF.
  ENDMETHOD.

  METHOD package_of_name.
    CLEAR rv_package.
    SELECT SINGLE devclass FROM tadir INTO @rv_package
      WHERE pgmid = 'R3TR' AND object = 'SUSO' AND obj_name = @iv_name.
  ENDMETHOD.

  METHOD tadir_masterlang.
    " Keep the TADIR master language in sync with the language the short and
    " long text are written in (RS_CORR_INSERT itself records sy-langu).
    UPDATE tadir SET masterlang = @iv_langu
      WHERE pgmid = 'R3TR' AND object = 'SUSO' AND obj_name = @iv_name.
    COMMIT WORK.
  ENDMETHOD.

  METHOD sap_language.
    CLEAR rv_langu.
    IF iv_iso IS INITIAL.
      RETURN.
    ENDIF.
    SELECT SINGLE spras FROM t002 INTO @rv_langu WHERE laiso = @iv_iso.
    IF sy-subrc <> 0.
      CLEAR rv_langu.
      IF strlen( iv_iso ) = 1.
        rv_langu = iv_iso.
      ENDIF.
    ENDIF.
  ENDMETHOD.

  METHOD iso_language.
    CLEAR rv_iso.
    SELECT SINGLE laiso FROM t002 INTO @rv_iso WHERE spras = @iv_langu.
    IF sy-subrc <> 0 OR rv_iso IS INITIAL.
      rv_iso = 'EN'.
    ENDIF.
    rv_iso = to_upper( rv_iso ).
  ENDMETHOD.

  METHOD trace_to_db.
    CASE to_lower( condense( val = iv_value ) ).
      WHEN '' OR 'withoutrestriction'.
        rv_flag = ''.
      WHEN 'ifinsameapplcomponent'.
        rv_flag = 'A'.
      WHEN 'ifinsamesoftwarecomponent'.
        rv_flag = 'S'.
      WHEN 'ifinsamesoftwarepackage'.
        rv_flag = 'P'.
      WHEN 'notcopiedfromtracedata'.
        rv_flag = 'N'.
      WHEN OTHERS.
        rv_flag = ''.
    ENDCASE.
  ENDMETHOD.

  METHOD trace_from_db.
    DATA lv_flag TYPE string.
    lv_flag = condense( val = iv_flag ).
    CASE lv_flag.
      WHEN ''.
        rv_value = 'withoutRestriction'.
      WHEN 'A'.
        rv_value = 'ifInSameApplComponent'.
      WHEN 'S'.
        rv_value = 'ifInSameSoftwareComponent'.
      WHEN 'P'.
        rv_value = 'ifInSameSoftwarePackage'.
      WHEN 'N'.
        rv_value = 'notCopiedFromTraceData'.
      WHEN OTHERS.
        rv_value = 'withoutRestriction'.
    ENDCASE.
  ENDMETHOD.

  METHOD criticality_to_db.
    CASE to_lower( condense( val = iv_value ) ).
      WHEN '' OR 'notspecified'.
        rv_flag = ''.
      WHEN 'critical'.
        rv_flag = 'C'.
      WHEN 'notcritical'.
        rv_flag = 'N'.
      WHEN OTHERS.
        rv_flag = ''.
    ENDCASE.
  ENDMETHOD.

  METHOD criticality_from_db.
    DATA lv_flag TYPE string.
    lv_flag = condense( val = iv_flag ).
    CASE lv_flag.
      WHEN 'C'.
        rv_value = 'critical'.
      WHEN 'N'.
        rv_value = 'notCritical'.
      WHEN OTHERS.
        rv_value = 'notSpecified'.
    ENDCASE.
  ENDMETHOD.

  METHOD own_context_to_db.
    CASE to_lower( condense( val = iv_value ) ).
      WHEN '' OR 'notspecified'.
        rv_flag = ''.
      WHEN 'notallowed'.
        rv_flag = 'N'.
      WHEN 'allowed'.
        rv_flag = 'A'.
      WHEN 'insamesoftwarecomponent'.
        rv_flag = 'S'.
      WHEN OTHERS.
        rv_flag = ''.
    ENDCASE.
  ENDMETHOD.

  METHOD own_context_from_db.
    DATA lv_flag TYPE string.
    lv_flag = condense( val = iv_flag ).
    CASE lv_flag.
      WHEN 'N'.
        rv_value = 'notAllowed'.
      WHEN 'A'.
        rv_value = 'allowed'.
      WHEN 'S'.
        rv_value = 'inSameSoftwareComponent'.
      WHEN OTHERS.
        rv_value = 'notSpecified'.
    ENDCASE.
  ENDMETHOD.

  METHOD privileged_to_db.
    CASE to_lower( condense( val = iv_value ) ).
      WHEN '' OR 'notspecified'.
        rv_flag = ''.
      WHEN 'notallowed'.
        rv_flag = 'N'.
      WHEN 'allowed'.
        rv_flag = 'A'.
      WHEN OTHERS.
        rv_flag = ''.
    ENDCASE.
  ENDMETHOD.

  METHOD privileged_from_db.
    DATA lv_flag TYPE string.
    lv_flag = condense( val = iv_flag ).
    CASE lv_flag.
      WHEN 'N'.
        rv_value = 'notAllowed'.
      WHEN 'A'.
        rv_value = 'allowed'.
      WHEN OTHERS.
        rv_value = 'notSpecified'.
    ENDCASE.
  ENDMETHOD.

  METHOD language_version_to_db.
    CASE to_lower( condense( val = iv_value ) ).
      WHEN '' OR 'standard'.
        rv_value = space.
      WHEN 'keyuser'.
        rv_value = '2'.
      WHEN 'clouddevelopment'.
        rv_value = '5'.
      WHEN OTHERS.
        rv_value = space.
    ENDCASE.
  ENDMETHOD.

  METHOD language_version_from_db.
    CASE iv_value.
      WHEN space.
        rv_value = 'standard'.
      WHEN 'X'.
        rv_value = 'standard'.
      WHEN '2'.
        rv_value = 'keyUser'.
      WHEN OTHERS.
        rv_value = 'cloudDevelopment'.
    ENDCASE.
  ENDMETHOD.

  METHOD regen_requested.
    CLEAR rv_regen.
    DATA lv_value TYPE string.
    lv_value = zcl_abap_vibe_icf_response=>query_param( iv_query = iv_query
                                                        iv_name = 'regenerateProfiles' ).
    IF to_lower( lv_value ) = 'true' OR to_upper( lv_value ) = 'X'.
      rv_regen = abap_true.
    ENDIF.
  ENDMETHOD.

  METHOD regen_preflight.
    CLEAR: ev_ok, ev_http_code, ev_code, ev_msg.
    ev_ok = abap_true.
    TRY.
        IF cl_auth_gen=>auth_check_generate_sap_all( ) IS NOT INITIAL.
          ev_ok = abap_false.
          ev_http_code = 403.
          ev_code = 'SUSO_NOT_AUTHORIZED'.
          ev_msg = 'not authorized to generate the SAP_ALL/SAP_NEW profiles'.
          RETURN.
        ENDIF.
        IF cl_auth_zdm=>appl_lock_check( sy-repid ) IS NOT INITIAL.
          ev_ok = abap_false.
          ev_http_code = 409.
          ev_code = 'SUSO_LOCKED'.
          ev_msg = 'SAP_ALL/SAP_NEW generation is locked by another process'.
        ENDIF.
      CATCH cx_root INTO DATA(lx_error).
        ev_ok = abap_false.
        ev_http_code = 500.
        ev_code = 'SUSO_WRITE_FAILED'.
        ev_msg = |profile regeneration preflight failed: { lx_error->get_text( ) }|.
    ENDTRY.
  ENDMETHOD.

  METHOD regenerate_profiles.
    CLEAR: ev_ok, ev_msg.
    DATA lt_e071 TYPE STANDARD TABLE OF e071 WITH EMPTY KEY.
    DATA lt_e071k TYPE STANDARD TABLE OF e071k WITH EMPTY KEY.
    lt_e071 = VALUE #( ( pgmid = 'R3TR' object = 'SUSO' obj_name = iv_name ) ).

    " Same protection as abapGit: keep PRGN_AFTER_IMP_SUSO_SAP_ALL from writing
    " a protocol file during the request.
    DATA lv_mem_file TYPE protfile.
    lv_mem_file = 'zabap_vibe_suso.log'.
    EXPORT gv_mem_file = lv_mem_file TO MEMORY ID 'prot_file'.

    TRY.
        CALL FUNCTION 'PRGN_AFTER_IMP_SUSO_SAP_ALL'
          EXPORTING
            iv_tarclient  = '000'
            iv_is_upgrade = space
          TABLES
            tt_e071       = lt_e071
            tt_e071k      = lt_e071k
          EXCEPTIONS
            OTHERS        = 1.
        IF sy-subrc = 0.
          ev_ok = abap_true.
        ELSE.
          ev_msg = error_message( ).
          IF ev_msg IS INITIAL.
            ev_msg = |PRGN_AFTER_IMP_SUSO_SAP_ALL failed (sy-subrc { sy-subrc })|.
          ENDIF.
        ENDIF.
      CATCH cx_root INTO DATA(lx_error).
        ev_ok = abap_false.
        ev_msg = lx_error->get_text( ).
    ENDTRY.
  ENDMETHOD.

  METHOD write_error_http.
    CASE iv_rc.
      WHEN 8.
        rv_http = 403.
      WHEN 4.
        rv_http = 404.
      WHEN 16 OR 20 OR 21 OR 30 OR 31 OR 32.
        rv_http = 400.
      WHEN OTHERS.
        rv_http = 500.
    ENDCASE.
  ENDMETHOD.

  METHOD write_error_code.
    CASE iv_rc.
      WHEN 4.
        rv_code = 'SUSO_NOT_FOUND'.
      WHEN 8.
        rv_code = 'SUSO_NOT_AUTHORIZED'.
      WHEN 16.
        rv_code = 'SUSO_TRANSPORT_REQUIRED'.
      WHEN 20 OR 21 OR 30 OR 31 OR 32.
        rv_code = 'SUSO_INVALID_PAYLOAD'.
      WHEN OTHERS.
        rv_code = 'SUSO_WRITE_FAILED'.
    ENDCASE.
  ENDMETHOD.

  METHOD write_error_message.
    DATA lv_msg TYPE string.
    lv_msg = error_message( ).
    CASE iv_rc.
      WHEN 4.
        rv_msg = 'SUSO does not exist'.
      WHEN 8.
        rv_msg = lv_msg.
        IF rv_msg IS INITIAL.
          rv_msg = 'not authorized to change this SUSO (or the object is not editable)'.
        ENDIF.
      WHEN 16.
        rv_msg = lv_msg.
        IF rv_msg IS INITIAL.
          rv_msg = 'transport request recording failed'.
        ENDIF.
      WHEN 20 OR 21.
        rv_msg = lv_msg.
        IF rv_msg IS INITIAL.
          rv_msg = 'invalid SUSO header data'.
        ENDIF.
      WHEN 30.
        rv_msg = 'the authorization field list must not be empty'.
      WHEN 31.
        rv_msg = lv_msg.
        IF rv_msg IS INITIAL.
          rv_msg = 'invalid authorization field name'.
        ENDIF.
      WHEN 32.
        rv_msg = lv_msg.
        IF rv_msg IS INITIAL.
          rv_msg = 'the authorization field list cannot be changed for this object'.
        ENDIF.
      WHEN OTHERS.
        rv_msg = lv_msg.
        IF rv_msg IS INITIAL.
          rv_msg = |SUSO write failed (sy-subrc { iv_rc })|.
        ENDIF.
    ENDCASE.
  ENDMETHOD.

  METHOD delete_error.
    CLEAR: ev_http, ev_code, ev_msg.
    ev_msg = error_message( ).
    CASE iv_rc.
      WHEN 4.
        ev_http = 404.
        ev_code = 'SUSO_NOT_FOUND'.
        IF ev_msg IS INITIAL.
          ev_msg = 'SUSO does not exist'.
        ENDIF.
      WHEN 8.
        ev_http = 409.
        ev_code = 'SUSO_DELETE_REFUSED'.
        IF ev_msg IS INITIAL.
          ev_msg = 'SUSO cannot be deleted; check where-used in SU21'.
        ENDIF.
      WHEN 16.
        ev_http = 400.
        ev_code = 'SUSO_TRANSPORT_REQUIRED'.
        IF ev_msg IS INITIAL.
          ev_msg = 'transport request recording failed'.
        ENDIF.
      WHEN OTHERS.
        ev_http = 500.
        ev_code = 'SUSO_DELETE_FAILED'.
        IF ev_msg IS INITIAL.
          ev_msg = |SUSO delete failed (sy-subrc { iv_rc })|.
        ENDIF.
    ENDCASE.
  ENDMETHOD.

  METHOD respond_corr_error.
    zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                   iv_status = iv_http_code iv_code = iv_code iv_msg = iv_msg ).
  ENDMETHOD.

  METHOD respond_read.
    DATA ls_payload TYPE ty_get_payload.
    ls_payload-status = 'success'.
    ls_payload-data = is_data.
    zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                  iv_status = 200 iv_reason = 'OK' is_payload = ls_payload ).
  ENDMETHOD.

  METHOD respond_write.
    DATA ls_payload TYPE ty_write_payload.
    ls_payload-status = 'success'.
    ls_payload-data-name = iv_name.
    ls_payload-data-type = 'SUSO'.
    ls_payload-data-action = iv_action.
    ls_payload-data-package = iv_package.
    ls_payload-data-activated = abap_false.
    IF iv_regen = abap_true AND iv_regen_error IS INITIAL.
      ls_payload-data-profiles_regenerated = abap_true.
    ELSE.
      ls_payload-data-profiles_regenerated = abap_false.
      IF iv_regen = abap_true.
        ls_payload-data-profiles_regeneration_error = iv_regen_error.
      ENDIF.
    ENDIF.
    zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                  iv_status = 200 iv_reason = 'OK' is_payload = ls_payload ).
  ENDMETHOD.

  METHOD error_message.
    rv_msg = zcl_abap_vibe_icf_auth_common=>last_message( ).
  ENDMETHOD.
ENDCLASS.
