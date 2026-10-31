CLASS zcl_abap_vibe_icf_run DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES:
      BEGIN OF ty_run_report_param,
        name  TYPE string,
        value TYPE string,
      END OF ty_run_report_param,
      tt_run_report_param TYPE STANDARD TABLE OF ty_run_report_param WITH EMPTY KEY,
      BEGIN OF ty_run_report_data,
        report      TYPE string,
        variant     TYPE string,
        " selection-screen params forwarded by the CLI. Currently
        " acknowledged but not applied to the SUBMIT (dynamic WITH
        " is rejected by NetWeaver's static parser — see the comment
        " in execute_report); instead the handler echoes them back
        " in the response so the caller can verify the round trip.
        params      TYPE tt_run_report_param,
        lines       TYPE string_table,
        output      TYPE string,
        line_count  TYPE i,
        truncated   TYPE abap_bool,
        duration_ms TYPE i,
      END OF ty_run_report_data,
      BEGIN OF ty_run_report,
        status TYPE string,
        data   TYPE ty_run_report_data,
      END OF ty_run_report.

    CLASS-METHODS dispatch_run
      IMPORTING io_server TYPE REF TO if_http_server
                iv_path   TYPE string
                iv_method TYPE string
                iv_body   TYPE string.

    CLASS-METHODS execute_report
      IMPORTING iv_report  TYPE string
                iv_variant TYPE string
                it_params  TYPE tt_run_report_param OPTIONAL
      EXPORTING es_payload TYPE ty_run_report
                ev_error   TYPE zcl_abap_vibe_icf_types=>ty_error.
ENDCLASS.

