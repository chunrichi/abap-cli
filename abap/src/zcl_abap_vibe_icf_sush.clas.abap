CLASS zcl_abap_vibe_icf_sush DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS dispatch
      IMPORTING io_server TYPE REF TO if_http_server
                iv_path   TYPE string
                iv_method TYPE string
                iv_body   TYPE string.
  PRIVATE SECTION.
    " ----- AFF sush-v1 document (wire: camelCase) -----
    TYPES:
      BEGIN OF ty_field_value,
        auth_field_name       TYPE string,
        auth_field_low_value  TYPE string,
        auth_field_high_value TYPE string,
      END OF ty_field_value,
      tt_field_value TYPE STANDARD TABLE OF ty_field_value WITH EMPTY KEY,
      BEGIN OF ty_auth_object,
        auth_object_name         TYPE string,
        maintenance_status       TYPE string,
        documentation            TYPE string,
        auth_object_field_values TYPE tt_field_value,
      END OF ty_auth_object,
      tt_auth_object TYPE STANDARD TABLE OF ty_auth_object WITH EMPTY KEY,
      BEGIN OF ty_header,
        description           TYPE string,
        original_language     TYPE string,
        abap_language_version TYPE string,
      END OF ty_header,
      BEGIN OF ty_general_information,
        application_name        TYPE string,
        application_type        TYPE string,
        maintenance_mode        TYPE string,
        default_values_required TYPE string,
        documentation           TYPE string,
      END OF ty_general_information,
      BEGIN OF ty_document,
        format_version        TYPE string,
        header                TYPE ty_header,
        general_information   TYPE ty_general_information,
        authorization_objects TYPE tt_auth_object,
      END OF ty_document,
      BEGIN OF ty_read_data,
        format_version        TYPE string,
        header                TYPE ty_header,
        general_information   TYPE ty_general_information,
        authorization_objects TYPE tt_auth_object,
        name                  TYPE string,
        package               TYPE string,
      END OF ty_read_data,
      BEGIN OF ty_read_envelope,
        status TYPE string,
        data   TYPE ty_read_data,
      END OF ty_read_envelope.

    " ----- route handling -----
    CLASS-METHODS init_su22
      EXPORTING io_su22 TYPE REF TO object
                ev_code TYPE string
                ev_msg  TYPE string.

    CLASS-METHODS parse_name
      IMPORTING iv_name  TYPE string
      EXPORTING es_key   TYPE usobkey
                ev_code  TYPE string
                ev_msg   TYPE string.

    CLASS-METHODS read_sush
      IMPORTING io_server TYPE REF TO if_http_server
                io_su22   TYPE REF TO object
                is_key    TYPE usobkey.

    CLASS-METHODS create_sush
      IMPORTING io_server TYPE REF TO if_http_server
                io_su22   TYPE REF TO object
                is_key    TYPE usobkey
                iv_body   TYPE string.

    CLASS-METHODS update_sush
      IMPORTING io_server TYPE REF TO if_http_server
                io_su22   TYPE REF TO object
                is_key    TYPE usobkey
                iv_body   TYPE string.

    CLASS-METHODS delete_sush
      IMPORTING io_server TYPE REF TO if_http_server
                io_su22   TYPE REF TO object
                is_key    TYPE usobkey.

    " ----- SAP object access -----
    CLASS-METHODS exists
      IMPORTING io_su22       TYPE REF TO object
                is_key        TYPE usobkey
      RETURNING VALUE(rv_exists) TYPE abap_bool.

    CLASS-METHODS create_object
      IMPORTING io_su22      TYPE REF TO object
                is_key       TYPE usobkey
                is_doc       TYPE ty_document
                iv_package   TYPE devclass
                iv_transport TYPE trkorr
                iv_abap_lv   TYPE char1
      EXPORTING ev_code      TYPE string
                ev_msg       TYPE string
                ev_http      TYPE i.

    CLASS-METHODS update_object
      IMPORTING io_su22 TYPE REF TO object
                is_key  TYPE usobkey
                is_doc  TYPE ty_document
      EXPORTING ev_code TYPE string
                ev_msg  TYPE string
                ev_http TYPE i.

    CLASS-METHODS validate_with_sap
      IMPORTING io_su22 TYPE REF TO object
                is_key  TYPE usobkey
                is_doc  TYPE ty_document
      EXPORTING ev_code TYPE string
                ev_msg  TYPE string
                ev_http TYPE i.

    CLASS-METHODS rollback_create
      IMPORTING io_su22      TYPE REF TO object
                is_key       TYPE usobkey
                iv_package   TYPE devclass
                iv_transport TYPE trkorr.

    CLASS-METHODS preflight_rf
      IMPORTING is_key     TYPE usobkey
                iv_package TYPE devclass
      EXPORTING ev_code    TYPE string
                ev_msg     TYPE string
                ev_http    TYPE i.

    " ----- document helpers -----
    CLASS-METHODS validate_document
      IMPORTING is_key  TYPE usobkey
                is_doc  TYPE ty_document
      EXPORTING ev_code TYPE string
                ev_msg  TYPE string.

    CLASS-METHODS build_head
      IMPORTING is_key TYPE usobkey
                is_doc TYPE ty_document
      RETURNING VALUE(rr_head) TYPE REF TO data.

    CLASS-METHODS build_tables
      IMPORTING is_key  TYPE usobkey
                is_doc  TYPE ty_document
      EXPORTING et_usobx TYPE usobx_t
                et_usobt TYPE usobt_t.

    CLASS-METHODS head_value
      IMPORTING is_struct    TYPE any
                iv_component TYPE string
      RETURNING VALUE(rv_value) TYPE string.

    CLASS-METHODS set_component
      IMPORTING iv_component TYPE string
                iv_value     TYPE any
      CHANGING  cs_struct    TYPE any.

    CLASS-METHODS canonical_name
      IMPORTING is_key TYPE usobkey
      RETURNING VALUE(rv_name) TYPE string.

    CLASS-METHODS trim_trailing_blanks
      IMPORTING iv_text TYPE string
      RETURNING VALUE(rv_text) TYPE string.

    CLASS-METHODS resolve_package
      IMPORTING is_key TYPE usobkey
      RETURNING VALUE(rv_package) TYPE devclass.

    CLASS-METHODS resolve_masterlang
      IMPORTING is_key TYPE usobkey
      RETURNING VALUE(rv_language) TYPE laiso.

    CLASS-METHODS tadir_object_of
      IMPORTING iv_type TYPE usobkey-type
      RETURNING VALUE(rv_object) TYPE trobjtype.

    CLASS-METHODS mode_to_json
      IMPORTING iv_mode TYPE any
      RETURNING VALUE(rv_mode) TYPE string.

    CLASS-METHODS mode_from_json
      IMPORTING iv_mode TYPE string
      EXPORTING ev_mode TYPE char1
                ev_ok   TYPE abap_bool.

    CLASS-METHODS status_to_json
      IMPORTING iv_status TYPE any
      RETURNING VALUE(rv_status) TYPE string.

    CLASS-METHODS status_from_json
      IMPORTING iv_status TYPE string
      EXPORTING ev_status TYPE char1
                ev_ok     TYPE abap_bool.

    CLASS-METHODS abap_lv_to_json
      IMPORTING iv_abap_lv TYPE any
      RETURNING VALUE(rv_version) TYPE string.

    CLASS-METHODS abap_lv_from_json
      IMPORTING iv_version TYPE string
      EXPORTING ev_abap_lv TYPE char1
                ev_ok      TYPE abap_bool.

    " ----- response helpers -----
    CLASS-METHODS respond_read
      IMPORTING io_server  TYPE REF TO if_http_server
                is_key     TYPE usobkey
                is_doc     TYPE ty_document
                iv_package TYPE devclass.

    CLASS-METHODS respond_write
      IMPORTING io_server  TYPE REF TO if_http_server
                is_key     TYPE usobkey
                iv_action  TYPE string
                iv_package TYPE devclass.

    CLASS-METHODS respond_doc_error
      IMPORTING io_server TYPE REF TO if_http_server
                iv_status TYPE i
                iv_code   TYPE string
                iv_msg    TYPE string.

    CLASS-METHODS check_sap_messages
      IMPORTING it_log   TYPE bapiret2_t
      EXPORTING ev_failed TYPE abap_bool
                ev_msg    TYPE string.
ENDCLASS.


