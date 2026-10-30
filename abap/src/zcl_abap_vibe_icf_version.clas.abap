CLASS zcl_abap_vibe_icf_version DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS dispatch_version_management
      IMPORTING io_server TYPE REF TO if_http_server
                iv_path   TYPE string
                iv_method TYPE string.
ENDCLASS.

CLASS zcl_abap_vibe_icf_version IMPLEMENTATION.
  METHOD dispatch_version_management.
    IF iv_method <> 'GET'.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 405
                     iv_reason = 'Method Not Allowed'
                     iv_code = 'METHOD_NOT_ALLOWED'
                     iv_msg = |GET only on Version Management endpoints| ).
      RETURN.
    ENDIF.

    DATA(lv_query) = io_server->request->get_header_field( '~query_string' ).
    DATA(lv_objtype) = to_upper( zcl_abap_vibe_icf_response=>query_param( iv_query = lv_query iv_name = 'objectType' ) ).
    DATA(lv_objname) = to_upper( zcl_abap_vibe_icf_response=>query_param( iv_query = lv_query iv_name = 'objectName' ) ).
    DATA(lv_destination) = to_upper( zcl_abap_vibe_icf_response=>query_param( iv_query = lv_query iv_name = 'destination' ) ).

    IF lv_objtype IS INITIAL OR lv_objname IS INITIAL OR lv_destination IS INITIAL.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code = 'VERSION_PARAMETER_REQUIRED'
                     iv_msg = |objectType, objectName and destination query parameters are required| ).
      RETURN.
    ENDIF.

    IF lv_objtype <> 'REPS' AND lv_objtype <> 'REPO' AND lv_objtype <> 'TYPD'
        AND lv_objtype <> 'FUNC' AND lv_objtype <> 'CNTX' AND lv_objtype <> 'CINC'
        AND lv_objtype <> 'METH' AND lv_objtype <> 'CLSD' AND lv_objtype <> 'CPUB'
        AND lv_objtype <> 'CPRI' AND lv_objtype <> 'CPRO' AND lv_objtype <> 'INTF'
        AND lv_objtype <> 'XSLT'.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code = 'VERSION_TYPE_NOT_SUPPORTED'
                     iv_msg = |unsupported Version Management object type: { lv_objtype }| ).
      RETURN.
    ENDIF.

    IF strlen( lv_destination ) > 60
        OR lv_destination CN 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@._-'.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code = 'VERSION_DESTINATION_INVALID'
                     iv_msg = |invalid RFC destination format| ).
      RETURN.
    ENDIF.

    lv_destination = |TMSADM@{ lv_destination }.DOMAIN_{ lv_destination }|.

    IF iv_path CP '/version-source*'.
      " Step 1: Check if any versions exist on the remote system
      DATA lt_versions TYPE tt_vrs_disp.
      TRY.
          CALL FUNCTION 'SVRS_GET_VERSIONS'
            EXPORTING
              iv_objtype = CONV vrsd-objtype( lv_objtype )
              iv_objname = CONV vrsd-objname( lv_objname )
              iv_rfcdest = CONV rfcdest( lv_destination )
            IMPORTING
              et_vrs_disp = lt_versions.
        CATCH cx_root INTO DATA(lx_versions).
          zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                         iv_status = 502
                         iv_reason = 'Bad Gateway'
                         iv_code = 'REMOTE_VERSIONS_FAILED'
                         iv_msg = lx_versions->get_text( ) ).
          RETURN.
      ENDTRY.

      " No versions — object has not been transported to production
      IF lt_versions IS INITIAL.
        DATA(ls_empty_source) = VALUE zcl_abap_vibe_icf_types=>ty_remote_source(
          status = 'success'
          data = VALUE #( objectType = lv_objtype
                          objectName = lv_objname
                          version = '00000'
                          source = '' ) ).
        zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                      iv_status = 200
                      iv_reason = 'OK'
                      is_payload = ls_empty_source ).
        RETURN.
      ENDIF.

      " Step 2: Versions exist — fetch source code for versno 00000 (active version)
      DATA lt_repos TYPE STANDARD TABLE OF abaptxt255 WITH EMPTY KEY.
      DATA lt_trdir TYPE STANDARD TABLE OF trdir WITH EMPTY KEY.
      CALL FUNCTION 'SVRS_GET_REPS_FROM_OBJECT'
        EXPORTING
          object_name = CONV vrsd-objname( lv_objname )
          object_type = CONV vrsd-objtype( lv_objtype )
          versno      = '00000'
          destination = CONV rfcdest( lv_destination )
        TABLES
          repos_tab   = lt_repos
          trdir_tab   = lt_trdir
        EXCEPTIONS
          no_version  = 1
          OTHERS      = 2.
      IF sy-subrc <> 0.
        zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                       iv_status = 404
                       iv_reason = 'Not Found'
                       iv_code = 'REMOTE_VERSION_NOT_FOUND'
                       iv_msg = |active version (00000) could not be read for { lv_objname }| ).
        RETURN.
      ENDIF.

      DATA lv_source TYPE string.
      LOOP AT lt_repos INTO DATA(lv_line).
        IF lv_source IS INITIAL.
          lv_source = CONV string( lv_line ).
        ELSE.
          lv_source = lv_source && cl_abap_char_utilities=>newline && CONV string( lv_line ).
        ENDIF.
      ENDLOOP.

      DATA(ls_source) = VALUE zcl_abap_vibe_icf_types=>ty_remote_source(
        status = 'success'
        data = VALUE #( objectType = lv_objtype
                        objectName = lv_objname
                        version = '00000'
                        source = lv_source ) ).
      zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                    iv_status = 200
                    iv_reason = 'OK'
                    is_payload = ls_source ).
      RETURN.
    ENDIF.

    zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                   iv_status = 404
                   iv_reason = 'Not Found'
                   iv_code = 'NOT_FOUND'
                   iv_msg = |unknown Version Management path: { iv_path }| ).
  ENDMETHOD.
ENDCLASS.
