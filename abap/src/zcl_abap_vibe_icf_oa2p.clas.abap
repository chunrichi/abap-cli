CLASS zcl_abap_vibe_icf_oa2p DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS dispatch_oa2p
      IMPORTING io_server TYPE REF TO if_http_server
                iv_path   TYPE string
                iv_method TYPE string
                iv_body   TYPE string.
  PRIVATE SECTION.
    " ----- /oa2p wire document (camelCase names through /ui2/cl_json) -----
    TYPES:
      tt_scope TYPE STANDARD TABLE OF string WITH EMPTY KEY,
      BEGIN OF ty_oa2p,
        format_version TYPE string,
        name           TYPE string,
        type           TYPE string,
        no_auth_check  TYPE abap_bool,
        scopes         TYPE tt_scope,
        package        TYPE string,
        created_by     TYPE as4user,
        created_on     TYPE dats,
        created_at     TYPE tims,
        changed_by     TYPE as4user,
        changed_on     TYPE dats,
        changed_at     TYPE tims,
      END OF ty_oa2p,
      BEGIN OF ty_oa2p_write,
        format_version    TYPE string,
        name              TYPE string,
        type              TYPE string,
        no_auth_check     TYPE abap_bool,
        scopes            TYPE tt_scope,
        package           TYPE string,
        transport_request TYPE string,
      END OF ty_oa2p_write,
      BEGIN OF ty_oa2p_write_data,
        name    TYPE string,
        type    TYPE string,
        action  TYPE string,
        package TYPE string,
      END OF ty_oa2p_write_data,
      BEGIN OF ty_oa2p_response,
        status TYPE string,
        data   TYPE ty_oa2p,
      END OF ty_oa2p_response,
      BEGIN OF ty_oa2p_write_response,
        status TYPE string,
        data   TYPE ty_oa2p_write_data,
      END OF ty_oa2p_write_response.
    CONSTANTS:
      gc_name_max       TYPE i VALUE 30,
      gc_type_max       TYPE i VALUE 20,
      gc_scope_max      TYPE i VALUE 1024,
      gc_format_version TYPE string VALUE '1',
      gc_objtype        TYPE string VALUE 'OA2P',
      gc_tadir_objtype  TYPE trobjtype VALUE 'OA2P',
      gc_action_created TYPE string VALUE 'created',
      gc_action_updated TYPE string VALUE 'updated',
      gc_action_deleted TYPE string VALUE 'deleted'.

    " ----- GET -----
    CLASS-METHODS read_profile
      IMPORTING io_server TYPE REF TO if_http_server
                iv_name   TYPE string.
    " ----- POST (create/update) -----
    CLASS-METHODS write_profile
      IMPORTING io_server TYPE REF TO if_http_server
                iv_name   TYPE string
                iv_body   TYPE string.
    " ----- DELETE -----
    CLASS-METHODS delete_profile
      IMPORTING io_server TYPE REF TO if_http_server
                iv_name   TYPE string
                iv_body   TYPE string.
    " ----- shared helpers -----
    CLASS-METHODS validate_name
      IMPORTING iv_name  TYPE string
      EXPORTING ev_error TYPE string.
    CLASS-METHODS validate_payload
      IMPORTING is_input  TYPE ty_oa2p_write
                iv_name   TYPE string
      EXPORTING es_wire   TYPE ty_oa2p_write
                ev_error  TYPE string.
    CLASS-METHODS profile_exists
      IMPORTING iv_name        TYPE string
      RETURNING VALUE(rv_exists) TYPE abap_bool.
    CLASS-METHODS package_of
      IMPORTING iv_name        TYPE string
      RETURNING VALUE(rv_package) TYPE devclass.
    CLASS-METHODS create_persist
      RETURNING VALUE(ro_persist) TYPE REF TO if_wb_object_persist.
    CLASS-METHODS create_data_model
      RETURNING VALUE(ro_data) TYPE REF TO if_wb_object_data_model.
    CLASS-METHODS wire_from_data
      IMPORTING is_data        TYPE oa2c_sx_oa2p_object_data
                iv_name        TYPE string
      RETURNING VALUE(rs_wire) TYPE ty_oa2p.
    CLASS-METHODS data_from_wire
      IMPORTING is_wire      TYPE ty_oa2p_write
                iv_name      TYPE string
                iv_created   TYPE abap_bool
                is_existing  TYPE oa2c_sx_oa2p_object_data
      RETURNING VALUE(rs_data) TYPE oa2c_sx_oa2p_object_data.
    CLASS-METHODS check_package
      IMPORTING iv_package   TYPE devclass
                iv_transport TYPE trkorr
      EXPORTING ev_error     TYPE string
                ev_message   TYPE string.
    CLASS-METHODS profile_usage
      IMPORTING iv_name       TYPE string
      EXPORTING et_clients    TYPE oa2c_t_overview
                ev_error      TYPE string
                ev_message    TYPE string.
    CLASS-METHODS corr_insert
      IMPORTING iv_name      TYPE string
                iv_package   TYPE devclass
                iv_transport TYPE trkorr
                iv_mode      TYPE seu_action
      EXPORTING ev_error     TYPE string
                ev_message   TYPE string.
    CLASS-METHODS lock_profile
      IMPORTING io_persist TYPE REF TO if_wb_object_persist
                iv_name    TYPE string
      EXPORTING ev_error   TYPE string
                ev_message TYPE string.
    CLASS-METHODS unlock_profile
      IMPORTING io_persist TYPE REF TO if_wb_object_persist
                iv_name    TYPE string.
    CLASS-METHODS persist_error
      IMPORTING io_server TYPE REF TO if_http_server
                iv_action TYPE string
                io_exc    TYPE REF TO cx_root.
    CLASS-METHODS write_error
      IMPORTING io_server TYPE REF TO if_http_server
                iv_status  TYPE i
                iv_code    TYPE string
                iv_msg     TYPE string
                iv_details TYPE string_table.
