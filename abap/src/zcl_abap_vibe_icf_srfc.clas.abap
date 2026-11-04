CLASS zcl_abap_vibe_icf_srfc DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS dispatch_srfc
      IMPORTING io_server TYPE REF TO if_http_server
                iv_path   TYPE string
                iv_method TYPE string
                iv_body   TYPE string.
  PRIVATE SECTION.
    " ----- /srfc wire document (camelCase names through /ui2/cl_json) -----
    TYPES:
      BEGIN OF ty_srfc,
        format_version  TYPE string,
        name            TYPE string,
        description     TYPE string,
        function_name   TYPE string,
        scope           TYPE string,
        default_profile TYPE string,
        package         TYPE string,
        created_by      TYPE as4user,
        created_on      TYPE dats,
        created_at      TYPE tims,
        changed_by      TYPE as4user,
        changed_on      TYPE dats,
        changed_at      TYPE tims,
      END OF ty_srfc,
      BEGIN OF ty_srfc_write,
        format_version    TYPE string,
        name              TYPE string,
        description       TYPE string,
        function_name     TYPE string,
        scope             TYPE string,
        default_profile   TYPE string,
        package           TYPE string,
        transport_request TYPE string,
      END OF ty_srfc_write,
      BEGIN OF ty_srfc_write_data,
        name    TYPE string,
        type    TYPE string,
        action  TYPE string,
        package TYPE string,
      END OF ty_srfc_write_data,
      BEGIN OF ty_srfc_response,
        status TYPE string,
        data   TYPE ty_srfc,
      END OF ty_srfc_response,
      BEGIN OF ty_srfc_write_response,
        status TYPE string,
        data   TYPE ty_srfc_write_data,
      END OF ty_srfc_write_response.
    CONSTANTS:
      gc_name_max       TYPE i VALUE 30,
      gc_desc_max       TYPE i VALUE 255,
      gc_function_max   TYPE i VALUE 30,
      gc_profile_max    TYPE i VALUE 30,
      gc_format_version TYPE string VALUE '1',
      gc_type           TYPE string VALUE 'SRFC',
      gc_objtype_tr     TYPE trobjtype VALUE 'SRFC',
      gc_action_created TYPE string VALUE 'created',
      gc_action_updated TYPE string VALUE 'updated',
      gc_action_deleted TYPE string VALUE 'deleted'.

    " ----- GET -----
    CLASS-METHODS read_service
      IMPORTING io_server TYPE REF TO if_http_server
                iv_name   TYPE string.
    " ----- POST (create/update) -----
    CLASS-METHODS write_service
      IMPORTING io_server TYPE REF TO if_http_server
                iv_name   TYPE string
                iv_body   TYPE string.
    " ----- DELETE -----
    CLASS-METHODS delete_service
      IMPORTING io_server TYPE REF TO if_http_server
                iv_name   TYPE string
                iv_body   TYPE string.
    " ----- shared helpers -----
    CLASS-METHODS validate_name
      IMPORTING iv_name  TYPE string
      EXPORTING ev_error TYPE string.
    CLASS-METHODS validate_payload
      IMPORTING is_input  TYPE ty_srfc_write
                iv_name   TYPE string
      EXPORTING es_wire   TYPE ty_srfc_write
                ev_error  TYPE string.
    CLASS-METHODS validate_function
      IMPORTING iv_function TYPE string
      EXPORTING ev_error    TYPE string
                ev_message  TYPE string.
    CLASS-METHODS validate_profile
      IMPORTING iv_profile TYPE string
      EXPORTING ev_error   TYPE string
                ev_message TYPE string.
    CLASS-METHODS service_exists
      IMPORTING iv_name        TYPE string
      RETURNING VALUE(rv_exists) TYPE abap_bool.
    CLASS-METHODS package_of
      IMPORTING iv_name        TYPE string
      RETURNING VALUE(rv_package) TYPE devclass.
    CLASS-METHODS create_persist
      RETURNING VALUE(ro_persist) TYPE REF TO if_wb_object_persist.
    CLASS-METHODS create_data_model
      RETURNING VALUE(ro_data) TYPE REF TO if_wb_object_data_model.
    CLASS-METHODS wire_from_api
      IMPORTING io_api         TYPE REF TO if_ucon_api_rfc_service
      RETURNING VALUE(rs_wire) TYPE ty_srfc.
    CLASS-METHODS description_of
      IMPORTING iv_name               TYPE string
      RETURNING VALUE(rv_description) TYPE string.
    CLASS-METHODS check_package
      IMPORTING iv_package   TYPE devclass
                iv_transport TYPE trkorr
      EXPORTING ev_error     TYPE string
                ev_message   TYPE string.
    CLASS-METHODS corr_insert
      IMPORTING iv_name      TYPE string
                iv_package   TYPE devclass
                iv_transport TYPE trkorr
      EXPORTING ev_error     TYPE string
                ev_message   TYPE string.
    CLASS-METHODS lock_service
      IMPORTING io_persist TYPE REF TO if_wb_object_persist
                iv_name    TYPE string
      EXPORTING ev_error   TYPE string
                ev_message TYPE string.
    CLASS-METHODS unlock_service
      IMPORTING io_persist TYPE REF TO if_wb_object_persist
                iv_name    TYPE string.
    CLASS-METHODS touch_runtime
      IMPORTING iv_name   TYPE string
                iv_action TYPE string.
    CLASS-METHODS respond_api_error
      IMPORTING io_server TYPE REF TO if_http_server
                iv_action TYPE string
                io_exc    TYPE REF TO cx_ucon_api_rfc_service.
    CLASS-METHODS respond_persist_error
      IMPORTING io_server TYPE REF TO if_http_server
                iv_action TYPE string
                io_exc    TYPE REF TO cx_root.
    CLASS-METHODS respond_runtime_error
      IMPORTING io_server TYPE REF TO if_http_server
                iv_action TYPE string
                io_exc    TYPE REF TO cx_root.
