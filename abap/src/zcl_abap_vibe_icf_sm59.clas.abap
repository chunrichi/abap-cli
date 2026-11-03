CLASS zcl_abap_vibe_icf_sm59 DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS dispatch_sm59
      IMPORTING io_server TYPE REF TO if_http_server
                iv_path   TYPE string
                iv_method TYPE string
                iv_body   TYPE string.
  PRIVATE SECTION.
    " ----- /sm59 wire document (camelCase names through /ui2/cl_json) -----
    TYPES:
      BEGIN OF ty_sm59,
        format_version TYPE string,
        name           TYPE string,
        type           TYPE string,
        description    TYPE string,
        target_host    TYPE string,
        port           TYPE i,
        protocol       TYPE string,
        path_prefix    TYPE string,
      END OF ty_sm59,
      BEGIN OF ty_sm59_write,
        name   TYPE string,
        type   TYPE string,
        action TYPE string,
      END OF ty_sm59_write,
      BEGIN OF ty_sm59_response,
        status TYPE string,
        data   TYPE ty_sm59,
      END OF ty_sm59_response,
      BEGIN OF ty_sm59_write_response,
        status TYPE string,
        data   TYPE ty_sm59_write,
      END OF ty_sm59_write_response.
    CONSTANTS:
      gc_name_max       TYPE i VALUE 32,
      gc_desc_max       TYPE i VALUE 72,
      gc_host_max       TYPE i VALUE 1024,
      gc_path_max       TYPE i VALUE 255,
      gc_port_max       TYPE i VALUE 65535,
      gc_port_http      TYPE i VALUE 80,
      gc_port_https     TYPE i VALUE 443,
      gc_type_http_ext  TYPE rfctype_d VALUE 'G',
      gc_protocol_http  TYPE string VALUE 'HTTP',
      gc_protocol_https TYPE string VALUE 'HTTPS',
      gc_format_version TYPE string VALUE '1'.

    " ----- GET -----
    CLASS-METHODS read_destination
      IMPORTING io_server TYPE REF TO if_http_server
                iv_name   TYPE string.
    " ----- POST (create/update) -----
    CLASS-METHODS write_destination
      IMPORTING io_server TYPE REF TO if_http_server
                iv_name   TYPE string
                iv_body   TYPE string.
    " ----- DELETE -----
    CLASS-METHODS delete_destination
      IMPORTING io_server TYPE REF TO if_http_server
                iv_name   TYPE string.
    " ----- shared helpers -----
    CLASS-METHODS destination_state
      IMPORTING iv_name    TYPE string
      EXPORTING ev_exists  TYPE abap_bool
                ev_rfctype TYPE rfctype_d.
    CLASS-METHODS validate_name
      IMPORTING iv_name  TYPE string
      EXPORTING ev_error TYPE string.
    CLASS-METHODS is_reserved_name
      IMPORTING iv_name TYPE string
      RETURNING VALUE(rv_reserved) TYPE abap_bool.
    CLASS-METHODS normalize_payload
      IMPORTING is_input  TYPE ty_sm59
                iv_name   TYPE string
      EXPORTING es_wire   TYPE ty_sm59
                ev_error  TYPE string.
    CLASS-METHODS wire_from_destination
      IMPORTING io_root TYPE REF TO if_dest_root
                io_http TYPE REF TO if_dest_http_ext
      RETURNING VALUE(rs_wire) TYPE ty_sm59.
    CLASS-METHODS description_of
      IMPORTING iv_name        TYPE string
                iv_description TYPE string
      RETURNING VALUE(rv_description) TYPE string.
    CLASS-METHODS respond_api_error
      IMPORTING io_server TYPE REF TO if_http_server
                iv_action TYPE string
                io_exc    TYPE REF TO cx_dest_api.
    CLASS-METHODS respond_runtime_error
      IMPORTING io_server TYPE REF TO if_http_server
                iv_action TYPE string
                io_exc    TYPE REF TO cx_root.
ENDCLASS.