ENDCLASS.

CLASS zcl_abap_vibe_icf_oa2p IMPLEMENTATION.
  METHOD dispatch_oa2p.
    " Route /oa2p/<name>. OA2C profile ids are case-insensitive, so the path
    " segment is uppercased before any SAP-side lookup or write.
    DATA lv_name  TYPE string.
    DATA lv_error TYPE string.

    IF strlen( iv_path ) <= strlen( '/oa2p/' ).
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = 'OA2P_NAME_INVALID'
                     iv_msg    = 'OAuth2 profile name is required on /oa2p/<name>' ).
      RETURN.
    ENDIF.

    lv_name = to_upper( condense( val = substring( val = iv_path
                                                   off = strlen( '/oa2p/' ) ) del = ` ` ) ).
    validate_name( EXPORTING iv_name  = lv_name
                   IMPORTING ev_error = lv_error ).
    IF lv_error IS NOT INITIAL.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = 'OA2P_NAME_INVALID'
                     iv_msg    = lv_error ).
      RETURN.
    ENDIF.

    CASE iv_method.
      WHEN 'GET'.
        read_profile( io_server = io_server iv_name = lv_name ).
      WHEN 'POST'.
        write_profile( io_server = io_server iv_name = lv_name iv_body = iv_body ).
      WHEN 'DELETE'.
        delete_profile( io_server = io_server iv_name = lv_name iv_body = iv_body ).
      WHEN OTHERS.
        zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                       iv_status = 405
                       iv_reason = 'Method Not Allowed'
                       iv_code   = 'METHOD_NOT_ALLOWED'
                       iv_msg    = |{ iv_method } not supported on /oa2p/<name>| ).
    ENDCASE.
  ENDMETHOD.

  METHOD read_profile.
    " GET /oa2p/<name>: read through the WB persistence class, the same path
    " abapGit and the Workbench tool use (the profile data model also carries
    " the service-provider specifics object, which is stateless).
    DATA lo_persist TYPE REF TO if_wb_object_persist.
    DATA lo_data    TYPE REF TO if_wb_object_data_model.
    DATA ls_data    TYPE oa2c_sx_oa2p_object_data.

    IF profile_exists( iv_name ) = abap_false.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 404
                     iv_reason = 'Not Found'
                     iv_code   = 'OA2P_OBJECT_NOT_FOUND'
                     iv_msg    = |OAuth2 profile { iv_name } does not exist| ).
      RETURN.
    ENDIF.

    TRY.
        lo_persist = create_persist( ).
        lo_data = create_data_model( ).
        CALL METHOD lo_persist->get
          EXPORTING
            p_object_key  = CONV seu_objkey( iv_name )
            p_version     = 'A'
          CHANGING
            p_object_data = lo_data.
        CALL METHOD lo_data->get_data
          IMPORTING
            p_data = ls_data.
        DATA(ls_response) = VALUE ty_oa2p_response( status = 'success'
                                                   data   = wire_from_data( is_data = ls_data iv_name = iv_name ) ).
        zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                       iv_status  = 200
                       iv_reason  = 'OK'
                       is_payload = ls_response ).
      CATCH cx_swb_object_does_not_exist INTO DATA(lx_missing).
        zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                       iv_status = 404
                       iv_reason = 'Not Found'
                       iv_code   = 'OA2P_OBJECT_NOT_FOUND'
                       iv_msg    = |OAuth2 profile { iv_name } does not exist| ).
      CATCH cx_root INTO DATA(lx_root).
        persist_error( io_server = io_server iv_action = 'read' io_exc = lx_root ).
    ENDTRY.
  ENDMETHOD.

  METHOD write_profile.
    " POST /oa2p/<name>: upsert through the WB persistence class. Create and
    " update both lock the profile, record the object in TADIR / the transport
    " request (RS_CORR_INSERT) and save the full profile data (header + scopes).
    DATA ls_input   TYPE ty_oa2p_write.
    DATA ls_wire    TYPE ty_oa2p_write.
    DATA ls_data    TYPE oa2c_sx_oa2p_object_data.
    DATA ls_existing TYPE oa2c_sx_oa2p_object_data.
    DATA lv_error   TYPE string.
    DATA lv_message TYPE string.
    DATA lv_exists  TYPE abap_bool.
    DATA lv_package TYPE devclass.
    DATA lv_action  TYPE string.
    DATA lo_persist TYPE REF TO if_wb_object_persist.
    DATA lo_data    TYPE REF TO if_wb_object_data_model.
    DATA lv_locked  TYPE abap_bool.

    IF iv_body IS INITIAL.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = 'OA2P_INVALID_PAYLOAD'
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
                       iv_code   = 'OA2P_INVALID_PAYLOAD'
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
                     iv_code   = 'OA2P_INVALID_PAYLOAD'
                     iv_msg    = lv_error ).
      RETURN.
    ENDIF.

    lv_exists = profile_exists( iv_name ).
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
      write_error( io_server = io_server iv_status = 400 iv_code = lv_error
                   iv_msg = lv_message iv_details = VALUE string_table( ) ).
      RETURN.
    ENDIF.
    lv_action = COND string( WHEN lv_exists = abap_true THEN gc_action_updated ELSE gc_action_created ).

    TRY.
        lo_persist = create_persist( ).
        lock_profile( EXPORTING io_persist = lo_persist iv_name = iv_name
                      IMPORTING ev_error = lv_error ev_message = lv_message ).
        IF lv_error IS NOT INITIAL.
          write_error( io_server = io_server iv_status = 400 iv_code = lv_error
                       iv_msg = lv_message iv_details = VALUE string_table( ) ).
          RETURN.
        ENDIF.
        lv_locked = abap_true.

        IF lv_exists = abap_true.
          lo_data = create_data_model( ).
          " The update starts from the persisted data so the provider-specific
          " object reference loaded by the persistence GET is preserved.
          CALL METHOD lo_persist->get
            EXPORTING
              p_object_key  = CONV seu_objkey( iv_name )
              p_version     = 'A'
            CHANGING
              p_object_data = lo_data.
          CALL METHOD lo_data->get_data
            IMPORTING
              p_data = ls_existing.
        ELSE.
          lo_data = create_data_model( ).
        ENDIF.

        corr_insert( EXPORTING iv_name = iv_name iv_package = lv_package
                               iv_transport = CONV trkorr( ls_wire-transport_request )
                               iv_mode = 'I'
                     IMPORTING ev_error = lv_error ev_message = lv_message ).
        IF lv_error IS NOT INITIAL.
          unlock_profile( io_persist = lo_persist iv_name = iv_name ).
          lv_locked = abap_false.
          write_error( io_server = io_server iv_status = 400 iv_code = lv_error
                       iv_msg = lv_message iv_details = VALUE string_table( ) ).
          RETURN.
        ENDIF.

        ls_data = data_from_wire( is_wire     = ls_wire
                                  iv_name     = iv_name
                                  iv_created  = boolc( lv_exists = abap_false )
                                  is_existing = ls_existing ).
        CALL METHOD lo_data->set_data
          EXPORTING
            p_data = ls_data.
        CALL METHOD lo_persist->save
          EXPORTING
            p_object_data = lo_data
            p_language    = sy-langu.
        COMMIT WORK.
        unlock_profile( io_persist = lo_persist iv_name = iv_name ).
        lv_locked = abap_false.

        DATA(ls_response) = VALUE ty_oa2p_write_response(
          status = 'success'
          data   = VALUE ty_oa2p_write_data( name    = iv_name
                                             type    = gc_objtype
                                             action  = lv_action
                                             package = CONV string( lv_package ) ) ).
        zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                       iv_status  = 200
                       iv_reason  = 'OK'
                       is_payload = ls_response ).
      CATCH cx_swb_object_does_not_exist INTO DATA(lx_missing).
        IF lv_locked = abap_true.
          unlock_profile( io_persist = lo_persist iv_name = iv_name ).
        ENDIF.
        zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                       iv_status = 404
                       iv_reason = 'Not Found'
                       iv_code   = 'OA2P_OBJECT_NOT_FOUND'
                       iv_msg    = |OAuth2 profile { iv_name } does not exist| ).
      CATCH cx_root INTO DATA(lx_root).
        IF lv_locked = abap_true.
          unlock_profile( io_persist = lo_persist iv_name = iv_name ).
        ENDIF.
        persist_error( io_server = io_server iv_action = 'write' io_exc = lx_root ).
    ENDTRY.
  ENDMETHOD.

  METHOD delete_profile.
    " DELETE /oa2p/<name>: refuse profiles that are still assigned to OAuth 2.0
    " clients (the UCONCOCKPIT/OA2C_CONFIG delete rule), then remove the rows,
    " the TADIR entry and the CTS record like the Workbench tool does.
    DATA lv_package   TYPE devclass.
    DATA lv_transport TYPE trkorr.
    DATA lv_match     TYPE string.
    DATA lv_error     TYPE string.
    DATA lv_message   TYPE string.
    DATA lt_clients   TYPE oa2c_t_overview.
    DATA data_details TYPE string_table.
    DATA lo_persist   TYPE REF TO if_wb_object_persist.
    DATA lv_locked    TYPE abap_bool.

    IF profile_exists( iv_name ) = abap_false.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 404
                     iv_reason = 'Not Found'
                     iv_code   = 'OA2P_OBJECT_NOT_FOUND'
                     iv_msg    = |OAuth2 profile { iv_name } does not exist| ).
      RETURN.
    ENDIF.

    profile_usage( EXPORTING iv_name  = iv_name
                   IMPORTING et_clients = lt_clients
                             ev_error   = lv_error
                             ev_message = lv_message ).
    IF lv_error IS NOT INITIAL.
      write_error( io_server = io_server iv_status = 500 iv_code = lv_error
                   iv_msg = lv_message iv_details = VALUE string_table( ) ).
      RETURN.
    ENDIF.
    IF lt_clients IS NOT INITIAL.
      APPEND |assigned OAuth 2.0 clients: { lines( lt_clients ) }| TO data_details.
      write_error( io_server = io_server iv_status = 400 iv_code = 'OA2P_PROFILE_IN_USE'
                   iv_msg = |OAuth2 profile { iv_name } is assigned to OAuth 2.0 clients; remove the assignments in OA2C_CONFIG first|
                   iv_details = data_details ).
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
        write_error( io_server = io_server iv_status = 400 iv_code = 'OA2P_TRANSPORT_REQUIRED'
                     iv_msg = |OAuth2 profile { iv_name } is in package { lv_package }; a transport request is required to record the deletion|
                     iv_details = VALUE string_table( ) ).
        RETURN.
      ENDIF.
      corr_insert( EXPORTING iv_name = iv_name iv_package = lv_package
                             iv_transport = lv_transport iv_mode = 'D'
                   IMPORTING ev_error = lv_error ev_message = lv_message ).
      IF lv_error IS NOT INITIAL.
        write_error( io_server = io_server iv_status = 400 iv_code = lv_error
                     iv_msg = lv_message iv_details = VALUE string_table( ) ).
        RETURN.
      ENDIF.
    ENDIF.

    TRY.
        lo_persist = create_persist( ).
        lock_profile( EXPORTING io_persist = lo_persist iv_name = iv_name
                      IMPORTING ev_error = lv_error ev_message = lv_message ).
        IF lv_error IS NOT INITIAL.
          write_error( io_server = io_server iv_status = 400 iv_code = lv_error
                       iv_msg = lv_message iv_details = VALUE string_table( ) ).
          RETURN.
        ENDIF.
        lv_locked = abap_true.
        CALL METHOD lo_persist->delete
          EXPORTING
            p_object_key = CONV seu_objkey( iv_name ).

        " A local object has no CTS entry to record, so drop its TADIR row
        " directly (TRINT_DELETE_TADIR_IF_LOCAL refuses shipped/foreign types).
        IF zcl_abap_vibe_icf_types=>is_local_package( lv_package ) = abap_true.
          DATA lv_objname TYPE tadir-obj_name.
          lv_objname = iv_name.
          DELETE FROM tadir
            WHERE pgmid = 'R3TR' AND object = 'OA2P' AND obj_name = @lv_objname.
        ENDIF.
        COMMIT WORK.
        unlock_profile( io_persist = lo_persist iv_name = iv_name ).
        lv_locked = abap_false.

        DATA(ls_response) = VALUE ty_oa2p_write_response(
          status = 'success'
          data   = VALUE ty_oa2p_write_data( name    = iv_name
                                             type    = gc_objtype
                                             action  = gc_action_deleted
                                             package = CONV string( lv_package ) ) ).
        zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                       iv_status  = 200
                       iv_reason  = 'OK'
                       is_payload = ls_response ).
      CATCH cx_swb_object_does_not_exist INTO DATA(lx_missing).
        IF lv_locked = abap_true.
          unlock_profile( io_persist = lo_persist iv_name = iv_name ).
        ENDIF.
        zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                       iv_status = 404
                       iv_reason = 'Not Found'
                       iv_code   = 'OA2P_OBJECT_NOT_FOUND'
                       iv_msg    = |OAuth2 profile { iv_name } does not exist| ).
      CATCH cx_root INTO DATA(lx_root).
        IF lv_locked = abap_true.
          unlock_profile( io_persist = lo_persist iv_name = iv_name ).
        ENDIF.
        persist_error( io_server = io_server iv_action = 'delete' io_exc = lx_root ).
    ENDTRY.
  ENDMETHOD.

  METHOD validate_name.
    " 1..30 characters, no whitespace/control characters: OA2C_PROFILE is a
    " CHAR 30 object key, so the same rules as the OA2C_CONFIG name field apply.
    CLEAR ev_error.
    IF iv_name IS INITIAL.
      ev_error = 'OAuth2 profile name must not be empty'.
      RETURN.
    ENDIF.
    IF strlen( iv_name ) > gc_name_max.
      ev_error = |OAuth2 profile name must not exceed { gc_name_max } characters (OA2C_PROFILE); got { strlen( iv_name ) }|.
      RETURN.
    ENDIF.
    IF iv_name CO 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_/'.
      RETURN.
    ENDIF.
    ev_error = |OAuth2 profile name may only contain A-Z, 0-9, '_' and '/' (got '{ iv_name }')|.
  ENDMETHOD.

  METHOD validate_payload.
    " Validate the wire document: the provider type must exist in OA2C_TYPES,
    " scope strings must be non-empty and short enough for OA2P_SCOPES.
    CLEAR: es_wire, ev_error.
    es_wire-format_version = gc_format_version.
    es_wire-name = iv_name.

    DATA(lv_format_version) = to_upper( condense( val = is_input-format_version del = ` ` ) ).
    IF lv_format_version IS NOT INITIAL AND lv_format_version <> gc_format_version.
      ev_error = |formatVersion must be '{ gc_format_version }' (got '{ is_input-format_version }')|.
      RETURN.
    ENDIF.
    IF is_input-name IS NOT INITIAL AND to_upper( condense( val = is_input-name del = ` ` ) ) <> iv_name.
      ev_error = |payload name '{ is_input-name }' does not match URL profile '{ iv_name }'|.
      RETURN.
    ENDIF.

    DATA(lv_type) = to_upper( condense( val = is_input-type del = ` ` ) ).
    IF lv_type IS INITIAL.
      lv_type = 'DEFAULT'.
    ENDIF.
    IF strlen( lv_type ) > gc_type_max.
      ev_error = |type must not exceed { gc_type_max } characters (OA2C_TYPE); got { strlen( lv_type ) }|.
      RETURN.
    ENDIF.
    SELECT SINGLE type FROM oa2c_types WHERE type = @lv_type INTO @DATA(lv_known_type).
    IF sy-subrc <> 0.
      ev_error = |type '{ lv_type }' is not a configured OAuth2 service provider type (OA2C_TYPES)|.
      RETURN.
    ENDIF.

    DATA lv_no_auth_check TYPE abap_bool.
    lv_no_auth_check = is_input-no_auth_check.

    DATA lv_scopes TYPE tt_scope.
    DATA lv_scope TYPE string.
    LOOP AT is_input-scopes INTO lv_scope.
      lv_scope = condense( val = lv_scope ).
      IF lv_scope IS NOT INITIAL.
        IF strlen( lv_scope ) > gc_scope_max.
          ev_error = |a scope value must not exceed { gc_scope_max } characters (OA2C_SCOPE); got { strlen( lv_scope ) }|.
          RETURN.
        ENDIF.
        APPEND lv_scope TO lv_scopes.
      ENDIF.
    ENDLOOP.

    es_wire-type          = lv_type.
    es_wire-no_auth_check = lv_no_auth_check.
    es_wire-scopes        = lv_scopes.
    es_wire-package       = to_upper( condense( val = is_input-package del = ` ` ) ).
    es_wire-transport_request = to_upper( condense( val = is_input-transport_request del = ` ` ) ).
  ENDMETHOD.

  METHOD profile_exists.
    " CHECK_EXISTS_ON_DB is the persistence class' own existence query (the
    " GET path would additionally require a working provider-specific BADI).
    rv_exists = cl_oa2p_object_persist=>check_exists_on_db( i_profile = CONV oa2c_profile( iv_name ) ).
  ENDMETHOD.

  METHOD package_of.
    " Package from TADIR; profiles created outside the WB tooling may have no
    " row, which callers treat as $TMP (the same default the API uses).
    CLEAR rv_package.
    SELECT SINGLE devclass FROM tadir
      WHERE pgmid = 'R3TR' AND object = 'OA2P' AND obj_name = @iv_name
      INTO @rv_package.
    rv_package = to_upper( condense( val = rv_package del = ` ` ) ).
  ENDMETHOD.

  METHOD create_persist.
    " CL_OA2P_OBJECT_PERSIST is the Workbench persistence implementation for
    " OA2P; it is instantiated dynamically because the class is not part of the
    " public API surface.
    CREATE OBJECT ro_persist TYPE ('CL_OA2P_OBJECT_PERSIST').
  ENDMETHOD.

  METHOD create_data_model.
    CREATE OBJECT ro_data TYPE ('CL_OA2P_OBJECT_DATA').
  ENDMETHOD.

  METHOD wire_from_data.
    " Map the persistence model to the wire document. The provider-specific
    " object reference (O_SPECIFICS) and the UI-only scope flags are omitted:
    " they are stateless/derived and not part of the local document.
    CLEAR rs_wire.
    rs_wire-format_version = gc_format_version.
    rs_wire-name           = iv_name.
    rs_wire-type           = is_data-header-type.
    rs_wire-no_auth_check  = is_data-header-no_auth_check.
    rs_wire-package        = CONV string( package_of( iv_name ) ).
    LOOP AT is_data-t_scopes INTO DATA(ls_scope).
      APPEND ls_scope-scope TO rs_wire-scopes.
    ENDLOOP.
    rs_wire-created_by = is_data-header-created_by.
    rs_wire-created_on = is_data-header-created_on.
    rs_wire-created_at = is_data-header-created_at.
    rs_wire-changed_by = is_data-header-changed_by.
    rs_wire-changed_on = is_data-header-changed_on.
    rs_wire-changed_at = is_data-header-changed_at.
  ENDMETHOD.

  METHOD data_from_wire.
    " Build the persistence model from the wire document. An update starts from
    " the persisted data so the provider-specific object reference survives.
    rs_data = is_existing.
    rs_data-header-profile = CONV oa2c_profile( iv_name ).
    rs_data-header-type    = CONV oa2c_type( is_wire-type ).
    IF is_wire-no_auth_check = abap_true.
      rs_data-header-no_auth_check = 'X'.
    ELSE.
      CLEAR rs_data-header-no_auth_check.
    ENDIF.
    IF iv_created = abap_true.
      rs_data-header-created_by = sy-uname.
      rs_data-header-created_on = sy-datum.
      rs_data-header-created_at = sy-uzeit.
    ENDIF.
    rs_data-header-changed_by = sy-uname.
    rs_data-header-changed_on = sy-datum.
    rs_data-header-changed_at = sy-uzeit.

    CLEAR: rs_data-t_scopes, rs_data-t_scopes_ui.
    DATA lv_scopeno TYPE i.
    LOOP AT is_wire-scopes INTO DATA(lv_scope).
      lv_scopeno = lv_scopeno + 1.
      APPEND VALUE #( profile = CONV oa2c_profile( iv_name )
                      scopeno = lv_scopeno
                      scope   = lv_scope ) TO rs_data-t_scopes.
    ENDLOOP.
  ENDMETHOD.

  METHOD check_package.
    " Fail before the persistence write when the package cannot be written:
    " missing package, or a transportable package without a request (the
    " RS_CORR_INSERT dialog is suppressed in the ICF context).
    CLEAR: ev_error, ev_message.
    IF iv_package IS INITIAL.
      ev_error = 'OA2P_PACKAGE_INVALID'.
      ev_message = 'a target package is required for OA2P'.
      RETURN.
    ENDIF.
    SELECT SINGLE korrflag FROM tdevc WHERE devclass = @iv_package INTO @DATA(lv_korrflag).
    IF sy-subrc <> 0.
      ev_error = 'OA2P_PACKAGE_INVALID'.
      ev_message = |package { iv_package } does not exist|.
      RETURN.
    ENDIF.
    IF zcl_abap_vibe_icf_types=>is_local_package( iv_package ) = abap_true.
      RETURN.
    ENDIF.
    IF iv_transport IS INITIAL.
      ev_error = 'OA2P_TRANSPORT_REQUIRED'.
      ev_message = |package { iv_package } is transportable; a transport request is required|.
      RETURN.
    ENDIF.
  ENDMETHOD.

  METHOD profile_usage.
    " A profile assigned to OAuth 2.0 clients cannot be deleted (the OA2P tool's
    " CHECK_PREREQUISITES_FOR_DELETE rule); report the usage so the caller can
    " point at OA2C_CONFIG.
    CLEAR: et_clients, ev_error, ev_message.
    TRY.
        cl_oa2c_config_writer=>check_profile_usage(
          EXPORTING i_profile  = CONV oa2c_profile( iv_name )
          IMPORTING et_clients = et_clients ).
      CATCH cx_root INTO DATA(lx_root).
        ev_error = 'OA2P_DELETE_FAILED'.
        ev_message = |could not check the OAuth2 profile usage: { lx_root->get_text( ) }|.
    ENDTRY.
  ENDMETHOD.

  METHOD corr_insert.
    " Record the object in TADIR and bind it to the package / transport request
    " (the Workbench tool does the same via IF_WB_OBJECT_PERSIST~SAVE's
    " framework; the persistence class itself does not touch TADIR).
    CLEAR: ev_error, ev_message.
    CALL FUNCTION 'RS_CORR_INSERT'
      EXPORTING object          = iv_name
                object_class    = 'OA2P'
                devclass        = iv_package
                master_language = sy-langu
                korrnum         = iv_transport
                mode            = iv_mode
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
      WHEN 1 THEN 'OA2P_TRANSPORT_REQUIRED'
      WHEN 2 THEN 'OA2P_NOT_AUTHORIZED'
      ELSE 'OA2P_PACKAGE_ASSIGN_FAILED' ).
    ev_message = |RS_CORR_INSERT failed for OA2P { iv_name } (sy-subrc { lv_subrc })|.
  ENDMETHOD.

  METHOD lock_profile.
    " The persistence class enqueues OA2C_PROFILES; a foreign lock must not
    " become a write on top of another user's changes.
    CLEAR: ev_error, ev_message.
    CALL METHOD io_persist->lock
      EXPORTING
        p_objname_tr = CONV trobj_name( iv_name )
        p_object_key = CONV seu_objkey( iv_name )
        p_objtype_tr = gc_tadir_objtype
      EXCEPTIONS foreign_lock     = 1
                 error_occurred   = 2
                 OTHERS            = 3.
    IF sy-subrc = 1.
      ev_error = 'OA2P_LOCK_FAILED'.
      ev_message = |OAuth2 profile { iv_name } is locked by another user|.
    ELSEIF sy-subrc <> 0.
      ev_error = 'OA2P_LOCK_FAILED'.
      ev_message = |could not lock OAuth2 profile { iv_name } (sy-subrc { sy-subrc })|.
    ENDIF.
  ENDMETHOD.

  METHOD unlock_profile.
    CALL METHOD io_persist->unlock
      EXPORTING
        p_objname_tr = CONV trobj_name( iv_name )
        p_object_key = CONV seu_objkey( iv_name )
        p_objtype_tr = gc_tadir_objtype.
  ENDMETHOD.

  METHOD persist_error.
    " Map persistence/runtime exceptions to the structured error envelope.
    DATA lv_code TYPE string.
    IF iv_action = 'read'.
      lv_code = 'OA2P_READ_FAILED'.
    ELSEIF iv_action = 'delete'.
      lv_code = 'OA2P_DELETE_FAILED'.
    ELSE.
      lv_code = 'OA2P_WRITE_FAILED'.
    ENDIF.
    zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                   iv_status = 500
                   iv_reason = 'Internal Server Error'
                   iv_code   = lv_code
                   iv_msg    = |OA2P { iv_action } failed: { io_exc->get_text( ) }| ).
  ENDMETHOD.

  METHOD write_error.
    zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                   iv_status  = iv_status
                   iv_reason  = COND string( WHEN iv_status = 404 THEN 'Not Found'
                                             WHEN iv_status = 403 THEN 'Forbidden'
                                             WHEN iv_status = 500 THEN 'Internal Server Error'
                                             ELSE 'Bad Request' )
                   iv_code    = iv_code
                   iv_msg     = iv_msg
                   iv_details = iv_details ).
  ENDMETHOD.
ENDCLASS.
