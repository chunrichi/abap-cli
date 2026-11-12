CLASS zcl_abap_vibe_icf_ucon_http DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS dispatch_ucon_http
      IMPORTING io_server TYPE REF TO if_http_server
                iv_path   TYPE string
                iv_method TYPE string
                iv_body   TYPE string.
  PRIVATE SECTION.
    " ----- /ucon_http wire document (camelCase names through /ui2/cl_json) -----
    TYPES:
      BEGIN OF ty_handler_api,
        id             TYPE c LENGTH 30,
        version        TYPE c LENGTH 1,
        serviceorder   TYPE n LENGTH 2,
        servicehandler TYPE c LENGTH 30,
      END OF ty_handler_api,
      tt_handler_api TYPE STANDARD TABLE OF ty_handler_api,
      BEGIN OF ty_handler_wire,
        order         TYPE string,
        handler_class TYPE string,
      END OF ty_handler_wire,
      tt_handler_wire TYPE STANDARD TABLE OF ty_handler_wire WITH EMPTY KEY,
      BEGIN OF ty_icf_api,
        icfname    TYPE c LENGTH 15,
        icfparguid TYPE c LENGTH 25,
      END OF ty_icf_api,
      BEGIN OF ty_icf_wire,
        icf_name     TYPE string,
        icf_par_guid TYPE string,
      END OF ty_icf_wire,
      BEGIN OF ty_description_api,
        id        TYPE c LENGTH 30,
        version   TYPE c LENGTH 1,
        lang      TYPE c LENGTH 1,
        shorttext TYPE c LENGTH 255,
      END OF ty_description_api,
      BEGIN OF ty_ucon_http,
        format_version TYPE string,
        name           TYPE string,
        description    TYPE string,
        handlers       TYPE tt_handler_wire,
        icf_service    TYPE ty_icf_wire,
        package        TYPE string,
      END OF ty_ucon_http,
      BEGIN OF ty_ucon_http_write,
        format_version    TYPE string,
        name              TYPE string,
        description       TYPE string,
        handlers          TYPE tt_handler_wire,
        icf_service       TYPE ty_icf_wire,
        package           TYPE string,
        transport_request TYPE string,
      END OF ty_ucon_http_write,
      BEGIN OF ty_write_data,
        name    TYPE string,
        type    TYPE string,
        action  TYPE string,
        package TYPE string,
      END OF ty_write_data,
      BEGIN OF ty_read_response,
        status TYPE string,
        data   TYPE ty_ucon_http,
      END OF ty_read_response,
      BEGIN OF ty_write_response,
        status TYPE string,
        data   TYPE ty_write_data,
      END OF ty_write_response.
    CONSTANTS:
      gc_name_max          TYPE i VALUE 30,
      gc_description_max   TYPE i VALUE 255,
      gc_handler_max       TYPE i VALUE 30,
      gc_icf_name_max      TYPE i VALUE 15,
      gc_icf_par_guid_max  TYPE i VALUE 25,
      gc_format_version    TYPE string VALUE '1',
      gc_type              TYPE string VALUE 'UCON_HTTP',
      gc_action_created    TYPE string VALUE 'created',
      gc_action_updated    TYPE string VALUE 'updated',
      gc_action_deleted    TYPE string VALUE 'deleted'.

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
      IMPORTING is_input   TYPE ty_ucon_http_write
                iv_name    TYPE string
      EXPORTING es_wire    TYPE ty_ucon_http_write
                et_handler TYPE tt_handler_api
                ev_error   TYPE string
                ev_message TYPE string.
    CLASS-METHODS language_version_of
      IMPORTING it_handler  TYPE tt_handler_api
      EXPORTING ev_version  TYPE c LENGTH 1
                ev_known    TYPE abap_bool.
    CLASS-METHODS api_available
      RETURNING VALUE(rv_available) TYPE abap_bool.
    CLASS-METHODS service_exists
      IMPORTING iv_name        TYPE string
      RETURNING VALUE(rv_exists) TYPE abap_bool.
    CLASS-METHODS package_of
      IMPORTING iv_name           TYPE string
      RETURNING VALUE(rv_package) TYPE devclass.
    CLASS-METHODS read_api
      IMPORTING iv_name       TYPE string
      RETURNING VALUE(ro_api) TYPE REF TO object.
    CLASS-METHODS wire_from_api
      IMPORTING io_api          TYPE REF TO object
                iv_name         TYPE string
      RETURNING VALUE(rs_wire)  TYPE ty_ucon_http.
    CLASS-METHODS description_of
      IMPORTING iv_name               TYPE string
      RETURNING VALUE(rv_description) TYPE string.
    CLASS-METHODS check_package
      IMPORTING iv_package   TYPE devclass
                iv_transport TYPE trkorr
      EXPORTING ev_error     TYPE string
                ev_message   TYPE string.
    CLASS-METHODS respond_failure
      IMPORTING io_server TYPE REF TO if_http_server
                iv_action TYPE string
                io_exc    TYPE REF TO cx_root.
