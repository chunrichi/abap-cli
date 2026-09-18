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
      lcl_response=>handle_root( io_server = server iv_method = lv_method ).
    ELSEIF lv_path CP '/ddic/*'.
      lcl_ddic=>dispatch_ddic( io_server = server iv_path = lv_path iv_method = lv_method iv_body = lv_body ).
    ELSEIF lv_path CP '/textpool/*'.
      lcl_textpool=>dispatch_textpool( io_server = server iv_path = lv_path iv_method = lv_method ).
    ELSEIF lv_path CP '/http/*'.
      lcl_http=>dispatch_http( io_server = server iv_path = lv_path iv_method = lv_method iv_body = lv_body ).
    ELSEIF lv_path CP '/tcode/*'.
      lcl_tcode=>dispatch_tcode( io_server = server iv_path = lv_path iv_method = lv_method ).
    ELSEIF lv_path CP '/tran/*'.
      lcl_tcode=>dispatch_tran( io_server = server iv_path = lv_path iv_method = lv_method iv_body = lv_body ).
    ELSEIF lv_path CP '/data/*'.
      " Read-only table data query (SE16N equivalent).
      TRY.
          lcl_data=>dispatch_data( io_server = server iv_path = lv_path iv_method = lv_method iv_body = lv_body ).
        CATCH cx_root INTO DATA(lx_top_dispatch).
          " Convert any runtime exception in /data/* handlers into a structured
          " QUERY_FAILED response (instead of leaking 500 HTML).
          lcl_response=>respond_error( io_server = server
                                       iv_status = 500
                                       iv_reason = 'Internal Server Error'
                                       iv_code   = 'QUERY_FAILED'
                                       iv_msg    = |dispatch_data runtime error: { lx_top_dispatch->get_text( ) }| ).
      ENDTRY.
    ELSEIF lv_path CP '/mime/*'.
      lcl_mime=>dispatch_mime( io_server = server iv_path = lv_path iv_method = lv_method iv_body = lv_body ).
    ELSEIF lv_path CP '/version-source*'.
      lcl_version=>dispatch_version_management( io_server = server iv_path = lv_path iv_method = lv_method ).
    ELSEIF lv_path CP '/_class-check*'.
      lcl_response=>handle_class_check( io_server = server ).
    ELSE.
      lcl_response=>respond_error( io_server = server
                                   iv_status = 404
                                   iv_reason = 'Not Found'
                                   iv_code = 'NOT_FOUND'
                                   iv_msg = |unknown path: /sap/abap_cli{ lv_path }| ).
    ENDIF.
  ENDMETHOD.
ENDCLASS.
