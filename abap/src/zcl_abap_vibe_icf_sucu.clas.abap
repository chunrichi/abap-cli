CLASS zcl_abap_vibe_icf_sucu DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    " TADIR-OBJ_NAME is CHAR 40: BRGRU padded to 30 + OBJECT padded to 10.
    CONSTANTS gc_name_max_length TYPE i VALUE 40.
    CONSTANTS gc_group_max_length TYPE i VALUE 30.
    CONSTANTS gc_object_max_length TYPE i VALUE 10.
    " TBRG_AUTHT-BEZEI is CHAR 40.
    CONSTANTS gc_text_max_length TYPE i VALUE 40.

    CLASS-METHODS dispatch
      IMPORTING io_server TYPE REF TO if_http_server
                iv_path   TYPE string
                iv_method TYPE string
                iv_body   TYPE string.

  PRIVATE SECTION.
    " ----- authorization group document (local <token>.sucu.json / GET data) -----
    TYPES:
      BEGIN OF ty_header,
        description       TYPE string,
        original_language TYPE string,
      END OF ty_header,
      BEGIN OF ty_general_information,
        authorization_group  TYPE string,
        authorization_object TYPE string,
      END OF ty_general_information,
      BEGIN OF ty_text,
        language    TYPE string,
        description TYPE string,
      END OF ty_text,
      tt_text TYPE STANDARD TABLE OF ty_text WITH EMPTY KEY,
      BEGIN OF ty_document,
        format_version      TYPE string,
        header              TYPE ty_header,
        general_information TYPE ty_general_information,
        texts               TYPE tt_text,
      END OF ty_document,
      BEGIN OF ty_document_data,
        format_version      TYPE string,
        header              TYPE ty_header,
        general_information TYPE ty_general_information,
        texts               TYPE tt_text,
        name                TYPE string,
        package             TYPE devclass,
      END OF ty_document_data,
      BEGIN OF ty_get_response,
        status TYPE string,
        data   TYPE ty_document_data,
      END OF ty_get_response.

    " ----- /auth/sucu/<name> read -----
    CLASS-METHODS read_sucu
      IMPORTING iv_brgru       TYPE tbrg_auth-brgru
                iv_object      TYPE tbrg_auth-object
      EXPORTING es_payload     TYPE ty_document_data
                ev_found       TYPE abap_bool
                ev_error_code  TYPE string
                ev_error_msg   TYPE string.

    " ----- /auth/sucu/<name> write (POST create, PUT update) -----
    CLASS-METHODS write_sucu
      IMPORTING io_server TYPE REF TO if_http_server
                iv_method TYPE string
                iv_name   TYPE string
                iv_brgru  TYPE tbrg_auth-brgru
                iv_object TYPE tbrg_auth-object
                iv_body   TYPE string.

    " ----- /auth/sucu/<name> delete -----
    CLASS-METHODS delete_sucu
      IMPORTING io_server TYPE REF TO if_http_server
                iv_name   TYPE string
                iv_brgru  TYPE tbrg_auth-brgru
                iv_object TYPE tbrg_auth-object
                iv_query  TYPE string.

    " ----- name handling -----
    CLASS-METHODS parse_name
      IMPORTING iv_raw    TYPE string
      EXPORTING ev_brgru  TYPE tbrg_auth-brgru
                ev_object TYPE tbrg_auth-object
                ev_error  TYPE string.

    CLASS-METHODS build_key
      IMPORTING iv_brgru      TYPE tbrg_auth-brgru
                iv_object     TYPE tbrg_auth-object
      RETURNING VALUE(rv_key) TYPE tadir-obj_name.

    CLASS-METHODS display_name
      IMPORTING iv_brgru       TYPE tbrg_auth-brgru
                iv_object      TYPE tbrg_auth-object
      RETURNING VALUE(rv_name) TYPE string.

    CLASS-METHODS part_valid
      IMPORTING iv_part        TYPE string
                iv_max_length  TYPE i
      RETURNING VALUE(rv_ok)   TYPE abap_bool.

    " ----- table access -----
    CLASS-METHODS sucu_exists
      IMPORTING iv_brgru         TYPE tbrg_auth-brgru
                iv_object        TYPE tbrg_auth-object
      RETURNING VALUE(rv_exists) TYPE abap_bool.

    CLASS-METHODS write_rows
      IMPORTING is_doc             TYPE ty_document
                iv_brgru           TYPE tbrg_auth-brgru
                iv_object          TYPE tbrg_auth-object
                iv_master_language TYPE sy-langu
      RETURNING VALUE(rv_error)    TYPE string.

    CLASS-METHODS delete_rows
      IMPORTING iv_brgru  TYPE tbrg_auth-brgru
                iv_object TYPE tbrg_auth-object.

    " ----- document validation -----
    CLASS-METHODS validate_document
      IMPORTING iv_brgru TYPE tbrg_auth-brgru
                iv_object TYPE tbrg_auth-object
      EXPORTING ev_code  TYPE string
                ev_msg   TYPE string
      CHANGING  cs_doc   TYPE ty_document.

    " ----- language mapping (AFF ISO code <-> SAP 1-char language) -----
    CLASS-METHODS iso_from_sap_language
      IMPORTING iv_spras      TYPE sy-langu
      RETURNING VALUE(rv_iso) TYPE string.

    CLASS-METHODS sap_language_from_iso
      IMPORTING iv_iso   TYPE string
      EXPORTING ev_spras TYPE sy-langu
                ev_ok    TYPE abap_bool.

    " ----- responses -----
    CLASS-METHODS respond_invalid
      IMPORTING io_server TYPE REF TO if_http_server
                iv_code   TYPE string
                iv_msg    TYPE string.