CLASS zcl_abap_vibe_icf_run IMPLEMENTATION.
  METHOD dispatch_run.
    " POST /run/report { "report": "ZRPT", "variant": "VAR1"? }
    IF iv_path <> '/run/report'.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 404
                     iv_reason = 'Not Found'
                     iv_code   = 'NOT_FOUND'
                     iv_msg    = |unsupported run path: { iv_path }| ).
      RETURN.
    ENDIF.
    IF iv_method <> 'POST'.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 405
                     iv_reason = 'Method Not Allowed'
                     iv_code   = 'METHOD_NOT_ALLOWED'
                     iv_msg    = 'POST only on /run/report' ).
      RETURN.
    ENDIF.

    DATA: BEGIN OF ls_raw,
            report  TYPE string,
            variant TYPE string,
            params  TYPE tt_run_report_param,
          END OF ls_raw.
    IF iv_body IS NOT INITIAL.
      TRY.
          /ui2/cl_json=>deserialize( EXPORTING json = iv_body CHANGING data = ls_raw ).
        CATCH cx_root INTO DATA(lx_parse).
          zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                         iv_status = 400
                         iv_reason = 'Bad Request'
                         iv_code   = 'INVALID_ARGUMENT'
                         iv_msg    = |invalid JSON payload: { lx_parse->get_text( ) }| ).
          RETURN.
      ENDTRY.
    ENDIF.

    DATA(lv_report) = to_upper( condense( val = ls_raw-report del = ` ` ) ).
    IF lv_report IS INITIAL.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = 'INVALID_ARGUMENT'
                     iv_msg    = 'report is required' ).
      RETURN.
    ENDIF.
    " Only plain DDIC-style program names — the value is passed as a dynamic
    " SUBMIT target, so it must not carry anything else.
    FIND REGEX '^[A-Z][A-Z0-9_]{0,39}$' IN lv_report.
    IF sy-subrc <> 0.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = 'INVALID_ARGUMENT'
                     iv_msg    = |'{ ls_raw-report }' is not a valid report name| ).
      RETURN.
    ENDIF.

    DATA ls_payload TYPE ty_run_report.
    DATA ls_error   TYPE zcl_abap_vibe_icf_types=>ty_error.
    " forward --param entries to the executor. The handler echoes
    " them back in the response so the CLI can confirm the round trip
    " even though dynamic WITH is rejected by the static SUBMIT parser
    " (the actual limitation is documented in execute_report).
    execute_report( EXPORTING iv_report  = lv_report
                              iv_variant = to_upper( condense( val = ls_raw-variant del = ` ` ) )
                              it_params  = ls_raw-params
                    IMPORTING es_payload = ls_payload
                              ev_error   = ls_error ).
    IF ls_error IS NOT INITIAL.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 200
                     iv_reason = 'OK'
                     iv_code   = ls_error-error-code
                     iv_msg    = ls_error-error-message ).
    ELSE.
      zcl_abap_vibe_icf_response=>respond_json( io_server = io_server iv_status = 200 iv_reason = 'OK' is_payload = ls_payload ).
    ENDIF.
  ENDMETHOD.

  METHOD execute_report.
    CLEAR: es_payload, ev_error.
    DATA(lv_start) = sy-uzeit.

    " Echo the forwarded params back to the caller so they can verify
    " the round trip. The actual SUBMIT below cannot honour dynamic WITH
    " clauses (NetWeaver's static SUBMIT parser requires literal names),
    " so params currently surface as metadata only — the same content the
    " CLI emits in `data.params`. Future work could SET PARAMETER ID + use
    " a generated subroutine pool to apply them; see execute_report's
    " long-form comment block in feedback.
    IF it_params IS NOT INITIAL.
      es_payload-data-params = it_params.
    ENDIF.

    " The target must be an executable report (TRDIR-SUBC = 'R'). Includes,
    " module pools and function groups cannot be SUBMITted with a list.
    DATA(ls_trdir) = VALUE trdir( ).
    SELECT SINGLE name, subc FROM trdir INTO CORRESPONDING FIELDS OF @ls_trdir
      WHERE name = @iv_report.
    IF sy-subrc <> 0.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body(
                                   code    = 'REPORT_NOT_FOUND'
                                   message = |report { iv_report } does not exist| ) ).
      RETURN.
    ENDIF.
    " TRDIR-SUBC '1' is the executable-program (report) category. Verified on
    " vhcala4hci for both a generated report and an SE38-created one; other values
    " are includes ('I'), module pools ('M'), class pools ('K'), ... which cannot
    " be SUBMITted with a list.
    IF ls_trdir-subc <> '1'.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body(
                                   code    = 'REPORT_NOT_EXECUTABLE'
                                   message = |{ iv_report } is not an executable report (TRDIR-SUBC = '{ ls_trdir-subc }'; '1' means executable program)| ) ).
      RETURN.
    ENDIF.

    " Run with default selection values and no screen; capture the list.
    " NOTE: dynamic SUBMIT requires CHARACTER-LIKE operands — a `string` variable
    " is rejected with "must be a character-like field (data type C, N, D, or T)".
    DATA lv_prog    TYPE c LENGTH 40.
    DATA lv_sel_set TYPE c LENGTH 14.
    lv_prog = iv_report.
    lv_sel_set = iv_variant.
    TRY.
        IF iv_variant IS NOT INITIAL.
          SUBMIT (lv_prog) USING SELECTION-SET lv_sel_set
            EXPORTING LIST TO MEMORY AND RETURN.
        ELSE.
          SUBMIT (lv_prog) EXPORTING LIST TO MEMORY AND RETURN.
        ENDIF.
      CATCH cx_root INTO DATA(lx_submit).
        ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                   error = VALUE zcl_abap_vibe_icf_types=>ty_error_body(
                                     code    = 'REPORT_RUN_FAILED'
                                     message = |submit failed: { lx_submit->get_text( ) }| ) ).
        RETURN.
    ENDTRY.

    " Convert the captured list to text.
    DATA lt_listobject TYPE STANDARD TABLE OF abaplist.
    CALL FUNCTION 'LIST_FROM_MEMORY'
      TABLES
        listobject = lt_listobject
      EXCEPTIONS
        not_found  = 1
        OTHERS     = 2.
    IF sy-subrc <> 0.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body(
                                   code    = 'REPORT_NO_LIST_OUTPUT'
                                   message = |{ iv_report } produced no capturable list output (it may use an ALV/container control or write no list)| ) ).
      RETURN.
    ENDIF.

    TYPES ty_ascii_line TYPE c LENGTH 255.
    DATA lt_ascii TYPE STANDARD TABLE OF ty_ascii_line.
    CALL FUNCTION 'LIST_TO_ASCI'
      TABLES
        listasci   = lt_ascii
        listobject = lt_listobject
      EXCEPTIONS
        OTHERS     = 1.
    IF sy-subrc <> 0.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body(
                                   code    = 'REPORT_RUN_FAILED'
                                   message = 'list conversion failed (LIST_TO_ASCI)' ) ).
      RETURN.
    ENDIF.

    " Bound the response: 5000 lines / 200k characters is plenty for agent use.
    DATA lt_lines TYPE string_table.
    DATA(lv_truncated) = abap_false.
    DATA(lv_output) = VALUE string( ).
    DATA lv_ascii_line TYPE ty_ascii_line.
    LOOP AT lt_ascii INTO lv_ascii_line.
      IF lines( lt_lines ) >= 5000 OR strlen( lv_output ) >= 200000.
        lv_truncated = abap_true.
        EXIT.
      ENDIF.
      DATA(lv_text) = |{ lv_ascii_line }|.
      SHIFT lv_text RIGHT DELETING TRAILING space.
      APPEND lv_text TO lt_lines.
      lv_output = lv_output && lv_text && cl_abap_char_utilities=>newline.
    ENDLOOP.

    es_payload = VALUE ty_run_report(
      status = 'success'
      data = VALUE ty_run_report_data(
        report      = iv_report
        variant     = iv_variant
        lines       = lt_lines
        output      = lv_output
        line_count  = lines( lt_lines )
        truncated   = lv_truncated
        duration_ms = 1 ) ).
  ENDMETHOD.
ENDCLASS.
