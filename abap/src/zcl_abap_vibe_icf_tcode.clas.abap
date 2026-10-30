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
    CLASS-METHODS read_tcode
      IMPORTING iv_tcode   TYPE tstc-tcode
      EXPORTING es_payload TYPE zcl_abap_vibe_icf_types=>ty_tcode
                ev_error   TYPE zcl_abap_vibe_icf_types=>ty_error.
    CLASS-METHODS read_tran_tstc
      IMPORTING iv_tcode TYPE tstc-tcode
      RETURNING VALUE(es_tstc) TYPE tstc.
    CLASS-METHODS build_tran_payload
      IMPORTING iv_tcode    TYPE tstc-tcode
      RETURNING VALUE(es_payload) TYPE zcl_abap_vibe_icf_types=>ty_tran_data.
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
    " /tran/<tcode>  —  Read SE93 transaction metadata as abap-file-format tran-v1.
    "
    "   GET  → read TSTC + TSTCT + TSTCC + TSTCP + TSTCA, map to tran-v1 schema
    "   POST → not implemented in this iteration (501). Write path needs the
    "          RPY_TRANSACTION_INSERT + RS_CORR_INSERT chain (or BDC for OO) and
    "          will land in a follow-up PR after S/4H validation on s4h.
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
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 501
                     iv_reason = 'Not Implemented'
                     iv_code = 'TRAN_WRITE_NOT_IMPLEMENTED'
                     iv_msg = |Transaction write is not yet implemented for { lv_match_name } on this handler| ).
      RETURN.
    ENDIF.

    zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                   iv_status = 405
                   iv_reason = 'Method Not Allowed'
                   iv_code = 'METHOD_NOT_ALLOWED'
                   iv_msg = |GET only on /tran/{ lv_match_name }| ).
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
    " 037 US2 (S07): map SAP sy-langu 1-char code to ISO 639-1 alpha-2 (matches
    " dispatch_http mapping so CLI wire round-trips cleanly).
    DATA(lv_original_lang) = SWITCH string( ls_tstct-sprsl
      WHEN '1' THEN 'ZH' WHEN '2' THEN 'KO' WHEN 'D' THEN 'DE'
      WHEN 'E' THEN 'EN' WHEN 'F' THEN 'FR' WHEN 'I' THEN 'IT'
      WHEN 'J' THEN 'JA' WHEN 'N' THEN 'NL' WHEN 'P' THEN 'PT'
      WHEN 'R' THEN 'RU' WHEN 'S' THEN 'ES'
      ELSE ls_tstct-sprsl ).

    " Derive transaction type from TSTC-CINFO bit pattern (abapGit
    " zcl_abapgit_object_tran constants: lc_hex_par = x'02', lc_hex_rep = x'80',
    " lc_hex_var = x'90' = rep + x'10' for variants, lc_hex_oo = x'08').
    DATA(lv_cinfo) = ls_tstc-cinfo.
    DATA(lv_transaction_type) = 'dialogTransaction'.
    " Variant carries the report bit plus 0x10, so it is tested before report.
    DATA lc_hex_var TYPE x VALUE '90'.
    DATA lc_hex_obj TYPE x VALUE '08'.
    DATA lc_hex_rep TYPE x VALUE '80'.
    DATA lc_hex_par TYPE x VALUE '02'.
    IF lv_cinfo O lc_hex_var.
      lv_transaction_type = 'variantTransaction'.
    ELSEIF lv_cinfo O lc_hex_obj.
      lv_transaction_type = 'ooTransaction'.
    ELSEIF lv_cinfo O lc_hex_rep.
      lv_transaction_type = 'reportTransaction'.
    ELSEIF lv_cinfo O lc_hex_par.
      lv_transaction_type = 'parameterTransaction'.
    ENDIF.

    es_payload = VALUE zcl_abap_vibe_icf_types=>ty_tran_data(
      format_version = '1'
      header = VALUE zcl_abap_vibe_icf_types=>ty_tran_header(
        description       = lv_description
        original_language = lv_original_lang ) ).

    " TSTCP rows (parameter transaction SPA/GPA values + OO transaction
    " class/method encoded as '\CLASS=...\METHOD=...' in PARAM).
    DATA lt_tstcp TYPE TABLE OF tstcp.
    SELECT * FROM tstcp WHERE tcode = @iv_tcode INTO TABLE @lt_tstcp.

    CASE lv_transaction_type.
      WHEN 'dialogTransaction'.
        es_payload-general_information = VALUE zcl_abap_vibe_icf_types=>ty_tran_general(
          transaction_type   = lv_transaction_type
          dialog_transaction = VALUE zcl_abap_vibe_icf_types=>ty_tran_dialog(
            program_name         = ls_tstc-pgmna
            program_dynnr        = ls_tstc-dypno
            stv_maintenance_mode = 'notAllowed' ) ).
      WHEN 'parameterTransaction'.
        " Parameter transaction: first TSTCP-PARAM holds the called tcode and
        " the SPA/GPA defaults as 'NAME VALUE' pairs separated by spaces.
        DATA(lv_param_string) = VALUE string( ).
        READ TABLE lt_tstcp INTO DATA(ls_param_row) INDEX 1.
        IF sy-subrc = 0.
          lv_param_string = ls_param_row-param.
        ENDIF.
        DATA(lv_called_tcode) = lv_param_string.
        " Trim to first whitespace — the called tcode lives in the leading segment.
        DATA(lv_space_pos) = find( val = lv_called_tcode sub = ` ` ).
        IF lv_space_pos >= 0.
          lv_called_tcode = substring( val = lv_called_tcode len = lv_space_pos ).
        ENDIF.
        " Subsequent rows carry individual 'NAME VALUE' pairs.
        DATA lt_pv TYPE zcl_abap_vibe_icf_types=>tt_tran_pv.
        LOOP AT lt_tstcp INTO ls_param_row FROM 2.
          SPLIT ls_param_row-param AT space INTO DATA(lv_pv_name) DATA(lv_pv_value).
          IF lv_pv_name IS NOT INITIAL.
            APPEND VALUE zcl_abap_vibe_icf_types=>ty_tran_pv(
              parameter_name  = lv_pv_name
              parameter_value = lv_pv_value ) TO lt_pv.
          ENDIF.
        ENDLOOP.
        es_payload-general_information = VALUE zcl_abap_vibe_icf_types=>ty_tran_general(
          transaction_type      = lv_transaction_type
          parameter_transaction = VALUE zcl_abap_vibe_icf_types=>ty_tran_param(
            par_parent_transaction_code = lv_called_tcode
            skip_initial_screen_mode    = 'skip'
            parameter_values            = lt_pv ) ).
      WHEN 'reportTransaction'.
        es_payload-general_information = VALUE zcl_abap_vibe_icf_types=>ty_tran_general(
          transaction_type   = lv_transaction_type
          report_transaction = VALUE zcl_abap_vibe_icf_types=>ty_tran_report(
            report_name  = ls_tstc-pgmna
            report_dynnr = ls_tstc-dypno ) ).
      WHEN 'ooTransaction'.
        " OO transaction: TSTCP-PARAM carries '\CLASS=...\METHOD=...' segments.
        " abapGit's split_parameters pattern: walk the string, picking out the
        " \CLASS= and \METHOD= tokens; default values for the method also live
        " in TSTCP as additional NAME VALUE pairs.
        DATA(lv_oo_param) = VALUE string( ).
        READ TABLE lt_tstcp INTO ls_param_row INDEX 1.
        IF sy-subrc = 0.
          lv_oo_param = ls_param_row-param.
        ENDIF.
        DATA(lv_oo_class)  = VALUE string( ).
        DATA(lv_oo_method) = VALUE string( ).
        FIND FIRST OCCURRENCE OF REGEX '\\CLASS=([^\\]+)' IN lv_oo_param
          SUBMATCHES lv_oo_class.
        FIND FIRST OCCURRENCE OF REGEX '\\METHOD=([^\\]+)' IN lv_oo_param
          SUBMATCHES lv_oo_method.
        es_payload-general_information = VALUE zcl_abap_vibe_icf_types=>ty_tran_general(
          transaction_type = lv_transaction_type
          oo_transaction   = VALUE zcl_abap_vibe_icf_types=>ty_tran_oo(
            class_name  = lv_oo_class
            method_name = lv_oo_method ) ).
      WHEN 'variantTransaction'.
        " Variant: first TSTCP-PARAM holds '@' + core tcode (abapGit split).
        DATA(lv_variant_param) = VALUE string( ).
        READ TABLE lt_tstcp INTO ls_param_row INDEX 1.
        IF sy-subrc = 0.
          lv_variant_param = ls_param_row-param.
        ENDIF.
        DATA(lv_var_parent) = lv_variant_param.
        DATA(lv_at_pos) = find( val = lv_var_parent sub = '@' ).
        IF lv_at_pos >= 0.
          lv_var_parent = substring( val = lv_var_parent off = lv_at_pos + 1 ).
          DATA(lv_var_space) = find( val = lv_var_parent sub = ` ` ).
          IF lv_var_space >= 0.
            lv_var_parent = substring( val = lv_var_parent len = lv_var_space ).
          ENDIF.
        ENDIF.
        es_payload-general_information = VALUE zcl_abap_vibe_icf_types=>ty_tran_general(
          transaction_type    = lv_transaction_type
          variant_transaction = VALUE zcl_abap_vibe_icf_types=>ty_tran_variant(
            var_parent_transaction_code = lv_var_parent ) ).
    ENDCASE.

    " TSTCC → userInterface.uiAttributes. The official field names are
    " S_WEBGUI / S_WIN32 / S_PLATIN for GUI modes, S_SERVICE for the IAC
    " service name, S_PERVAS for pervasive mode. UI classification is derived
    " from which GUI flags are set: webgui + win32/platin ⇒ professional,
    " webgui only ⇒ easy web.
    DATA ls_tstcc TYPE tstcc.
    SELECT SINGLE * FROM tstcc WHERE tcode = @iv_tcode INTO @ls_tstcc.
    IF sy-subrc = 0.
      DATA(lv_webgui_on) = boolc( ls_tstcc-s_webgui <> ' ' ).
      DATA(lv_win32_on)  = boolc( ls_tstcc-s_win32  <> ' ' ).
      DATA(lv_platin_on) = boolc( ls_tstcc-s_platin <> ' ' ).
      es_payload-user_interface = VALUE zcl_abap_vibe_icf_types=>ty_tran_user_interface(
        ui_attributes = VALUE zcl_abap_vibe_icf_types=>ty_tran_ui(
          ui_classification = COND #(
            WHEN lv_webgui_on = abap_true
              AND ( lv_win32_on = abap_true OR lv_platin_on = abap_true )
              THEN 'professionalUserTransaction'
            WHEN lv_webgui_on = abap_true
              THEN 'easyWebTransaction'
            ELSE 'professionalUserTransaction' )
          iac_service_name  = ls_tstcc-s_service
          pervasive_mode    = COND #( WHEN ls_tstcc-s_pervas = 'D' THEN 'disabled' ELSE 'enabled' )
          webgui_mode       = COND #( WHEN lv_webgui_on = abap_true THEN 'supported' ELSE 'notSupported' )
          platin_mode       = COND #( WHEN lv_platin_on = abap_true THEN 'supported' ELSE 'notSupported' )
          win32_mode        = COND #( WHEN lv_win32_on = abap_true THEN 'supported' ELSE 'notSupported' ) ) ).
    ENDIF.

    " TSTCA → authorizations.startAuthorizationObject + authorizationDefaults.
    " TSTCA stores one row per (tcode, objct, field, value). The first
    " row's OBJCT is the start authorization object name; subsequent rows for
    " the same OBJCT are its field values. Multiple OBJCT groups indicate
    " multiple authorization objects — only the first group is surfaced here;
    " extending this requires TSTCA → USOBX/USOBT cross-references.
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
      es_payload-authorizations = VALUE zcl_abap_vibe_icf_types=>ty_tran_auth(
        start_authorization_object = VALUE zcl_abap_vibe_icf_types=>ty_tran_sao(
          auth_object_name         = ls_first_tstca-objct
          auth_object_field_values = lt_sao_fv )
        authorization_defaults     = VALUE zcl_abap_vibe_icf_types=>ty_tran_ad(
          maintenance_mode        = 'manual'
          default_values_required = 'yes' ) ).
    ENDIF.
  ENDMETHOD.
ENDCLASS.
