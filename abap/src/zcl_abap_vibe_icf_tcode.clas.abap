CLASS zcl_abap_vibe_icf_tcode DEFINITION PUBLIC FINAL CREATE PUBLIC.
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
    " ----- /tcode read -----
    CLASS-METHODS read_tcode
      IMPORTING iv_tcode   TYPE tstc-tcode
      EXPORTING es_payload TYPE zcl_abap_vibe_icf_types=>ty_tcode
                ev_error   TYPE zcl_abap_vibe_icf_types=>ty_error.
    " ----- /tran read -----
    CLASS-METHODS read_tran_tstc
      IMPORTING iv_tcode TYPE tstc-tcode
      RETURNING VALUE(es_tstc) TYPE tstc.
    CLASS-METHODS build_tran_payload
      IMPORTING iv_tcode    TYPE tstc-tcode
      RETURNING VALUE(es_payload) TYPE zcl_abap_vibe_icf_types=>ty_tran_data.
    CLASS-METHODS parse_parameter_transaction
      IMPORTING iv_param        TYPE string
      EXPORTING ev_called_tcode TYPE string
                ev_skip_initial TYPE abap_bool
                et_values       TYPE zcl_abap_vibe_icf_types=>tt_tran_pv.
    CLASS-METHODS parse_variant_transaction
      IMPORTING iv_param           TYPE string
      EXPORTING ev_cross_client    TYPE abap_bool
                ev_called_tcode    TYPE string
                ev_variant_name    TYPE string.
    CLASS-METHODS parse_oo_transaction
      IMPORTING iv_param       TYPE string
      EXPORTING ev_program     TYPE string
                ev_class       TYPE string
                ev_method      TYPE string
                ev_update_mode TYPE string.
    CLASS-METHODS split_parameter_values
      IMPORTING iv_param  TYPE string
      EXPORTING et_values TYPE zcl_abap_vibe_icf_types=>tt_tran_pv.
    " ----- /tran write -----
    CLASS-METHODS write_tran
      IMPORTING io_server TYPE REF TO if_http_server
                iv_name   TYPE string
                iv_body   TYPE string.
    CLASS-METHODS delete_tran
      IMPORTING io_server TYPE REF TO if_http_server
                iv_name   TYPE string
                iv_body   TYPE string.
    CLASS-METHODS tran_docutype
      IMPORTING iv_transaction_type TYPE string
      RETURNING VALUE(rv_docutype)  TYPE rglif-docutype.
    CLASS-METHODS iso_to_sap_language
      IMPORTING iv_iso                 TYPE string
      RETURNING VALUE(rv_sap_language) TYPE sy-langu.
    CLASS-METHODS iso_from_sap_language
      IMPORTING iv_sap_language        TYPE sy-langu
      RETURNING VALUE(rv_iso_language) TYPE string.
    CLASS-METHODS corr_insert_tran
      IMPORTING iv_name      TYPE tstc-tcode
                iv_package   TYPE devclass
                iv_transport TYPE trkorr
                iv_language  TYPE sy-langu
      EXPORTING ev_error     TYPE zcl_abap_vibe_icf_types=>ty_error.
    CLASS-METHODS save_tran_authorizations
      IMPORTING iv_name  TYPE tstc-tcode
                is_auth  TYPE zcl_abap_vibe_icf_types=>ty_tran_auth
      EXPORTING ev_error TYPE zcl_abap_vibe_icf_types=>ty_error.
    CLASS-METHODS respond_tran_write_error
      IMPORTING io_server TYPE REF TO if_http_server
                iv_status TYPE i
                iv_code   TYPE string
                iv_msg    TYPE string.
    CLASS-METHODS last_message
      RETURNING VALUE(rv_message) TYPE string.
ENDCLASS.