CLASS zcl_abap_vibe_icf_sush IMPLEMENTATION.
  METHOD dispatch.
    " /auth/sush/<name> — one SU22 application per document: USOB_SM header,
    " USOBX assignments and USOBT values, addressed by the SU22 key
    " <NAME CHAR30>.<TYPE CHAR2> (RF / TR / HT / HS). WRITES go through SAP's
    " own CL_SU22_ADT_OBJECT (the ADT SU22 API abapGit uses), never through
    " direct USOB* DML, so SAP runs its consistency/authority/where-used checks.
    DATA lv_match_name TYPE string.
    DATA lv_name TYPE string.
    DATA ls_key TYPE usobkey.
    DATA lv_code TYPE string.
    DATA lv_msg TYPE string.
    DATA lv_error_code TYPE string.
    DATA lo_su22 TYPE REF TO object.

    TRY.
    FIND REGEX '^/auth/sush/(.+)$' IN iv_path IGNORING CASE SUBMATCHES lv_match_name.
    IF sy-subrc <> 0 OR lv_match_name IS INITIAL.
      respond_doc_error( io_server = io_server
                         iv_status = 400
                         iv_code   = 'SUSH_NAME_INVALID'
                         iv_msg    = 'SUSH object name is required: /auth/sush/<NAME>.<TYPE>' ).
      RETURN.
    ENDIF.

    " ICF may or may not decode the path; unescape is a no-op for plain names.
    lv_name = to_upper( cl_http_utility=>if_http_utility~unescape_url( escaped = lv_match_name ) ).
    parse_name( EXPORTING iv_name = lv_name
                IMPORTING es_key  = ls_key
                          ev_code = lv_code
                          ev_msg  = lv_msg ).
    IF lv_code IS NOT INITIAL.
      respond_doc_error( io_server = io_server
                         iv_status = 400
                         iv_code   = lv_code
                         iv_msg    = lv_msg ).
      RETURN.
    ENDIF.

    init_su22( IMPORTING io_su22 = lo_su22
                         ev_code = lv_code
                         ev_msg  = lv_msg ).
    IF lv_code IS NOT INITIAL.
      respond_doc_error( io_server = io_server
                         iv_status = 501
                         iv_code   = lv_code
                         iv_msg    = lv_msg ).
      RETURN.
    ENDIF.

    CASE iv_method.
      WHEN 'GET'.
        read_sush( io_server = io_server
                   io_su22   = lo_su22
                   is_key    = ls_key ).
      WHEN 'POST'.
        create_sush( io_server = io_server
                     io_su22   = lo_su22
                     is_key    = ls_key
                     iv_body   = iv_body ).
      WHEN 'PUT'.
        update_sush( io_server = io_server
                     io_su22   = lo_su22
                     is_key    = ls_key
                     iv_body   = iv_body ).
      WHEN 'DELETE'.
        delete_sush( io_server = io_server
                     io_su22   = lo_su22
                     is_key    = ls_key ).
      WHEN OTHERS.
        respond_doc_error( io_server = io_server
                           iv_status = 405
                           iv_code   = 'METHOD_NOT_ALLOWED'
                           iv_msg    = |{ iv_method } is not supported on /auth/sush/<name>| ).
    ENDCASE.

      CATCH cx_root INTO DATA(lx_dispatch).
        " Never leak an ICF HTML error page: answer the service envelope.
        lv_error_code = SWITCH string( iv_method
                                       WHEN 'GET' THEN 'SUSH_READ_FAILED'
                                       ELSE 'SUSH_WRITE_FAILED' ).
        respond_doc_error( io_server = io_server
                           iv_status = 500
                           iv_code   = lv_error_code
                           iv_msg    = |SUSH dispatch runtime error: { lx_dispatch->get_text( ) }| ).
    ENDTRY.
  ENDMETHOD.

  METHOD init_su22.
    " Release guard: the ADT SU22 API is release-dependent (757 verified); probe
    " its types dynamically so the class compiles on releases without it and the
    " route answers 501 instead of failing at load time.
    DATA lr_probe TYPE REF TO data.

    TRY.
        CREATE DATA lr_probe TYPE ('IF_SU22_ADT_OBJECT=>TS_SU2X_HEAD').
        CREATE OBJECT io_su22 TYPE ('CL_SU22_ADT_OBJECT').
      CATCH cx_root.
        CLEAR io_su22.
        ev_code = 'SUSH_UNSUPPORTED'.
        ev_msg  = 'this SAP release does not provide CL_SU22_ADT_OBJECT (ADT SU22 API), so SUSH objects cannot be managed here'.
    ENDTRY.
  ENDMETHOD.

  METHOD parse_name.
    " Canonical name: <NAME>.<TYPE>. A raw 32-character TADIR composite
    " (<NAME padded to 30><TYPE>) and '<NAME> <TYPE>' are accepted as aliases.
    DATA lv_name TYPE string.
    DATA lv_pos TYPE i.
    DATA lv_type TYPE string.
    DATA lv_key_name TYPE string.

    CLEAR: es_key, ev_code, ev_msg.
    lv_name = to_upper( iv_name ).

    " The dot separates <NAME>.<TYPE> (SU22 names never contain a dot).
    lv_pos = find( val = lv_name sub = '.' ).
    IF lv_pos > 0.
      lv_key_name = substring( val = lv_name off = 0 len = lv_pos ).
      lv_type = substring( val = lv_name off = lv_pos + 1 ).
    ELSEIF strlen( lv_name ) = 32.
      lv_key_name = trim_trailing_blanks( substring( val = lv_name off = 0 len = 30 ) ).
      lv_type = substring( val = lv_name off = 30 len = 2 ).
    ENDIF.

    IF lv_key_name IS INITIAL OR lv_type IS INITIAL.
      ev_code = 'SUSH_NAME_INVALID'.
      ev_msg  = |'{ iv_name }' is not a SUSH object name; use <NAME>.<TYPE> (e.g. ZCLI_TC_SUSH_FM.RF)|.
      RETURN.
    ENDIF.

    lv_key_name = trim_trailing_blanks( lv_key_name ).
    IF strlen( lv_key_name ) > 30.
      ev_code = 'SUSH_NAME_INVALID'.
      ev_msg  = |SUSH application name '{ lv_key_name }' is longer than 30 characters|.
      RETURN.
    ENDIF.
    IF lv_key_name CN 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_/'.
      ev_code = 'SUSH_NAME_INVALID'.
      ev_msg  = |SUSH application name '{ lv_key_name }' must use A-Z, 0-9, _ or / and must not contain spaces|.
      RETURN.
    ENDIF.
    IF lv_type CN 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' OR strlen( lv_type ) <> 2
       OR ( lv_type <> 'TR' AND lv_type <> 'RF' AND lv_type <> 'HT' AND lv_type <> 'HS' ).
      ev_code = 'SUSH_NAME_INVALID'.
      ev_msg  = |SUSH type '{ lv_type }' is not supported; use TR, RF, HT or HS|.
      RETURN.
    ENDIF.

    es_key-name = lv_key_name.
    es_key-type = lv_type.
  ENDMETHOD.

  METHOD canonical_name.
    rv_name = |{ is_key-name }.{ is_key-type }|.
  ENDMETHOD.

  METHOD trim_trailing_blanks.
    " RTRIM( ) is not part of this release's built-in function set, and
    " CONDENSE would also collapse meaningful internal spaces (e.g. the
    " IWSV service-name padding), so trim only the trailing blanks.
    DATA lv_length TYPE i.

    rv_text = iv_text.
    lv_length = strlen( rv_text ).
    WHILE lv_length > 0.
      IF substring( val = rv_text off = lv_length - 1 len = 1 ) <> ` `.
        EXIT.
      ENDIF.
      lv_length = lv_length - 1.
    ENDWHILE.
    IF lv_length < strlen( rv_text ).
      rv_text = substring( val = rv_text off = 0 len = lv_length ).
    ENDIF.
  ENDMETHOD.

  METHOD tadir_object_of.
    CASE iv_type.
      WHEN 'HS'.
        rv_object = 'SUSI'.
      WHEN 'TR'.
        rv_object = 'TRAN'.
      WHEN OTHERS.
        rv_object = 'SUSH'.
    ENDCASE.
  ENDMETHOD.

  METHOD resolve_package.
    DATA lv_tadir_name TYPE tadir-obj_name.
    DATA lv_object TYPE trobjtype.

    rv_package = ''.
    lv_object = tadir_object_of( is_key-type ).
    IF is_key-type = 'TR'.
      SELECT SINGLE devclass FROM tadir INTO rv_package
        WHERE pgmid = 'R3TR' AND object = lv_object AND obj_name = is_key-name.
    ELSE.
      lv_tadir_name = is_key.
      SELECT SINGLE devclass FROM tadir INTO rv_package
        WHERE pgmid = 'R3TR' AND object = lv_object AND obj_name = lv_tadir_name.
    ENDIF.
  ENDMETHOD.

  METHOD resolve_masterlang.
    DATA lv_tadir_name TYPE tadir-obj_name.
    DATA lv_masterlang TYPE tadir-masterlang.
    DATA lv_object TYPE trobjtype.

    rv_language = ''.
    lv_object = tadir_object_of( is_key-type ).
    IF is_key-type = 'TR'.
      SELECT SINGLE masterlang FROM tadir INTO lv_masterlang
        WHERE pgmid = 'R3TR' AND object = lv_object AND obj_name = is_key-name.
    ELSE.
      lv_tadir_name = is_key.
      SELECT SINGLE masterlang FROM tadir INTO lv_masterlang
        WHERE pgmid = 'R3TR' AND object = lv_object AND obj_name = lv_tadir_name.
    ENDIF.
    IF sy-subrc = 0 AND lv_masterlang IS NOT INITIAL.
      SELECT SINGLE laiso FROM t002 INTO rv_language WHERE spras = lv_masterlang.
    ENDIF.
    IF rv_language IS INITIAL.
      rv_language = 'EN'.
    ENDIF.
  ENDMETHOD.

  METHOD head_value.
    FIELD-SYMBOLS <lv_value> TYPE any.

    CLEAR rv_value.
    ASSIGN COMPONENT iv_component OF STRUCTURE is_struct TO <lv_value>.
    IF sy-subrc = 0.
      rv_value = |{ <lv_value> }|.
    ENDIF.
  ENDMETHOD.

  METHOD set_component.
    FIELD-SYMBOLS <lv_value> TYPE any.

    ASSIGN COMPONENT iv_component OF STRUCTURE cs_struct TO <lv_value>.
    IF sy-subrc = 0.
      <lv_value> = iv_value.
    ENDIF.
  ENDMETHOD.

  METHOD mode_to_json.
    CASE iv_mode.
      WHEN 'A'.
        rv_mode = 'automatic'.
      WHEN 'B'.
        rv_mode = 'automaticBasisObjects'.
      WHEN 'I'.
        rv_mode = 'noDefaultValues'.
      WHEN 'D'.
        rv_mode = 'deprecated'.
      WHEN 'O'.
        rv_mode = 'obsolete'.
      WHEN OTHERS.
        rv_mode = 'manual'.
    ENDCASE.
  ENDMETHOD.

  METHOD mode_from_json.
    CLEAR: ev_mode, ev_ok.
    CASE to_upper( iv_mode ).
      WHEN 'MANUAL' OR ''.
        ev_mode = ' '.
        ev_ok = abap_true.
      WHEN 'AUTOMATIC'.
        ev_mode = 'A'.
        ev_ok = abap_true.
      WHEN 'AUTOMATICBASISOBJECTS'.
        ev_mode = 'B'.
        ev_ok = abap_true.
      WHEN 'NODEFAULTVALUES'.
        ev_mode = 'I'.
        ev_ok = abap_true.
      WHEN 'DEPRECATED'.
        ev_mode = 'D'.
        ev_ok = abap_true.
      WHEN 'OBSOLETE'.
        ev_mode = 'O'.
        ev_ok = abap_true.
    ENDCASE.
  ENDMETHOD.

  METHOD status_to_json.
    CASE iv_status.
      WHEN 'X'.
        rv_status = 'noDefault'.
      WHEN 'Y'.
        rv_status = 'defaultWithValues'.
      WHEN 'V'.
        rv_status = 'defaultWithoutValues'.
      WHEN 'I'.
        rv_status = 'inactiveValues'.
      WHEN 'N'.
        rv_status = 'noAuthorizationCheck'.
      WHEN OTHERS.
        rv_status = 'undefined'.
    ENDCASE.
  ENDMETHOD.

  METHOD status_from_json.
    CLEAR: ev_status, ev_ok.
    CASE to_upper( iv_status ).
      WHEN 'UNDEFINED' OR ''.
        ev_status = ' '.
        ev_ok = abap_true.
      WHEN 'NODEFAULT'.
        ev_status = 'X'.
        ev_ok = abap_true.
      WHEN 'DEFAULTWITHVALUES'.
        ev_status = 'Y'.
        ev_ok = abap_true.
      WHEN 'DEFAULTWITHOUTVALUES'.
        ev_status = 'V'.
        ev_ok = abap_true.
      WHEN 'INACTIVEVALUES'.
        ev_status = 'I'.
        ev_ok = abap_true.
      WHEN 'NOAUTHORIZATIONCHECK'.
        ev_status = 'N'.
        ev_ok = abap_true.
    ENDCASE.
  ENDMETHOD.

  METHOD abap_lv_to_json.
    IF iv_abap_lv = '5'.
      rv_version = 'cloudDevelopment'.
    ELSE.
      rv_version = 'standard'.
    ENDIF.
  ENDMETHOD.

  METHOD abap_lv_from_json.
    CLEAR: ev_abap_lv, ev_ok.
    CASE to_upper( iv_version ).
      WHEN 'STANDARD' OR ''.
        ev_abap_lv = ' '.
        ev_ok = abap_true.
      WHEN 'CLOUDDEVELOPMENT'.
        ev_abap_lv = '5'.
        ev_ok = abap_true.
    ENDCASE.
  ENDMETHOD.

  METHOD exists.
    DATA lv_exists TYPE abap_bool.

    rv_exists = abap_false.
    TRY.
        CALL METHOD io_su22->('IF_SU22_ADT_OBJECT~CHECK_EXIST')
          EXPORTING iv_key   = is_key
          RECEIVING rv_exist = lv_exists.
        rv_exists = lv_exists.
      CATCH cx_root.
        rv_exists = abap_false.
    ENDTRY.
  ENDMETHOD.

  METHOD build_head.
    " Dynamically created IF_SU22_ADT_OBJECT=>TS_SU2X_HEAD so the class stays
    " release-independent (the type is probed in INIT_SU22).
    FIELD-SYMBOLS <ls_head> TYPE any.
    DATA lv_mode TYPE char1.
    DATA lv_status_mode TYPE abap_bool.
    DATA lv_version TYPE char1.
    DATA lv_version_ok TYPE abap_bool.

    CREATE DATA rr_head TYPE ('IF_SU22_ADT_OBJECT=>TS_SU2X_HEAD').
    ASSIGN rr_head->* TO <ls_head>.

    set_component( EXPORTING iv_component = 'NAME' iv_value = is_key-name CHANGING cs_struct = <ls_head> ).
    set_component( EXPORTING iv_component = 'TYPE' iv_value = is_key-type CHANGING cs_struct = <ls_head> ).
    set_component( EXPORTING iv_component = 'DISPLAY_NAME'
                   iv_value     = is_doc-general_information-application_name
                   CHANGING     cs_struct = <ls_head> ).

    mode_from_json( EXPORTING iv_mode = is_doc-general_information-maintenance_mode
                    IMPORTING ev_mode = lv_mode
                              ev_ok   = lv_status_mode ).
    IF lv_status_mode = abap_true.
      set_component( EXPORTING iv_component = 'OKFLAG' iv_value = lv_mode CHANGING cs_struct = <ls_head> ).
    ENDIF.

    abap_lv_from_json( EXPORTING iv_version = is_doc-header-abap_language_version
                       IMPORTING ev_abap_lv = lv_version
                                 ev_ok      = lv_version_ok ).
    IF lv_version_ok = abap_true AND lv_version IS NOT INITIAL.
      set_component( EXPORTING iv_component = 'ABAP_LANGUAGE_VERSION'
                     iv_value     = lv_version
                     CHANGING     cs_struct = <ls_head> ).
    ENDIF.
  ENDMETHOD.

  METHOD build_tables.
    DATA lv_object TYPE string.
    DATA lv_field TYPE string.
    DATA lv_low TYPE string.
    DATA lv_high TYPE string.
    DATA lv_status TYPE char1.
    DATA lv_status_ok TYPE abap_bool.

    CLEAR: et_usobx, et_usobt.
    LOOP AT is_doc-authorization_objects INTO DATA(ls_object).
      status_from_json( EXPORTING iv_status = ls_object-maintenance_status
                        IMPORTING ev_status = lv_status
                                  ev_ok     = lv_status_ok ).
      lv_object = ls_object-auth_object_name.
      APPEND VALUE usobx( name   = is_key-name
                          type   = is_key-type
                          object = lv_object
                          okflag = lv_status ) TO et_usobx.
      LOOP AT ls_object-auth_object_field_values INTO DATA(ls_value).
        lv_field = ls_value-auth_field_name.
        lv_low = ls_value-auth_field_low_value.
        lv_high = ls_value-auth_field_high_value.
        APPEND VALUE usobt( name   = is_key-name
                            type   = is_key-type
                            object = lv_object
                            field  = lv_field
                            low    = lv_low
                            high   = lv_high ) TO et_usobt.
      ENDLOOP.
    ENDLOOP.
  ENDMETHOD.

  METHOD validate_document.
    DATA lv_mode TYPE char1.
    DATA lv_ok TYPE abap_bool.
    DATA lv_status TYPE char1.
    DATA lv_app_type TYPE string.
    DATA lv_app_name TYPE string.
    DATA lv_text TYPE string.

    CLEAR: ev_code, ev_msg.

    IF is_doc-format_version IS NOT INITIAL AND is_doc-format_version <> '1'.
      ev_code = 'SUSH_INVALID_PAYLOAD'.
      ev_msg  = |unsupported formatVersion '{ is_doc-format_version }' (expected '1')|.
      RETURN.
    ENDIF.

    lv_app_type = to_upper( is_doc-general_information-application_type ).
    lv_app_name = is_doc-general_information-application_name.

    CASE is_key-type.
      WHEN 'RF'.
        IF lv_app_type <> 'FUNC'.
          ev_code = 'SUSH_INVALID_PAYLOAD'.
          ev_msg  = |type RF requires applicationType 'FUNC' (got '{ lv_app_type }')|.
          RETURN.
        ENDIF.
        IF to_upper( lv_app_name ) <> is_key-name.
          ev_code = 'SUSH_INVALID_PAYLOAD'.
          ev_msg  = |type RF requires applicationName '{ is_key-name }' (got '{ lv_app_name }')|.
          RETURN.
        ENDIF.
      WHEN 'TR'.
        IF lv_app_type <> 'TRAN'.
          ev_code = 'SUSH_INVALID_PAYLOAD'.
          ev_msg  = |type TR requires applicationType 'TRAN' (got '{ lv_app_type }')|.
          RETURN.
        ENDIF.
        IF to_upper( lv_app_name ) <> is_key-name.
          ev_code = 'SUSH_INVALID_PAYLOAD'.
          ev_msg  = |type TR requires applicationName '{ is_key-name }' (got '{ lv_app_name }')|.
          RETURN.
        ENDIF.
      WHEN OTHERS.
        IF lv_app_type IS INITIAL OR lv_app_name IS INITIAL.
          ev_code = 'SUSH_INVALID_PAYLOAD'.
          ev_msg  = |type { is_key-type } requires applicationType and applicationName of the leading object|.
          RETURN.
        ENDIF.
        IF strlen( lv_app_type ) > 80 OR strlen( lv_app_name ) > 132.
          ev_code = 'SUSH_INVALID_PAYLOAD'.
          ev_msg  = 'applicationType/applicationName exceed the AFF field limits (80/132 characters)'.
          RETURN.
        ENDIF.
    ENDCASE.

    mode_from_json( EXPORTING iv_mode = is_doc-general_information-maintenance_mode
                    IMPORTING ev_mode = lv_mode ev_ok = lv_ok ).
    IF lv_ok = abap_false.
      ev_code = 'SUSH_INVALID_PAYLOAD'.
      ev_msg  = |unknown maintenanceMode '{ is_doc-general_information-maintenance_mode }'|.
      RETURN.
    ENDIF.

    abap_lv_from_json( EXPORTING iv_version = is_doc-header-abap_language_version
                       IMPORTING ev_abap_lv = lv_mode ev_ok = lv_ok ).
    IF lv_ok = abap_false.
      ev_code = 'SUSH_INVALID_PAYLOAD'.
      ev_msg  = |unknown header.abapLanguageVersion '{ is_doc-header-abap_language_version }' (expected standard or cloudDevelopment)|.
      RETURN.
    ENDIF.

    LOOP AT is_doc-authorization_objects INTO DATA(ls_object).
      lv_text = to_upper( ls_object-auth_object_name ).
      IF strlen( lv_text ) < 1 OR strlen( lv_text ) > 10
         OR lv_text CN 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_/'.
        ev_code = 'SUSH_INVALID_PAYLOAD'.
        ev_msg  = |authorization object name '{ ls_object-auth_object_name }' must be 1..10 characters of A-Z, 0-9, _ or /|.
        RETURN.
      ENDIF.
      status_from_json( EXPORTING iv_status = ls_object-maintenance_status
                        IMPORTING ev_status = lv_status ev_ok = lv_ok ).
      IF lv_ok = abap_false.
        ev_code = 'SUSH_INVALID_PAYLOAD'.
        ev_msg  = |unknown maintenanceStatus '{ ls_object-maintenance_status }' for { lv_text }|.
        RETURN.
      ENDIF.
      LOOP AT ls_object-auth_object_field_values INTO DATA(ls_value).
        lv_text = to_upper( ls_value-auth_field_name ).
        IF strlen( lv_text ) < 1 OR strlen( lv_text ) > 10
           OR lv_text CN 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_/'.
          ev_code = 'SUSH_INVALID_PAYLOAD'.
          ev_msg  = |authorization field name '{ ls_value-auth_field_name }' must be 1..10 characters of A-Z, 0-9, _ or /|.
          RETURN.
        ENDIF.
        IF strlen( ls_value-auth_field_low_value ) > 40 OR strlen( ls_value-auth_field_high_value ) > 40.
          ev_code = 'SUSH_INVALID_PAYLOAD'.
          ev_msg  = |field value of { ls_object-auth_object_name }/{ lv_text } is longer than 40 characters|.
          RETURN.
        ENDIF.
      ENDLOOP.
    ENDLOOP.

    " Duplicate authorization objects are ambiguous: AFF keys the array by
    " authObjectName (same rule as USOBX: one row per object).
    DATA lt_objects TYPE tt_auth_object.
    lt_objects = is_doc-authorization_objects.
    SORT lt_objects BY auth_object_name.
    DELETE ADJACENT DUPLICATES FROM lt_objects COMPARING auth_object_name.
    IF lines( lt_objects ) <> lines( is_doc-authorization_objects ).
      ev_code = 'SUSH_INVALID_PAYLOAD'.
      ev_msg  = 'duplicate authorization objects in the document'.
      RETURN.
    ENDIF.
  ENDMETHOD.

  METHOD read_sush.
    DATA lr_head TYPE REF TO data.
    FIELD-SYMBOLS <ls_head> TYPE any.
    DATA lt_usobx TYPE usobx_t.
    DATA lt_usobt TYPE usobt_t.
    DATA ls_doc TYPE ty_document.
    DATA ls_hush TYPE usobhash.
    DATA lv_app_type TYPE string.
    DATA lv_app_name TYPE string.
    DATA lv_text TYPE string.
    DATA lv_desc TYPE string.
    DATA lv_sel_name TYPE usobkey-name.
    DATA lv_sel_type TYPE usobkey-type.
    FIELD-SYMBOLS <ls_object> TYPE ty_auth_object.

    CREATE DATA lr_head TYPE ('IF_SU22_ADT_OBJECT=>TS_SU2X_HEAD').
    ASSIGN lr_head->* TO <ls_head>.

    TRY.
        CALL METHOD io_su22->('IF_SU22_ADT_OBJECT~SELECT')
          EXPORTING iv_key   = is_key
          IMPORTING es_head  = <ls_head>
                    et_usobx = lt_usobx
                    et_usobt = lt_usobt.
      CATCH cx_root INTO DATA(lx_read).
        DATA(lv_exception_text) = lx_read->get_text( ).
        DATA(lv_object_name) = canonical_name( is_key ).
        DATA(lv_error_msg) = |cannot read SUSH object { lv_object_name }: { lv_exception_text }|.
        " e603(su2x) = no SU22 header data for the key.
        IF sy-msgno = '603'.
          respond_doc_error( io_server = io_server
                             iv_status = 404
                             iv_code   = 'SUSH_NOT_FOUND'
                             iv_msg    = |SUSH object { canonical_name( is_key ) } does not exist| ).
        ELSE.
          respond_doc_error( io_server = io_server
                             iv_status = 500
                             iv_code   = 'SUSH_READ_FAILED'
                             iv_msg    = lv_error_msg ).
        ENDIF.
        RETURN.
    ENDTRY.

    CASE is_key-type.
      WHEN 'RF'.
        lv_app_type = 'FUNC'.
        lv_app_name = is_key-name.
      WHEN 'TR'.
        lv_app_type = 'TRAN'.
        lv_app_name = is_key-name.
      WHEN OTHERS.
        lv_sel_name = is_key-name.
        lv_sel_type = is_key-type.
        SELECT SINGLE object, obj_name, service_type, service FROM usobhash
          INTO CORRESPONDING FIELDS OF @ls_hush
          WHERE name = @lv_sel_name AND type = @lv_sel_type.
        IF sy-subrc <> 0.
          respond_doc_error( io_server = io_server
                             iv_status = 500
                             iv_code   = 'SUSH_READ_FAILED'
                             iv_msg    = |USOBHASH mapping for { canonical_name( is_key ) } is missing| ).
          RETURN.
        ENDIF.
        IF is_key-type = 'HT'.
          lv_app_type = ls_hush-object.
          lv_app_name = trim_trailing_blanks( CONV string( ls_hush-obj_name ) ).
        ELSE.
          lv_app_type = ls_hush-service_type.
          lv_app_name = trim_trailing_blanks( ls_hush-service ).
        ENDIF.
    ENDCASE.

    IF strlen( lv_app_name ) > 132.
      respond_doc_error( io_server = io_server
                         iv_status = 500
                         iv_code   = 'SUSH_READ_FAILED'
                         iv_msg    = |the { is_key-type } application name is longer than the AFF limit of 132 characters| ).
      RETURN.
    ENDIF.

    ls_doc-format_version = '1'.
    lv_desc = |R3TR { lv_app_type } { lv_app_name }|.
    IF strlen( lv_desc ) > 60.
      lv_desc = substring( val = lv_desc off = 0 len = 60 ).
    ENDIF.
    ls_doc-header-description = lv_desc.
    ls_doc-header-original_language = to_lower( resolve_masterlang( is_key ) ).
    ls_doc-header-abap_language_version =
      abap_lv_to_json( head_value( is_struct = <ls_head> iv_component = 'ABAP_LANGUAGE_VERSION' ) ).
    ls_doc-general_information-application_name = lv_app_name.
    ls_doc-general_information-application_type = lv_app_type.
    ls_doc-general_information-maintenance_mode =
      mode_to_json( head_value( is_struct = <ls_head> iv_component = 'OKFLAG' ) ).
    ls_doc-general_information-default_values_required = 'yes'.

    LOOP AT lt_usobx INTO DATA(ls_usobx).
      lv_text = ls_usobx-object.
      APPEND VALUE ty_auth_object( auth_object_name   = lv_text
                                   maintenance_status = status_to_json( ls_usobx-okflag ) )
             TO ls_doc-authorization_objects.
    ENDLOOP.

    LOOP AT lt_usobt INTO DATA(ls_usobt).
      lv_text = ls_usobt-object.
      READ TABLE ls_doc-authorization_objects ASSIGNING <ls_object>
        WITH KEY auth_object_name = lv_text.
      IF sy-subrc <> 0.
        " Orphan USOBT row (no USOBX row): keep the value, mark the object
        " undefined; SAP's own consistency check flags such data on write.
        APPEND VALUE ty_auth_object( auth_object_name   = lv_text
                                     maintenance_status = 'undefined' )
               TO ls_doc-authorization_objects.
        ASSIGN ls_doc-authorization_objects[ lines( ls_doc-authorization_objects ) ] TO <ls_object>.
      ENDIF.
      APPEND VALUE ty_field_value(
               auth_field_name       = ls_usobt-field
               auth_field_low_value  = trim_trailing_blanks( CONV string( ls_usobt-low ) )
               auth_field_high_value = trim_trailing_blanks( CONV string( ls_usobt-high ) ) )
             TO <ls_object>-auth_object_field_values.
    ENDLOOP.

    SORT ls_doc-authorization_objects BY auth_object_name.
    LOOP AT ls_doc-authorization_objects ASSIGNING <ls_object>.
      SORT <ls_object>-auth_object_field_values BY auth_field_name auth_field_low_value.
    ENDLOOP.

    respond_read( io_server  = io_server
                  is_key     = is_key
                  is_doc     = ls_doc
                  iv_package = resolve_package( is_key ) ).
  ENDMETHOD.

  METHOD validate_with_sap.
    " Display-mode consistency check (id_mode 03): SAP reports every error in
    " ET_LOG without writing; the handler turns them into a 400 before UPDATE.
    FIELD-SYMBOLS <ls_head> TYPE any.
    DATA lr_head TYPE REF TO data.
    DATA lt_usobx TYPE usobx_t.
    DATA lt_usobt TYPE usobt_t.
    DATA lt_usobx_c TYPE usobx_c_t.
    DATA lt_usobt_c TYPE usobt_c_t.
    DATA lt_log TYPE bapiret2_t.
    DATA lv_failed TYPE abap_bool.

    CLEAR: ev_code, ev_msg, ev_http.
    lr_head = build_head( is_key = is_key is_doc = is_doc ).
    ASSIGN lr_head->* TO <ls_head>.
    build_tables( EXPORTING is_key = is_key is_doc = is_doc
                  IMPORTING et_usobx = lt_usobx et_usobt = lt_usobt ).
    LOOP AT lt_usobx INTO DATA(ls_x).
      APPEND VALUE usobx_c( name   = ls_x-name
                            type   = ls_x-type
                            object = ls_x-object
                            okflag = ls_x-okflag ) TO lt_usobx_c.
    ENDLOOP.
    LOOP AT lt_usobt INTO DATA(ls_t).
      APPEND VALUE usobt_c( name   = ls_t-name
                            type   = ls_t-type
                            object = ls_t-object
                            field  = ls_t-field
                            low    = ls_t-low
                            high   = ls_t-high ) TO lt_usobt_c.
    ENDLOOP.

    TRY.
        CALL METHOD io_su22->('IF_SU22_ADT_OBJECT~CHECK')
          EXPORTING id_mode   = '03'
          IMPORTING et_log    = lt_log
          CHANGING  cs_head   = <ls_head>
                    ct_su2x_x = lt_usobx_c
                    ct_su2x_t = lt_usobt_c.
      CATCH cx_root INTO DATA(lx_check).
        ev_code = 'SUSH_INVALID_PAYLOAD'.
        ev_http = 400.
        ev_msg  = lx_check->get_text( ).
        RETURN.
    ENDTRY.

    check_sap_messages( EXPORTING it_log = lt_log
                        IMPORTING ev_failed = lv_failed ev_msg = ev_msg ).
    IF lv_failed = abap_true.
      ev_code = 'SUSH_INVALID_PAYLOAD'.
      ev_http = 400.
    ENDIF.
  ENDMETHOD.

  METHOD check_sap_messages.
    DATA lv_msg TYPE string.

    CLEAR: ev_failed, ev_msg.
    LOOP AT it_log INTO DATA(ls_log) WHERE type = 'E'.
      lv_msg = ls_log-message.
      IF lv_msg IS INITIAL.
        MESSAGE ID ls_log-id TYPE 'S' NUMBER ls_log-number
          WITH ls_log-message_v1 ls_log-message_v2 ls_log-message_v3 ls_log-message_v4
          INTO lv_msg.
      ENDIF.
      IF ev_msg IS INITIAL.
        ev_msg = lv_msg.
      ELSE.
        ev_msg = |{ ev_msg }; { lv_msg }|.
      ENDIF.
      ev_failed = abap_true.
    ENDLOOP.
  ENDMETHOD.

  METHOD update_object.
    FIELD-SYMBOLS <ls_head> TYPE any.
    DATA lr_head TYPE REF TO data.
    DATA lt_usobx TYPE usobx_t.
    DATA lt_usobt TYPE usobt_t.

    CLEAR: ev_code, ev_msg, ev_http.
    lr_head = build_head( is_key = is_key is_doc = is_doc ).
    ASSIGN lr_head->* TO <ls_head>.
    build_tables( EXPORTING is_key = is_key is_doc = is_doc
                  IMPORTING et_usobx = lt_usobx et_usobt = lt_usobt ).

    TRY.
        " IV_CTS = abap_false: the ADT/background mode (transport and enqueue
        " are handled by this handler, SAP's checks inside UPDATE still run).
        CALL METHOD io_su22->('IF_SU22_ADT_OBJECT~UPDATE')
          EXPORTING is_head  = <ls_head>
                    it_usobx = lt_usobx
                    it_usobt = lt_usobt
                    iv_cts   = abap_false.
      CATCH cx_root INTO DATA(lx_update).
        ev_code = 'SUSH_INVALID_PAYLOAD'.
        ev_http = 400.
        ev_msg  = lx_update->get_text( ).
        IF ev_msg IS INITIAL.
          ev_code = 'SUSH_WRITE_FAILED'.
          ev_http = 500.
          ev_msg  = zcl_abap_vibe_icf_auth_common=>last_message( ).
        ENDIF.
    ENDTRY.
  ENDMETHOD.

  METHOD preflight_rf.
    " SU22 RF applications require an existing remote-enabled function module;
    " CREATE/UPDATE would accept a normal module into a half-broken state
    " (verified: the consistency check refuses it later), so reject it first.
    DATA lv_fmode TYPE tfdir-fmode.
    DATA lv_devclass TYPE devclass.

    CLEAR: ev_code, ev_msg, ev_http.
    SELECT SINGLE fmode FROM tfdir INTO lv_fmode WHERE funcname = is_key-name.
    IF sy-subrc <> 0.
      ev_code = 'SUSH_INVALID_PAYLOAD'.
      ev_http = 400.
      ev_msg  = |RFC-enabled function module { is_key-name } does not exist; create the leading function module in package { iv_package } first|.
      RETURN.
    ENDIF.
    IF lv_fmode NA 'XRK'.
      ev_code = 'SUSH_INVALID_PAYLOAD'.
      ev_http = 400.
      ev_msg  = |function module { is_key-name } is not remote-enabled (FMODE='{ lv_fmode }'); SU22 RF applications require processing type 'Remote-Enabled Module'|.
      RETURN.
    ENDIF.

    TRY.
        CALL METHOD ('CL_SU2X_API')=>('SU2X_GET_DEVC_FOR_RF_APPL')
          EXPORTING id_name = is_key-name
          RECEIVING ed_devc = lv_devclass.
      CATCH cx_root.
        lv_devclass = ''.
    ENDTRY.
    IF lv_devclass IS INITIAL.
      ev_code = 'SUSH_INVALID_PAYLOAD'.
      ev_http = 400.
      ev_msg  = |the function group of { is_key-name } has no package; the SUSH object cannot be assigned|.
      RETURN.
    ENDIF.
    IF lv_devclass <> iv_package.
      ev_code = 'SUSH_PACKAGE_ERROR'.
      ev_http = 400.
      ev_msg  = |the leading function module { is_key-name } lives in package { lv_devclass }; a SUSH object must be created in the same package|.
      RETURN.
    ENDIF.
  ENDMETHOD.

  METHOD create_object.
    DATA ls_uhash TYPE usobhash.
    DATA ls_rs_key TYPE usobkey.
    DATA lv_no_cts TYPE abap_bool.
    DATA lv_tadir_name TYPE tadir-obj_name.
    DATA lv_devclass TYPE devclass.
    DATA lv_author TYPE sy-uname.
    DATA lv_http TYPE i.
    DATA lv_code TYPE string.
    DATA lv_msg TYPE string.

    CLEAR: ev_code, ev_msg, ev_http.
    ls_uhash-name = is_key-name.
    ls_uhash-type = is_key-type.
    lv_no_cts = zcl_abap_vibe_icf_types=>is_local_package( iv_package ).

    TRY.
        CALL METHOD io_su22->('IF_SU22_ADT_OBJECT~CREATE')
          EXPORTING
            iv_new_key       = ls_uhash
            iv_abap_vers_flg = iv_abap_lv
            iv_no_cts        = lv_no_cts
            iv_task          = iv_transport
          RECEIVING
            rs_key           = ls_rs_key.
      CATCH cx_root INTO DATA(lx_create).
        rollback_create( io_su22 = io_su22 is_key = is_key
                         iv_package = iv_package iv_transport = iv_transport ).
        ev_code = 'SUSH_WRITE_FAILED'.
        ev_http = 500.
        ev_msg  = lx_create->get_text( ).
        RETURN.
    ENDTRY.
    IF ls_rs_key-name IS INITIAL.
      ev_code = 'SUSH_WRITE_FAILED'.
      ev_http = 500.
      ev_msg  = zcl_abap_vibe_icf_auth_common=>last_message( ).
      IF ev_msg IS INITIAL.
        ev_msg = |SAP refused to create the SUSH application { canonical_name( is_key ) }|.
      ENDIF.
      RETURN.
    ENDIF.

    " For a local package CREATE already inserts the TADIR SUSH row; for a
    " transportable package it is recorded here (abapGit does the same).
    lv_tadir_name = is_key.
    SELECT SINGLE devclass FROM tadir INTO lv_devclass
      WHERE pgmid = 'R3TR' AND object = 'SUSH' AND obj_name = lv_tadir_name.
    IF sy-subrc <> 0.
      zcl_abap_vibe_icf_auth_common=>corr_insert(
        EXPORTING iv_tadir_object = 'SUSH'
                  iv_name         = CONV string( lv_tadir_name )
                  iv_package      = iv_package
                  iv_transport    = iv_transport
                  iv_mode         = 'I'
                  iv_prefix       = 'SUSH'
        IMPORTING ev_author       = lv_author
                  ev_http_code    = lv_http
                  ev_code         = lv_code
                  ev_msg          = lv_msg ).
      IF lv_code IS NOT INITIAL.
        rollback_create( io_su22 = io_su22 is_key = is_key
                         iv_package = iv_package iv_transport = iv_transport ).
        ev_code = lv_code.
        ev_msg  = lv_msg.
        ev_http = lv_http.
        RETURN.
      ENDIF.
    ENDIF.
  ENDMETHOD.

  METHOD rollback_create.
    " Best-effort compensation when the write after CREATE fails: remove the
    " SU22 data and the TADIR row so a failed create leaves no residue.
    DATA lv_composite TYPE tadir-obj_name.

    lv_composite = is_key.
    TRY.
        CALL METHOD io_su22->('IF_SU22_ADT_OBJECT~DELETE')
          EXPORTING iv_key     = is_key
                    iv_cleanup = abap_true
                    iv_cts     = abap_false.
      CATCH cx_root.
    ENDTRY.
    IF is_key-type <> 'TR'.
      zcl_abap_vibe_icf_auth_common=>tadir_delete( iv_tadir_object = 'SUSH'
                                                   iv_name         = CONV string( lv_composite )
                                                   iv_package      = iv_package
                                                   iv_transport    = iv_transport ).
    ENDIF.
  ENDMETHOD.

  METHOD update_sush.
    DATA ls_doc TYPE ty_document.
    DATA lv_query TYPE string.
    DATA lv_package TYPE devclass.
    DATA lv_transport TYPE trkorr.
    DATA lv_rule_code TYPE string.
    DATA lv_rule_msg TYPE string.
    DATA lv_code TYPE string.
    DATA lv_msg TYPE string.
    DATA lv_http TYPE i.
    DATA lv_cur_package TYPE devclass.
    DATA lv_sel_name TYPE usobkey-name.
    DATA lv_sel_type TYPE usobkey-type.
    DATA lv_composite TYPE tadir-obj_name.
    DATA lr_head TYPE REF TO data.
    FIELD-SYMBOLS <ls_head> TYPE any.

    lv_query = io_server->request->get_header_field( '~query_string' ).
    lv_package = zcl_abap_vibe_icf_auth_common=>query_package( lv_query ).
    lv_transport = zcl_abap_vibe_icf_auth_common=>query_transport( lv_query ).

    CREATE DATA lr_head TYPE ('IF_SU22_ADT_OBJECT=>TS_SU2X_HEAD').
    ASSIGN lr_head->* TO <ls_head>.
    TRY.
        CALL METHOD io_su22->('IF_SU22_ADT_OBJECT~SELECT')
          EXPORTING iv_key = is_key
          IMPORTING es_head = <ls_head>.
      CATCH cx_root.
        respond_doc_error( io_server = io_server
                           iv_status = 404
                           iv_code   = 'SUSH_NOT_FOUND'
                           iv_msg    = |SUSH object { canonical_name( is_key ) } does not exist; create it first| ).
        RETURN.
    ENDTRY.

    IF zcl_abap_vibe_icf_auth_common=>parse_body( EXPORTING iv_body = iv_body
                                                  CHANGING  cs_doc  = ls_doc ) = abap_false.
      respond_doc_error( io_server = io_server
                         iv_status = 400
                         iv_code   = 'SUSH_INVALID_PAYLOAD'
                         iv_msg    = 'request body is not a valid SUSH document (JSON object)' ).
      RETURN.
    ENDIF.

    validate_document( EXPORTING is_key = is_key is_doc = ls_doc
                       IMPORTING ev_code = lv_code ev_msg = lv_msg ).
    IF lv_code IS NOT INITIAL.
      respond_doc_error( io_server = io_server
                         iv_status = 400
                         iv_code   = lv_code
                         iv_msg    = lv_msg ).
      RETURN.
    ENDIF.

    " The leading application is the identity of an existing SUSH object: it
    " cannot be changed by an update (create a new object instead).
    IF is_key-type = 'HT' OR is_key-type = 'HS'.
      DATA ls_hush TYPE usobhash.
      lv_sel_name = is_key-name.
      lv_sel_type = is_key-type.
      SELECT SINGLE object, obj_name, service_type, service FROM usobhash
        INTO CORRESPONDING FIELDS OF @ls_hush
        WHERE name = @lv_sel_name AND type = @lv_sel_type.
      IF sy-subrc = 0.
        IF is_key-type = 'HT'.
          DATA(lv_cur_type) = CONV string( ls_hush-object ).
          DATA(lv_cur_name) = trim_trailing_blanks( CONV string( ls_hush-obj_name ) ).
        ELSE.
          lv_cur_type = CONV string( ls_hush-service_type ).
          lv_cur_name = trim_trailing_blanks( ls_hush-service ).
        ENDIF.
        IF to_upper( ls_doc-general_information-application_type ) <> to_upper( lv_cur_type )
           OR ls_doc-general_information-application_name <> lv_cur_name.
          respond_doc_error( io_server = io_server
                             iv_status = 400
                             iv_code   = 'SUSH_INVALID_PAYLOAD'
                             iv_msg    = |the leading application of { canonical_name( is_key ) } cannot be changed (SAP: { lv_cur_type } { lv_cur_name })| ).
          RETURN.
        ENDIF.
      ENDIF.
    ENDIF.

    CLEAR lv_cur_package.
    lv_cur_package = resolve_package( is_key ).
    IF lv_package IS INITIAL.
      lv_package = lv_cur_package.
    ENDIF.
    IF lv_package IS INITIAL.
      respond_doc_error( io_server = io_server
                         iv_status = 400
                         iv_code   = 'SUSH_PACKAGE_ERROR'
                         iv_msg    = |package of { canonical_name( is_key ) } could not be resolved; pass package=<package>| ).
      RETURN.
    ENDIF.

    zcl_abap_vibe_icf_auth_common=>transport_rule(
      EXPORTING iv_package   = lv_package
                iv_transport = lv_transport
                iv_verb      = 'update'
                iv_prefix    = 'SUSH'
      IMPORTING ev_code      = lv_rule_code
                ev_msg       = lv_rule_msg ).
    IF lv_rule_code IS NOT INITIAL.
      respond_doc_error( io_server = io_server
                         iv_status = 400
                         iv_code   = lv_rule_code
                         iv_msg    = lv_rule_msg ).
      RETURN.
    ENDIF.

    " abapGit parity: the lead application must live in the same package as
    " the SUSH object (skipped for transactions, they own no SUSH TADIR row).
    IF is_key-type <> 'TR'.
      TRY.
          DATA lo_appl TYPE REF TO object.
          DATA lr_appl TYPE REF TO data.
          FIELD-SYMBOLS <ls_appl> TYPE any.
          CREATE OBJECT lo_appl TYPE ('CL_SU22_APPL').
          CREATE DATA lr_appl TYPE ('CL_SU2X=>TS_HEAD').
          ASSIGN lr_appl->* TO <ls_appl>.
          CALL METHOD lo_appl->('GET_DATA')
            EXPORTING is_key  = is_key
            IMPORTING es_head = <ls_appl>.
          DATA(lv_lead_package) = CONV devclass( head_value( is_struct = <ls_appl> iv_component = 'DEVCLASS' ) ).
          IF lv_lead_package IS NOT INITIAL AND lv_lead_package <> lv_package.
            respond_doc_error( io_server = io_server
                               iv_status = 400
                               iv_code   = 'SUSH_PACKAGE_ERROR'
                               iv_msg    = |the leading application of { canonical_name( is_key ) } lives in package { lv_lead_package }; update it in that package| ).
            RETURN.
          ENDIF.
        CATCH cx_root.
      ENDTRY.
    ENDIF.

    " Pre-validate with SAP's own consistency check (no write).
    validate_with_sap( EXPORTING io_su22 = io_su22 is_key = is_key is_doc = ls_doc
                       IMPORTING ev_code = lv_code ev_msg = lv_msg ev_http = lv_http ).
    IF lv_code IS NOT INITIAL.
      respond_doc_error( io_server = io_server
                         iv_status = lv_http
                         iv_code   = lv_code
                         iv_msg    = lv_msg ).
      RETURN.
    ENDIF.

    IF zcl_abap_vibe_icf_types=>is_local_package( lv_package ) = abap_false AND is_key-type <> 'TR'.
      DATA lv_author TYPE sy-uname.
      lv_composite = is_key.
      zcl_abap_vibe_icf_auth_common=>corr_insert(
        EXPORTING iv_tadir_object = tadir_object_of( is_key-type )
                  iv_name         = CONV string( lv_composite )
                  iv_package      = lv_package
                  iv_transport    = lv_transport
                  iv_mode         = 'I'
                  iv_prefix       = 'SUSH'
        IMPORTING ev_author       = lv_author
                  ev_http_code    = lv_http
                  ev_code         = lv_code
                  ev_msg          = lv_msg ).
      IF lv_code IS NOT INITIAL.
        respond_doc_error( io_server = io_server
                           iv_status = lv_http
                           iv_code   = lv_code
                           iv_msg    = lv_msg ).
        RETURN.
      ENDIF.
    ENDIF.

    update_object( EXPORTING io_su22 = io_su22 is_key = is_key is_doc = ls_doc
                   IMPORTING ev_code = lv_code ev_msg = lv_msg ev_http = lv_http ).
    IF lv_code IS NOT INITIAL.
      respond_doc_error( io_server = io_server
                         iv_status = lv_http
                         iv_code   = lv_code
                         iv_msg    = lv_msg ).
      RETURN.
    ENDIF.

    respond_write( io_server  = io_server
                   is_key     = is_key
                   iv_action  = 'updated'
                   iv_package = lv_package ).
  ENDMETHOD.

  METHOD create_sush.
    DATA lv_query TYPE string.
    DATA lv_package TYPE devclass.
    DATA lv_transport TYPE trkorr.
    DATA ls_doc TYPE ty_document.
    DATA lv_code TYPE string.
    DATA lv_msg TYPE string.
    DATA lv_http TYPE i.
    DATA lv_rule_code TYPE string.
    DATA lv_rule_msg TYPE string.
    DATA lv_abap_lv TYPE char1.
    DATA lv_abap_lv_ok TYPE abap_bool.
    DATA lv_created_by TYPE string.

    lv_query = io_server->request->get_header_field( '~query_string' ).
    lv_package = zcl_abap_vibe_icf_auth_common=>query_package( lv_query ).
    lv_transport = zcl_abap_vibe_icf_auth_common=>query_transport( lv_query ).

    " Creation through SU22 only exists for RF applications. HT/HS keys are
    " SAP-computed hashes of a leading TADIR object / service and TR data is
    " written by the transaction itself, so the CLI cannot address them before
    " SAP creates them (abapGit skips CREATE for TR for the same reason).
    IF is_key-type <> 'RF'.
      CASE is_key-type.
        WHEN 'TR'.
          lv_created_by = 'the transaction itself (SE93/TSTC)'.
        WHEN 'HT'.
          lv_created_by = 'the leading TADIR object (SU22 registers the hash key)'.
        WHEN OTHERS.
          lv_created_by = 'the service registration (SU22 registers the hash key)'.
      ENDCASE.
      respond_doc_error( io_server = io_server
                         iv_status = 400
                         iv_code   = 'SUSH_UNSUPPORTED'
                         iv_msg    = |SUSH { is_key-type } applications are created by { lv_created_by }; pull the existing key instead of creating it| ).
      RETURN.
    ENDIF.

    IF lv_package IS INITIAL.
      respond_doc_error( io_server = io_server
                         iv_status = 400
                         iv_code   = 'SUSH_PACKAGE_ERROR'
                         iv_msg    = 'package query parameter is required to create a SUSH object' ).
      RETURN.
    ENDIF.

    IF zcl_abap_vibe_icf_auth_common=>parse_body( EXPORTING iv_body = iv_body
                                                  CHANGING  cs_doc  = ls_doc ) = abap_false.
      respond_doc_error( io_server = io_server
                         iv_status = 400
                         iv_code   = 'SUSH_INVALID_PAYLOAD'
                         iv_msg    = 'request body is not a valid SUSH document (JSON object)' ).
      RETURN.
    ENDIF.

    validate_document( EXPORTING is_key = is_key is_doc = ls_doc
                       IMPORTING ev_code = lv_code ev_msg = lv_msg ).
    IF lv_code IS NOT INITIAL.
      respond_doc_error( io_server = io_server
                         iv_status = 400
                         iv_code   = lv_code
                         iv_msg    = lv_msg ).
      RETURN.
    ENDIF.

    zcl_abap_vibe_icf_auth_common=>transport_rule(
      EXPORTING iv_package   = lv_package
                iv_transport = lv_transport
                iv_verb      = 'create'
                iv_prefix    = 'SUSH'
      IMPORTING ev_code      = lv_rule_code
                ev_msg       = lv_rule_msg ).
    IF lv_rule_code IS NOT INITIAL.
      respond_doc_error( io_server = io_server
                         iv_status = 400
                         iv_code   = lv_rule_code
                         iv_msg    = lv_rule_msg ).
      RETURN.
    ENDIF.

    IF exists( io_su22 = io_su22 is_key = is_key ) = abap_true.
      respond_doc_error( io_server = io_server
                         iv_status = 409
                         iv_code   = 'SUSH_ALREADY_EXISTS'
                         iv_msg    = |SUSH object { canonical_name( is_key ) } already exists; update it instead| ).
      RETURN.
    ENDIF.

    preflight_rf( EXPORTING is_key = is_key iv_package = lv_package
                  IMPORTING ev_code = lv_code ev_msg = lv_msg ev_http = lv_http ).
    IF lv_code IS NOT INITIAL.
      respond_doc_error( io_server = io_server
                         iv_status = lv_http
                         iv_code   = lv_code
                         iv_msg    = lv_msg ).
      RETURN.
    ENDIF.

    abap_lv_from_json( EXPORTING iv_version = ls_doc-header-abap_language_version
                       IMPORTING ev_abap_lv = lv_abap_lv ev_ok = lv_abap_lv_ok ).
    create_object( EXPORTING io_su22    = io_su22
                             is_key     = is_key
                             is_doc     = ls_doc
                             iv_package = lv_package
                             iv_transport = lv_transport
                             iv_abap_lv = lv_abap_lv
                   IMPORTING ev_code    = lv_code
                             ev_msg     = lv_msg
                             ev_http    = lv_http ).
    IF lv_code IS NOT INITIAL.
      respond_doc_error( io_server = io_server
                         iv_status = lv_http
                         iv_code   = lv_code
                         iv_msg    = lv_msg ).
      RETURN.
    ENDIF.

    update_object( EXPORTING io_su22 = io_su22 is_key = is_key is_doc = ls_doc
                   IMPORTING ev_code = lv_code ev_msg = lv_msg ev_http = lv_http ).
    IF lv_code IS NOT INITIAL.
      rollback_create( io_su22 = io_su22 is_key = is_key
                       iv_package = lv_package iv_transport = lv_transport ).
      respond_doc_error( io_server = io_server
                         iv_status = lv_http
                         iv_code   = lv_code
                         iv_msg    = |{ lv_msg } (the partially created object was rolled back)| ).
      RETURN.
    ENDIF.

    respond_write( io_server  = io_server
                   is_key     = is_key
                   iv_action  = 'created'
                   iv_package = lv_package ).
  ENDMETHOD.

  METHOD delete_sush.
    DATA lv_query TYPE string.
    DATA lv_package TYPE devclass.
    DATA lv_transport TYPE trkorr.
    DATA lv_rule_code TYPE string.
    DATA lv_rule_msg TYPE string.
    DATA lv_composite TYPE tadir-obj_name.

    lv_query = io_server->request->get_header_field( '~query_string' ).
    lv_transport = zcl_abap_vibe_icf_auth_common=>query_transport( lv_query ).

    IF exists( io_su22 = io_su22 is_key = is_key ) = abap_false.
      respond_doc_error( io_server = io_server
                         iv_status = 404
                         iv_code   = 'SUSH_NOT_FOUND'
                         iv_msg    = |SUSH object { canonical_name( is_key ) } does not exist| ).
      RETURN.
    ENDIF.

    lv_package = zcl_abap_vibe_icf_auth_common=>query_package( lv_query ).
    IF lv_package IS INITIAL.
      lv_package = resolve_package( is_key ).
    ENDIF.
    IF lv_package IS INITIAL.
      respond_doc_error( io_server = io_server
                         iv_status = 400
                         iv_code   = 'SUSH_PACKAGE_ERROR'
                         iv_msg    = |package of { canonical_name( is_key ) } could not be resolved| ).
      RETURN.
    ENDIF.

    zcl_abap_vibe_icf_auth_common=>transport_rule(
      EXPORTING iv_package   = lv_package
                iv_transport = lv_transport
                iv_verb      = 'delete'
                iv_prefix    = 'SUSH'
      IMPORTING ev_code      = lv_rule_code
                ev_msg       = lv_rule_msg ).
    IF lv_rule_code IS NOT INITIAL.
      respond_doc_error( io_server = io_server
                         iv_status = 400
                         iv_code   = lv_rule_code
                         iv_msg    = lv_rule_msg ).
      RETURN.
    ENDIF.

    " SAP's DELETE runs its own authority check (SUSO/SUSH activity 06) and the
    " BEFORE_DEL/where-used consistency check; do not bypass them.
    TRY.
        CALL METHOD io_su22->('IF_SU22_ADT_OBJECT~DELETE')
          EXPORTING iv_key     = is_key
                    iv_cleanup = abap_true
                    iv_cts     = abap_false.
      CATCH cx_root INTO DATA(lx_delete).
        DATA(lv_delete_text) = lx_delete->get_text( ).
        DATA(lv_delete_name) = canonical_name( is_key ).
        DATA(lv_delete_msg) = |{ lv_delete_name } was not deleted: { lv_delete_text }|.
        respond_doc_error( io_server = io_server
                           iv_status = 409
                           iv_code   = 'SUSH_DELETE_REFUSED'
                           iv_msg    = lv_delete_msg ).
        RETURN.
    ENDTRY.

    " Idempotent TADIR cleanup: local objects are removed by SAP already,
    " transportable ones are set to delete-flag and recorded in the request.
    IF is_key-type <> 'TR'.
      lv_composite = is_key.
      zcl_abap_vibe_icf_auth_common=>tadir_delete( iv_tadir_object = tadir_object_of( is_key-type )
                                                   iv_name         = CONV string( lv_composite )
                                                   iv_package      = lv_package
                                                   iv_transport    = lv_transport ).
    ENDIF.

    respond_write( io_server  = io_server
                   is_key     = is_key
                   iv_action  = 'deleted'
                   iv_package = lv_package ).
  ENDMETHOD.

  METHOD respond_read.
    DATA ls_envelope TYPE ty_read_envelope.

    ls_envelope-status = 'success'.
    ls_envelope-data-format_version = is_doc-format_version.
    ls_envelope-data-header = is_doc-header.
    ls_envelope-data-general_information = is_doc-general_information.
    ls_envelope-data-authorization_objects = is_doc-authorization_objects.
    ls_envelope-data-name = canonical_name( is_key ).
    ls_envelope-data-package = iv_package.

    zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                                              iv_status = 200
                                              iv_reason = 'OK'
                                              is_payload = ls_envelope ).
  ENDMETHOD.

  METHOD respond_write.
    zcl_abap_vibe_icf_auth_common=>respond_write_ok( io_server  = io_server
                                                     iv_name    = canonical_name( is_key )
                                                     iv_type    = 'SUSH'
                                                     iv_action  = iv_action
                                                     iv_package = iv_package ).
  ENDMETHOD.

  METHOD respond_doc_error.
    zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                                                  iv_status = iv_status
                                                  iv_code   = iv_code
                                                  iv_msg    = iv_msg ).
  ENDMETHOD.
ENDCLASS.