ENDCLASS.

CLASS zcl_abap_vibe_icf_ucon_http IMPLEMENTATION.
  METHOD dispatch_ucon_http.
    " Route /ucon_http/<name>. HTTP service ids are case-insensitive, so the
    " path segment is uppercased before any SAP-side lookup or write.
    DATA lv_name  TYPE string.
    DATA lv_error TYPE string.

    IF api_available( ) = abap_false.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 501
                     iv_reason = 'Not Implemented'
                     iv_code   = 'UCON_HTTP_API_UNAVAILABLE'
                     iv_msg    = 'this release does not expose UCON HTTP services (UCONHTTPSERVHEAD is missing); maintain the service in transaction UCONCOCKPIT' ).
      RETURN.
    ENDIF.

    IF strlen( iv_path ) <= strlen( '/ucon_http/' ).
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = 'UCON_HTTP_NAME_INVALID'
                     iv_msg    = 'service name is required on /ucon_http/<name>' ).
      RETURN.
    ENDIF.

    lv_name = to_upper( condense( val = substring( val = iv_path
                                                   off = strlen( '/ucon_http/' ) ) del = ` ` ) ).
    validate_name( EXPORTING iv_name  = lv_name
                   IMPORTING ev_error = lv_error ).
    IF lv_error IS NOT INITIAL.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = 'UCON_HTTP_NAME_INVALID'
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
                       iv_msg    = |{ iv_method } not supported on /ucon_http/<name>| ).
    ENDCASE.
  ENDMETHOD.

  METHOD read_service.
    " GET /ucon_http/<name>: the public UCON HTTP service API exposes the
    " handler list, the description and the optional ICF node link, so the route
    " never assembles row contents from the persistence tables.
    DATA lo_api TYPE REF TO object.

    IF service_exists( iv_name ) = abap_false.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 404
                     iv_reason = 'Not Found'
                     iv_code   = 'UCON_HTTP_OBJECT_NOT_FOUND'
                     iv_msg    = |UCON HTTP service { iv_name } does not exist| ).
      RETURN.
    ENDIF.

    TRY.
        lo_api = read_api( iv_name ).
        DATA(ls_response) = VALUE ty_read_response( status = 'success'
                                                    data   = wire_from_api( io_api  = lo_api
                                                                            iv_name = iv_name ) ).
        zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                       iv_status  = 200
                       iv_reason  = 'OK'
                       is_payload = ls_response ).
      CATCH cx_root INTO DATA(lx_root).
        respond_failure( io_server = io_server iv_action = 'read' io_exc = lx_root ).
    ENDTRY.
  ENDMETHOD.

  METHOD write_service.
    " POST /ucon_http/<name>: upsert through the public UCON HTTP service API
    " (CL_UCON_API_FACTORY / IF_UCON_API_HTTP_SERVICE), the same path abapGit and
    " UCONCOCKPIT use. The API records TADIR / the transport request on SAVE.
    DATA ls_input   TYPE ty_ucon_http_write.
    DATA ls_wire    TYPE ty_ucon_http_write.
    DATA lt_handler TYPE tt_handler_api.
    DATA lv_error   TYPE string.
    DATA lv_message TYPE string.
    DATA lv_exists  TYPE abap_bool.
    DATA lv_package TYPE devclass.
    DATA lv_action  TYPE string.
    DATA lo_api     TYPE REF TO object.

    IF iv_body IS INITIAL.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = 'UCON_HTTP_INVALID_PAYLOAD'
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
                       iv_code   = 'UCON_HTTP_INVALID_PAYLOAD'
                       iv_msg    = |invalid JSON payload: { lx_parse->get_text( ) }| ).
        RETURN.
    ENDTRY.

    validate_payload( EXPORTING is_input   = ls_input
                                iv_name    = iv_name
                      IMPORTING es_wire    = ls_wire
                                et_handler = lt_handler
                                ev_error   = lv_error
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
        IF lv_exists = abap_true.
          lo_api = read_api( iv_name ).
        ELSE.
          CALL METHOD ('CL_UCON_API_FACTORY')=>('NEW_HTTP_SERVICE')
            EXPORTING
              name         = iv_name
            RECEIVING
              http_service = lo_api.
        ENDIF.

        CALL METHOD lo_api->('IF_UCON_API_HTTP_SERVICE~SET_HANDLER')
          EXPORTING
            handler = lt_handler.

        language_version_of( EXPORTING it_handler = lt_handler
                             IMPORTING ev_version = DATA(lv_language_version)
                                       ev_known   = DATA(lv_version_known) ).
        IF lv_version_known = abap_true.
          TRY.
              CALL METHOD lo_api->('IF_UCON_API_HTTP_SERVICE~SET_LANGUAGE_VERSION')
                EXPORTING
                  iv_langu_version = lv_language_version.
            CATCH cx_root.
              " Releases without the language-version setter keep the default.
          ENDTRY.
        ENDIF.

        DATA ls_text TYPE ty_description_api.
        ls_text-id        = CONV uconhttpservid( iv_name ).
        ls_text-version   = 'A'.
        ls_text-lang      = sy-langu.
        ls_text-shorttext = ls_wire-description.
        CALL METHOD lo_api->('IF_UCON_API_HTTP_SERVICE~SET_DESCRIPTION')
          EXPORTING
            texts = ls_text.

        DATA ls_icf TYPE ty_icf_api.
        ls_icf-icfname    = ls_wire-icf_service-icf_name.
        ls_icf-icfparguid = ls_wire-icf_service-icf_par_guid.
        CALL METHOD lo_api->('IF_UCON_API_HTTP_SERVICE~SET_ICF_SERVICE')
          EXPORTING
            iv_icfservice = ls_icf.

        CALL METHOD lo_api->('IF_UCON_API_HTTP_SERVICE~ACTIVATE').
        CALL METHOD lo_api->('IF_UCON_API_HTTP_SERVICE~SAVE')
          EXPORTING
            run_dark  = abap_true
            dev_class = lv_package
            korrnum   = CONV trkorr( ls_wire-transport_request ).
        TRY.
            CALL METHOD lo_api->('IF_UCON_API_HTTP_SERVICE~FREE').
          CATCH cx_root.
            " The write is already committed; a failing FREE is not an error.
        ENDTRY.
        CLEAR lo_api.

        DATA(ls_response) = VALUE ty_write_response(
          status = 'success'
          data   = VALUE ty_write_data( name    = iv_name
                                        type    = gc_type
                                        action  = lv_action
                                        package = CONV string( lv_package ) ) ).
        zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                       iv_status  = 200
                       iv_reason  = 'OK'
                       is_payload = ls_response ).
      CATCH cx_root INTO DATA(lx_root).
        respond_failure( io_server = io_server iv_action = 'write' io_exc = lx_root ).
    ENDTRY.
  ENDMETHOD.

  METHOD delete_service.
    " DELETE /ucon_http/<name>: CL_UCON_API_FACTORY=>DELETE_HTTP_SERVICE removes
    " the header/text/handler rows and the TADIR entry and records the request.
    DATA lv_package   TYPE devclass.
    DATA lv_transport TYPE trkorr.
    DATA lv_match     TYPE string.

    IF service_exists( iv_name ) = abap_false.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 404
                     iv_reason = 'Not Found'
                     iv_code   = 'UCON_HTTP_OBJECT_NOT_FOUND'
                     iv_msg    = |UCON HTTP service { iv_name } does not exist| ).
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
                       iv_code   = 'UCON_HTTP_TRANSPORT_REQUIRED'
                       iv_msg    = |UCON HTTP service { iv_name } is in package { lv_package }; a transport request is required to record the deletion| ).
        RETURN.
      ENDIF.
    ENDIF.

    TRY.
        CALL METHOD ('CL_UCON_API_FACTORY')=>('DELETE_HTTP_SERVICE')
          EXPORTING
            name     = iv_name
            devclass = lv_package
            korrnum  = lv_transport
            run_dark = abap_true.

        DATA(ls_response) = VALUE ty_write_response(
          status = 'success'
          data   = VALUE ty_write_data( name    = iv_name
                                        type    = gc_type
                                        action  = gc_action_deleted
                                        package = CONV string( lv_package ) ) ).
        zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                       iv_status  = 200
                       iv_reason  = 'OK'
                       is_payload = ls_response ).
      CATCH cx_root INTO DATA(lx_root).
        respond_failure( io_server = io_server iv_action = 'delete' io_exc = lx_root ).
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
      ev_error = |service name must not exceed { gc_name_max } characters (UCONHTTPSERVID); got { strlen( iv_name ) }|.
      RETURN.
    ENDIF.
    IF iv_name CO 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_/'.
      RETURN.
    ENDIF.
    ev_error = |service name may only contain A-Z, 0-9, '_' and '/' (got '{ iv_name }')|.
  ENDMETHOD.

  METHOD validate_payload.
    " Validate the wire document and normalise the fields the API expects:
    " handlers are ordered, handler classes must exist, description/ICF link
    " lengths are checked before the write.
    CLEAR: es_wire, et_handler, ev_error, ev_message.
    es_wire-format_version = gc_format_version.
    es_wire-name = iv_name.

    DATA(lv_format_version) = to_upper( condense( val = is_input-format_version del = ` ` ) ).
    IF lv_format_version IS NOT INITIAL AND lv_format_version <> gc_format_version.
      ev_error = 'UCON_HTTP_INVALID_PAYLOAD'.
      ev_message = |formatVersion must be '{ gc_format_version }' (got '{ is_input-format_version }')|.
      RETURN.
    ENDIF.
    IF is_input-name IS NOT INITIAL AND to_upper( condense( val = is_input-name del = ` ` ) ) <> iv_name.
      ev_error = 'UCON_HTTP_INVALID_PAYLOAD'.
      ev_message = |payload name '{ is_input-name }' does not match URL service '{ iv_name }'|.
      RETURN.
    ENDIF.

    DATA(lv_description) = condense( val = is_input-description ).
    IF strlen( lv_description ) > gc_description_max.
      ev_error = 'UCON_HTTP_INVALID_PAYLOAD'.
      ev_message = |description must not exceed { gc_description_max } characters (UCONHTTPSERVTEXT); got { strlen( lv_description ) }|.
      RETURN.
    ENDIF.
    IF lv_description CS cl_abap_char_utilities=>cr_lf OR lv_description CS cl_abap_char_utilities=>newline.
      ev_error = 'UCON_HTTP_INVALID_PAYLOAD'.
      ev_message = 'description must be a single line (UCONHTTPSERVTEXT is one CHAR 255 field)'.
      RETURN.
    ENDIF.
    es_wire-description = lv_description.

    DATA lv_index TYPE i.
    LOOP AT is_input-handlers INTO DATA(ls_wire_handler).
      lv_index = lv_index + 1.
      DATA(lv_class) = to_upper( condense( val = ls_wire_handler-handler_class del = ` ` ) ).
      IF lv_class IS INITIAL.
        ev_error = 'UCON_HTTP_INVALID_PAYLOAD'.
        ev_message = |handlers[{ lv_index }].handlerClass is required|.
        RETURN.
      ENDIF.
      IF strlen( lv_class ) > gc_handler_max.
        ev_error = 'UCON_HTTP_INVALID_PAYLOAD'.
        ev_message = |handlers[{ lv_index }].handlerClass must not exceed { gc_handler_max } characters; got { strlen( lv_class ) }|.
        RETURN.
      ENDIF.
      IF lv_class CN 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_/'.
        ev_error = 'UCON_HTTP_INVALID_PAYLOAD'.
        ev_message = |handlers[{ lv_index }].handlerClass may only contain A-Z, 0-9, '_' and '/' (got '{ ls_wire_handler-handler_class }')|.
        RETURN.
      ENDIF.

      DATA(lv_order_text) = condense( val = ls_wire_handler-order del = ` ` ).
      IF lv_order_text IS NOT INITIAL
          AND ( lv_order_text CN '0123456789' OR strlen( lv_order_text ) > 2 ).
        ev_error = 'UCON_HTTP_INVALID_PAYLOAD'.
        ev_message = |handlers[{ lv_index }].order must be a 1 or 2 digit service order (got '{ ls_wire_handler-order }')|.
        RETURN.
      ENDIF.
      IF lv_order_text IS INITIAL.
        lv_order_text = |{ lv_index }|.
      ENDIF.

      DATA ls_handler TYPE ty_handler_api.
      ls_handler-id             = iv_name.
      ls_handler-version        = 'A'.
      ls_handler-serviceorder   = lv_order_text.
      ls_handler-servicehandler = lv_class.
      APPEND ls_handler TO et_handler.
    ENDLOOP.

    IF et_handler IS INITIAL.
      ev_error = 'UCON_HTTP_INVALID_PAYLOAD'.
      ev_message = 'handlers must contain at least one handler class'.
      RETURN.
    ENDIF.

    SORT et_handler BY serviceorder.
    DATA lv_previous_order TYPE n LENGTH 2.
    LOOP AT et_handler INTO DATA(ls_handler_check).
      IF sy-tabix > 1 AND ls_handler_check-serviceorder = lv_previous_order.
        ev_error = 'UCON_HTTP_INVALID_PAYLOAD'.
        ev_message = |handler service order { ls_handler_check-serviceorder } is used more than once|.
        RETURN.
      ENDIF.
      lv_previous_order = ls_handler_check-serviceorder.

      SELECT SINGLE clsname FROM seoclass
        WHERE clsname = @ls_handler_check-servicehandler
        INTO @DATA(lv_class_name).
      IF sy-subrc <> 0.
        ev_error = 'UCON_HTTP_HANDLER_NOT_FOUND'.
        ev_message = |handler class { ls_handler_check-servicehandler } does not exist|.
        RETURN.
      ENDIF.
    ENDLOOP.

    DATA(lv_icf_name) = to_upper( condense( val = is_input-icf_service-icf_name del = ` ` ) ).
    DATA(lv_icf_par_guid) = to_upper( condense( val = is_input-icf_service-icf_par_guid del = ` ` ) ).
    IF lv_icf_name IS NOT INITIAL OR lv_icf_par_guid IS NOT INITIAL.
      IF strlen( lv_icf_name ) > gc_icf_name_max.
        ev_error = 'UCON_HTTP_INVALID_PAYLOAD'.
        ev_message = |icfService.icfName must not exceed { gc_icf_name_max } characters (ICFNAME); got { strlen( lv_icf_name ) }|.
        RETURN.
      ENDIF.
      IF strlen( lv_icf_par_guid ) > gc_icf_par_guid_max.
        ev_error = 'UCON_HTTP_INVALID_PAYLOAD'.
        ev_message = |icfService.icfParGuid must not exceed { gc_icf_par_guid_max } characters (ICFPARGUID); got { strlen( lv_icf_par_guid ) }|.
        RETURN.
      ENDIF.
      es_wire-icf_service-icf_name     = lv_icf_name.
      es_wire-icf_service-icf_par_guid = lv_icf_par_guid.
    ENDIF.

    es_wire-package           = to_upper( condense( val = is_input-package del = ` ` ) ).
    es_wire-transport_request = to_upper( condense( val = is_input-transport_request del = ` ` ) ).
  ENDMETHOD.

  METHOD language_version_of.
    " Derive the ABAP language version from the first handler class, mirroring
    " UCONCOCKPIT: the service inherits the handler class version. ABAP Cloud
    " ('X') is stored as the standard version, matching abapGit.
    CLEAR: ev_version, ev_known.
    READ TABLE it_handler INTO DATA(ls_handler) INDEX 1.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    TRY.
        DATA(lo_lang_version) = cl_abap_language_version=>get_instance( ).
        DATA(ls_object_version) = lo_lang_version->get_version_of_object(
          iv_object_type  = 'CLAS'
          iv_object_name  = CONV if_abap_language_version=>ty_object_name( ls_handler-servicehandler )
          iv_object_state = if_abap_language_version=>gc_object_state-active ).
        ev_version = ls_object_version-id.
        IF ev_version = if_abap_language_version=>gc_version-sap_cloud_platform.
          ev_version = space.
        ENDIF.
        ev_known = abap_true.
      CATCH cx_root.
        " Introspection failures must not block the write; keep the default.
    ENDTRY.
  ENDMETHOD.

  METHOD api_available.
    " The UCON HTTP API is not present on every release the bundled handler
    " compiles on; a dynamic probe keeps the class deployable and lets the
    " route answer 501 instead of dumping.
    DATA lv_probe TYPE uconhttpservid.
    TRY.
        SELECT SINGLE id FROM ('UCONHTTPSERVHEAD') WHERE id = @lv_probe INTO @DATA(lv_id).
        rv_available = abap_true.
      CATCH cx_root.
        rv_available = abap_false.
    ENDTRY.
  ENDMETHOD.

  METHOD service_exists.
    " UCONHTTPSERVHEAD is the persisted authority: a TADIR-only leftover does
    " not make the object readable.
    DATA lv_key TYPE uconhttpservid.
    lv_key = iv_name.
    TRY.
        SELECT SINGLE id FROM ('UCONHTTPSERVHEAD') WHERE id = @lv_key INTO @DATA(lv_id).
        rv_exists = boolc( sy-subrc = 0 ).
      CATCH cx_root.
        rv_exists = abap_false.
    ENDTRY.
  ENDMETHOD.

  METHOD package_of.
    " Package from TADIR; a service created outside the WB tooling may have no
    " row, which callers treat as $TMP (the same default the API uses).
    DATA lv_key TYPE uconhttpservid.
    lv_key = iv_name.
    CLEAR rv_package.
    SELECT SINGLE devclass FROM tadir
      WHERE pgmid = 'R3TR' AND object = 'HTTP' AND obj_name = @lv_key
      INTO @rv_package.
    rv_package = to_upper( condense( val = rv_package del = ` ` ) ).
  ENDMETHOD.

  METHOD read_api.
    " CL_UCON_API_FACTORY is called dynamically (like abapGit) so the handler
    " still compiles on releases that do not ship the UCON HTTP API.
    CALL METHOD ('CL_UCON_API_FACTORY')=>('GET_HTTP_SERVICE')
      EXPORTING
        name          = iv_name
        no_auth_check = abap_true
      RECEIVING
        http_service  = ro_api.
  ENDMETHOD.

  METHOD wire_from_api.
    " Map the API getters to the wire document. The description falls back to
    " any maintained language row so a pull in a non-English session still
    " produces a useful document.
    CLEAR rs_wire.
    rs_wire-format_version = gc_format_version.

    DATA lv_name TYPE string.
    CALL METHOD io_api->('IF_UCON_API_HTTP_SERVICE~GET_NAME')
      RECEIVING
        name = lv_name.
    lv_name = to_upper( condense( val = lv_name del = ` ` ) ).
    IF lv_name IS INITIAL.
      lv_name = iv_name.
    ENDIF.
    rs_wire-name    = lv_name.
    rs_wire-package = CONV string( package_of( lv_name ) ).

    DATA lt_handler TYPE STANDARD TABLE OF ty_handler_api.
    CALL METHOD io_api->('IF_UCON_API_HTTP_SERVICE~GET_HANDLER')
      RECEIVING
        handler = lt_handler.
    SORT lt_handler BY serviceorder.
    LOOP AT lt_handler INTO DATA(ls_handler).
      APPEND VALUE ty_handler_wire(
        order         = CONV string( ls_handler-serviceorder )
        handler_class = to_upper( condense( val = ls_handler-servicehandler del = ` ` ) ) )
        TO rs_wire-handlers.
    ENDLOOP.

    DATA ls_text TYPE ty_description_api.
    TRY.
        CALL METHOD io_api->('IF_UCON_API_HTTP_SERVICE~GET_DESCRIPTION')
          EXPORTING
            lang = sy-langu
          RECEIVING
            text = ls_text.
      CATCH cx_root.
        CLEAR ls_text.
    ENDTRY.
    rs_wire-description = condense( val = ls_text-shorttext ).
    IF rs_wire-description IS INITIAL.
      rs_wire-description = description_of( iv_name = lv_name ).
    ENDIF.

    DATA ls_icf TYPE ty_icf_api.
    TRY.
        CALL METHOD io_api->('IF_UCON_API_HTTP_SERVICE~GET_ICF_SERVICE')
          IMPORTING
            ev_icfservice = ls_icf.
      CATCH cx_root.
        CLEAR ls_icf.
    ENDTRY.
    rs_wire-icf_service-icf_name     = to_upper( condense( val = ls_icf-icfname del = ` ` ) ).
    rs_wire-icf_service-icf_par_guid = to_upper( condense( val = ls_icf-icfparguid del = ` ` ) ).
  ENDMETHOD.

  METHOD description_of.
    " Session-language description, then any other language as a lossless-enough
    " fallback for SAP-shipped services that only carry one language row.
    DATA lv_key TYPE uconhttpservid.
    lv_key = iv_name.
    CLEAR rv_description.
    TRY.
        SELECT SINGLE shorttext FROM ('UCONHTTPSERVTEXT')
          WHERE id = @lv_key AND version = 'A' AND lang = @sy-langu
          INTO @rv_description.
        IF rv_description IS INITIAL.
          SELECT SINGLE shorttext FROM ('UCONHTTPSERVTEXT')
            WHERE id = @lv_key AND version = 'A'
            INTO @rv_description.
        ENDIF.
      CATCH cx_root.
        CLEAR rv_description.
    ENDTRY.
    rv_description = condense( val = rv_description ).
  ENDMETHOD.

  METHOD check_package.
    " Fail before the write when the package cannot be written from the ICF
    " context: a missing package, or a transportable package without a request
    " (the CTS dialog is suppressed here).
    CLEAR: ev_error, ev_message.
    IF iv_package IS INITIAL.
      ev_error = 'UCON_HTTP_PACKAGE_INVALID'.
      ev_message = 'a target package is required for UCON_HTTP'.
      RETURN.
    ENDIF.
    SELECT SINGLE korrflag FROM tdevc WHERE devclass = @iv_package INTO @DATA(lv_korrflag).
    IF sy-subrc <> 0.
      ev_error = 'UCON_HTTP_PACKAGE_INVALID'.
      ev_message = |package { iv_package } does not exist|.
      RETURN.
    ENDIF.
    IF zcl_abap_vibe_icf_types=>is_local_package( iv_package ) = abap_true.
      RETURN.
    ENDIF.
    IF iv_transport IS INITIAL.
      ev_error = 'UCON_HTTP_TRANSPORT_REQUIRED'.
      ev_message = |package { iv_package } is transportable; a transport request is required|.
      RETURN.
    ENDIF.
  ENDMETHOD.

  METHOD respond_failure.
    " The UCON HTTP API exception class is referenced dynamically, so failures
    " share one 500 code family instead of the per-T100 mapping SRFC can do.
    DATA lv_code TYPE string.
    IF iv_action = 'read'.
      lv_code = 'UCON_HTTP_READ_FAILED'.
    ELSEIF iv_action = 'delete'.
      lv_code = 'UCON_HTTP_DELETE_FAILED'.
    ELSE.
      lv_code = 'UCON_HTTP_WRITE_FAILED'.
    ENDIF.
    zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                   iv_status = 500
                   iv_reason = 'Internal Server Error'
                   iv_code   = lv_code
                   iv_msg    = |UCON HTTP service { iv_action } failed: { io_exc->get_text( ) }| ).
  ENDMETHOD.
ENDCLASS.