ENDCLASS.

CLASS zcl_abap_vibe_icf_srfc IMPLEMENTATION.
  METHOD dispatch_srfc.
    " Route /srfc/<name>. UCON RFC service ids are case-insensitive, so the
    " path segment is uppercased before any SAP-side lookup or write.
    DATA lv_name  TYPE string.
    DATA lv_error TYPE string.

    IF strlen( iv_path ) <= strlen( '/srfc/' ).
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = 'SRFC_NAME_INVALID'
                     iv_msg    = 'service name is required on /srfc/<name>' ).
      RETURN.
    ENDIF.

    lv_name = to_upper( condense( val = substring( val = iv_path
                                                   off = strlen( '/srfc/' ) ) del = ` ` ) ).
    validate_name( EXPORTING iv_name  = lv_name
                   IMPORTING ev_error = lv_error ).
    IF lv_error IS NOT INITIAL.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = 'SRFC_NAME_INVALID'
                     iv_msg    = lv_error ).
      RETURN.
    ENDIF.

    CASE iv_method.
      WHEN 'GET'.
        read_service( io_server = io_server iv_name = lv_name ).
      WHEN 'POST'.
        write_service( io_server = io_server iv_name = lv_name iv_body = iv_body ).
      WHEN 'DELETE'.
        delete_service( io_server = io_server iv_name = lv_name iv_body = iv_body ).
      WHEN OTHERS.
        zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                       iv_status = 405
                       iv_reason = 'Method Not Allowed'
                       iv_code   = 'METHOD_NOT_ALLOWED'
                       iv_msg    = |{ iv_method } not supported on /srfc/<name>| ).
    ENDCASE.
  ENDMETHOD.

  METHOD read_service.
    " GET /srfc/<name>: read through the public UCON RFC service API. The
    " getters expose header/text/admin data, so the route never assembles row
    " contents from the persistence tables.
    DATA lo_api TYPE REF TO if_ucon_api_rfc_service.

    TRY.
        lo_api = cl_ucon_api_factory=>get_rfc_service( CONV uconrfcservid( iv_name ) ).
      CATCH cx_ucon_api_rfc_service INTO DATA(lx_api).
        respond_api_error( io_server = io_server iv_action = 'read' io_exc = lx_api ).
        RETURN.
    ENDTRY.

    TRY.
        DATA(ls_response) = VALUE ty_srfc_response( status = 'success'
                                                   data   = wire_from_api( lo_api ) ).
        zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                       iv_status  = 200
                       iv_reason  = 'OK'
                       is_payload = ls_response ).
      CATCH cx_ucon_api_rfc_service INTO lx_api.
        respond_api_error( io_server = io_server iv_action = 'read' io_exc = lx_api ).
      CATCH cx_root INTO DATA(lx_root).
        respond_runtime_error( io_server = io_server iv_action = 'read' io_exc = lx_root ).
    ENDTRY.
  ENDMETHOD.

  METHOD write_service.
    " POST /srfc/<name>: upsert through the Workbench persistence classes
    " (CL_UCONRFC_OBJECT_PERSIST / CL_UCONRFC_OBJECT_DATA), the same path
    " abapGit and the UCONCOCKPIT save use. Create and update both lock the
    " service, record TADIR / the transport request (RS_CORR_INSERT), save the
    " active version and touch the runtime cache.
    DATA ls_input   TYPE ty_srfc_write.
    DATA ls_wire    TYPE ty_srfc_write.
    DATA ls_data    TYPE uconrfcserv_complete.
    DATA lv_error   TYPE string.
    DATA lv_message TYPE string.
    DATA lv_exists  TYPE abap_bool.
    DATA lv_package TYPE devclass.
    DATA lv_action  TYPE string.
    DATA lv_locked  TYPE abap_bool.
    DATA lo_persist TYPE REF TO if_wb_object_persist.
    DATA lo_data    TYPE REF TO if_wb_object_data_model.

    IF iv_body IS INITIAL.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = 'SRFC_INVALID_PAYLOAD'
                     iv_msg    = 'request body is empty' ).
      RETURN.
    ENDIF.
    TRY.
        /ui2/cl_json=>deserialize( EXPORTING json        = iv_body
                                             pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                                   CHANGING  data        = ls_input ).
      CATCH cx_root INTO DATA(lx_parse).
        zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                       iv_status = 400
                       iv_reason = 'Bad Request'
                       iv_code   = 'SRFC_INVALID_PAYLOAD'
                       iv_msg    = |invalid JSON payload: { lx_parse->get_text( ) }| ).
        RETURN.
    ENDTRY.

    validate_payload( EXPORTING is_input = ls_input
                                iv_name  = iv_name
                      IMPORTING es_wire  = ls_wire
                                ev_error = lv_error ).
    IF lv_error IS NOT INITIAL.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = 'SRFC_INVALID_PAYLOAD'
                     iv_msg    = lv_error ).
      RETURN.
    ENDIF.

    validate_function( EXPORTING iv_function = ls_wire-function_name
                       IMPORTING ev_error    = lv_error
                                 ev_message  = lv_message ).
    IF lv_error IS NOT INITIAL.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = lv_error
                     iv_msg    = lv_message ).
      RETURN.
    ENDIF.
    validate_profile( EXPORTING iv_profile = ls_wire-default_profile
                      IMPORTING ev_error   = lv_error
                                ev_message = lv_message ).
    IF lv_error IS NOT INITIAL.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = lv_error
                     iv_msg    = lv_message ).
      RETURN.
    ENDIF.

    lv_exists = service_exists( iv_name ).
    lv_action = COND string( WHEN lv_exists = abap_true THEN gc_action_updated ELSE gc_action_created ).
    lv_package = package_of( iv_name ).
    IF lv_package IS INITIAL AND ls_wire-package IS NOT INITIAL.
      lv_package = CONV devclass( ls_wire-package ).
    ENDIF.
    IF lv_package IS INITIAL.
      lv_package = '$TMP'.
    ENDIF.
    check_package( EXPORTING iv_package   = lv_package
                             iv_transport = CONV trkorr( ls_wire-transport_request )
                   IMPORTING ev_error     = lv_error
                             ev_message   = lv_message ).
    IF lv_error IS NOT INITIAL.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = lv_error
                     iv_msg    = lv_message ).
      RETURN.
    ENDIF.

    TRY.
        lo_persist = create_persist( ).
        lock_service( EXPORTING io_persist = lo_persist iv_name = iv_name
                      IMPORTING ev_error = lv_error ev_message = lv_message ).
        IF lv_error IS NOT INITIAL.
          zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                         iv_status = 400
                         iv_reason = 'Bad Request'
                         iv_code   = lv_error
                         iv_msg    = lv_message ).
          RETURN.
        ENDIF.
        lv_locked = abap_true.

        lo_data = create_data_model( ).
        IF lv_exists = abap_true.
          CALL METHOD lo_persist->get
            EXPORTING
              p_object_key  = CONV seu_objkey( iv_name )
              p_version     = 'A'
            CHANGING
              p_object_data = lo_data.
          CALL METHOD lo_data->get_data
            IMPORTING
              p_data = ls_data.
        ENDIF.

        corr_insert( EXPORTING iv_name      = iv_name
                               iv_package   = lv_package
                               iv_transport = CONV trkorr( ls_wire-transport_request )
                     IMPORTING ev_error     = lv_error
                               ev_message   = lv_message ).
        IF lv_error IS NOT INITIAL.
          unlock_service( io_persist = lo_persist iv_name = iv_name ).
          lv_locked = abap_false.
          zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                         iv_status = 400
                         iv_reason = 'Bad Request'
                         iv_code   = lv_error
                         iv_msg    = lv_message ).
          RETURN.
        ENDIF.

        ls_data-header-id              = CONV uconrfcservid( iv_name ).
        ls_data-header-version         = 'A'.
        ls_data-header-funcname        = CONV rs38l_fnam( ls_wire-function_name ).
        ls_data-header-scope           = CONV uconrfcscope( ls_wire-scope ).
        ls_data-header-default_profile = CONV uconhttpservid( ls_wire-default_profile ).
        IF lv_exists = abap_false.
          ls_data-header-createdby = sy-uname.
          ls_data-header-createdon = sy-datum.
          ls_data-header-createdat = sy-uzeit.
          CLEAR: ls_data-header-changedby, ls_data-header-changedon, ls_data-header-changedat.
        ELSE.
          ls_data-header-changedby = sy-uname.
          ls_data-header-changedon = sy-datum.
          ls_data-header-changedat = sy-uzeit.
        ENDIF.
        ls_data-text-shorttext = ls_wire-description.
        IF lv_exists = abap_false AND ls_data-text-shorttext IS INITIAL.
          ls_data-text-shorttext = |Default RFC Service for Function-Module: { ls_wire-function_name }|.
        ENDIF.

        CALL METHOD lo_data->set_data
          EXPORTING
            p_data = ls_data.
        CALL METHOD lo_persist->save
          EXPORTING
            p_object_data = lo_data
            p_language    = sy-langu.
        COMMIT WORK.
        unlock_service( io_persist = lo_persist iv_name = iv_name ).
        lv_locked = abap_false.

        touch_runtime( iv_name = iv_name iv_action = 'I' ).

        DATA(ls_response) = VALUE ty_srfc_write_response(
          status = 'success'
          data   = VALUE ty_srfc_write_data( name    = iv_name
                                             type    = gc_type
                                             action  = lv_action
                                             package = CONV string( lv_package ) ) ).
        zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                       iv_status  = 200
                       iv_reason  = 'OK'
                       is_payload = ls_response ).
      CATCH cx_swb_object_does_not_exist INTO DATA(lx_missing).
        IF lv_locked = abap_true.
          unlock_service( io_persist = lo_persist iv_name = iv_name ).
        ENDIF.
        zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                       iv_status = 404
                       iv_reason = 'Not Found'
                       iv_code   = 'SRFC_OBJECT_NOT_FOUND'
                       iv_msg    = |UCON RFC service { iv_name } does not exist| ).
      CATCH cx_root INTO DATA(lx_root).
        IF lv_locked = abap_true.
          unlock_service( io_persist = lo_persist iv_name = iv_name ).
        ENDIF.
        respond_persist_error( io_server = io_server iv_action = 'write' io_exc = lx_root ).
    ENDTRY.
  ENDMETHOD.

  METHOD delete_service.
    " DELETE /srfc/<name>: CL_UCON_API_FACTORY=>DELETE_RFC_SERVICE removes the
    " header/text rows, the TADIR entry and the CTS record, writes the change
    " document and touches the runtime tables (the canonical delete path).
    DATA lv_package   TYPE devclass.
    DATA lv_transport TYPE trkorr.
    DATA lv_match     TYPE string.

    IF service_exists( iv_name ) = abap_false.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 404
                     iv_reason = 'Not Found'
                     iv_code   = 'SRFC_OBJECT_NOT_FOUND'
                     iv_msg    = |UCON RFC service { iv_name } does not exist| ).
      RETURN.
    ENDIF.

    lv_package = package_of( iv_name ).
    IF lv_package IS INITIAL.
      lv_package = '$TMP'.
    ENDIF.
    IF zcl_abap_vibe_icf_types=>is_local_package( lv_package ) = abap_false.
      FIND FIRST OCCURRENCE OF REGEX '"transportRequest"\s*:\s*"([^"]+)"' IN iv_body IGNORING CASE
        SUBMATCHES lv_match.
      IF sy-subrc = 0.
        lv_transport = to_upper( lv_match ).
      ENDIF.
      IF lv_transport IS INITIAL.
        zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                       iv_status = 400
                       iv_reason = 'Bad Request'
                       iv_code   = 'SRFC_TRANSPORT_REQUIRED'
                       iv_msg    = |UCON RFC service { iv_name } is in package { lv_package }; a transport request is required to record the deletion| ).
        RETURN.
      ENDIF.
    ENDIF.

    TRY.
        cl_ucon_api_factory=>delete_rfc_service( name     = CONV uconrfcservid( iv_name )
                                                 devclass = lv_package
                                                 korrnum  = lv_transport
                                                 run_dark = abap_true ).
        DATA(ls_response) = VALUE ty_srfc_write_response(
          status = 'success'
          data   = VALUE ty_srfc_write_data( name    = iv_name
                                             type    = gc_type
                                             action  = gc_action_deleted
                                             package = CONV string( lv_package ) ) ).
        zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                       iv_status  = 200
                       iv_reason  = 'OK'
                       is_payload = ls_response ).
      CATCH cx_ucon_api_rfc_service INTO DATA(lx_api).
        respond_api_error( io_server = io_server iv_action = 'delete' io_exc = lx_api ).
      CATCH cx_root INTO DATA(lx_root).
        respond_runtime_error( io_server = io_server iv_action = 'delete' io_exc = lx_root ).
    ENDTRY.
  ENDMETHOD.

  METHOD validate_name.
    " Mirror the non-interactive part of the UCONCOCKPIT name rule: 1..30
    " characters, no whitespace/control characters, uppercase names.
    CLEAR ev_error.
    IF iv_name IS INITIAL.
      ev_error = 'service name must not be empty'.
      RETURN.
    ENDIF.
    IF strlen( iv_name ) > gc_name_max.
      ev_error = |service name must not exceed { gc_name_max } characters (UCONRFCSERVID); got { strlen( iv_name ) }|.
      RETURN.
    ENDIF.
    IF iv_name CO 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_/'.
      RETURN.
    ENDIF.
    ev_error = |service name may only contain A-Z, 0-9, '_' and '/' (got '{ iv_name }')|.
  ENDMETHOD.

  METHOD validate_payload.
    " Validate the wire document and normalise the fields the persistence
    " layer expects: scope is restricted to the UCONRFCSCOPE domain;
    " description/function/profile lengths are checked before the write.
    CLEAR: es_wire, ev_error.
    es_wire-format_version = gc_format_version.
    es_wire-name = iv_name.

    DATA(lv_format_version) = to_upper( condense( val = is_input-format_version del = ` ` ) ).
    IF lv_format_version IS NOT INITIAL AND lv_format_version <> gc_format_version.
      ev_error = |formatVersion must be '{ gc_format_version }' (got '{ is_input-format_version }')|.
      RETURN.
    ENDIF.
    IF is_input-name IS NOT INITIAL AND to_upper( condense( val = is_input-name del = ` ` ) ) <> iv_name.
      ev_error = |payload name '{ is_input-name }' does not match URL service '{ iv_name }'|.
      RETURN.
    ENDIF.

    DATA(lv_function) = to_upper( condense( val = is_input-function_name del = ` ` ) ).
    IF lv_function IS INITIAL.
      ev_error = 'functionName is required (RFC-enabled function module backing the service)'.
      RETURN.
    ENDIF.
    IF strlen( lv_function ) > gc_function_max.
      ev_error = |functionName must not exceed { gc_function_max } characters (RS38L_FNAM); got { strlen( lv_function ) }|.
      RETURN.
    ENDIF.

    DATA(lv_scope) = to_upper( condense( val = is_input-scope del = ` ` ) ).
    IF lv_scope IS NOT INITIAL AND lv_scope <> 'E' AND lv_scope <> 'O'
        AND lv_scope <> 'P' AND lv_scope <> 'S'.
      ev_error = |scope must be one of E, O, P, S or empty (got '{ is_input-scope }')|.
      RETURN.
    ENDIF.

    DATA(lv_profile) = to_upper( condense( val = is_input-default_profile del = ` ` ) ).
    IF strlen( lv_profile ) > gc_profile_max.
      ev_error = |defaultProfile must not exceed { gc_profile_max } characters (UCONHTTPSERVID); got { strlen( lv_profile ) }|.
      RETURN.
    ENDIF.

    DATA(lv_description) = condense( val = is_input-description ).
    IF strlen( lv_description ) > gc_desc_max.
      ev_error = |description must not exceed { gc_desc_max } characters (UCONTEXT); got { strlen( lv_description ) }|.
      RETURN.
    ENDIF.

    es_wire-function_name     = lv_function.
    es_wire-scope             = lv_scope.
    es_wire-default_profile   = lv_profile.
    es_wire-description       = lv_description.
    es_wire-package           = to_upper( condense( val = is_input-package del = ` ` ) ).
    es_wire-transport_request = to_upper( condense( val = is_input-transport_request del = ` ` ) ).
  ENDMETHOD.

  METHOD validate_function.
    " Same checks as CL_UCONRFC_OBJECT_TOOL=>CHECK_OBJECT_DATA: the function
    " module must exist and be RFC-enabled (FMODE R/X/K); a missing/non-RFC
    " module is what UCONCOCKPIT would reject before saving.
    CLEAR: ev_error, ev_message.
    IF iv_function IS INITIAL.
      RETURN.
    ENDIF.
    CALL FUNCTION 'FUNCTION_EXISTS'
      EXPORTING
        funcname           = CONV rs38l_fnam( iv_function )
      EXCEPTIONS
        function_not_exist = 1
        OTHERS             = 2.
    IF sy-subrc <> 0.
      ev_error = 'SRFC_FUNCTION_NOT_FOUND'.
      ev_message = |function module { iv_function } does not exist|.
      RETURN.
    ENDIF.
    SELECT SINGLE fmode FROM tfdir INTO @DATA(lv_fmode)
      WHERE funcname = @iv_function AND ( fmode = 'R' OR fmode = 'X' OR fmode = 'K' ).
    IF sy-subrc <> 0 OR lv_fmode IS INITIAL.
      ev_error = 'SRFC_FUNCTION_NOT_RFC_ENABLED'.
      ev_message = |function module { iv_function } is not RFC-enabled|.
    ENDIF.
  ENDMETHOD.

  METHOD validate_profile.
    " UCONCOCKPIT checks that a maintained default profile exists in
    " UCONPROFHEAD; validate it before the persistence write.
    CLEAR: ev_error, ev_message.
    IF iv_profile IS INITIAL.
      RETURN.
    ENDIF.
    SELECT SINGLE id FROM uconprofhead INTO @DATA(lv_profile)
      WHERE id = @iv_profile.
    IF sy-subrc <> 0.
      ev_error = 'SRFC_PROFILE_NOT_FOUND'.
      ev_message = |UCON profile { iv_profile } does not exist|.
    ENDIF.
  ENDMETHOD.

  METHOD service_exists.
    " Existence via the API factory; the persisted rows are the authority (a
    " TADIR-only leftover does not make the object readable).
    TRY.
        cl_ucon_api_factory=>get_rfc_service( CONV uconrfcservid( iv_name ) ).
        rv_exists = abap_true.
      CATCH cx_ucon_api_rfc_service.
        rv_exists = abap_false.
    ENDTRY.
  ENDMETHOD.

  METHOD package_of.
    " Package from TADIR; a service created outside the WB tooling may have no
    " row, which callers treat as $TMP (the same default the API uses).
    CLEAR rv_package.
    SELECT SINGLE devclass FROM tadir
      WHERE pgmid = 'R3TR' AND object = 'SRFC' AND obj_name = @iv_name
      INTO @rv_package.
    rv_package = to_upper( condense( val = rv_package del = ` ` ) ).
  ENDMETHOD.

  METHOD create_persist.
    " CL_UCONRFC_OBJECT_PERSIST is the Workbench persistence implementation for
    " SRFC; it is instantiated dynamically because the class is not part of the
    " public API surface.
    CREATE OBJECT ro_persist TYPE ('CL_UCONRFC_OBJECT_PERSIST').
  ENDMETHOD.

  METHOD create_data_model.
    CREATE OBJECT ro_data TYPE ('CL_UCONRFC_OBJECT_DATA').
  ENDMETHOD.

  METHOD wire_from_api.
    " Map the API getters to the wire document. The description falls back to
    " any maintained language row so a pull in a non-English session still
    " produces a useful document.
    DATA ls_admin TYPE ucon_admin_data.

    CLEAR rs_wire.
    rs_wire-format_version   = gc_format_version.
    rs_wire-name             = io_api->get_name( ).
    rs_wire-function_name    = io_api->get_function_module( ).
    rs_wire-scope            = io_api->get_scope( ).
    rs_wire-default_profile  = io_api->get_profile( ).
    TRY.
        rs_wire-description = io_api->get_description( lang = sy-langu ).
      CATCH cx_ucon_api_rfc_service.
        CLEAR rs_wire-description.
    ENDTRY.
    rs_wire-description = condense( val = rs_wire-description ).
    IF rs_wire-description IS INITIAL.
      rs_wire-description = description_of( iv_name = CONV string( rs_wire-name ) ).
    ENDIF.
    rs_wire-package = CONV string( package_of( CONV string( rs_wire-name ) ) ).
    ls_admin = io_api->get_admin_data( ).
    rs_wire-created_by = ls_admin-createdby.
    rs_wire-created_on = ls_admin-createdon.
    rs_wire-created_at = ls_admin-createdat.
    rs_wire-changed_by = ls_admin-changedby.
    rs_wire-changed_on = ls_admin-changedon.
    rs_wire-changed_at = ls_admin-changedat.
  ENDMETHOD.

  METHOD description_of.
    " Session-language description, then any other language as a lossless-enough
    " fallback for SAP-shipped services that only carry one language row.
    CLEAR rv_description.
    SELECT SINGLE shorttext FROM uconrfcservtext
      WHERE id = @iv_name AND version = 'A' AND lang = @sy-langu
      INTO @rv_description.
    IF rv_description IS INITIAL.
      SELECT SINGLE shorttext FROM uconrfcservtext
        WHERE id = @iv_name AND version = 'A'
        INTO @rv_description.
    ENDIF.
    rv_description = condense( val = rv_description ).
  ENDMETHOD.

  METHOD check_package.
    " Fail before the persistence write when the package cannot be written from
    " the ICF context: a missing package, or a transportable package without a
    " request (the CTS dialog is suppressed here).
    CLEAR: ev_error, ev_message.
    IF iv_package IS INITIAL.
      ev_error = 'SRFC_PACKAGE_INVALID'.
      ev_message = 'a target package is required for SRFC'.
      RETURN.
    ENDIF.
    SELECT SINGLE korrflag FROM tdevc WHERE devclass = @iv_package INTO @DATA(lv_korrflag).
    IF sy-subrc <> 0.
      ev_error = 'SRFC_PACKAGE_INVALID'.
      ev_message = |package { iv_package } does not exist|.
      RETURN.
    ENDIF.
    IF zcl_abap_vibe_icf_types=>is_local_package( iv_package ) = abap_true.
      RETURN.
    ENDIF.
    IF iv_transport IS INITIAL.
      ev_error = 'SRFC_TRANSPORT_REQUIRED'.
      ev_message = |package { iv_package } is transportable; a transport request is required|.
      RETURN.
    ENDIF.
  ENDMETHOD.

  METHOD corr_insert.
    " Record the object in TADIR and bind it to the package / transport request
    " (the Workbench tool does the same before IF_WB_OBJECT_PERSIST~SAVE).
    CLEAR: ev_error, ev_message.
    CALL FUNCTION 'RS_CORR_INSERT'
      EXPORTING object          = iv_name
                object_class    = 'SRFC'
                devclass        = iv_package
                master_language = sy-langu
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
    ev_error = SWITCH string( lv_subrc
      WHEN 1 THEN 'SRFC_TRANSPORT_REQUIRED'
      WHEN 2 THEN 'SRFC_NOT_AUTHORIZED'
      ELSE 'SRFC_PACKAGE_ASSIGN_FAILED' ).
    ev_message = |RS_CORR_INSERT failed for SRFC { iv_name } (sy-subrc { lv_subrc })|.
  ENDMETHOD.

  METHOD lock_service.
    " The persistence class enqueues UCONRFCSERVHEAD; a foreign lock must not
    " become a write on top of another user's changes.
    CLEAR: ev_error, ev_message.
    CALL METHOD io_persist->lock
      EXPORTING
        p_objname_tr = CONV trobj_name( iv_name )
        p_object_key = CONV seu_objkey( iv_name )
        p_objtype_tr = gc_objtype_tr
      EXCEPTIONS foreign_lock  = 1
                 error_occurred = 2
                 OTHERS         = 3.
    IF sy-subrc = 1.
      ev_error = 'SRFC_LOCK_FAILED'.
      ev_message = |UCON RFC service { iv_name } is locked by another user|.
    ELSEIF sy-subrc <> 0.
      ev_error = 'SRFC_LOCK_FAILED'.
      ev_message = |could not lock UCON RFC service { iv_name } (sy-subrc { sy-subrc })|.
    ENDIF.
  ENDMETHOD.

  METHOD unlock_service.
    CALL METHOD io_persist->unlock
      EXPORTING
        p_objname_tr = CONV trobj_name( iv_name )
        p_object_key = CONV seu_objkey( iv_name )
        p_objtype_tr = gc_objtype_tr.
  ENDMETHOD.

  METHOD touch_runtime.
    " Same side effect as the UCONCOCKPIT activation: reset the UCON RFC kernel
    " cache so a created/changed service is effective without a system restart.
    IF iv_action = 'I' OR iv_action = 'U'.
      cl_uconrfc_runtime=>set_ucon_service_name_4_rt( ip_service_name = CONV uconhttpservid( iv_name )
                                                      ip_action       = CONV uconhttp_afterimp_touch( 'I' ) ).
    ENDIF.
  ENDMETHOD.

  METHOD respond_api_error.
    " Map the public API exception to the structured error envelope. The known
    " T100 keys get actionable 400s; anything else is a SAP-side failure.
    DATA lv_status TYPE i VALUE 400.
    DATA lv_reason TYPE string VALUE 'Bad Request'.
    DATA lv_code   TYPE string.
    DATA lv_message TYPE string.

    IF iv_action = 'read'.
      lv_code = 'SRFC_READ_FAILED'.
    ELSEIF iv_action = 'delete'.
      lv_code = 'SRFC_DELETE_FAILED'.
    ELSE.
      lv_code = 'SRFC_WRITE_FAILED'.
    ENDIF.

    IF io_exc->if_t100_message~t100key = cx_ucon_api_rfc_service=>unknown_rfc_service.
      lv_status = 404.
      lv_reason = 'Not Found'.
      lv_code = 'SRFC_OBJECT_NOT_FOUND'.
    ELSEIF io_exc->if_t100_message~t100key = cx_ucon_api_rfc_service=>rfc_service_already_exists.
      lv_code = 'SRFC_ALREADY_EXISTS'.
    ELSEIF io_exc->if_t100_message~t100key = cx_ucon_api_rfc_service=>corr_insert_failed.
      lv_code = 'SRFC_TRANSPORT_REQUIRED'.
    ELSEIF io_exc->if_t100_message~t100key = cx_ucon_api_rfc_service=>insuf_auth.
      lv_status = 403.
      lv_reason = 'Forbidden'.
      lv_code = 'SRFC_NOT_AUTHORIZED'.
    ELSEIF io_exc->if_t100_message~t100key = cx_ucon_api_rfc_service=>delete_failed.
      lv_code = 'SRFC_DELETE_FAILED'.
    ELSE.
      lv_status = 500.
      lv_reason = 'Internal Server Error'.
    ENDIF.
    lv_message = io_exc->get_text( ).
    IF lv_message IS INITIAL.
      lv_message = |SRFC { iv_action } failed (exception { cl_abap_classdescr=>get_class_name( io_exc ) })|.
    ENDIF.
    zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                   iv_status = lv_status
                   iv_reason = lv_reason
                   iv_code   = lv_code
                   iv_msg    = lv_message ).
  ENDMETHOD.

  METHOD respond_persist_error.
    " Persistence/runtime exceptions are never a validation problem: report 500
    " with the API code family so the CLI maps it to SAP_ERROR.
    DATA lv_code TYPE string.
    IF iv_action = 'read'.
      lv_code = 'SRFC_READ_FAILED'.
    ELSEIF iv_action = 'delete'.
      lv_code = 'SRFC_DELETE_FAILED'.
    ELSE.
      lv_code = 'SRFC_WRITE_FAILED'.
    ENDIF.
    zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                   iv_status = 500
                   iv_reason = 'Internal Server Error'
                   iv_code   = lv_code
                   iv_msg    = |SRFC { iv_action } failed: { io_exc->get_text( ) }| ).
  ENDMETHOD.

  METHOD respond_runtime_error.
    " Runtime errors are never a validation problem: report 500 with the API
    " code family so the CLI maps it to SAP_ERROR instead of a transport failure.
    DATA lv_code TYPE string.
    IF iv_action = 'read'.
      lv_code = 'SRFC_READ_FAILED'.
    ELSEIF iv_action = 'delete'.
      lv_code = 'SRFC_DELETE_FAILED'.
    ELSE.
      lv_code = 'SRFC_WRITE_FAILED'.
    ENDIF.
    zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                   iv_status = 500
                   iv_reason = 'Internal Server Error'
                   iv_code   = lv_code
                   iv_msg    = |SRFC { iv_action } failed: { io_exc->get_text( ) }| ).
  ENDMETHOD.
ENDCLASS.
