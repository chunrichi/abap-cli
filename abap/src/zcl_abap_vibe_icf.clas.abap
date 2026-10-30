CLASS zcl_abap_vibe_icf DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_http_extension.
  PRIVATE SECTION.
ENDCLASS.

CLASS zcl_abap_vibe_icf IMPLEMENTATION.
  METHOD if_http_extension~handle_request.
    DATA(lv_path) = server->request->get_header_field( '~path_info' ).
    DATA(lv_method) = server->request->get_method( ).
    DATA(lv_body) = server->request->get_cdata( ).

    IF lv_path IS INITIAL OR lv_path = '/'.
      zcl_abap_vibe_icf_response=>handle_root( io_server = server iv_method = lv_method ).
    ELSEIF lv_path CP '/ddic/*'.
      zcl_abap_vibe_icf_ddic=>dispatch_ddic( io_server = server iv_path = lv_path iv_method = lv_method iv_body = lv_body ).
    ELSEIF lv_path CP '/textpool/*'.
      zcl_abap_vibe_icf_textpool=>dispatch_textpool( io_server = server iv_path = lv_path iv_method = lv_method ).
    ELSEIF lv_path CP '/http/*'.
      zcl_abap_vibe_icf_http=>dispatch_http( io_server = server iv_path = lv_path iv_method = lv_method iv_body = lv_body ).
    ELSEIF lv_path CP '/tcode/*'.
      zcl_abap_vibe_icf_tcode=>dispatch_tcode( io_server = server iv_path = lv_path iv_method = lv_method ).
    ELSEIF lv_path CP '/tran/*'.
      zcl_abap_vibe_icf_tcode=>dispatch_tran( io_server = server iv_path = lv_path iv_method = lv_method iv_body = lv_body ).
    ELSEIF lv_path CP '/data/*'.
      " Read-only table data query (SE16N equivalent).
      TRY.
          zcl_abap_vibe_icf_data=>dispatch_data( io_server = server iv_path = lv_path iv_method = lv_method iv_body = lv_body ).
        CATCH cx_root INTO DATA(lx_top_dispatch).
          " Convert any runtime exception in /data/* handlers into a structured
          " QUERY_FAILED response (instead of leaking 500 HTML).
          zcl_abap_vibe_icf_response=>respond_error( io_server = server
                                       iv_status = 500
                                       iv_reason = 'Internal Server Error'
                                       iv_code   = 'QUERY_FAILED'
                                       iv_msg    = |dispatch_data runtime error: { lx_top_dispatch->get_text( ) }| ).
      ENDTRY.
    ELSEIF lv_path CP '/run/*'.
      " F-16: execute an activated REPORT and capture its list output.
      TRY.
          zcl_abap_vibe_icf_run=>dispatch_run( io_server = server iv_path = lv_path iv_method = lv_method iv_body = lv_body ).
        CATCH cx_root INTO DATA(lx_run_dispatch).
          zcl_abap_vibe_icf_response=>respond_error( io_server = server
                                       iv_status = 500
                                       iv_reason = 'Internal Server Error'
                                       iv_code   = 'REPORT_RUN_FAILED'
                                       iv_msg    = |dispatch_run runtime error: { lx_run_dispatch->get_text( ) }| ).
      ENDTRY.
    ELSEIF lv_path CP '/mime/*'.
      zcl_abap_vibe_icf_mime=>dispatch_mime( io_server = server iv_path = lv_path iv_method = lv_method iv_body = lv_body ).
    ELSEIF lv_path CP '/version-source*'.
      zcl_abap_vibe_icf_version=>dispatch_version_management( io_server = server iv_path = lv_path iv_method = lv_method ).
    ELSEIF lv_path CP '/_class-check*'.
      zcl_abap_vibe_icf_response=>handle_class_check( io_server = server ).
    ELSE.
      zcl_abap_vibe_icf_response=>respond_error( io_server = server
                                   iv_status = 404
                                   iv_reason = 'Not Found'
                                   iv_code = 'NOT_FOUND'
                                   iv_msg = |unknown path: /sap/abap_cli{ lv_path }| ).
    ENDIF.
  ENDMETHOD.
ENDCLASS.
