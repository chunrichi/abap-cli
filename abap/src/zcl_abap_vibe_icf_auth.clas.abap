CLASS zcl_abap_vibe_icf_auth DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    " AUTHX-FIELDNAME is CHAR 30.
    CONSTANTS gc_name_max_length TYPE i VALUE 30.

    CLASS-METHODS dispatch
      IMPORTING io_server TYPE REF TO if_http_server
                iv_path   TYPE string
                iv_method TYPE string
                iv_body   TYPE string.

  PRIVATE SECTION.
    " ----- authorization field document (local <token>.auth.json / GET data) -----
    TYPES:
      BEGIN OF ty_general_information,
        data_element     TYPE string,
        search_help_exit TYPE string,
        activity_field   TYPE abap_bool,
      END OF ty_general_information,
      BEGIN OF ty_alternative_search_help,
        check_table TYPE string,
      END OF ty_alternative_search_help,
      BEGIN OF ty_document,
        format_version          TYPE string,
        general_information     TYPE ty_general_information,
        alternative_search_help TYPE ty_alternative_search_help,
      END OF ty_document,
      BEGIN OF ty_document_data,
        format_version          TYPE string,
        general_information     TYPE ty_general_information,
        alternative_search_help TYPE ty_alternative_search_help,
        name                    TYPE string,
        package                 TYPE devclass,
      END OF ty_document_data,
      BEGIN OF ty_get_response,
        status TYPE string,
        data   TYPE ty_document_data,
      END OF ty_get_response.

    " ----- /auth/auth/<name> read -----
    CLASS-METHODS read_auth
      IMPORTING iv_name       TYPE string
      EXPORTING es_payload    TYPE ty_document_data
                ev_error_code TYPE string
                ev_error_msg  TYPE string.

    " ----- /auth/auth/<name> write (POST create, PUT update) -----
    CLASS-METHODS write_auth
      IMPORTING io_server TYPE REF TO if_http_server
                iv_name   TYPE string
                iv_method TYPE string
                iv_body   TYPE string.

    " ----- /auth/auth/<name> delete -----
    CLASS-METHODS delete_auth
      IMPORTING io_server TYPE REF TO if_http_server
                iv_name   TYPE string
                iv_query  TYPE string.

    " ----- helpers -----
    CLASS-METHODS name_valid
      IMPORTING iv_name      TYPE string
      RETURNING VALUE(rv_ok) TYPE abap_bool.
    CLASS-METHODS ddic_name_valid
      IMPORTING iv_name      TYPE string
      RETURNING VALUE(rv_ok) TYPE abap_bool.
    CLASS-METHODS auth_exists
      IMPORTING iv_name        TYPE string
      RETURNING VALUE(rv_exists) TYPE abap_bool.
    CLASS-METHODS validate_document
      EXPORTING ev_code TYPE string
                ev_msg  TYPE string
      CHANGING  cs_doc  TYPE ty_document.
    CLASS-METHODS respond_invalid
      IMPORTING io_server TYPE REF TO if_http_server
                iv_code   TYPE string
                iv_msg    TYPE string.
ENDCLASS.