CLASS zcl_abap_vibe_icf_tcode IMPLEMENTATION.
  METHOD dispatch_tcode.
    " Resolve only the configured transaction entry; parameter and object
    " transaction chains deliberately remain explicit as entry_only in v1.
    DATA lv_tcode_raw TYPE string.
    DATA lv_tcode     TYPE tstc-tcode.
    DATA ls_payload   TYPE zcl_abap_vibe_icf_types=>ty_tcode.
    DATA ls_error     TYPE zcl_abap_vibe_icf_types=>ty_error.

    IF iv_method <> 'GET'.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 405
                     iv_reason = 'Method Not Allowed'
                     iv_code   = 'METHOD_NOT_ALLOWED'
                     iv_msg    = 'GET only on /tcode/<tcode>' ).
      RETURN.
    ENDIF.

    lv_tcode_raw = to_upper( substring( val = iv_path off = strlen( '/tcode/' ) ) ).
    IF lv_tcode_raw IS INITIAL OR strlen( lv_tcode_raw ) > 20 OR lv_tcode_raw CS ` `.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = 'INVALID_ARGUMENT'
                     iv_msg    = 'tcode must be a non-empty transaction code of at most 20 characters without whitespace' ).
      RETURN.
    ENDIF.

    lv_tcode = lv_tcode_raw.
    AUTHORITY-CHECK OBJECT 'S_TCODE'
      ID 'TCD' FIELD lv_tcode.
    IF sy-subrc <> 0.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 403
                     iv_reason = 'Forbidden'
                     iv_code   = 'TCODE_NOT_AUTHORIZED'
                     iv_msg    = |not authorized to inspect transaction { lv_tcode }| ).
      RETURN.
    ENDIF.

    read_tcode( EXPORTING iv_tcode = lv_tcode
                IMPORTING es_payload = ls_payload
                          ev_error = ls_error ).
    IF ls_error IS NOT INITIAL.
      DATA(lv_status) = COND i( WHEN ls_error-error-code = 'TCODE_NOT_FOUND' THEN 404 ELSE 500 ).
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = lv_status
                     iv_reason = COND string( WHEN lv_status = 404 THEN 'Not Found' ELSE 'Internal Server Error' )
                     iv_code   = ls_error-error-code
                     iv_msg    = ls_error-error-message ).
      RETURN.
    ENDIF.

    zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                  iv_status = 200
                  iv_reason = 'OK'
                  is_payload = ls_payload ).
  ENDMETHOD.
  METHOD read_tcode.
    " TSTC is the canonical configured initial program/screen mapping. It is
    " intentionally not presented as a fully followed parameter-transaction chain.
    CLEAR: es_payload, ev_error.
    SELECT SINGLE pgmna, dypno
      FROM tstc
      WHERE tcode = @iv_tcode
      INTO @DATA(ls_tstc).
    IF sy-subrc <> 0.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error(
        status = 'error'
        error = VALUE #( code = 'TCODE_NOT_FOUND'
                         message = |transaction { iv_tcode } was not found| ) ).
      RETURN.
    ENDIF.

    DATA(lv_description) = VALUE string( ).
    SELECT SINGLE ttext
      FROM tstct
      WHERE sprsl = @sy-langu
        AND tcode = @iv_tcode
      INTO @lv_description.

    es_payload = VALUE zcl_abap_vibe_icf_types=>ty_tcode(
      status = 'success'
      data = VALUE #(
        tcode = iv_tcode
        description = lv_description
        entry = VALUE #( program = ls_tstc-pgmna screen = ls_tstc-dypno )
        target = VALUE #( kind = 'program' name = ls_tstc-pgmna resolved = abap_true )
        resolution_state = 'entry_only'
        resolution_chain = VALUE #( ( tcode = iv_tcode
                                      kind = 'program'
                                      name = ls_tstc-pgmna
                                      screen = ls_tstc-dypno
                                      relation = 'entry' ) ) ) ).
  ENDMETHOD.
  METHOD dispatch_tran.
    " /tran/<tcode>  —  Read/write SE93 transaction metadata as abap-file-format tran-v1.
    "
    "   GET  → read TSTC + TSTCT + TSTCC + TSTCP + TSTCA, map to tran-v1 schema
    "   POST → upsert (create or overwrite) through RS_CORR_INSERT +
    "          RPY_TRANSACTION_INSERT; PUT behaves like POST
    "
    " Wire payload uses /ui2/cl_json pretty_mode-camel_case so field names on the
    " wire (generalInformation, transactionServices, ...) match the ABAP struct
    " names (general_information, transaction_services, ...) one-to-one.
    DATA lv_match_name TYPE string.

    FIND REGEX '^/tran/(.+)$' IN iv_path IGNORING CASE SUBMATCHES lv_match_name.
    IF sy-subrc <> 0 OR lv_match_name IS INITIAL.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code = 'TRAN_SERVICE_INVALID'
                     iv_msg = 'Transaction code is required' ).
      RETURN.
    ENDIF.

    IF iv_method = 'GET'.
      DATA(ls_tstc) = read_tran_tstc( CONV tstc-tcode( lv_match_name ) ).
      IF ls_tstc IS INITIAL.
        zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                       iv_status = 404
                       iv_reason = 'Not Found'
                       iv_code = 'TRAN_OBJECT_NOT_FOUND'
                       iv_msg = |Transaction { lv_match_name } not found| ).
        RETURN.
      ENDIF.
      DATA(ls_payload) = build_tran_payload( CONV tstc-tcode( lv_match_name ) ).
      zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                    iv_status = 200
                    iv_reason = 'OK'
                    is_payload = VALUE zcl_abap_vibe_icf_types=>ty_tran_service_response( status = 'success' data = ls_payload ) ).
      RETURN.
    ENDIF.

    IF iv_method = 'POST' OR iv_method = 'PUT'.
      write_tran( io_server = io_server
                  iv_name   = to_upper( lv_match_name )
                  iv_body   = iv_body ).
      RETURN.
    ENDIF.

    IF iv_method = 'DELETE'.
      delete_tran( io_server = io_server
                   iv_name   = to_upper( lv_match_name )
                   iv_body   = iv_body ).
      RETURN.
    ENDIF.

    zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                   iv_status = 405
                   iv_reason = 'Method Not Allowed'
                   iv_code = 'METHOD_NOT_ALLOWED'
                   iv_msg = |{ iv_method } not supported on /tran/{ lv_match_name }| ).
  ENDMETHOD.
  METHOD read_tran_tstc.
    " Read the TSTC row for iv_tcode. Clear when not found so callers can
    " use IS INITIAL to detect a 404 case.
    CLEAR es_tstc.
    SELECT SINGLE * FROM tstc WHERE tcode = @iv_tcode INTO @es_tstc.
  ENDMETHOD.
  METHOD build_tran_payload.
    " Map TSTC + auxiliary tables to the abap-file-format tran-v1 schema.
    " Returns an empty struct when the transaction does not exist.
    CLEAR es_payload.

    DATA(ls_tstc) = read_tran_tstc( iv_tcode ).
    IF ls_tstc IS INITIAL.
      RETURN.
    ENDIF.

    " Primary-language short text. Prefer the current login language; fall back
    " to whatever entry exists.
    DATA ls_tstct TYPE tstct.
    SELECT SINGLE * FROM tstct
      WHERE tcode = @iv_tcode AND sprsl = @sy-langu
      INTO @ls_tstct.
    IF sy-subrc <> 0.
      SELECT SINGLE * FROM tstct
        WHERE tcode = @iv_tcode
        INTO @ls_tstct.
    ENDIF.
    DATA(lv_description)   = ls_tstct-ttext.
    DATA(lv_original_lang) = iso_from_sap_language( ls_tstct-sprsl ).

    " TSTCP carries the type-specific extras: parameter/SPA-GPA values,
    " transaction variant parent + variant name, or OO class/method. It is a
    " single row per tcode (TSTCP-TCODE is the key) whose PARAM string is
    " prefix-encoded — see parse_* helpers.
    DATA lt_tstcp TYPE STANDARD TABLE OF tstcp WITH EMPTY KEY.
    SELECT * FROM tstcp WHERE tcode = @iv_tcode INTO TABLE @lt_tstcp.
    DATA ls_tstcp TYPE tstcp.
    READ TABLE lt_tstcp INTO ls_tstcp INDEX 1.
    DATA lv_param TYPE string.
    IF sy-subrc = 0.
      lv_param = ls_tstcp-param.
    ENDIF.

    " Derive the transaction type from the TSTC-CINFO bit pattern (abapGit
    " zcl_abapgit_object_tran: parameter x02, OO x08, report x80; a report
    " transaction with a variant carries x90 and a transaction variant is a
    " parameter-shaped cinfo whose TSTCP starts with '@').
    DATA(lv_cinfo) = ls_tstc-cinfo.
    DATA lv_transaction_type TYPE string.
    DATA lc_hex_obj TYPE x VALUE '08'.
    DATA lc_hex_rep TYPE x VALUE '80'.
    DATA lc_hex_par TYPE x VALUE '02'.
    IF lv_cinfo O lc_hex_rep.
      lv_transaction_type = 'reportTransaction'.
    ELSEIF lv_cinfo O lc_hex_obj.
      lv_transaction_type = 'ooTransaction'.
    ELSEIF lv_cinfo O lc_hex_par.
      IF lv_param IS NOT INITIAL AND substring( val = lv_param len = 1 ) = '@'.
        lv_transaction_type = 'variantTransaction'.
      ELSE.
        lv_transaction_type = 'parameterTransaction'.
      ENDIF.
    ELSE.
      lv_transaction_type = 'dialogTransaction'.
    ENDIF.

    es_payload = VALUE zcl_abap_vibe_icf_types=>ty_tran_data(
      format_version = '1'
      header = VALUE zcl_abap_vibe_icf_types=>ty_tran_header(
        abap_language_version = 'standard'
        description       = lv_description
        original_language = lv_original_lang )
      general_information = VALUE zcl_abap_vibe_icf_types=>ty_tran_general(
        dialog_transaction = VALUE zcl_abap_vibe_icf_types=>ty_tran_dialog(
          program_dynnr        = '0000'
          stv_maintenance_mode = 'notAllowed' )
        parameter_transaction = VALUE zcl_abap_vibe_icf_types=>ty_tran_param(
          skip_initial_screen_mode = 'skip' )
        report_transaction = VALUE zcl_abap_vibe_icf_types=>ty_tran_report(
          report_dynnr = '0000' )
        oo_transaction = VALUE zcl_abap_vibe_icf_types=>ty_tran_oo(
          update_mode = 'notSet' )
        variant_transaction = VALUE zcl_abap_vibe_icf_types=>ty_tran_variant( ) ) ).

    CASE lv_transaction_type.
      WHEN 'dialogTransaction'.
        es_payload-general_information = VALUE zcl_abap_vibe_icf_types=>ty_tran_general(
          transaction_type   = lv_transaction_type
          dialog_transaction = VALUE zcl_abap_vibe_icf_types=>ty_tran_dialog(
            program_name         = ls_tstc-pgmna
            program_dynnr        = ls_tstc-dypno
            stv_maintenance_mode = 'notAllowed' ) ).
      WHEN 'parameterTransaction'.
        DATA(lv_called_tcode) = VALUE string( ).
        DATA(lv_skip_initial) = abap_false.
        DATA lt_pv TYPE zcl_abap_vibe_icf_types=>tt_tran_pv.
        parse_parameter_transaction( EXPORTING iv_param        = lv_param
                                     IMPORTING ev_called_tcode = lv_called_tcode
                                               ev_skip_initial = lv_skip_initial
                                               et_values       = lt_pv ).
        es_payload-general_information = VALUE zcl_abap_vibe_icf_types=>ty_tran_general(
          transaction_type      = lv_transaction_type
          parameter_transaction = VALUE zcl_abap_vibe_icf_types=>ty_tran_param(
            par_parent_transaction_code = lv_called_tcode
            skip_initial_screen_mode    = COND string( WHEN lv_skip_initial = abap_true THEN 'skip' ELSE 'show' )
            parameter_values            = lt_pv ) ).
      WHEN 'reportTransaction'.
        " A report transaction may additionally run a report variant; its name
        " is the plain TSTCP-PARAM value.
        es_payload-general_information = VALUE zcl_abap_vibe_icf_types=>ty_tran_general(
          transaction_type   = lv_transaction_type
          report_transaction = VALUE zcl_abap_vibe_icf_types=>ty_tran_report(
            report_name         = ls_tstc-pgmna
            report_dynnr        = ls_tstc-dypno
            report_variant_name = condense( val = lv_param ) ) ).
      WHEN 'ooTransaction'.
        DATA(lv_oo_program)     = VALUE string( ).
        DATA(lv_oo_class)       = VALUE string( ).
        DATA(lv_oo_method)      = VALUE string( ).
        DATA(lv_oo_update_mode) = VALUE string( ).
        parse_oo_transaction( EXPORTING iv_param       = lv_param
                              IMPORTING ev_program     = lv_oo_program
                                        ev_class       = lv_oo_class
                                        ev_method      = lv_oo_method
                                        ev_update_mode = lv_oo_update_mode ).
        es_payload-general_information = VALUE zcl_abap_vibe_icf_types=>ty_tran_general(
          transaction_type = lv_transaction_type
          oo_transaction   = VALUE zcl_abap_vibe_icf_types=>ty_tran_oo(
            local_in_program_indi = boolc( lv_oo_program IS NOT INITIAL )
            class_program_name    = lv_oo_program
            class_name            = lv_oo_class
            method_name           = lv_oo_method
            update_mode           = SWITCH string( lv_oo_update_mode
                                      WHEN 'S' THEN 'synchronous'
                                      WHEN 'U' THEN 'asynchronous'
                                      WHEN 'L' THEN 'local'
                                      ELSE 'notSet' ) ) ).
      WHEN 'variantTransaction'.
        DATA(lv_var_cross_client) = abap_false.
        DATA(lv_var_called)       = VALUE string( ).
        DATA(lv_var_name)         = VALUE string( ).
        parse_variant_transaction( EXPORTING iv_param        = lv_param
                                   IMPORTING ev_cross_client = lv_var_cross_client
                                             ev_called_tcode = lv_var_called
                                             ev_variant_name = lv_var_name ).
        es_payload-general_information = VALUE zcl_abap_vibe_icf_types=>ty_tran_general(
          transaction_type    = lv_transaction_type
          variant_transaction = VALUE zcl_abap_vibe_icf_types=>ty_tran_variant(
            var_parent_transaction_code = lv_var_called
            transaction_variant_ci_indi = lv_var_cross_client
            transaction_ci_variant_name = COND string( WHEN lv_var_cross_client = abap_true THEN lv_var_name ELSE `` )
            transaction_variant_name    = COND string( WHEN lv_var_cross_client = abap_false THEN lv_var_name ELSE `` ) ) ).
    ENDCASE.

    " AFF defaults that are not stored in the transaction tables on this
    " release: the lock flag has no TSTC column and the ABAP language version
    " of a transaction is always standard.
    es_payload-general_information-lock_status = 'notLocked'.

    " Wire-only package (TADIR), so a pulled .tran.json can push back to the
    " same package without repeating --package.
    SELECT SINGLE devclass FROM tadir
      WHERE pgmid = 'R3TR' AND object = 'TRAN' AND obj_name = @iv_tcode
      INTO @es_payload-package.

    " TSTCC → userInterface.uiAttributes. S_WEBGUI stores the GUI-for-HTML
    " mode ('1' = professional, '2' = Easy Web), S_WIN32 / S_PLATIN are X when
    " the GUI is enabled, S_PERVAS is X when pervasive mode is enabled and
    " S_SERVICE holds the IAC service name.
    DATA ls_tstcc TYPE tstcc.
    SELECT SINGLE * FROM tstcc WHERE tcode = @iv_tcode INTO @ls_tstcc.
    es_payload-user_interface = VALUE zcl_abap_vibe_icf_types=>ty_tran_user_interface(
      ui_attributes = VALUE zcl_abap_vibe_icf_types=>ty_tran_ui(
        inheritance_mode  = 'inactive'
        ui_classification = COND #( WHEN ls_tstcc-s_webgui = '2'
                                    THEN 'easyWebTransaction'
                                    ELSE 'professionalUserTransaction' )
        iac_service_name  = ls_tstcc-s_service
        pervasive_mode    = COND #( WHEN ls_tstcc-s_pervas = abap_true THEN 'enabled' ELSE 'disabled' )
        webgui_mode       = COND #( WHEN ls_tstcc-s_webgui IS NOT INITIAL THEN 'supported' ELSE 'notSupported' )
        platin_mode       = COND #( WHEN ls_tstcc-s_platin IS NOT INITIAL THEN 'supported' ELSE 'notSupported' )
        win32_mode        = COND #( WHEN ls_tstcc-s_win32 IS NOT INITIAL THEN 'supported' ELSE 'notSupported' ) ) ).

    " TSTCA → authorizations.startAuthorizationObject. TSTCA stores one row
    " per (tcode, objct, field, value) for the transaction start authorization
    " object. Authorization defaults for roles (USOBHASH) are not read here;
    " the AFF block is emitted with schema-valid defaults only.
    DATA ls_auth TYPE zcl_abap_vibe_icf_types=>ty_tran_auth.
    ls_auth-authorization_defaults = VALUE zcl_abap_vibe_icf_types=>ty_tran_ad(
      maintenance_mode        = 'manual'
      default_values_required = 'yes'
      inheritance_mode        = 'inactive' ).
    DATA lt_tstca TYPE TABLE OF tstca.
    SELECT * FROM tstca WHERE tcode = @iv_tcode ORDER BY PRIMARY KEY INTO TABLE @lt_tstca.
    IF sy-subrc = 0 AND lines( lt_tstca ) > 0.
      DATA ls_first_tstca TYPE tstca.
      READ TABLE lt_tstca INTO ls_first_tstca INDEX 1.
      DATA lt_sao_fv TYPE zcl_abap_vibe_icf_types=>tt_tran_sao_fv.
      LOOP AT lt_tstca INTO DATA(ls_tstca) WHERE objct = ls_first_tstca-objct.
        APPEND VALUE zcl_abap_vibe_icf_types=>ty_tran_sao_fv(
          auth_field_name  = ls_tstca-field
          auth_field_value = ls_tstca-value ) TO lt_sao_fv.
      ENDLOOP.
      ls_auth-start_authorization_object = VALUE zcl_abap_vibe_icf_types=>ty_tran_sao(
        auth_object_name         = ls_first_tstca-objct
        auth_object_field_values = lt_sao_fv ).
    ENDIF.
    es_payload-authorizations = ls_auth.
  ENDMETHOD.
  METHOD parse_parameter_transaction.
    " TSTCP-PARAM of a parameter transaction starts with '/' (show initial
    " screen) or '/*' (skip initial screen), followed by the core transaction
    " code, a blank and semicolon-terminated NAME=VALUE SPA/GPA defaults, e.g.
    "   /*SM30 VIEWNAME=V_TSAD2;UPDATE=X;
    CLEAR: ev_called_tcode, ev_skip_initial, et_values.
    DATA(lv_rest) = condense( val = iv_param ).
    IF strlen( lv_rest ) >= 2 AND substring( val = lv_rest len = 2 ) = '/*'.
      ev_skip_initial = abap_true.
      lv_rest = substring( val = lv_rest off = 2 ).
    ELSEIF strlen( lv_rest ) >= 1 AND substring( val = lv_rest len = 1 ) = '/'.
      lv_rest = substring( val = lv_rest off = 1 ).
    ENDIF.

    DATA(lv_space) = find( val = lv_rest sub = ` ` ).
    IF lv_space >= 0.
      ev_called_tcode = substring( val = lv_rest len = lv_space ).
      lv_rest = substring( val = lv_rest off = lv_space + 1 ).
    ELSE.
      ev_called_tcode = lv_rest.
      CLEAR lv_rest.
    ENDIF.

    split_parameter_values( EXPORTING iv_param  = lv_rest
                            IMPORTING et_values = et_values ).
  ENDMETHOD.
  METHOD parse_variant_transaction.
    " TSTCP-PARAM of a transaction variant starts with '@' (client-specific
    " variant) or '@@' (cross-client), followed by the core transaction code,
    " a blank and the variant name, e.g. '/*' variant: '@@SLG1 /BOBF/LOG'.
    CLEAR: ev_cross_client, ev_called_tcode, ev_variant_name.
    DATA(lv_rest) = condense( val = iv_param ).
    IF strlen( lv_rest ) >= 2 AND substring( val = lv_rest len = 2 ) = '@@'.
      ev_cross_client = abap_true.
      lv_rest = substring( val = lv_rest off = 2 ).
    ELSEIF strlen( lv_rest ) >= 1 AND substring( val = lv_rest len = 1 ) = '@'.
      lv_rest = substring( val = lv_rest off = 1 ).
    ENDIF.

    DATA(lv_space) = find( val = lv_rest sub = ` ` ).
    IF lv_space >= 0.
      ev_called_tcode = substring( val = lv_rest len = lv_space ).
      ev_variant_name = condense( val = substring( val = lv_rest off = lv_space + 1 ) ).
    ELSE.
      ev_called_tcode = lv_rest.
    ENDIF.
  ENDMETHOD.
  METHOD parse_oo_transaction.
    " OO transactions encode their target in TSTCP-PARAM as backslash
    " separated KEY=VALUE tokens, e.g.
    "   \PROGRAM=...\CLASS=...\METHOD=...\UPDATE_MODE=S
    " PROGRAM is only present for local classes.
    CLEAR: ev_program, ev_class, ev_method, ev_update_mode.
    DATA(lv_param) = condense( val = iv_param ).
    FIND FIRST OCCURRENCE OF REGEX '\\PROGRAM=([^\\ ]+)' IN lv_param SUBMATCHES ev_program.
    FIND FIRST OCCURRENCE OF REGEX '\\CLASS=([^\\ ]+)' IN lv_param SUBMATCHES ev_class.
    FIND FIRST OCCURRENCE OF REGEX '\\METHOD=([^\\ ]+)' IN lv_param SUBMATCHES ev_method.
    FIND FIRST OCCURRENCE OF REGEX '\\UPDATE_MODE=([^\\ ]+)' IN lv_param SUBMATCHES ev_update_mode.
  ENDMETHOD.
  METHOD split_parameter_values.
    " Parse semicolon-separated NAME=VALUE pairs (TSTCP parameter encoding).
    CLEAR et_values.
    DATA(lv_rest) = iv_param.
    WHILE lv_rest IS NOT INITIAL.
      DATA(lv_pair) = lv_rest.
      DATA(lv_semi) = find( val = lv_rest sub = ';' ).
      IF lv_semi >= 0.
        lv_pair = substring( val = lv_rest len = lv_semi ).
        lv_rest = substring( val = lv_rest off = lv_semi + 1 ).
      ELSE.
        CLEAR lv_rest.
      ENDIF.
      IF lv_pair IS INITIAL.
        CONTINUE.
      ENDIF.
      DATA(lv_eq) = find( val = lv_pair sub = '=' ).
      IF lv_eq > 0.
        APPEND VALUE zcl_abap_vibe_icf_types=>ty_tran_pv(
          parameter_name  = substring( val = lv_pair len = lv_eq )
          parameter_value = substring( val = lv_pair off = lv_eq + 1 ) ) TO et_values.
      ENDIF.
    ENDWHILE.
  ENDMETHOD.
  METHOD write_tran.
    " Upsert /tran/<tcode>. Mirrors abapGit's zcl_abapgit_object_tran:
    "   delete (when the tcode exists) → RS_CORR_INSERT (package/transport) →
    "   RPY_TRANSACTION_INSERT with suppress_corr_insert, then TSTCC extras,
    "   the report-variant CINFO bit and the TSTCA start authorization.
    " OO transactions cannot be written through RPY_TRANSACTION_INSERT (the
    " FM has no class/method parameters), so they are rejected explicitly.
    DATA ls_request TYPE zcl_abap_vibe_icf_types=>ty_tran_write_request.
    DATA lv_name       TYPE string.
    DATA lv_type       TYPE string.
    DATA lv_docutype   TYPE rglif-docutype.
    DATA lv_package    TYPE devclass.
    DATA lv_transport  TYPE trkorr.
    DATA lv_language   TYPE sy-langu.
    DATA lv_description TYPE string.
    DATA ls_error      TYPE zcl_abap_vibe_icf_types=>ty_error.

    IF iv_body IS INITIAL.
      respond_tran_write_error( io_server = io_server
                                iv_status = 400
                                iv_code   = 'TRAN_INVALID_PAYLOAD'
                                iv_msg    = 'request body is empty' ).
      RETURN.
    ENDIF.
    TRY.
        /ui2/cl_json=>deserialize( EXPORTING json        = iv_body
                                             pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                                   CHANGING  data        = ls_request ).
      CATCH cx_root INTO DATA(lx_parse).
        respond_tran_write_error( io_server = io_server
                                  iv_status = 400
                                  iv_code   = 'TRAN_INVALID_PAYLOAD'
                                  iv_msg    = |invalid JSON payload: { lx_parse->get_text( ) }| ).
        RETURN.
    ENDTRY.

    lv_name = to_upper( condense( val = iv_name del = ` ` ) ).
    IF lv_name IS INITIAL OR strlen( lv_name ) > 20 OR lv_name CS ` `.
      respond_tran_write_error( io_server = io_server
                                iv_status = 400
                                iv_code   = 'TRAN_SERVICE_INVALID'
                                iv_msg    = 'transaction code must be a non-empty name of at most 20 characters without whitespace' ).
      RETURN.
    ENDIF.
    IF ls_request-name IS NOT INITIAL AND to_upper( condense( val = ls_request-name del = ` ` ) ) <> lv_name.
      respond_tran_write_error( io_server = io_server
                                iv_status = 400
                                iv_code   = 'TRAN_NAME_MISMATCH'
                                iv_msg    = |payload name { ls_request-name } does not match URL transaction { lv_name }| ).
      RETURN.
    ENDIF.

    lv_type     = ls_request-general_information-transaction_type.
    lv_docutype = tran_docutype( lv_type ).
    IF lv_docutype IS INITIAL.
      respond_tran_write_error( io_server = io_server
                                iv_status = 400
                                iv_code   = 'TRAN_TYPE_INVALID'
                                iv_msg    = |unsupported transactionType '{ lv_type }'; expected dialogTransaction, reportTransaction, parameterTransaction, variantTransaction or ooTransaction| ).
      RETURN.
    ENDIF.

    lv_description = condense( val = ls_request-header-description ).
    IF lv_description IS INITIAL.
      respond_tran_write_error( io_server = io_server
                                iv_status = 400
                                iv_code   = 'TRAN_DESCRIPTION_REQUIRED'
                                iv_msg    = 'header.description is required' ).
      RETURN.
    ENDIF.
    IF strlen( lv_description ) > 80.
      respond_tran_write_error( io_server = io_server
                                iv_status = 400
                                iv_code   = 'TRAN_DESCRIPTION_TOO_LONG'
                                iv_msg    = |description must not exceed 80 characters (got { strlen( lv_description ) })| ).
      RETURN.
    ENDIF.

    lv_language  = iso_to_sap_language( ls_request-header-original_language ).
    lv_package   = to_upper( condense( val = ls_request-package del = ` ` ) ).
    IF lv_package IS INITIAL.
      lv_package = '$TMP'.
    ENDIF.
    lv_transport = to_upper( condense( val = ls_request-transport_request del = ` ` ) ).
    IF lv_package = '$TMP'.
      CLEAR lv_transport.
    ENDIF.

    DATA ls_tstc TYPE tstc.
    DATA ls_tstct TYPE tstct.
    DATA ls_tstcc TYPE tstcc.
    DATA ls_rsstcd TYPE rsstcd.
    DATA lt_param_values TYPE STANDARD TABLE OF rsparam WITH NON-UNIQUE DEFAULT KEY.
    ls_tstc-tcode  = lv_name.
    ls_tstct-tcode = lv_name.
    ls_tstct-sprsl = lv_language.
    ls_tstct-ttext = lv_description.
    ls_tstcc-tcode = lv_name.
    DATA(lv_existed) = boolc( read_tran_tstc( CONV tstc-tcode( lv_name ) ) IS NOT INITIAL ).

    CASE lv_type.
      WHEN 'dialogTransaction'.
        DATA(ls_dialog) = ls_request-general_information-dialog_transaction.
        ls_tstc-pgmna = to_upper( condense( val = ls_dialog-program_name del = ` ` ) ).
        IF ls_tstc-pgmna IS INITIAL.
          respond_tran_write_error( io_server = io_server
                                    iv_status = 400
                                    iv_code   = 'TRAN_PROGRAM_REQUIRED'
                                    iv_msg    = 'generalInformation.dialogTransaction.programName is required' ).
          RETURN.
        ENDIF.
        IF ls_dialog-program_dynnr IS NOT INITIAL.
          FIND REGEX '^[0-9]{1,4}$' IN ls_dialog-program_dynnr.
          IF sy-subrc <> 0.
            respond_tran_write_error( io_server = io_server
                                      iv_status = 400
                                      iv_code   = 'TRAN_DYNNR_INVALID'
                                      iv_msg    = |programDynnr '{ ls_dialog-program_dynnr }' must be 1-4 digits| ).
            RETURN.
          ENDIF.
          ls_tstc-dypno = ls_dialog-program_dynnr.
        ENDIF.
      WHEN 'reportTransaction'.
        DATA(ls_report) = ls_request-general_information-report_transaction.
        ls_tstc-pgmna = to_upper( condense( val = ls_report-report_name del = ` ` ) ).
        IF ls_tstc-pgmna IS INITIAL.
          respond_tran_write_error( io_server = io_server
                                    iv_status = 400
                                    iv_code   = 'TRAN_PROGRAM_REQUIRED'
                                    iv_msg    = 'generalInformation.reportTransaction.reportName is required' ).
          RETURN.
        ENDIF.
        IF ls_report-report_dynnr IS NOT INITIAL.
          FIND REGEX '^[0-9]{1,4}$' IN ls_report-report_dynnr.
          IF sy-subrc <> 0.
            respond_tran_write_error( io_server = io_server
                                      iv_status = 400
                                      iv_code   = 'TRAN_DYNNR_INVALID'
                                      iv_msg    = |reportDynnr '{ ls_report-report_dynnr }' must be 1-4 digits| ).
            RETURN.
          ENDIF.
          ls_tstc-dypno = ls_report-report_dynnr.
        ENDIF.
        ls_rsstcd-variant = to_upper( condense( val = ls_report-report_variant_name del = ` ` ) ).
      WHEN 'parameterTransaction'.
        DATA(ls_par) = ls_request-general_information-parameter_transaction.
        ls_rsstcd-call_tcode = to_upper( condense( val = ls_par-par_parent_transaction_code del = ` ` ) ).
        IF ls_rsstcd-call_tcode IS INITIAL.
          respond_tran_write_error( io_server = io_server
                                    iv_status = 400
                                    iv_code   = 'TRAN_PARENT_REQUIRED'
                                    iv_msg    = 'generalInformation.parameterTransaction.parParentTransactionCode is required' ).
          RETURN.
        ENDIF.
        IF ls_par-skip_initial_screen_mode IS INITIAL OR ls_par-skip_initial_screen_mode = 'skip'.
          ls_rsstcd-st_skip_1 = abap_true.
        ENDIF.
        LOOP AT ls_par-parameter_values INTO DATA(ls_pv).
          DATA ls_rsparam TYPE rsparam.
          CLEAR ls_rsparam.
          ls_rsparam-field = to_upper( condense( val = ls_pv-parameter_name del = ` ` ) ).
          ls_rsparam-value = ls_pv-parameter_value.
          IF ls_rsparam-field IS NOT INITIAL.
            APPEND ls_rsparam TO lt_param_values.
          ENDIF.
        ENDLOOP.
      WHEN 'variantTransaction'.
        DATA(ls_var) = ls_request-general_information-variant_transaction.
        ls_rsstcd-call_tcode = to_upper( condense( val = ls_var-var_parent_transaction_code del = ` ` ) ).
        IF ls_rsstcd-call_tcode IS INITIAL.
          respond_tran_write_error( io_server = io_server
                                    iv_status = 400
                                    iv_code   = 'TRAN_PARENT_REQUIRED'
                                    iv_msg    = 'generalInformation.variantTransaction.varParentTransactionCode is required' ).
          RETURN.
        ENDIF.
        IF ls_var-transaction_variant_ci_indi = abap_true.
          ls_rsstcd-s_ind_vari = abap_true.
          ls_rsstcd-variant = to_upper( condense( val = ls_var-transaction_ci_variant_name del = ` ` ) ).
        ELSE.
          ls_rsstcd-variant = to_upper( condense( val = ls_var-transaction_variant_name del = ` ` ) ).
        ENDIF.
        IF ls_rsstcd-variant IS INITIAL.
          respond_tran_write_error( io_server = io_server
                                    iv_status = 400
                                    iv_code   = 'TRAN_VARIANT_REQUIRED'
                                    iv_msg    = 'generalInformation.variantTransaction needs a variant name' ).
          RETURN.
        ENDIF.
      WHEN 'ooTransaction'.
        respond_tran_write_error( io_server = io_server
                                  iv_status = 400
                                  iv_code   = 'TRAN_OO_NOT_SUPPORTED'
                                  iv_msg    = 'OO transactions cannot be written through RPY_TRANSACTION_INSERT; maintain the OO transaction in transaction SE93 and pull it afterwards' ).
        RETURN.
    ENDCASE.

    " TSTCC extras that RPY_TRANSACTION_INSERT does not accept: GUI-for-HTML
    " mode, pervasive mode and the IAC service name. They are written directly
    " after the insert (the transport collector exports them with the TRAN object).
    DATA(ls_ui) = ls_request-user_interface-ui_attributes.
    IF ls_ui-webgui_mode = 'supported'.
      ls_tstcc-s_webgui = COND char1( WHEN ls_ui-ui_classification = 'easyWebTransaction' THEN '2' ELSE '1' ).
    ENDIF.
    IF ls_ui-platin_mode = 'supported'.
      ls_tstcc-s_platin = abap_true.
    ENDIF.
    IF ls_ui-win32_mode = 'supported'.
      ls_tstcc-s_win32 = abap_true.
    ENDIF.
    IF ls_ui-pervasive_mode = 'enabled'.
      ls_tstcc-s_pervas = abap_true.
    ENDIF.
    ls_tstcc-s_service = to_upper( condense( val = ls_ui-iac_service_name del = ` ` ) ).

    " Step 1: an existing transaction cannot be overwritten (the insert FM
    " refuses existing codes) and RPY_TRANSACTION_DELETE needs a GUI dynpro, so
    " clear the five transaction tables for this code and let the canonical
    " insert FM recreate the definition. Everything payable is validated above,
    " so the delete/recreate window only closes on a genuine SAP write error.
    DATA lv_tcode TYPE tstc-tcode.
    lv_tcode = ls_tstc-tcode.
    IF lv_existed = abap_true.
      DELETE FROM tstc  WHERE tcode = @lv_tcode.
      DELETE FROM tstct WHERE tcode = @lv_tcode.
      DELETE FROM tstcp WHERE tcode = @lv_tcode.
      DELETE FROM tstcc WHERE tcode = @lv_tcode.
      DELETE FROM tstca WHERE tcode = @lv_tcode.
    ENDIF.

    " Step 2: record the object in the package/transport (TADIR) before the
    " insert, so the object is transportable exactly like a SE93 save. This is
    " idempotent for an existing transaction (it only re-binds the package).
    corr_insert_tran( EXPORTING iv_name      = ls_tstc-tcode
                                iv_package   = lv_package
                                iv_transport = lv_transport
                                iv_language  = lv_language
                      IMPORTING ev_error     = ls_error ).
    IF ls_error IS NOT INITIAL.
      respond_tran_write_error( io_server = io_server
                                iv_status = 200
                                iv_code   = ls_error-error-code
                                iv_msg    = ls_error-error-message ).
      RETURN.
    ENDIF.

    " Step 3: canonical write through RPY_TRANSACTION_INSERT. The legacy FM
    " parameters are typed/generic, so pass the same concrete types abapGit
    " uses (d020s-dnum for the dynpro, TSTCT-TTEXT for the short text) instead
    " of N4/string values — otherwise the FM raises a type-mismatch dump.
    DATA lv_dynpro TYPE d020s-dnum.
    lv_dynpro = ls_tstc-dypno.
    CALL FUNCTION 'RPY_TRANSACTION_INSERT'
      EXPORTING transaction             = ls_tstc-tcode
                program                 = ls_tstc-pgmna
                dynpro                  = lv_dynpro
                language                = lv_language
                development_class       = lv_package
                transaction_type        = lv_docutype
                shorttext               = ls_tstct-ttext
                called_transaction      = ls_rsstcd-call_tcode
                called_transaction_skip = ls_rsstcd-st_skip_1
                variant                 = ls_rsstcd-variant
                cl_independend          = ls_rsstcd-s_ind_vari
                html_enabled            = ls_tstcc-s_webgui
                java_enabled            = ls_tstcc-s_platin
                wingui_enabled          = ls_tstcc-s_win32
                suppress_corr_insert    = abap_true
      TABLES param_values            = lt_param_values
      EXCEPTIONS cancelled              = 1
                 already_exist          = 2
                 permission_error       = 3
                 name_not_allowed       = 4
                 name_conflict          = 5
                 illegal_type           = 6
                 object_inconsistent    = 7
                 db_access_error        = 8
                 OTHERS                 = 9.
    IF sy-subrc <> 0.
      DATA(lv_insert_msg) = last_message( ).
      IF lv_insert_msg IS INITIAL.
        lv_insert_msg = |RPY_TRANSACTION_INSERT failed (sy-subrc { sy-subrc })|.
      ENDIF.
      DATA(lv_insert_code) = SWITCH string( sy-subrc
        WHEN 1 THEN 'TRAN_WRITE_CANCELLED'
        WHEN 3 THEN 'TRAN_NOT_AUTHORIZED'
        WHEN 4 THEN 'TRAN_NAME_NOT_ALLOWED'
        WHEN 5 THEN 'TRAN_NAME_CONFLICT'
        WHEN 6 THEN 'TRAN_TYPE_INVALID'
        WHEN 7 THEN 'TRAN_OBJECT_INCONSISTENT'
        WHEN 8 THEN 'TRAN_DB_ACCESS_ERROR'
        ELSE 'TRAN_WRITE_FAILED' ).
      respond_tran_write_error( io_server = io_server
                                iv_status = 200
                                iv_code   = lv_insert_code
                                iv_msg    = lv_insert_msg ).
      RETURN.
    ENDIF.

    " Step 4: post-write fixups.
    DATA ls_tstc_new TYPE tstc.
    ls_tstc_new = read_tran_tstc( ls_tstc-tcode ).
    IF ls_tstc_new IS INITIAL.
      respond_tran_write_error( io_server = io_server
                                iv_status = 200
                                iv_code   = 'TRAN_WRITE_FAILED'
                                iv_msg    = |transaction { lv_name } was not persisted| ).
      RETURN.
    ENDIF.

    " Report transactions with a variant carry the x'10' flag (bit 4) in
    " addition to the report bit; RPY_TRANSACTION_INSERT does not set it.
    IF lv_type = 'reportTransaction' AND ls_rsstcd-variant IS NOT INITIAL.
      DATA(lv_cinfo_fixed) = ls_tstc_new-cinfo.
      SET BIT 4 OF lv_cinfo_fixed TO 1.
      UPDATE tstc SET cinfo = @lv_cinfo_fixed WHERE tcode = @ls_tstc_new-tcode.
      ls_tstc_new-cinfo = lv_cinfo_fixed.
    ENDIF.

    " TSTCC: RPY_TRANSACTION_INSERT creates/updates the row with the three GUI
    " flags; overlay the remaining attributes.
    UPDATE tstcc FROM ls_tstcc.
    IF sy-subrc <> 0.
      INSERT tstcc FROM ls_tstcc.
      IF sy-subrc <> 0.
        respond_tran_write_error( io_server = io_server
                                  iv_status = 200
                                  iv_code   = 'TRAN_TSTCC_WRITE_FAILED'
                                  iv_msg    = |could not persist user interface attributes for { lv_name }| ).
        RETURN.
      ENDIF.
    ENDIF.

    " Start authorization object (TSTCA) + CINFO x'04' check flag.
    save_tran_authorizations( EXPORTING iv_name  = ls_tstc-tcode
                                        is_auth  = ls_request-authorizations
                              IMPORTING ev_error = ls_error ).
    IF ls_error IS NOT INITIAL.
      respond_tran_write_error( io_server = io_server
                                iv_status = 200
                                iv_code   = ls_error-error-code
                                iv_msg    = ls_error-error-message ).
      RETURN.
    ENDIF.

    zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                  iv_status = 200
                  iv_reason = 'OK'
                  is_payload = VALUE zcl_abap_vibe_icf_types=>ty_tran_write_response(
                    status = 'success'
                    data   = VALUE zcl_abap_vibe_icf_types=>ty_tran_write(
                      name   = lv_name
                      type   = 'TRAN'
                      action = COND string( WHEN lv_existed = abap_true THEN 'updated' ELSE 'created' ) ) ) ).
  ENDMETHOD.
  METHOD delete_tran.
    " DELETE /tran/<tcode>. RPY_TRANSACTION_DELETE cannot run in the ICF context
    " (it opens a GUI dynpro), so remove the transaction table rows directly and
    " delete the TADIR entry through TR_TADIR_INTERFACE, which also records the
    " deletion in the transport request when one is supplied.
    DATA lv_name      TYPE string.
    DATA lv_tcode     TYPE tstc-tcode.
    DATA lv_package   TYPE devclass.
    DATA lv_transport TYPE trkorr.
    DATA lv_match     TYPE string.

    lv_name = to_upper( condense( val = iv_name del = ` ` ) ).
    IF lv_name IS INITIAL OR strlen( lv_name ) > 20.
      respond_tran_write_error( io_server = io_server
                                iv_status = 400
                                iv_code   = 'TRAN_SERVICE_INVALID'
                                iv_msg    = 'transaction code must be a non-empty name of at most 20 characters' ).
      RETURN.
    ENDIF.
    lv_tcode = lv_name.
    SELECT SINGLE devclass FROM tadir
      WHERE pgmid = 'R3TR' AND object = 'TRAN' AND obj_name = @lv_tcode
      INTO @lv_package.
    " Either representation can be left behind by a partial write, so accept
    " both when deciding whether the transaction exists.
    IF read_tran_tstc( lv_tcode ) IS INITIAL AND lv_package IS INITIAL.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 404
                     iv_reason = 'Not Found'
                     iv_code   = 'TRAN_OBJECT_NOT_FOUND'
                     iv_msg    = |Transaction { lv_name } not found| ).
      RETURN.
    ENDIF.
    FIND FIRST OCCURRENCE OF REGEX '"transportRequest"\s*:\s*"([^"]+)"' IN iv_body IGNORING CASE
      SUBMATCHES lv_match.
    IF sy-subrc = 0.
      lv_transport = to_upper( lv_match ).
    ENDIF.
    " Transported transactions stay out of scope: removing a repository object
    " from a transport request cannot be recorded from the ICF context (the CTS
    " dialog is unavailable), so SE93 remains the canonical path there.
    IF lv_package IS NOT INITIAL AND lv_package <> '$TMP'.
      respond_tran_write_error( io_server = io_server
                                iv_status = 400
                                iv_code   = 'TRAN_DELETE_UNSUPPORTED'
                                iv_msg    = |transaction { lv_name } is in transportable package { lv_package }; delete it in SE93 so the deletion is recorded in a transport request| ).
      RETURN.
    ENDIF.

    DELETE FROM tstc  WHERE tcode = @lv_tcode.
    DELETE FROM tstct WHERE tcode = @lv_tcode.
    DELETE FROM tstcp WHERE tcode = @lv_tcode.
    DELETE FROM tstcc WHERE tcode = @lv_tcode.
    DELETE FROM tstca WHERE tcode = @lv_tcode.

    " A local ($TMP) object has no CTS entry to record, so drop the TADIR row
    " directly; TR_TADIR_INTERFACE/TRINT_DELETE_TADIR_IF_LOCAL refuse this
    " object type with object_is_distributed in a non-dialog session.
    IF lv_package = '$TMP'.
      DELETE FROM tadir WHERE pgmid = 'R3TR' AND object = 'TRAN' AND obj_name = @lv_tcode.
    ENDIF.

    zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                  iv_status = 200
                  iv_reason = 'OK'
                  is_payload = VALUE zcl_abap_vibe_icf_types=>ty_tran_write_response(
                    status = 'success'
                    data   = VALUE zcl_abap_vibe_icf_types=>ty_tran_write(
                      name   = lv_name
                      type   = 'TRAN'
                      action = 'deleted' ) ) ).
  ENDMETHOD.
  METHOD tran_docutype.
    " AFF transactionType → RGLIF-DOCUTYPE (the SE93 type flag used by
    " RPY_TRANSACTION_INSERT).
    CLEAR rv_docutype.
    CASE iv_transaction_type.
      WHEN 'dialogTransaction'.
        rv_docutype = 'D'.
      WHEN 'reportTransaction'.
        rv_docutype = 'R'.
      WHEN 'parameterTransaction'.
        rv_docutype = 'P'.
      WHEN 'variantTransaction'.
        rv_docutype = 'V'.
      WHEN 'ooTransaction'.
        rv_docutype = 'O'.
    ENDCASE.
  ENDMETHOD.
  METHOD iso_to_sap_language.
    " AFF header.originalLanguage is a 2-character ISO code; T002 maps it to
    " the internal 1-character language key.
    rv_sap_language = sy-langu.
    DATA(lv_iso) = to_upper( condense( val = iv_iso del = ` ` ) ).
    IF lv_iso IS INITIAL.
      RETURN.
    ENDIF.
    SELECT SINGLE spras FROM t002 WHERE laiso = @lv_iso INTO @rv_sap_language.
    IF sy-subrc <> 0 OR rv_sap_language IS INITIAL.
      rv_sap_language = sy-langu.
    ENDIF.
  ENDMETHOD.
  METHOD iso_from_sap_language.
    rv_iso_language = 'EN'.
    IF iv_sap_language IS INITIAL.
      RETURN.
    ENDIF.
    SELECT SINGLE laiso FROM t002 WHERE spras = @iv_sap_language INTO @rv_iso_language.
    IF sy-subrc <> 0 OR rv_iso_language IS INITIAL.
      rv_iso_language = 'EN'.
    ENDIF.
  ENDMETHOD.
  METHOD corr_insert_tran.
    " Record the TRAN object in TADIR and bind it to the package / transport
    " request (mirrors abapGit zcl_abapgit_cts_api~insert_transport_object).
    CLEAR ev_error.
    CALL FUNCTION 'RS_CORR_INSERT'
      EXPORTING object          = iv_name
                object_class    = 'TRAN'
                devclass        = iv_package
                master_language = iv_language
                korrnum         = iv_transport
                mode            = 'I'
                global_lock     = abap_true
                suppress_dialog = abap_true
      EXCEPTIONS cancelled           = 1
                 permission_failure  = 2
                 unknown_objectclass = 3
                 OTHERS              = 4.
    IF sy-subrc = 0.
      RETURN.
    ENDIF.
    DATA(lv_subrc) = sy-subrc.
    DATA(lv_msg) = last_message( ).
    IF lv_msg IS INITIAL.
      lv_msg = |RS_CORR_INSERT failed (sy-subrc { lv_subrc })|.
    ENDIF.
    DATA(lv_code) = SWITCH string( lv_subrc
      WHEN 1 THEN 'TRAN_WRITE_CANCELLED'
      WHEN 2 THEN 'TRAN_NOT_AUTHORIZED'
      WHEN 3 THEN 'TRAN_PACKAGE_INVALID'
      ELSE 'TRAN_PACKAGE_ASSIGN_FAILED' ).
    ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error(
      status = 'error'
      error = VALUE #( code = lv_code message = lv_msg ) ).
  ENDMETHOD.
  METHOD save_tran_authorizations.
    " Persist the transaction start authorization object (TSTCA) and set the
    " x'04' CINFO flag so the transaction checks it at start (same as SE93).
    CLEAR ev_error.
    DATA lv_tcode TYPE tstc-tcode.
    lv_tcode = iv_name.
    DELETE FROM tstca WHERE tcode = @lv_tcode.

    DATA(ls_sao) = is_auth-start_authorization_object.
    DATA(lv_object_name) = to_upper( condense( val = ls_sao-auth_object_name del = ` ` ) ).
    IF lv_object_name IS NOT INITIAL.
      DATA ls_tstca TYPE tstca.
      LOOP AT ls_sao-auth_object_field_values INTO DATA(ls_fv).
        CLEAR ls_tstca.
        ls_tstca-tcode = lv_tcode.
        ls_tstca-objct = lv_object_name.
        ls_tstca-field = to_upper( condense( val = ls_fv-auth_field_name del = ` ` ) ).
        ls_tstca-value = ls_fv-auth_field_value.
        INSERT tstca FROM ls_tstca.
        IF sy-subrc <> 0.
          ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error(
            status = 'error'
            error = VALUE #( code = 'TRAN_AUTH_WRITE_FAILED'
                             message = |could not persist start authorization field { ls_tstca-field } for { lv_tcode }| ) ).
          RETURN.
        ENDIF.
      ENDLOOP.

      DATA(ls_tstc) = read_tran_tstc( lv_tcode ).
      IF ls_tstc IS NOT INITIAL.
        DATA(lv_cinfo) = ls_tstc-cinfo.
        " x'04' = authorization check flag (bits 0-7, least significant bit 0).
        SET BIT 2 OF lv_cinfo TO 1.
        UPDATE tstc SET cinfo = @lv_cinfo WHERE tcode = @lv_tcode.
      ENDIF.
    ENDIF.
  ENDMETHOD.
  METHOD respond_tran_write_error.
    zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                   iv_status = iv_status
                   iv_reason = COND string( WHEN iv_status = 200 THEN 'OK' ELSE 'Bad Request' )
                   iv_code   = iv_code
                   iv_msg    = iv_msg ).
  ENDMETHOD.
  METHOD last_message.
    " Render the T100 message left by a failed classic FM call (the FM fills
    " sy-msgid / sy-msgno / sy-msgv1..4 before raising its EXCEPTION).
    CLEAR rv_message.
    IF sy-msgid IS INITIAL OR sy-msgno IS INITIAL.
      RETURN.
    ENDIF.
    MESSAGE ID sy-msgid TYPE 'S' NUMBER sy-msgno
      WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4 INTO rv_message.
  ENDMETHOD.
ENDCLASS.
