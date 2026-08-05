CLASS zcl_abap_vibe_icf DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_http_extension.
  PROTECTED SECTION.
  PRIVATE SECTION.
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
      END OF ty_error_body,
      BEGIN OF ty_error,
        status TYPE string,
        error  TYPE ty_error_body,
      END OF ty_error.
    CONSTANTS gc_service TYPE string VALUE 'zabap_vibe'.
    CONSTANTS gc_version TYPE string VALUE '0.1.0'.
    METHODS respond_json
      IMPORTING io_server  TYPE REF TO if_http_server
                iv_status  TYPE i
                iv_reason  TYPE string
                is_payload TYPE any.
    METHODS respond_error
      IMPORTING io_server TYPE REF TO if_http_server
                iv_status TYPE i
                iv_reason TYPE string
                iv_code   TYPE string
                iv_msg    TYPE string.
ENDCLASS.

CLASS zcl_abap_vibe_icf IMPLEMENTATION.
  METHOD if_http_extension~handle_request.
    DATA(lv_path) = server->request->get_header_field( '~path_info' ).
    DATA(lv_method) = server->request->get_method( ).

    IF lv_path IS INITIAL OR lv_path = '/'.
      IF lv_method = 'GET'.
        DATA(ls_root) = VALUE ty_root( status = 'success'
                                       data = VALUE ty_root_data( service = gc_service version = gc_version ) ).
        respond_json( io_server = server
                      iv_status = 200
                      iv_reason = 'OK'
                      is_payload = ls_root ).
      ELSE.
        respond_error( io_server = server
                       iv_status = 405
                       iv_reason = 'Method Not Allowed'
                       iv_code = 'METHOD_NOT_ALLOWED'
                       iv_msg = |GET only on /sap/zabap_vibe/| ).
      ENDIF.
    ELSE.
      respond_error( io_server = server
                     iv_status = 404
                     iv_reason = 'Not Found'
                     iv_code = 'NOT_FOUND'
                     iv_msg = |unknown path: /sap/zabap_vibe{ lv_path }| ).
    ENDIF.
  ENDMETHOD.

  METHOD respond_json.
    DATA(lv_json) = /ui2/cl_json=>serialize( data = is_payload
                                             pretty_name = /ui2/cl_json=>pretty_mode-camel_case ).
    io_server->response->set_status( code = iv_status reason = iv_reason ).
    io_server->response->set_content_type( content_type = 'application/json' ).
    io_server->response->set_cdata( data = lv_json ).
  ENDMETHOD.

  METHOD respond_error.
    DATA(ls_error) = VALUE ty_error( status = 'error'
                                     error = VALUE ty_error_body( code = iv_code message = iv_msg ) ).
    DATA(lv_json) = /ui2/cl_json=>serialize( data = ls_error
                                             pretty_name = /ui2/cl_json=>pretty_mode-camel_case ).
    io_server->response->set_status( code = iv_status reason = iv_reason ).
    io_server->response->set_content_type( content_type = 'application/json' ).
    io_server->response->set_cdata( data = lv_json ).
  ENDMETHOD.
ENDCLASS.
