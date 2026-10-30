CLASS zcl_abap_vibe_icf_textpool DEFINITION PUBLIC FINAL CREATE PUBLIC.
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
      EXPORTING es_payload  TYPE zcl_abap_vibe_icf_types=>ty_textpool_get
                ev_error    TYPE zcl_abap_vibe_icf_types=>ty_error.
ENDCLASS.

CLASS zcl_abap_vibe_icf_textpool IMPLEMENTATION.
  METHOD dispatch_textpool.
    " Read textpool via RS_TEXTPOOL_READ; write support is target-specific.
    " Routes /textpool/<category>?object=<name>&type=<type>.
    " category: texts|selections|headings; object = program/class name; type = PROG|CLAS|FUGR.
    DATA lv_path        TYPE string.
    DATA lv_category TYPE string.
    DATA lv_object   TYPE string.
    DATA lv_objtype  TYPE string.
    DATA lv_cat      TYPE string.
    DATA lv_obj      TYPE string.
    DATA lv_type     TYPE string.
    lv_path = iv_path.

    FIND REGEX '^/textpool/(texts|selections|headings)' IN lv_path IGNORING CASE
      SUBMATCHES lv_cat.
    IF sy-subrc <> 0 OR lv_cat IS INITIAL.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 404
                     iv_reason = 'Not Found'
                     iv_code = 'NOT_FOUND'
                     iv_msg = |unsupported textpool path: { iv_path }| ).
      RETURN.
    ENDIF.
    lv_category = to_upper( lv_cat ).

    " Query params from the request URL.
    DATA(lv_query) = io_server->request->get_header_field( '~query_string' ).
    IF lv_query IS NOT INITIAL.
      FIND FIRST OCCURRENCE OF REGEX 'object=([^&]+)' IN lv_query IGNORING CASE SUBMATCHES lv_obj.
      IF sy-subrc = 0. lv_object = to_upper( lv_obj ). ENDIF.
      FIND FIRST OCCURRENCE OF REGEX 'type=([^&]+)' IN lv_query IGNORING CASE SUBMATCHES lv_type.
      IF sy-subrc = 0. lv_objtype = to_upper( lv_type ). ENDIF.
    ENDIF.
    IF lv_object IS INITIAL.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code = 'TEXTPOOL_OBJECT_NOT_FOUND'
                     iv_msg = |object query parameter is required| ).
      RETURN.
    ENDIF.

    IF iv_method = 'GET'.
      get_textpool_elements( EXPORTING iv_category = lv_category
                                       iv_object   = lv_object
                                       iv_objtype  = lv_objtype
                             IMPORTING es_payload  = DATA(ls_payload_get)
                                       ev_error    = DATA(ls_error_get) ).
      IF ls_error_get IS NOT INITIAL.
        " get_textpool_elements failures are single-message (not a BAPI table);
        " no details to surface, so iv_details is omitted on purpose.
        zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                       iv_status = 404
                       iv_reason = 'Not Found'
                       iv_code   = ls_error_get-error-code
                       iv_msg    = ls_error_get-error-message ).
      ELSE.
        zcl_abap_vibe_icf_response=>respond_json( io_server = io_server iv_status = 200 iv_reason = 'OK' is_payload = ls_payload_get ).
      ENDIF.
    ELSEIF iv_method = 'POST'.
      " Write is not available through a non-interactive API on this release.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 200
                     iv_reason = 'OK'
                     iv_code   = 'TEXTPOOL_WRITE_UNSUPPORTED'
                     iv_msg    = 'Textpool writing is not available through a non-interactive API on this SAP release' ).
    ELSE.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 405
                     iv_reason = 'Method Not Allowed'
                     iv_code = 'METHOD_NOT_ALLOWED'
                     iv_msg = |{ iv_method } not supported on /textpool/{ lv_category }| ).
    ENDIF.
  ENDMETHOD.
  METHOD get_textpool_elements.
    " RS_TEXTPOOL_READ is the non-interactive textpool reader available on the
    " target release; category selects the returned rows.
    DATA lt_pool TYPE TABLE OF textpool.
    DATA ls_pool TYPE textpool.

    CALL FUNCTION 'RS_TEXTPOOL_READ'
      EXPORTING
        objectname      = CONV rs38m-programm( iv_object )
        action          = 'SHOW'
        authority_check = ' '
        language        = sy-langu
      TABLES
        tpool           = lt_pool
      EXCEPTIONS
        object_not_found  = 1
        permission_failure = 2
        invalid_program_type = 3
        error_occured      = 4
        action_cancelled   = 5
        OTHERS             = 6.
    IF sy-subrc <> 0.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'TEXTPOOL_OBJECT_NOT_FOUND'
                                                              message = |{ iv_object } not found| ) ).
      RETURN.
    ENDIF.

    DATA(lt_elements) = VALUE zcl_abap_vibe_icf_types=>tt_textpool_elem( ).
    LOOP AT lt_pool INTO ls_pool.
      " Category filter: symbols → ID = 'I'; selections → ID = 'S'; headings → ID = 'H'.
      IF iv_category = 'TEXTS' AND ls_pool-id <> 'I'. CONTINUE. ENDIF.
      IF iv_category = 'SELECTIONS' AND ls_pool-id <> 'S'. CONTINUE. ENDIF.
      IF iv_category = 'HEADINGS' AND ls_pool-id <> 'H'. CONTINUE. ENDIF.
      IF zcl_abap_vibe_icf_response=>escape_probe_needed( ) = abap_true.
        " Old /UI2/CL_JSON (vhcala4hci) does not escape — escape text elements.
        APPEND VALUE zcl_abap_vibe_icf_types=>ty_textpool_elem( id   = zcl_abap_vibe_icf_response=>escape_json_string( CONV string( ls_pool-key ) )
                                       text = zcl_abap_vibe_icf_response=>escape_json_string( CONV string( ls_pool-entry ) ) ) TO lt_elements.
      ELSE.
        APPEND VALUE zcl_abap_vibe_icf_types=>ty_textpool_elem( id = CONV string( ls_pool-key ) text = CONV string( ls_pool-entry ) ) TO lt_elements.
      ENDIF.
    ENDLOOP.

    es_payload = VALUE zcl_abap_vibe_icf_types=>ty_textpool_get( status = 'success'
                                        data = VALUE zcl_abap_vibe_icf_types=>ty_textpool_data( object   = iv_object
                                                                       type     = iv_objtype
                                                                       category = iv_category
                                                                       elements = lt_elements ) ).
  ENDMETHOD.
ENDCLASS.