ENDCLASS.

CLASS zcl_abap_vibe_icf_sucu IMPLEMENTATION.
  METHOD dispatch.
    " Route /auth/sucu/<name>: one cross-client authorization group
    " (TBRG_AUTH key row + TBRG_AUTHT texts) plus its TADIR/transport entry.
    " The route name is the compact BRGRU~OBJECT form (CLI identity) or the raw
    " 40-character padded TADIR name; the TADIR/OBJSL key is always the padded
    " composite. abapGit drives this object through zcl_abapgit_objects_generic
    " (direct table writes + CTS insert), which is the path ported here.
    DATA lv_match_name TYPE string.

    FIND REGEX '^/auth/sucu/(.+)$' IN iv_path IGNORING CASE SUBMATCHES lv_match_name.
    IF sy-subrc <> 0 OR lv_match_name IS INITIAL.
      respond_invalid( io_server = io_server
                       iv_code   = 'SUCU_NAME_INVALID'
                       iv_msg    = 'authorization group name is required' ).
      RETURN.
    ENDIF.

    DATA(lv_raw) = cl_http_utility=>if_http_utility~unescape_url( escaped = lv_match_name ).
    DATA lv_brgru TYPE tbrg_auth-brgru.
    DATA lv_object TYPE tbrg_auth-object.
    DATA lv_error TYPE string.
    parse_name( EXPORTING iv_raw    = lv_raw
                IMPORTING ev_brgru  = lv_brgru
                          ev_object = lv_object
                          ev_error  = lv_error ).
    IF lv_error IS NOT INITIAL.
      respond_invalid( io_server = io_server
                       iv_code   = 'SUCU_NAME_INVALID'
                       iv_msg    = lv_error ).
      RETURN.
    ENDIF.

    CASE iv_method.
      WHEN 'GET'.
        DATA ls_payload TYPE ty_document_data.
        DATA lv_code TYPE string.
        DATA lv_msg TYPE string.
        read_sucu( EXPORTING iv_brgru      = lv_brgru
                             iv_object     = lv_object
                   IMPORTING es_payload    = ls_payload
                             ev_found      = DATA(lv_found)
                             ev_error_code = lv_code
                             ev_error_msg  = lv_msg ).
        IF lv_code IS NOT INITIAL.
          zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                           iv_status = 500
                           iv_code   = lv_code
                           iv_msg    = lv_msg ).
          RETURN.
        ENDIF.
        IF lv_found = abap_false.
          zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                           iv_status = 404
                           iv_code   = 'SUCU_NOT_FOUND'
                           iv_msg    = |authorization group { display_name( iv_brgru = lv_brgru iv_object = lv_object ) } does not exist| ).
          RETURN.
        ENDIF.
        zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                      iv_status  = 200
                      iv_reason  = 'OK'
                      is_payload = VALUE ty_get_response( status = 'success'
                                                          data   = ls_payload ) ).
      WHEN 'POST' OR 'PUT'.
        write_sucu( io_server = io_server
                    iv_method = iv_method
                    iv_name   = display_name( iv_brgru = lv_brgru iv_object = lv_object )
                    iv_brgru  = lv_brgru
                    iv_object = lv_object
                    iv_body   = iv_body ).
      WHEN 'DELETE'.
        delete_sucu( io_server = io_server
                     iv_name   = display_name( iv_brgru = lv_brgru iv_object = lv_object )
                     iv_brgru  = lv_brgru
                     iv_object = lv_object
                     iv_query  = io_server->request->get_header_field( '~query_string' ) ).
      WHEN OTHERS.
        zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                       iv_status = 405
                       iv_code   = 'METHOD_NOT_ALLOWED'
                       iv_msg    = |{ iv_method } not supported on /auth/sucu/<name>| ).
    ENDCASE.
  ENDMETHOD.

  METHOD parse_name.
    " Accept the compact BRGRU~OBJECT CLI name and the raw 40-character padded
    " TADIR name. The padded form is the live SAP key; the compact form is what
    " the CLI sends (TADIR names cannot contain '~', so the separator is
    " unambiguous even for namespaced names such as /AIF/...).
    CLEAR: ev_brgru, ev_object, ev_error.

    DATA lv_raw TYPE string.
    lv_raw = iv_raw.
    IF lv_raw IS INITIAL.
      ev_error = 'authorization group name is required'.
      RETURN.
    ENDIF.

    DATA lv_group TYPE string.
    DATA lv_object TYPE string.
    DATA(lv_sep) = find( val = lv_raw sub = '~' ).
    IF lv_sep >= 0.
      IF find( val = substring( val = lv_raw off = lv_sep + 1 ) sub = '~' ) >= 0.
        ev_error = |object name '{ lv_raw }' must contain exactly one ~ separator|.
        RETURN.
      ENDIF.
      lv_group = substring( val = lv_raw off = 0 len = lv_sep ).
      lv_object = substring( val = lv_raw off = lv_sep + 1 ).
    ELSEIF strlen( lv_raw ) = gc_name_max_length.
      " raw TADIR key: BRGRU 30 + OBJECT 10, padded with blanks.
      lv_group = substring( val = lv_raw off = 0 len = gc_group_max_length ).
      lv_object = substring( val = lv_raw off = gc_group_max_length len = gc_object_max_length ).
    ELSE.
      ev_error = |object name '{ lv_raw }' must be <GROUP>~<OBJECT> or the { gc_name_max_length }-character TADIR name|.
      RETURN.
    ENDIF.

    lv_group = to_upper( condense( val = lv_group ) ).
    lv_object = to_upper( condense( val = lv_object ) ).
    IF part_valid( iv_part = lv_group iv_max_length = gc_group_max_length ) = abap_false.
      ev_error = |authorization group '{ lv_group }' must be 1-{ gc_group_max_length } characters A-Z, 0-9, _ or /|.
      RETURN.
    ENDIF.
    IF part_valid( iv_part = lv_object iv_max_length = gc_object_max_length ) = abap_false.
      ev_error = |authorization object '{ lv_object }' must be 1-{ gc_object_max_length } characters A-Z, 0-9, _ or /|.
      RETURN.
    ENDIF.

    ev_brgru = lv_group.
    ev_object = lv_object.
  ENDMETHOD.

  METHOD build_key.
    CLEAR rv_key.
    rv_key+0(gc_group_max_length) = iv_brgru.
    rv_key+gc_group_max_length(gc_object_max_length) = iv_object.
  ENDMETHOD.

  METHOD display_name.
    rv_name = |{ condense( val = iv_brgru ) }~{ condense( val = iv_object ) }|.
  ENDMETHOD.

  METHOD part_valid.
    rv_ok = abap_false.
    IF iv_part IS INITIAL OR strlen( iv_part ) > iv_max_length.
      RETURN.
    ENDIF.
    FIND REGEX '^[A-Z0-9_/]+$' IN iv_part.
    rv_ok = boolc( sy-subrc = 0 ).
  ENDMETHOD.

  METHOD sucu_exists.
    DATA lv_key TYPE tadir-obj_name.
    lv_key = build_key( iv_brgru = iv_brgru iv_object = iv_object ).
    SELECT SINGLE devclass FROM tadir INTO @DATA(lv_package)
      WHERE pgmid = 'R3TR' AND object = 'SUCU' AND obj_name = @lv_key.
    IF sy-subrc = 0.
      rv_exists = abap_true.
      RETURN.
    ENDIF.
    SELECT SINGLE brgru FROM tbrg_auth INTO @DATA(lv_brgru)
      WHERE brgru = @iv_brgru AND object = @iv_object.
    rv_exists = boolc( sy-subrc = 0 ).
  ENDMETHOD.

  METHOD read_sucu.
    " Read one authorization group: TBRG_AUTH key row, TBRG_AUTHT texts, TADIR
    " package/master language. A row without a TADIR entry still counts as
    " existing (the package stays empty then).
    CLEAR: es_payload, ev_found, ev_error_code, ev_error_msg.

    DATA lv_key TYPE tadir-obj_name.
    lv_key = build_key( iv_brgru = iv_brgru iv_object = iv_object ).

    SELECT SINGLE * FROM tbrg_auth INTO @DATA(ls_auth)
      WHERE brgru = @iv_brgru AND object = @iv_object.
    IF sy-subrc = 0.
      ev_found = abap_true.
    ENDIF.

    SELECT SINGLE devclass, masterlang FROM tadir INTO @DATA(ls_tadir)
      WHERE pgmid = 'R3TR' AND object = 'SUCU' AND obj_name = @lv_key.
    IF sy-subrc = 0.
      ev_found = abap_true.
    ENDIF.
    IF ev_found = abap_false.
      RETURN.
    ENDIF.

    DATA lt_text TYPE STANDARD TABLE OF tbrg_autht WITH EMPTY KEY.
    " SELECT *: the select list of a plain INTO TABLE fills the structure
    " positionally, so a partial field list would shift the columns.
    SELECT * FROM tbrg_autht INTO TABLE @lt_text
      WHERE brgru = @iv_brgru AND object = @iv_object.

    DATA lv_master_language TYPE sy-langu.
    lv_master_language = ls_tadir-masterlang.
    IF lv_master_language IS INITIAL.
      lv_master_language = sy-langu.
    ENDIF.

    es_payload-format_version = '1'.
    es_payload-general_information-authorization_group = condense( val = iv_brgru ).
    es_payload-general_information-authorization_object = condense( val = iv_object ).
    es_payload-header-original_language = iso_from_sap_language( lv_master_language ).

    LOOP AT lt_text INTO DATA(ls_text).
      IF ls_text-spras = lv_master_language.
        es_payload-header-description = condense( val = ls_text-bezei ).
      ELSE.
        APPEND VALUE ty_text( language    = iso_from_sap_language( ls_text-spras )
                              description = condense( val = ls_text-bezei ) ) TO es_payload-texts.
      ENDIF.
    ENDLOOP.
    SORT es_payload-texts BY language.
    es_payload-name = display_name( iv_brgru = iv_brgru iv_object = iv_object ).
    es_payload-package = ls_tadir-devclass.
  ENDMETHOD.

  METHOD write_sucu.
    " POST creates, PUT updates an existing object. Both record the TADIR entry
    " and the transport request first (shared RS_CORR_INSERT path), then replace
    " the TBRG_AUTH/TBRG_AUTHT rows — the same full-document semantics as
    " abapGit's generic deserialize (delete + insert + corr_insert).
    DATA: lv_package   TYPE devclass,
          lv_transport TYPE trkorr,
          lv_code      TYPE string,
          lv_msg       TYPE string,
          lv_verb      TYPE string,
          lv_query     TYPE string.

    lv_query = io_server->request->get_header_field( '~query_string' ).
    lv_transport = zcl_abap_vibe_icf_auth_common=>query_transport( lv_query ).
    lv_package = zcl_abap_vibe_icf_auth_common=>query_package( lv_query ).

    DATA ls_doc TYPE ty_document.
    IF zcl_abap_vibe_icf_auth_common=>parse_body( EXPORTING iv_body = iv_body
                                                  CHANGING  cs_doc  = ls_doc ) = abap_false.
      respond_invalid( io_server = io_server
                       iv_code   = 'SUCU_INVALID_PAYLOAD'
                       iv_msg    = 'request body is not a valid authorization group document (JSON object)' ).
      RETURN.
    ENDIF.

    IF iv_method = 'POST'.
      lv_verb = 'create'.
      IF lv_package IS INITIAL.
        respond_invalid( io_server = io_server
                         iv_code   = 'SUCU_INVALID_PAYLOAD'
                         iv_msg    = 'package query parameter is required to create an authorization group' ).
        RETURN.
      ENDIF.
      IF sucu_exists( iv_brgru = iv_brgru iv_object = iv_object ) = abap_true.
        zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                       iv_status = 409
                       iv_code   = 'SUCU_ALREADY_EXISTS'
                       iv_msg    = |authorization group { iv_name } already exists; update it instead| ).
        RETURN.
      ENDIF.
    ELSE.
      lv_verb = 'update'.
      IF sucu_exists( iv_brgru = iv_brgru iv_object = iv_object ) = abap_false.
        zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                       iv_status = 404
                       iv_code   = 'SUCU_NOT_FOUND'
                       iv_msg    = |authorization group { iv_name } does not exist; create it first| ).
        RETURN.
      ENDIF.
      " The package of the existing TADIR entry decides the transport rule; the
      " query package cannot move an object (a package change needs the CTS
      " dialog). A key row without TADIR entry is treated as a local object.
      DATA(lv_actual_package) = zcl_abap_vibe_icf_auth_common=>package_of(
                                    iv_tadir_object = 'SUCU'
                                    iv_name         = build_key( iv_brgru = iv_brgru iv_object = iv_object ) ).
      IF lv_actual_package IS NOT INITIAL.
        lv_package = lv_actual_package.
      ELSEIF lv_package IS INITIAL.
        lv_package = '$TMP'.
      ENDIF.
    ENDIF.

    validate_document( EXPORTING iv_brgru = iv_brgru
                                 iv_object = iv_object
                       IMPORTING ev_code  = lv_code
                                 ev_msg   = lv_msg
                       CHANGING  cs_doc   = ls_doc ).
    IF lv_code IS NOT INITIAL.
      respond_invalid( io_server = io_server
                       iv_code   = lv_code
                       iv_msg    = lv_msg ).
      RETURN.
    ENDIF.

    zcl_abap_vibe_icf_auth_common=>transport_rule( EXPORTING iv_package   = lv_package
                                                             iv_transport = lv_transport
                                                             iv_verb      = lv_verb
                                                             iv_prefix    = 'SUCU'
                                                   IMPORTING ev_code      = lv_code
                                                             ev_msg       = lv_msg ).
    IF lv_code IS NOT INITIAL.
      respond_invalid( io_server = io_server
                       iv_code   = lv_code
                       iv_msg    = lv_msg ).
      RETURN.
    ENDIF.

    " The document language becomes the TADIR master language (and the language
    " of the primary TBRG_AUTHT row); validate_document already proved it maps
    " in T002.
    DATA lv_master_language TYPE sy-langu.
    DATA lv_language_ok TYPE abap_bool.
    sap_language_from_iso( EXPORTING iv_iso   = ls_doc-header-original_language
                           IMPORTING ev_spras = lv_master_language
                                     ev_ok    = lv_language_ok ).
    IF lv_language_ok = abap_false.
      respond_invalid( io_server = io_server
                       iv_code   = 'SUCU_INVALID_PAYLOAD'
                       iv_msg    = |header.originalLanguage '{ ls_doc-header-original_language }' is not a known SAP language| ).
      RETURN.
    ENDIF.

    DATA lv_http_code TYPE i.
    DATA lv_author TYPE sy-uname.
    zcl_abap_vibe_icf_auth_common=>corr_insert(
        EXPORTING iv_tadir_object    = 'SUCU'
                  iv_name            = build_key( iv_brgru = iv_brgru iv_object = iv_object )
                  iv_package         = lv_package
                  iv_transport       = lv_transport
                  iv_mode            = 'I'
                  iv_prefix          = 'SUCU'
                  iv_master_language = lv_master_language
        IMPORTING ev_author          = lv_author
                  ev_http_code       = lv_http_code
                  ev_code            = lv_code
                  ev_msg             = lv_msg ).
    IF lv_code IS NOT INITIAL.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                       iv_status = lv_http_code
                       iv_code   = lv_code
                       iv_msg    = lv_msg ).
      RETURN.
    ENDIF.

    DATA(lv_write_error) = write_rows( is_doc             = ls_doc
                                       iv_brgru           = iv_brgru
                                       iv_object          = iv_object
                                       iv_master_language = lv_master_language ).
    IF lv_write_error IS NOT INITIAL.
      " Best-effort rollback of the row write. A local object also drops the
      " TADIR entry again; for a transportable object the TADIR/request binding
      " stays (the object directory must not lose the assignment) and the PUT
      " can be retried.
      delete_rows( iv_brgru = iv_brgru iv_object = iv_object ).
      IF zcl_abap_vibe_icf_types=>is_local_package( lv_package ) = abap_true.
        zcl_abap_vibe_icf_auth_common=>tadir_delete(
            iv_tadir_object = 'SUCU'
            iv_name         = build_key( iv_brgru = iv_brgru iv_object = iv_object )
            iv_package      = lv_package
            iv_transport    = lv_transport ).
      ENDIF.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                       iv_status = 500
                       iv_code   = 'SUCU_WRITE_FAILED'
                       iv_msg    = lv_write_error ).
      RETURN.
    ENDIF.

    zcl_abap_vibe_icf_auth_common=>respond_write_ok( io_server  = io_server
                  iv_name    = iv_name
                  iv_type    = 'SUCU'
                  iv_action  = COND string( WHEN iv_method = 'POST' THEN 'created' ELSE 'updated' )
                  iv_package = lv_package ).
  ENDMETHOD.

  METHOD delete_sucu.
    " Delete one authorization group. The ICF session cannot record a CTS
    " delete entry, so only transport-free ('$') objects are deletable here;
    " transportable objects must be deleted in SM30/SU21.
    DATA: lv_package   TYPE devclass,
          lv_transport TYPE trkorr,
          lv_code      TYPE string,
          lv_msg       TYPE string.

    lv_transport = zcl_abap_vibe_icf_auth_common=>query_transport( iv_query ).

    IF sucu_exists( iv_brgru = iv_brgru iv_object = iv_object ) = abap_false.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 404
                     iv_code   = 'SUCU_NOT_FOUND'
                     iv_msg    = |authorization group { iv_name } does not exist| ).
      RETURN.
    ENDIF.

    DATA lv_key TYPE tadir-obj_name.
    lv_key = build_key( iv_brgru = iv_brgru iv_object = iv_object ).
    lv_package = zcl_abap_vibe_icf_auth_common=>package_of( iv_tadir_object = 'SUCU'
                                                            iv_name         = CONV string( lv_key ) ).

    IF lv_package IS NOT INITIAL AND zcl_abap_vibe_icf_types=>is_local_package( lv_package ) = abap_false.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_code   = 'SUCU_DELETE_UNSUPPORTED'
                     iv_msg    = |authorization group { iv_name } is assigned to transportable package { lv_package }; delete it in SM30/SU21 so the deletion is recorded in a transport request| ).
      RETURN.
    ENDIF.
    IF lv_package IS INITIAL.
      " key row without TADIR entry: treat as a local object.
      lv_package = '$TMP'.
    ENDIF.

    zcl_abap_vibe_icf_auth_common=>transport_rule( EXPORTING iv_package   = lv_package
                                                             iv_transport = lv_transport
                                                             iv_verb      = 'delete'
                                                             iv_prefix    = 'SUCU'
                                                   IMPORTING ev_code      = lv_code
                                                             ev_msg       = lv_msg ).
    IF lv_code IS NOT INITIAL.
      respond_invalid( io_server = io_server
                       iv_code   = lv_code
                       iv_msg    = lv_msg ).
      RETURN.
    ENDIF.

    delete_rows( iv_brgru = iv_brgru iv_object = iv_object ).
    zcl_abap_vibe_icf_auth_common=>tadir_delete( iv_tadir_object = 'SUCU'
                                                 iv_name         = CONV string( lv_key )
                                                 iv_package      = lv_package
                                                 iv_transport    = lv_transport ).

    SELECT SINGLE devclass FROM tadir INTO @DATA(lv_leftover)
      WHERE pgmid = 'R3TR' AND object = 'SUCU' AND obj_name = @lv_key.
    IF sy-subrc = 0.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 500
                     iv_code   = 'SUCU_DELETE_FAILED'
                     iv_msg    = |authorization group rows were deleted but the TADIR entry { lv_key } remained| ).
      RETURN.
    ENDIF.

    zcl_abap_vibe_icf_auth_common=>respond_write_ok( io_server  = io_server
                  iv_name    = iv_name
                  iv_type    = 'SUCU'
                  iv_action  = 'deleted'
                  iv_package = lv_package ).
  ENDMETHOD.

  METHOD write_rows.
    " TBRG_AUTH contains only key fields (MODIFY/UPDATE are rejected by the
    " compiler), so the update path deletes and re-inserts the key row and
    " replaces the text rows.
    CLEAR rv_error.

    delete_rows( iv_brgru = iv_brgru iv_object = iv_object ).

    DATA ls_auth TYPE tbrg_auth.
    ls_auth-brgru = iv_brgru.
    ls_auth-object = iv_object.
    INSERT tbrg_auth FROM ls_auth.
    IF sy-subrc <> 0.
      rv_error = |could not insert the TBRG_AUTH row (sy-subrc { sy-subrc })|.
      RETURN.
    ENDIF.

    DATA ls_text TYPE tbrg_autht.
    IF is_doc-header-description IS NOT INITIAL.
      ls_text-spras = iv_master_language.
      ls_text-brgru = iv_brgru.
      ls_text-object = iv_object.
      ls_text-bezei = is_doc-header-description.
      INSERT tbrg_autht FROM ls_text.
      IF sy-subrc <> 0.
        rv_error = |could not insert the TBRG_AUTHT row for language { iv_master_language } (sy-subrc { sy-subrc })|.
        RETURN.
      ENDIF.
    ENDIF.

    LOOP AT is_doc-texts INTO DATA(ls_doc_text).
      DATA lv_spras TYPE sy-langu.
      DATA lv_ok TYPE abap_bool.
      sap_language_from_iso( EXPORTING iv_iso   = ls_doc_text-language
                             IMPORTING ev_spras = lv_spras
                                       ev_ok    = lv_ok ).
      IF lv_ok = abap_false.
        rv_error = |text language '{ ls_doc_text-language }' is not a known SAP language|.
        RETURN.
      ENDIF.
      CLEAR ls_text.
      ls_text-spras = lv_spras.
      ls_text-brgru = iv_brgru.
      ls_text-object = iv_object.
      ls_text-bezei = ls_doc_text-description.
      INSERT tbrg_autht FROM ls_text.
      IF sy-subrc <> 0.
        rv_error = |could not insert the TBRG_AUTHT row for language { lv_spras } (sy-subrc { sy-subrc })|.
        RETURN.
      ENDIF.
    ENDLOOP.

    COMMIT WORK.
  ENDMETHOD.

  METHOD delete_rows.
    DELETE FROM tbrg_auth WHERE brgru = @iv_brgru AND object = @iv_object.
    DELETE FROM tbrg_autht WHERE brgru = @iv_brgru AND object = @iv_object.
    COMMIT WORK.
  ENDMETHOD.

  METHOD validate_document.
    " Normalize + validate the editable document fields; the key must match
    " the route name and the authorization object must exist (SM30 would check
    " it through the XUOBJECT check table TOBJ).
    CLEAR: ev_code, ev_msg.

    IF cs_doc-format_version IS NOT INITIAL AND cs_doc-format_version <> '1'.
      ev_code = 'SUCU_INVALID_PAYLOAD'.
      ev_msg = 'formatVersion must be "1"'.
      RETURN.
    ENDIF.
    cs_doc-format_version = '1'.

    DATA(lv_group) = to_upper( condense( val = cs_doc-general_information-authorization_group ) ).
    IF lv_group IS INITIAL.
      ev_code = 'SUCU_INVALID_PAYLOAD'.
      ev_msg = 'generalInformation.authorizationGroup is required'.
      RETURN.
    ENDIF.
    DATA(lv_object) = to_upper( condense( val = cs_doc-general_information-authorization_object ) ).
    IF lv_object IS INITIAL.
      ev_code = 'SUCU_INVALID_PAYLOAD'.
      ev_msg = 'generalInformation.authorizationObject is required'.
      RETURN.
    ENDIF.

    IF lv_group <> condense( val = iv_brgru ) OR lv_object <> condense( val = iv_object ).
      ev_code = 'SUCU_NAME_INVALID'.
      ev_msg = |document key { lv_group }~{ lv_object } does not match the object name { display_name( iv_brgru = iv_brgru iv_object = iv_object ) }|.
      RETURN.
    ENDIF.
    IF part_valid( iv_part = lv_group iv_max_length = gc_group_max_length ) = abap_false.
      ev_code = 'SUCU_INVALID_PAYLOAD'.
      ev_msg = |generalInformation.authorizationGroup '{ lv_group }' must be 1-{ gc_group_max_length } characters A-Z, 0-9, _ or /|.
      RETURN.
    ENDIF.
    IF part_valid( iv_part = lv_object iv_max_length = gc_object_max_length ) = abap_false.
      ev_code = 'SUCU_INVALID_PAYLOAD'.
      ev_msg = |generalInformation.authorizationObject '{ lv_object }' must be 1-{ gc_object_max_length } characters A-Z, 0-9, _ or /|.
      RETURN.
    ENDIF.
    cs_doc-general_information-authorization_group = lv_group.
    cs_doc-general_information-authorization_object = lv_object.

    SELECT SINGLE objct FROM tobj INTO @DATA(lv_object_row) WHERE objct = @lv_object.
    IF sy-subrc <> 0.
      ev_code = 'SUCU_INVALID_PAYLOAD'.
      ev_msg = |authorization object { lv_object } does not exist (TOBJ); an authorization group must reference an existing authorization object|.
      RETURN.
    ENDIF.

    DATA(lv_iso) = to_lower( condense( val = cs_doc-header-original_language ) ).
    IF lv_iso IS INITIAL.
      ev_code = 'SUCU_INVALID_PAYLOAD'.
      ev_msg = 'header.originalLanguage is required (two-letter ISO code)'.
      RETURN.
    ENDIF.
    FIND REGEX '^[a-z]{2}$' IN lv_iso.
    IF sy-subrc <> 0.
      ev_code = 'SUCU_INVALID_PAYLOAD'.
      ev_msg = |header.originalLanguage '{ lv_iso }' must be a two-letter ISO code|.
      RETURN.
    ENDIF.
    DATA lv_spras TYPE sy-langu.
    DATA lv_language_ok TYPE abap_bool.
    sap_language_from_iso( EXPORTING iv_iso   = lv_iso
                           IMPORTING ev_spras = lv_spras
                                     ev_ok    = lv_language_ok ).
    IF lv_language_ok = abap_false.
      ev_code = 'SUCU_INVALID_PAYLOAD'.
      ev_msg = |header.originalLanguage '{ lv_iso }' is not a known SAP language (T002-LAISO)|.
      RETURN.
    ENDIF.
    cs_doc-header-original_language = lv_iso.

    DATA(lv_description) = condense( val = cs_doc-header-description ).
    IF strlen( lv_description ) > gc_text_max_length.
      ev_code = 'SUCU_INVALID_PAYLOAD'.
      ev_msg = |header.description must not exceed { gc_text_max_length } characters (TBRG_AUTHT-BEZEI)|.
      RETURN.
    ENDIF.
    cs_doc-header-description = lv_description.

    DATA lt_seen_languages TYPE STANDARD TABLE OF string WITH EMPTY KEY.
    LOOP AT cs_doc-texts ASSIGNING FIELD-SYMBOL(<ls_text>).
      DATA(lv_text_iso) = to_lower( condense( val = <ls_text>-language ) ).
      FIND REGEX '^[a-z]{2}$' IN lv_text_iso.
      IF sy-subrc <> 0.
        ev_code = 'SUCU_INVALID_PAYLOAD'.
        ev_msg = |texts[{ sy-tabix }].language '{ lv_text_iso }' must be a two-letter ISO code|.
        RETURN.
      ENDIF.
      IF lv_text_iso = lv_iso.
        ev_code = 'SUCU_INVALID_PAYLOAD'.
        ev_msg = |texts must not repeat header.originalLanguage '{ lv_iso }'|.
        RETURN.
      ENDIF.
      READ TABLE lt_seen_languages TRANSPORTING NO FIELDS WITH KEY table_line = lv_text_iso.
      IF sy-subrc = 0.
        ev_code = 'SUCU_INVALID_PAYLOAD'.
        ev_msg = |texts contains language '{ lv_text_iso }' more than once|.
        RETURN.
      ENDIF.
      APPEND lv_text_iso TO lt_seen_languages.
      sap_language_from_iso( EXPORTING iv_iso   = lv_text_iso
                             IMPORTING ev_spras = lv_spras
                                       ev_ok    = lv_language_ok ).
      IF lv_language_ok = abap_false.
        ev_code = 'SUCU_INVALID_PAYLOAD'.
        ev_msg = |texts[{ sy-tabix }].language '{ lv_text_iso }' is not a known SAP language (T002-LAISO)|.
        RETURN.
      ENDIF.
      DATA(lv_text_description) = condense( val = <ls_text>-description ).
      IF strlen( lv_text_description ) > gc_text_max_length.
        ev_code = 'SUCU_INVALID_PAYLOAD'.
        ev_msg = |texts[{ sy-tabix }].description must not exceed { gc_text_max_length } characters (TBRG_AUTHT-BEZEI)|.
        RETURN.
      ENDIF.
      <ls_text>-language = lv_text_iso.
      <ls_text>-description = lv_text_description.
    ENDLOOP.
  ENDMETHOD.

  METHOD iso_from_sap_language.
    " AFF stores the ISO 639-1 language in lower case; SAP keys by its
    " 1-character code and T002-LAISO is upper case.
    CLEAR rv_iso.
    IF iv_spras IS INITIAL.
      rv_iso = 'en'.
      RETURN.
    ENDIF.
    SELECT SINGLE laiso FROM t002 INTO @DATA(lv_laiso) WHERE spras = @iv_spras.
    IF sy-subrc <> 0 OR lv_laiso IS INITIAL.
      " Custom language without an ISO mapping: fall back to English (documented
      " risk; all standard SUCU objects on the test system use mapped languages).
      rv_iso = 'en'.
      RETURN.
    ENDIF.
    rv_iso = to_lower( lv_laiso ).
  ENDMETHOD.

  METHOD sap_language_from_iso.
    CLEAR: ev_spras, ev_ok.
    DATA(lv_iso) = to_upper( condense( val = iv_iso ) ).
    IF lv_iso IS INITIAL.
      RETURN.
    ENDIF.
    SELECT SINGLE spras FROM t002 INTO @ev_spras WHERE laiso = @lv_iso.
    ev_ok = boolc( sy-subrc = 0 AND ev_spras IS NOT INITIAL ).
  ENDMETHOD.

  METHOD respond_invalid.
    zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                                                   iv_status = 400
                                                   iv_code   = iv_code
                                                   iv_msg    = iv_msg ).
  ENDMETHOD.
ENDCLASS.