CLASS zcl_abap_vibe_icf_sm59 IMPLEMENTATION.
  METHOD dispatch_sm59.
    " Route /sm59/<name>. The destination name is case-insensitive, so the path
    " segment is uppercased before any SAP-side lookup or write.
    DATA lv_name  TYPE string.
    DATA lv_error TYPE string.

    IF strlen( iv_path ) <= strlen( '/sm59/' ).
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = 'SM59_NAME_INVALID'
                     iv_msg    = 'destination name is required on /sm59/<name>' ).
      RETURN.
    ENDIF.

    lv_name = to_upper( condense( val = substring( val = iv_path
                                                   off = strlen( '/sm59/' ) ) del = ` ` ) ).
    validate_name( EXPORTING iv_name  = lv_name
                   IMPORTING ev_error = lv_error ).
    IF lv_error IS NOT INITIAL.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = 'SM59_NAME_INVALID'
                     iv_msg    = lv_error ).
      RETURN.
    ENDIF.

    CASE iv_method.
      WHEN 'GET'.
        read_destination( io_server = io_server iv_name = lv_name ).
      WHEN 'POST'.
        write_destination( io_server = io_server iv_name = lv_name iv_body = iv_body ).
      WHEN 'DELETE'.
        delete_destination( io_server = io_server iv_name = lv_name ).
      WHEN OTHERS.
        zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                       iv_status = 405
                       iv_reason = 'Method Not Allowed'
                       iv_code   = 'METHOD_NOT_ALLOWED'
                       iv_msg    = |{ iv_method } not supported on /sm59/<name>| ).
    ENDCASE.
  ENDMETHOD.

  METHOD read_destination.
    " GET /sm59/<name>: classify the RFCDES row, then read the HTTP attributes
    " through the standard SRFC_DESTAPI getters (no manual RFCOPTIONS parsing).
    DATA lv_exists  TYPE abap_bool.
    DATA lv_rfctype TYPE rfctype_d.

    destination_state( EXPORTING iv_name    = iv_name
                       IMPORTING ev_exists  = lv_exists
                                 ev_rfctype = lv_rfctype ).
    IF lv_exists = abap_false.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 404
                     iv_reason = 'Not Found'
                     iv_code   = 'SM59_OBJECT_NOT_FOUND'
                     iv_msg    = |SM59 destination { iv_name } does not exist| ).
      RETURN.
    ENDIF.
    IF lv_rfctype <> gc_type_http_ext.
      DATA lt_details TYPE string_table.
      APPEND |rfctype={ lv_rfctype }| TO lt_details.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = 'SM59_TYPE_NOT_SUPPORTED'
                     iv_msg    = |SM59 destination { iv_name } has RFCTYPE '{ lv_rfctype }'; only HTTP connections to external server (type G) are supported|
                     iv_details = lt_details ).
      RETURN.
    ENDIF.

    TRY.
        DATA(lo_root) = cl_dest_factory=>create( name = CONV rfcdest( iv_name ) ).
        DATA lo_http TYPE REF TO if_dest_http_ext.
        lo_http ?= lo_root.
        DATA(ls_response) = VALUE ty_sm59_response(
          status = 'success'
          data   = wire_from_destination( io_root = lo_root io_http = lo_http ) ).
        zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                       iv_status = 200
                       iv_reason = 'OK'
                       is_payload = ls_response ).
      CATCH cx_dest_api INTO DATA(lx_api).
        respond_api_error( io_server = io_server iv_action = 'read' io_exc = lx_api ).
      CATCH cx_root INTO DATA(lx_root).
        respond_runtime_error( io_server = io_server iv_action = 'read' io_exc = lx_root ).
    ENDTRY.
  ENDMETHOD.

  METHOD write_destination.
    " POST /sm59/<name>: upsert through the standard API. A missing destination
    " is created (create_new), an existing one is loaded with the enqueue lock,
    " the modelled fields are overwritten and saved.
    DATA lv_body     TYPE ty_sm59.
    DATA ls_wire     TYPE ty_sm59.
    DATA lv_error    TYPE string.
    DATA lv_exists   TYPE abap_bool.
    DATA lv_rfctype  TYPE rfctype_d.
    DATA lv_action   TYPE string.
    DATA lo_root     TYPE REF TO if_dest_root.
    DATA lo_http     TYPE REF TO if_dest_http_ext.

    IF iv_body IS INITIAL.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = 'SM59_INVALID_PAYLOAD'
                     iv_msg    = 'request body is empty' ).
      RETURN.
    ENDIF.
    TRY.
        /ui2/cl_json=>deserialize( EXPORTING json        = iv_body
                                             pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                                   CHANGING  data        = lv_body ).
      CATCH cx_root INTO DATA(lx_parse).
        zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                       iv_status = 400
                       iv_reason = 'Bad Request'
                       iv_code   = 'SM59_INVALID_PAYLOAD'
                       iv_msg    = |invalid JSON payload: { lx_parse->get_text( ) }| ).
        RETURN.
    ENDTRY.

    normalize_payload( EXPORTING is_input = lv_body
                                 iv_name  = iv_name
                       IMPORTING es_wire  = ls_wire
                                 ev_error = lv_error ).
    IF lv_error IS NOT INITIAL.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = 'SM59_INVALID_PAYLOAD'
                     iv_msg    = lv_error ).
      RETURN.
    ENDIF.

    destination_state( EXPORTING iv_name    = iv_name
                       IMPORTING ev_exists  = lv_exists
                                 ev_rfctype = lv_rfctype ).
    IF lv_exists = abap_true AND lv_rfctype <> gc_type_http_ext.
      DATA lt_details TYPE string_table.
      APPEND |rfctype={ lv_rfctype }| TO lt_details.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = 'SM59_TYPE_NOT_SUPPORTED'
                     iv_msg    = |SM59 destination { iv_name } has RFCTYPE '{ lv_rfctype }'; only HTTP connections to external server (type G) can be written|
                     iv_details = lt_details ).
      RETURN.
    ENDIF.

    TRY.
        IF lv_exists = abap_true.
          lo_root = cl_dest_factory=>create( name = CONV rfcdest( iv_name ) lock = abap_true ).
          lv_action = 'updated'.
        ELSE.
          lo_root = cl_dest_factory=>create_new( name = CONV rfcdest( iv_name )
                                                 type = gc_type_http_ext
                                                 lock = abap_true ).
          lv_action = 'created'.
        ENDIF.
        lo_http ?= lo_root.

        DATA lv_description TYPE rfcdoc_d.
        DATA lv_server_name TYPE rfchost_ext.
        DATA lv_service     TYPE rfcsysid.
        DATA lv_path_prefix TYPE pfadpre.
        lv_description = ls_wire-description.
        lv_server_name = ls_wire-target_host.
        lv_service     = ls_wire-port.
        lv_path_prefix = ls_wire-path_prefix.

        lo_http->set_description( description = lv_description ).
        lo_http->set_server_name( server_name = lv_server_name ).
        lo_http->set_service_number( service_number = lv_service ).
        lo_http->set_ssl_active( ssl_active = boolc( ls_wire-protocol = gc_protocol_https ) ).
        lo_http->set_path_prefix( path_prefix = lv_path_prefix ).
        lo_http->save( ).
        lo_http->unlock( ).

        DATA(ls_response) = VALUE ty_sm59_write_response(
          status = 'success'
          data   = VALUE ty_sm59_write( name   = iv_name
                                        type   = gc_type_http_ext
                                        action = lv_action ) ).
        zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                       iv_status = 200
                       iv_reason = 'OK'
                       is_payload = ls_response ).
      CATCH cx_dest_api INTO DATA(lx_api).
        IF lo_root IS BOUND.
          TRY.
              lo_root->unlock( ).
            CATCH cx_root.
          ENDTRY.
        ENDIF.
        respond_api_error( io_server = io_server iv_action = 'write' io_exc = lx_api ).
      CATCH cx_root INTO DATA(lx_root).
        IF lo_root IS BOUND.
          TRY.
              lo_root->unlock( ).
            CATCH cx_root.
          ENDTRY.
        ENDIF.
        respond_runtime_error( io_server = io_server iv_action = 'write' io_exc = lx_root ).
    ENDTRY.
  ENDMETHOD.

  METHOD delete_destination.
    " DELETE /sm59/<name>: CL_DEST_FACTORY=>DELETE is the canonical dialog-free
    " delete (it releases the secure-store entries and all related table rows).
    DATA lv_exists  TYPE abap_bool.
    DATA lv_rfctype TYPE rfctype_d.

    destination_state( EXPORTING iv_name    = iv_name
                       IMPORTING ev_exists  = lv_exists
                                 ev_rfctype = lv_rfctype ).
    IF lv_exists = abap_false.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 404
                     iv_reason = 'Not Found'
                     iv_code   = 'SM59_OBJECT_NOT_FOUND'
                     iv_msg    = |SM59 destination { iv_name } does not exist| ).
      RETURN.
    ENDIF.
    IF lv_rfctype <> gc_type_http_ext.
      DATA lt_details TYPE string_table.
      APPEND |rfctype={ lv_rfctype }| TO lt_details.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = 'SM59_TYPE_NOT_SUPPORTED'
                     iv_msg    = |SM59 destination { iv_name } has RFCTYPE '{ lv_rfctype }'; only HTTP connections to external server (type G) can be deleted|
                     iv_details = lt_details ).
      RETURN.
    ENDIF.

    TRY.
        cl_dest_factory=>delete( name = CONV rfcdest( iv_name ) ).
        DATA(ls_response) = VALUE ty_sm59_write_response(
          status = 'success'
          data   = VALUE ty_sm59_write( name   = iv_name
                                        type   = gc_type_http_ext
                                        action = 'deleted' ) ).
        zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                       iv_status = 200
                       iv_reason = 'OK'
                       is_payload = ls_response ).
      CATCH cx_dest_api INTO DATA(lx_api).
        respond_api_error( io_server = io_server iv_action = 'delete' io_exc = lx_api ).
      CATCH cx_root INTO DATA(lx_root).
        respond_runtime_error( io_server = io_server iv_action = 'delete' io_exc = lx_root ).
    ENDTRY.
  ENDMETHOD.

  METHOD destination_state.
    " Read-only RFCDES classification: existence and RFCTYPE are needed to
    " distinguish 404 / type-not-supported from a maintenance-API failure.
    CLEAR: ev_exists, ev_rfctype.
    SELECT SINGLE rfctype FROM rfcdes
      WHERE rfcdest = @iv_name
      INTO @ev_rfctype.
    IF sy-subrc = 0.
      ev_exists = abap_true.
    ENDIF.
  ENDMETHOD.

  METHOD validate_name.
    " Mirror the non-interactive part of CL_DEST_UTILITY=>CHECK_NAME. Names that
    " would make the standard API open a POPUP_TO_CONFIRM are rejected instead:
    " an ICF request must never wait for or require a GUI dialog.
    CLEAR ev_error.
    IF iv_name IS INITIAL.
      ev_error = 'destination name must not be empty'.
      RETURN.
    ENDIF.
    IF strlen( iv_name ) > gc_name_max.
      ev_error = |destination name must not exceed { gc_name_max } characters (RFCDEST); got { strlen( iv_name ) }|.
      RETURN.
    ENDIF.
    IF iv_name CA ' '.
      ev_error = 'destination name must not contain whitespace'.
      RETURN.
    ENDIF.
    IF substring( val = iv_name len = 1 ) CA `#@$%*_+-:.;,/\&?"=!`.
      ev_error = 'destination name must not start with one of # @ $ % * _ + - : . ; , / \ & ? " = !'.
      RETURN.
    ENDIF.
    IF iv_name = 'A_RFC' OR iv_name = 'B_RFC'.
      ev_error = |destination name { iv_name } is reserved by SAP|.
      RETURN.
    ENDIF.
    IF is_reserved_name( iv_name ) = abap_true.
      ev_error = |destination name { iv_name } matches an internal-reserved SM59 name pattern that requires an interactive confirmation; maintain such a destination in SM59 directly|.
      RETURN.
    ENDIF.
  ENDMETHOD.

  METHOD is_reserved_name.
    " Same five patterns as CL_DEST_UTILITY=>CHECK_NAME, where the SM59 UI asks
    " the user to confirm before saving. Fail closed if the regex engine errors.
    rv_reserved = abap_false.
    TRY.
        IF cl_abap_matcher=>matches( pattern     = 'NONE\[.{0,}\]'
                                     ignore_case = abap_true
                                     text        = iv_name ) = abap_true
        OR cl_abap_matcher=>matches( pattern     = '.{1,}_.{3,8}_[[:digit:]]{2}_TRUSTED'
                                     ignore_case = abap_true
                                     text        = iv_name ) = abap_true
        OR cl_abap_matcher=>matches( pattern     = '.{1,}_.{3,8}_[[:digit:]]{2}'
                                     ignore_case = abap_true
                                     text        = iv_name ) = abap_true
        OR cl_abap_matcher=>matches( pattern     = '.{1,}_.{3,8}_TRUSTED\[.{0,}\]'
                                     ignore_case = abap_true
                                     text        = iv_name ) = abap_true
        OR cl_abap_matcher=>matches( pattern     = '.{1,}_.{3,8}\[.{0,}\]'
                                     ignore_case = abap_true
                                     text        = iv_name ) = abap_true.
          rv_reserved = abap_true.
        ENDIF.
      CATCH cx_sy_regex.
        rv_reserved = abap_true.
    ENDTRY.
  ENDMETHOD.

  METHOD normalize_payload.
    " Validate the wire document and resolve the defaults the SM59 screen applies:
    " the port defaults to 443/80 by protocol and is always written explicitly.
    CLEAR: es_wire, ev_error.
    es_wire-format_version = gc_format_version.
    es_wire-name           = iv_name.
    es_wire-type           = gc_type_http_ext.

    DATA(lv_format_version) = to_upper( condense( val = is_input-format_version del = ` ` ) ).
    IF lv_format_version IS NOT INITIAL AND lv_format_version <> gc_format_version.
      ev_error = |formatVersion must be '{ gc_format_version }' (got '{ is_input-format_version }')|.
      RETURN.
    ENDIF.
    IF is_input-name IS NOT INITIAL AND to_upper( condense( val = is_input-name del = ` ` ) ) <> iv_name.
      ev_error = |payload name '{ is_input-name }' does not match URL destination '{ iv_name }'|.
      RETURN.
    ENDIF.
    IF is_input-type IS NOT INITIAL AND to_upper( condense( val = is_input-type del = ` ` ) ) <> gc_type_http_ext.
      ev_error = |payload type must be '{ gc_type_http_ext }' (got '{ is_input-type }')|.
      RETURN.
    ENDIF.

    DATA(lv_protocol) = to_upper( condense( val = is_input-protocol del = ` ` ) ).
    IF lv_protocol IS INITIAL.
      ev_error = 'protocol is required (HTTP or HTTPS)'.
      RETURN.
    ENDIF.
    IF lv_protocol <> gc_protocol_http AND lv_protocol <> gc_protocol_https.
      ev_error = |protocol must be HTTP or HTTPS (got '{ is_input-protocol }')|.
      RETURN.
    ENDIF.

    DATA(lv_host) = condense( val = is_input-target_host del = ` ` ).
    IF lv_host IS INITIAL.
      ev_error = 'targetHost is required'.
      RETURN.
    ENDIF.
    IF strlen( lv_host ) > gc_host_max.
      ev_error = |targetHost must not exceed { gc_host_max } characters|.
      RETURN.
    ENDIF.

    DATA lv_port TYPE i.
    IF is_input-port < 0 OR is_input-port > gc_port_max.
      ev_error = |port must be an integer between 1 and { gc_port_max } (got { is_input-port })|.
      RETURN.
    ENDIF.
    IF is_input-port > 0.
      lv_port = is_input-port.
    ELSEIF lv_protocol = gc_protocol_https.
      lv_port = gc_port_https.
    ELSE.
      lv_port = gc_port_http.
    ENDIF.

    DATA(lv_path_prefix) = condense( val = is_input-path_prefix del = ` ` ).
    IF strlen( lv_path_prefix ) > gc_path_max.
      ev_error = |pathPrefix must not exceed { gc_path_max } characters|.
      RETURN.
    ENDIF.

    DATA(lv_description) = condense( val = is_input-description ).
    IF strlen( lv_description ) > gc_desc_max.
      ev_error = |description must not exceed { gc_desc_max } characters (RFCDOC)|.
      RETURN.
    ENDIF.

    es_wire-protocol    = lv_protocol.
    es_wire-target_host = lv_host.
    es_wire-port        = lv_port.
    es_wire-path_prefix = lv_path_prefix.
    es_wire-description = lv_description.
  ENDMETHOD.

  METHOD wire_from_destination.
    " Map the standard getters to the wire document. The description is read from
    " RFCDOC in the session language; SAP-shipped destinations usually carry only
    " an English row, so an any-language fallback keeps pull lossless.
    rs_wire = VALUE ty_sm59( format_version = gc_format_version
                             name           = io_root->name
                             type           = io_root->type
                             description    = description_of( iv_name        = CONV string( io_root->name )
                                                              iv_description = CONV string( io_root->description ) )
                             target_host    = condense( val = io_http->server_name del = ` ` )
                             path_prefix    = condense( val = io_http->path_prefix del = ` ` )
                             protocol       = COND string( WHEN io_http->ssl_active = abap_true
                                                            THEN gc_protocol_https
                                                            ELSE gc_protocol_http ) ).
    DATA lv_port_text TYPE string.
    lv_port_text = condense( val = io_http->service_number del = ` ` ).
    IF lv_port_text IS NOT INITIAL AND lv_port_text CO '0123456789'.
      rs_wire-port = lv_port_text.
    ENDIF.
  ENDMETHOD.

  METHOD description_of.
    rv_description = condense( val = iv_description ).
    IF rv_description IS NOT INITIAL.
      RETURN.
    ENDIF.
    SELECT SINGLE rfcdoc1 FROM rfcdoc
      WHERE rfcdest = @iv_name
      INTO @rv_description.
    rv_description = condense( val = rv_description ).
  ENDMETHOD.

  METHOD respond_api_error.
    " Map a maintenance-API exception to the structured error envelope. Authority
    " failures become 403, everything else 500; the API text is passed through.
    DATA lv_status TYPE i.
    DATA lv_reason TYPE string.
    DATA lv_code   TYPE string.
    IF io_exc->if_t100_message~t100key = cx_dest_api=>no_authority.
      lv_status = 403.
      lv_reason = 'Forbidden'.
    ELSE.
      lv_status = 500.
      lv_reason = 'Internal Server Error'.
    ENDIF.
    IF iv_action = 'read'.
      lv_code = 'SM59_READ_FAILED'.
    ELSE.
      lv_code = 'SM59_WRITE_FAILED'.
    ENDIF.
    zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                   iv_status = lv_status
                   iv_reason = lv_reason
                   iv_code   = lv_code
                   iv_msg    = |SM59 { iv_action } failed: { io_exc->get_text( ) }| ).
  ENDMETHOD.

  METHOD respond_runtime_error.
    " Runtime errors are never a validation problem: report 500 with the API code
    " family so the CLI maps it to SAP_ERROR instead of a transport failure.
    DATA lv_reason TYPE string.
    DATA lv_code   TYPE string.
    lv_reason = 'Internal Server Error'.
    IF iv_action = 'read'.
      lv_code = 'SM59_READ_FAILED'.
    ELSE.
      lv_code = 'SM59_WRITE_FAILED'.
    ENDIF.
    zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                   iv_status = 500
                   iv_reason = lv_reason
                   iv_code   = lv_code
                   iv_msg    = |SM59 { iv_action } failed: { io_exc->get_text( ) }| ).
  ENDMETHOD.
ENDCLASS.