CLASS zcl_abap_vibe_icf_auth IMPLEMENTATION.
  METHOD dispatch.
    " Route /auth/auth/<name>: one AUTHX maintenance row plus its TADIR entry.
    " The ICF service is the only channel (AUTH has no ADT resource); TADIR and
    " transport handling use the shared RS_CORR_INSERT path because the abapGit
    " helper CL_AUTH_TOOLS->ADD_AFIELD_TO_TRKORR opens a dialog and aborts in a
    " background handler.
    DATA lv_match_name TYPE string.

    FIND REGEX '^/auth/auth/(.+)$' IN iv_path IGNORING CASE SUBMATCHES lv_match_name.
    IF sy-subrc <> 0 OR lv_match_name IS INITIAL.
      respond_invalid( io_server = io_server
                       iv_code   = 'AUTH_NAME_INVALID'
                       iv_msg    = 'authorization field name is required' ).
      RETURN.
    ENDIF.

    DATA(lv_name) = to_upper( condense( val = cl_http_utility=>unescape_url( lv_match_name ) del = ` ` ) ).
    IF name_valid( lv_name ) = abap_false.
      respond_invalid( io_server = io_server
                       iv_code   = 'AUTH_NAME_INVALID'
                       iv_msg    = |authorization field name must be 1-{ gc_name_max_length } characters A-Z, 0-9, _ or / without whitespace (got '{ lv_name }')| ).
      RETURN.
    ENDIF.

    CASE iv_method.
      WHEN 'GET'.
        DATA ls_payload TYPE ty_document_data.
        read_auth( EXPORTING iv_name       = lv_name
                   IMPORTING es_payload    = ls_payload
                             ev_error_code = DATA(lv_error_code)
                             ev_error_msg  = DATA(lv_error_msg) ).
        IF lv_error_code IS NOT INITIAL.
          zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                           iv_status = COND i( WHEN lv_error_code = 'AUTH_NOT_FOUND' THEN 404 ELSE 500 )
                           iv_code   = lv_error_code
                           iv_msg    = lv_error_msg ).
          RETURN.
        ENDIF.
        zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                      iv_status  = 200
                      iv_reason  = 'OK'
                      is_payload = VALUE ty_get_response( status = 'success'
                                                          data   = ls_payload ) ).
      WHEN 'POST' OR 'PUT'.
        write_auth( io_server = io_server
                    iv_name   = lv_name
                    iv_method = iv_method
                    iv_body   = iv_body ).
      WHEN 'DELETE'.
        delete_auth( io_server = io_server
                     iv_name   = lv_name
                     iv_query  = io_server->request->get_header_field( '~query_string' ) ).
      WHEN OTHERS.
        zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                       iv_status = 405
                       iv_code   = 'METHOD_NOT_ALLOWED'
                       iv_msg    = |{ iv_method } not supported on /auth/auth/<name>| ).
    ENDCASE.
  ENDMETHOD.

  METHOD read_auth.
    " Read one AUTHX row; the package is read-side metadata (62 of the 4023
    " reference rows have no TADIR entry, so it may stay empty).
    DATA ls_authx TYPE authx.

    CLEAR: es_payload, ev_error_code, ev_error_msg.

    SELECT SINGLE * FROM authx INTO @ls_authx WHERE fieldname = @iv_name.
    IF sy-subrc <> 0.
      ev_error_code = 'AUTH_NOT_FOUND'.
      ev_error_msg = |authorization field { iv_name } does not exist|.
      RETURN.
    ENDIF.

    es_payload-format_version = '1'.
    es_payload-general_information-data_element = ls_authx-rollname.
    es_payload-general_information-search_help_exit = ls_authx-exit_fb.
    IF ls_authx-actvt_flag = 'X'.
      es_payload-general_information-activity_field = abap_true.
    ENDIF.
    es_payload-alternative_search_help-check_table = ls_authx-checktable.
    es_payload-name = iv_name.
    es_payload-package = zcl_abap_vibe_icf_auth_common=>package_of( iv_tadir_object = 'AUTH'
                                                                    iv_name         = iv_name ).
  ENDMETHOD.

  METHOD write_auth.
    " POST creates, PUT updates an existing row. Both record the TADIR entry and
    " the transport request first (shared corr_insert), then write AUTHX.
    DATA: lv_query     TYPE string,
          lv_package   TYPE devclass,
          lv_transport TYPE trkorr,
          lv_author    TYPE sy-uname,
          lv_http_code TYPE i,
          lv_code      TYPE string,
          lv_msg       TYPE string,
          lv_verb      TYPE string,
          ls_doc       TYPE ty_document,
          ls_authx     TYPE authx.

    lv_query = io_server->request->get_header_field( '~query_string' ).
    lv_package = zcl_abap_vibe_icf_auth_common=>query_package( lv_query ).
    lv_transport = zcl_abap_vibe_icf_auth_common=>query_transport( lv_query ).

    TRY.
        /ui2/cl_json=>deserialize( EXPORTING json        = iv_body
                                             pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                                   CHANGING  data        = ls_doc ).
      CATCH cx_root.
        respond_invalid( io_server = io_server
                         iv_code   = 'AUTH_INVALID_PAYLOAD'
                         iv_msg    = 'request body is not a valid authorization field document (JSON object)' ).
        RETURN.
    ENDTRY.
    validate_document( IMPORTING ev_code = lv_code
                                 ev_msg  = lv_msg
                       CHANGING  cs_doc  = ls_doc ).
    IF lv_code IS NOT INITIAL.
      respond_invalid( io_server = io_server
                       iv_code   = lv_code
                       iv_msg    = lv_msg ).
      RETURN.
    ENDIF.

    IF iv_method = 'POST'.
      lv_verb = 'create'.
      IF lv_package IS INITIAL.
        respond_invalid( io_server = io_server
                         iv_code   = 'AUTH_INVALID_PAYLOAD'
                         iv_msg    = 'package query parameter is required to create an authorization field' ).
        RETURN.
      ENDIF.
      IF auth_exists( iv_name ) = abap_true.
        zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                       iv_status = 409
                       iv_code   = 'AUTH_ALREADY_EXISTS'
                       iv_msg    = |authorization field { iv_name } already exists; update it instead| ).
        RETURN.
      ENDIF.
      " A stale TADIR row without an AUTHX row (interrupted delete) would block
      " RS_CORR_INSERT with a lock conflict; clear it before recording.
      IF zcl_abap_vibe_icf_auth_common=>package_of( iv_tadir_object = 'AUTH'
                                                    iv_name         = iv_name ) IS NOT INITIAL.
        zcl_abap_vibe_icf_auth_common=>tadir_delete( iv_tadir_object = 'AUTH'
                                                     iv_name         = iv_name
                                                     iv_package      = lv_package
                                                     iv_transport    = lv_transport ).
      ENDIF.
    ELSE.
      lv_verb = 'update'.
      IF auth_exists( iv_name ) = abap_false.
        zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                       iv_status = 404
                       iv_code   = 'AUTH_NOT_FOUND'
                       iv_msg    = |authorization field { iv_name } does not exist; create it first| ).
        RETURN.
      ENDIF.
      IF lv_package IS INITIAL.
        lv_package = zcl_abap_vibe_icf_auth_common=>package_of( iv_tadir_object = 'AUTH'
                                                                iv_name         = iv_name ).
      ENDIF.
    ENDIF.

    zcl_abap_vibe_icf_auth_common=>transport_rule( EXPORTING iv_package   = lv_package
                                                             iv_transport = lv_transport
                                                             iv_verb      = lv_verb
                                                             iv_prefix    = 'AUTH'
                                                   IMPORTING ev_code      = lv_code
                                                             ev_msg       = lv_msg ).
    IF lv_code IS NOT INITIAL.
      respond_invalid( io_server = io_server
                       iv_code   = lv_code
                       iv_msg    = lv_msg ).
      RETURN.
    ENDIF.

    zcl_abap_vibe_icf_auth_common=>corr_insert( EXPORTING iv_tadir_object = 'AUTH'
                                                          iv_name         = iv_name
                                                          iv_package      = lv_package
                                                          iv_transport    = lv_transport
                                                          iv_mode         = 'I'
                                                          iv_prefix       = 'AUTH'
                                                IMPORTING ev_author       = lv_author
                                                          ev_http_code    = lv_http_code
                                                          ev_code         = lv_code
                                                          ev_msg          = lv_msg ).
    IF lv_code IS NOT INITIAL.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                                                     iv_status = lv_http_code
                                                     iv_code   = lv_code
                                                     iv_msg    = lv_msg ).
      RETURN.
    ENDIF.

    ls_authx-fieldname = iv_name.
    ls_authx-rollname = ls_doc-general_information-data_element.
    ls_authx-checktable = ls_doc-alternative_search_help-check_table.
    ls_authx-exit_fb = ls_doc-general_information-search_help_exit.
    IF ls_doc-general_information-activity_field = abap_true.
      ls_authx-actvt_flag = 'X'.
    ENDIF.
    MODIFY authx FROM ls_authx.
    IF sy-subrc <> 0.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                       iv_status = 500
                       iv_code   = 'AUTH_WRITE_FAILED'
                       iv_msg    = |authorization field { iv_name } was not saved (AUTHX sy-subrc { sy-subrc })| ).
      RETURN.
    ENDIF.
    COMMIT WORK.

    " Refresh the auth-field buffer so the runtime sees the new definition
    " immediately (the same step the abapGit AUTH handler performs).
    TRY.
        DATA lo_auth TYPE REF TO cl_auth_tools.
        DATA lv_fieldname TYPE authx-fieldname.
        lv_fieldname = iv_name.
        CREATE OBJECT lo_auth.
        lo_auth->set_authfld_info_from_db( lv_fieldname ).
      CATCH cx_root INTO DATA(lx_refresh).
        zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                       iv_status = 500
                       iv_code   = 'AUTH_WRITE_FAILED'
                       iv_msg    = |authorization field { iv_name } was saved but the buffer refresh failed: { lx_refresh->get_text( ) }| ).
        RETURN.
    ENDTRY.

    zcl_abap_vibe_icf_auth_common=>respond_write_ok( io_server  = io_server
                  iv_name    = iv_name
                  iv_type    = 'AUTH'
                  iv_action  = COND string( WHEN iv_method = 'POST' THEN 'created' ELSE 'updated' )
                  iv_package = lv_package ).
  ENDMETHOD.

  METHOD delete_auth.
    " Ported abapGit pre-checks: authority (SUSO activity 06) and where-used
    " before any mutation, then the AUTHX row and the TADIR entry.
    DATA: lv_package   TYPE devclass,
          lv_transport TYPE trkorr,
          lv_code      TYPE string,
          lv_msg       TYPE string.

    lv_transport = zcl_abap_vibe_icf_auth_common=>query_transport( iv_query ).

    IF auth_exists( iv_name ) = abap_false.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 404
                     iv_code   = 'AUTH_NOT_FOUND'
                     iv_msg    = |authorization field { iv_name } does not exist| ).
      RETURN.
    ENDIF.

    DATA lo_auth TYPE REF TO cl_auth_tools.
    DATA lv_fieldname TYPE authx-fieldname.
    lv_fieldname = iv_name.
    CREATE OBJECT lo_auth.
    IF lo_auth->authority_check_suso( actvt     = '06'
                                      fieldname = lv_fieldname ) <> 0.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 403
                     iv_code   = 'AUTH_NOT_AUTHORIZED'
                     iv_msg    = |not authorized to delete authorization field { iv_name }| ).
      RETURN.
    ENDIF.

    DATA lt_used TYPE susr_t_xuobject.
    TRY.
        lt_used = lo_auth->suso_where_used_afield( lv_fieldname ).
      CATCH cx_root INTO DATA(lx_used).
        zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                       iv_status = 500
                       iv_code   = 'AUTH_DELETE_FAILED'
                       iv_msg    = |where-used check failed for authorization field { iv_name }: { lx_used->get_text( ) }| ).
        RETURN.
    ENDTRY.
    IF lines( lt_used ) > 0.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 409
                     iv_code   = 'AUTH_DELETE_REFUSED'
                     iv_msg    = |authorization field { iv_name } is still used by { lines( lt_used ) } authorization object(s); remove it from them first| ).
      RETURN.
    ENDIF.

    lv_package = zcl_abap_vibe_icf_auth_common=>package_of( iv_tadir_object = 'AUTH'
                                                            iv_name         = iv_name ).
    IF lv_package IS NOT INITIAL.
      zcl_abap_vibe_icf_auth_common=>transport_rule( EXPORTING iv_package   = lv_package
                                                               iv_transport = lv_transport
                                                               iv_verb      = 'delete'
                                                               iv_prefix    = 'AUTH'
                                                     IMPORTING ev_code      = lv_code
                                                               ev_msg       = lv_msg ).
      IF lv_code IS NOT INITIAL.
        respond_invalid( io_server = io_server
                         iv_code   = lv_code
                         iv_msg    = lv_msg ).
        RETURN.
      ENDIF.
    ENDIF.

    DELETE FROM authx WHERE fieldname = @iv_name.
    IF sy-subrc <> 0.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 500
                     iv_code   = 'AUTH_DELETE_FAILED'
                     iv_msg    = |authorization field { iv_name } could not be deleted (AUTHX sy-subrc { sy-subrc })| ).
      RETURN.
    ENDIF.
    COMMIT WORK.

    " SAP does not remove the TADIR entry when an authorization field is deleted
    " in SU20 (documented abapGit bug); the handler must delete it explicitly.
    IF lv_package IS NOT INITIAL.
      zcl_abap_vibe_icf_auth_common=>tadir_delete( iv_tadir_object = 'AUTH'
                                                   iv_name         = iv_name
                                                   iv_package      = lv_package
                                                   iv_transport    = lv_transport ).
    ENDIF.

    zcl_abap_vibe_icf_auth_common=>respond_write_ok( io_server  = io_server
                  iv_name    = iv_name
                  iv_type    = 'AUTH'
                  iv_action  = 'deleted'
                  iv_package = lv_package ).
  ENDMETHOD.

  METHOD name_valid.
    " AUTHX-FIELDNAME as used by SU20: plain ABAP names plus namespaces and the
    " interior-slash shape found on the reference system (ACCGO/SID).
    IF iv_name IS INITIAL OR strlen( iv_name ) > gc_name_max_length.
      rv_ok = abap_false.
      RETURN.
    ENDIF.
    FIND REGEX '^/?[A-Z0-9_]+(/[A-Z0-9_]+)*$' IN iv_name.
    rv_ok = boolc( sy-subrc = 0 ).
  ENDMETHOD.

  METHOD ddic_name_valid.
    " DDIC repository names (data element, check table, function module): plain
    " name or the well-formed /NAMESPACE/NAME form.
    IF iv_name IS INITIAL OR strlen( iv_name ) > gc_name_max_length.
      rv_ok = abap_false.
      RETURN.
    ENDIF.
    FIND REGEX '^([A-Z0-9_]+|/[A-Z0-9_]+/[A-Z0-9_]+)$' IN iv_name.
    rv_ok = boolc( sy-subrc = 0 ).
  ENDMETHOD.

  METHOD auth_exists.
    SELECT SINGLE fieldname FROM authx INTO @DATA(lv_fieldname)
      WHERE fieldname = @iv_name.
    rv_exists = boolc( sy-subrc = 0 ).
  ENDMETHOD.

  METHOD validate_document.
    " Normalize + validate the editable document fields against the real DDIC
    " objects: the data element, check table and search-help exit must exist.
    CLEAR: ev_code, ev_msg.

    DATA(lv_data_element) = to_upper( condense( val = cs_doc-general_information-data_element del = ` ` ) ).
    IF lv_data_element IS INITIAL.
      ev_code = 'AUTH_INVALID_PAYLOAD'.
      ev_msg = 'generalInformation.dataElement is required'.
      RETURN.
    ENDIF.
    IF ddic_name_valid( lv_data_element ) = abap_false.
      ev_code = 'AUTH_INVALID_PAYLOAD'.
      ev_msg = |generalInformation.dataElement '{ lv_data_element }' is not a valid data element name|.
      RETURN.
    ENDIF.
    SELECT SINGLE rollname FROM dd04l INTO @DATA(lv_dtel)
      WHERE rollname = @lv_data_element AND as4local = 'A'.
    IF sy-subrc <> 0.
      ev_code = 'AUTH_INVALID_PAYLOAD'.
      ev_msg = |data element { lv_data_element } does not exist (DD04L)|.
      RETURN.
    ENDIF.
    cs_doc-general_information-data_element = lv_data_element.

    DATA(lv_check_table) = to_upper( condense( val = cs_doc-alternative_search_help-check_table del = ` ` ) ).
    IF lv_check_table IS NOT INITIAL.
      IF ddic_name_valid( lv_check_table ) = abap_false.
        ev_code = 'AUTH_INVALID_PAYLOAD'.
        ev_msg = |alternativeSearchHelp.checkTable '{ lv_check_table }' is not a valid table name|.
        RETURN.
      ENDIF.
      SELECT SINGLE tabname FROM dd02l INTO @DATA(lv_tabname)
        WHERE tabname = @lv_check_table AND as4local = 'A'.
      IF sy-subrc <> 0.
        ev_code = 'AUTH_INVALID_PAYLOAD'.
        ev_msg = |check table { lv_check_table } does not exist (DD02L)|.
        RETURN.
      ENDIF.
    ENDIF.
    cs_doc-alternative_search_help-check_table = lv_check_table.

    DATA(lv_exit_fb) = to_upper( condense( val = cs_doc-general_information-search_help_exit del = ` ` ) ).
    IF lv_exit_fb IS NOT INITIAL.
      IF ddic_name_valid( lv_exit_fb ) = abap_false.
        ev_code = 'AUTH_INVALID_PAYLOAD'.
        ev_msg = |generalInformation.searchHelpExit '{ lv_exit_fb }' is not a valid function module name|.
        RETURN.
      ENDIF.
      SELECT SINGLE funcname FROM tfdir INTO @DATA(lv_funcname)
        WHERE funcname = @lv_exit_fb.
      IF sy-subrc <> 0.
        ev_code = 'AUTH_INVALID_PAYLOAD'.
        ev_msg = |search-help exit { lv_exit_fb } does not exist (TFDIR)|.
        RETURN.
      ENDIF.
    ENDIF.
    cs_doc-general_information-search_help_exit = lv_exit_fb.
  ENDMETHOD.

  METHOD respond_invalid.
    zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                                                   iv_status = 400
                                                   iv_code   = iv_code
                                                   iv_msg    = iv_msg ).
  ENDMETHOD.
ENDCLASS.
