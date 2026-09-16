*"* local class implementations for ZCL_ABAP_VIBE_ICF
CLASS lcl_response IMPLEMENTATION.
  METHOD handle_root.
    IF iv_method = 'GET'.
      DATA(ls_root) = VALUE ty_root( status = 'success'
                                     data = VALUE ty_root_data( service = gc_service version = gc_version ) ).
      respond_json( io_server = io_server
                    iv_status = 200
                    iv_reason = 'OK'
                    is_payload = ls_root ).
    ELSE.
      respond_error( io_server = io_server
                     iv_status = 405
                     iv_reason = 'Method Not Allowed'
                     iv_code = 'METHOD_NOT_ALLOWED'
                     iv_msg = |GET only on /sap/zabap_vibe/| ).
    ENDIF.
  ENDMETHOD.
  METHOD handle_class_check.
    " 037 ops endpoint: probe the runtime class load version + last source
    " change timestamp. Useful to confirm whether the ICF runtime picked up
    " a freshly-deployed main include (SM12/SICF deactivate+activate resets
    " the in-memory class load handle).
    DATA ls_class_info TYPE ty_root_data.
    ls_class_info-service = gc_service.
    ls_class_info-version = gc_version.
    respond_json( io_server = io_server
                  iv_status = 200
                  iv_reason = 'OK'
                  is_payload = VALUE ty_root( status = 'success' data = ls_class_info ) ).
  ENDMETHOD.
  METHOD respond_json.
    DATA(lv_json) = serialize_response( is_payload ).
    io_server->response->set_status( code = iv_status reason = iv_reason ).
    io_server->response->set_content_type( content_type = 'application/json' ).
    io_server->response->set_cdata( data = lv_json ).
  ENDMETHOD.
  METHOD respond_error.
    DATA lv_json TYPE string.
    " forward iv_details to serialize_error only when the caller actually
    " supplied it (most call sites pass no details; their initial data ref
    " would otherwise leak as an empty `details: null` in the response).
    IF iv_details IS SUPPLIED.
      lv_json = serialize_error( iv_code    = iv_code
                                iv_message = iv_msg
                                iv_details = iv_details ).
    ELSE.
      lv_json = serialize_error( iv_code    = iv_code
                                iv_message = iv_msg ).
    ENDIF.
    io_server->response->set_status( code = iv_status reason = iv_reason ).
    io_server->response->set_content_type( content_type = 'application/json' ).
    io_server->response->set_cdata( data = lv_json ).
  ENDMETHOD.
  METHOD serialize_response.
    " Single success-envelope generation entry (camelCase wire).
    " Copy to a modifiable heap object so old /UI2/CL_JSON escaping can apply.
    DATA lr_payload TYPE REF TO data.
    CREATE DATA lr_payload LIKE is_payload.
    ASSIGN lr_payload->* TO FIELD-SYMBOL(<lv_payload>).
    <lv_payload> = is_payload.
    IF escape_probe_needed( ) = abap_true.
      escape_json_strings( CHANGING cv_data = <lv_payload> ).
    ENDIF.
    TRY.
        rv_json = /ui2/cl_json=>serialize( data        = <lv_payload>
                                           pretty_name = /ui2/cl_json=>pretty_mode-camel_case ).
      CATCH cx_root.
        rv_json = serialize_error( iv_code    = 'SERIALIZE_FAILED'
                                   iv_message = 'response serialization failed' ).
    ENDTRY.
  ENDMETHOD.
  METHOD serialize_error.
    " Single error-envelope generation entry (compress skips unbound details).
    DATA lv_msg TYPE string.
    lv_msg = iv_message.
    IF escape_probe_needed( ) = abap_true.
      lv_msg = escape_json_string( iv_message ).
    ENDIF.
    DATA(ls_error) = VALUE ty_error( status = 'error'
                                     error = VALUE ty_error_body( code    = iv_code
                                                                  message = lv_msg ) ).
    IF iv_details IS SUPPLIED.
      ls_error-error-details = iv_details.
    ENDIF.
    TRY.
        rv_json = /ui2/cl_json=>serialize( data        = ls_error
                                           pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                                           compress    = abap_true ).
      CATCH cx_root.
        " Static last-resort envelope (no dynamic content, cannot fail again).
        rv_json = `{"status":"error","error":{"code":"SERIALIZE_FAILED","message":"internal serialization failure"}}`.
    ENDTRY.
  ENDMETHOD.
  METHOD escape_probe_needed.
    " Probe once: does /ui2/cl_json escape a double quote inside a string?
    " Old /UI2/CL_JSON (vhcala4hci) returns it unescaped — then we escape.
    DATA lv_probe TYPE string.
    IF gv_escape_needed IS INITIAL.
      lv_probe = /ui2/cl_json=>serialize( 'x"' ).
      IF lv_probe CS '\"'.
        gv_escape_needed = abap_false.
      ELSE.
        gv_escape_needed = abap_true.
      ENDIF.
    ENDIF.
    rv_needed = gv_escape_needed.
  ENDMETHOD.
  METHOD escape_json_string.
    " Escape backslash and double quote (order matters), then control chars.
    rv_value = iv_value.
    REPLACE ALL OCCURRENCES OF '\' IN rv_value WITH '\\'.
    REPLACE ALL OCCURRENCES OF '"' IN rv_value WITH '\"'.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>cr_lf IN rv_value WITH '\r\n'.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>newline IN rv_value WITH '\n'.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>horizontal_tab IN rv_value WITH '\t'.
  ENDMETHOD.
  METHOD escape_json_strings.
    " Recursively escape char-like elements of a structure/table (017 quirk).
    " Fields typed /ui2/cl_json=>json (partial JSON pieces) are already escaped
    " at their source and are skipped by absolute_name.
    DATA lo_descr      TYPE REF TO cl_abap_typedescr.
    DATA lo_elem       TYPE REF TO cl_abap_elemdescr.
    DATA lo_struct     TYPE REF TO cl_abap_structdescr.
    DATA lt_components TYPE abap_component_tab.
    FIELD-SYMBOLS:
      <lt_tab>  TYPE ANY TABLE,
      <ls_line> TYPE any,
      <lv_comp> TYPE any.
    lo_descr = cl_abap_typedescr=>describe_by_data( cv_data ).
    CASE lo_descr->kind.
      WHEN cl_abap_typedescr=>kind_elem.
        lo_elem ?= lo_descr.
        IF lo_elem->absolute_name CS '/UI2/CL_JSON=>JSON'.
          RETURN.
        ENDIF.
        IF lo_elem->type_kind CA 'cgndt'.
          cv_data = escape_json_string( CONV string( cv_data ) ).
        ENDIF.
      WHEN cl_abap_typedescr=>kind_struct.
        lo_struct ?= lo_descr.
        lt_components = lo_struct->get_components( ).
        LOOP AT lt_components INTO DATA(ls_comp).
          ASSIGN COMPONENT ls_comp-name OF STRUCTURE cv_data TO <lv_comp>.
          IF sy-subrc = 0.
            escape_json_strings( CHANGING cv_data = <lv_comp> ).
          ENDIF.
        ENDLOOP.
      WHEN cl_abap_typedescr=>kind_table.
        ASSIGN cv_data TO <lt_tab>.
        LOOP AT <lt_tab> ASSIGNING <ls_line>.
          escape_json_strings( CHANGING cv_data = <ls_line> ).
        ENDLOOP.
    ENDCASE.
  ENDMETHOD.
  METHOD query_param.
    DATA lv_pattern TYPE string.
    lv_pattern = '(?:^|&)' && iv_name && '=([^&]*)'.
    FIND FIRST OCCURRENCE OF REGEX lv_pattern IN iv_query IGNORING CASE
      SUBMATCHES rv_value.
    IF sy-subrc = 0.
      rv_value = cl_http_utility=>if_http_utility~unescape_url( escaped = rv_value ).
    ENDIF.
  ENDMETHOD.
ENDCLASS.

CLASS lcl_mime IMPLEMENTATION.
  METHOD dispatch_mime.
    " /mime/* — MIME repository folder/resource operations on the SE80 MIME
    " repository (CL_MIME_REPOSITORY_API). Response codes: INVALID_ARGUMENT →
    " 400, NOT_FOUND → 404, OBJECT_EXISTS → 409, VALIDATION_ERROR → 422,
    " everything else → 500, so the CLI maps them to its exit codes.
    IF iv_path = '/mime/folder'.
      IF iv_method = 'POST'.
        mime_create_folder( EXPORTING iv_body    = iv_body
                            IMPORTING es_payload = DATA(ls_create)
                                      ev_error   = DATA(ls_create_err) ).
        IF ls_create_err IS NOT INITIAL.
          respond_mime_error( io_server = io_server is_error = ls_create_err ).
          RETURN.
        ENDIF.
        lcl_response=>respond_json( io_server = io_server
                      iv_status = 200
                      iv_reason = 'OK'
                      is_payload = ls_create ).
        RETURN.
      ENDIF.

      IF iv_method = 'PUT'.
        DATA(lv_query) = io_server->request->get_header_field( '~query_string' ).
        DATA(lv_recursive) = COND abap_bool(
          WHEN to_upper( lcl_response=>query_param( iv_query = lv_query iv_name = 'recursive' ) ) = 'TRUE'
          THEN abap_true ELSE abap_false ).
        DATA(lv_transport) = lcl_response=>query_param( iv_query = lv_query iv_name = 'transport' ).
        mime_delete_folder( EXPORTING iv_body      = iv_body
                                      iv_recursive = lv_recursive
                                      iv_transport = CONV trkorr( lv_transport )
                            IMPORTING es_payload   = DATA(ls_delete)
                                      ev_error     = DATA(ls_delete_err) ).
        IF ls_delete_err IS NOT INITIAL.
          respond_mime_error( io_server = io_server is_error = ls_delete_err ).
          RETURN.
        ENDIF.
        lcl_response=>respond_json( io_server = io_server
                      iv_status = 200
                      iv_reason = 'OK'
                      is_payload = ls_delete ).
        RETURN.
      ENDIF.

      lcl_response=>respond_error( io_server = io_server
                     iv_status = 405
                     iv_reason = 'Method Not Allowed'
                     iv_code   = 'METHOD_NOT_ALLOWED'
                     iv_msg    = 'POST (create) and PUT (delete) only on /mime/folder' ).
      RETURN.
    ENDIF.

    IF iv_path = '/mime/resources'.
      IF iv_method = 'POST'.
        mime_upload_resource( EXPORTING iv_body    = iv_body
                              IMPORTING es_payload = DATA(ls_upload)
                                        ev_error   = DATA(ls_upload_err) ).
        IF ls_upload_err IS NOT INITIAL.
          respond_mime_error( io_server = io_server is_error = ls_upload_err ).
          RETURN.
        ENDIF.
        lcl_response=>respond_json( io_server = io_server
                      iv_status = 200
                      iv_reason = 'OK'
                      is_payload = ls_upload ).
        RETURN.
      ENDIF.

      lcl_response=>respond_error( io_server = io_server
                     iv_status = 405
                     iv_reason = 'Method Not Allowed'
                     iv_code   = 'METHOD_NOT_ALLOWED'
                     iv_msg    = 'POST only on /mime/resources' ).
      RETURN.
    ENDIF.

    lcl_response=>respond_error( io_server = io_server
                   iv_status = 404
                   iv_reason = 'Not Found'
                   iv_code   = 'NOT_FOUND'
                   iv_msg    = |unsupported path: /sap/zabap_vibe{ iv_path }| ).
  ENDMETHOD.
  METHOD respond_mime_error.
    DATA(lv_status) = COND i(
      WHEN is_error-error-code = 'NOT_FOUND'        THEN 404
      WHEN is_error-error-code = 'INVALID_ARGUMENT' THEN 400
      WHEN is_error-error-code = 'OBJECT_EXISTS'    THEN 409
      WHEN is_error-error-code = 'VALIDATION_ERROR' THEN 422
      ELSE 500 ).
    lcl_response=>respond_error( io_server = io_server
                   iv_status = lv_status
                   iv_reason = COND string(
                     WHEN lv_status = 404 THEN 'Not Found'
                     WHEN lv_status = 400 THEN 'Bad Request'
                     WHEN lv_status = 409 THEN 'Conflict'
                     WHEN lv_status = 422 THEN 'Unprocessable Entity'
                     ELSE 'Internal Server Error' )
                   iv_code = is_error-error-code
                   iv_msg  = is_error-error-message ).
  ENDMETHOD.
  METHOD validate_mime_path.
    " Mirrors the CLI-side validateMimePath (server-side defense in depth).
    IF iv_path IS INITIAL.
      rv_error = 'MIME path must not be empty'.
      RETURN.
    ENDIF.
    IF iv_path(1) <> '/'.
      rv_error = |MIME path must start with '/'; got '{ iv_path }'|.
      RETURN.
    ENDIF.
    IF iv_path CS '..'.
      rv_error = |MIME path must not contain '..'; got '{ iv_path }'|.
      RETURN.
    ENDIF.
    IF strlen( iv_path ) > 1
       AND substring( val = iv_path off = strlen( iv_path ) - 1 len = 1 ) = '/'.
      rv_error = |MIME path must not end with '/'; got '{ iv_path }'|.
      RETURN.
    ENDIF.
    DATA(lv_rest) = substring( val = iv_path off = 1 ).
    IF lv_rest IS INITIAL OR lv_rest CS '//'.
      rv_error = |MIME path must be a '/'-separated non-empty path; got '{ iv_path }'|.
      RETURN.
    ENDIF.
  ENDMETHOD.
  METHOD mime_url_exists.
    " Resolve iv_url with one namespace lookup (the same call CL_MIME_
    " REPOSITORY_API's delete/get_io_for_url use; that method raises
    " inconsistent errors for missing roots vs nested folders, so only the
    " returned io handle decides existence here).
    DATA lv_rest TYPE string.
    DATA ls_io TYPE skwf_io.
    DATA lv_url TYPE skwf_url.
    rv_exists = abap_false.
    IF iv_url IS INITIAL OR iv_url(1) <> '/'.
      RETURN.
    ENDIF.
    lv_rest = substring( val = iv_url off = 1 ).
    IF lv_rest IS INITIAL.
      RETURN.
    ENDIF.
    lv_url = CONV skwf_url( lv_rest ).
    CALL FUNCTION 'SKWF_NMSPC_IO_FIND_BY_ADDRESS'
      EXPORTING
        url  = lv_url
        appl = wbmr_c_skwf_appl_name
      IMPORTING
        io   = ls_io.
    IF ls_io-objid IS NOT INITIAL.
      rv_exists = abap_true.
    ENDIF.
  ENDMETHOD.
  METHOD mime_create_folder.
    CLEAR: es_payload, ev_error.
    DATA ls_req TYPE ty_mime_folder_create.
    TRY.
        /ui2/cl_json=>deserialize( EXPORTING json        = iv_body
                                             pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                                    CHANGING  data        = ls_req ).
      CATCH cx_root INTO DATA(lx_json).
        ev_error = VALUE ty_error( status = 'error'
          error = VALUE ty_error_body( code    = 'INVALID_ARGUMENT'
                                       message = |invalid JSON body: { lx_json->get_text( ) }| ) ).
        RETURN.
    ENDTRY.
    DATA(lv_invalid) = validate_mime_path( ls_req-path ).
    IF lv_invalid IS NOT INITIAL.
      ev_error = VALUE ty_error( status = 'error'
        error = VALUE ty_error_body( code = 'INVALID_ARGUMENT' message = lv_invalid ) ).
      RETURN.
    ENDIF.
    DATA(lv_devclass) = COND devclass( WHEN ls_req-package IS INITIAL THEN '$TMP' ELSE ls_req-package ).
    DATA(lv_kind) = COND string(
      WHEN substring( val = ls_req-path off = 1 ) CS '/' THEN 'folder' ELSE 'root' ).

    " Deterministic duplicate check before calling the repository API (whose
    " folder_exists exception surfaces inconsistently for existing roots).
    IF mime_url_exists( ls_req-path ) = abap_true.
      ev_error = VALUE ty_error( status = 'error'
        error = VALUE ty_error_body( code    = 'OBJECT_EXISTS'
                                     message = |MIME folder already exists: { ls_req-path }| ) ).
      RETURN.
    ENDIF.

    " A single-segment path creates a MIME root; deeper paths create folders
    " (missing parents are created along the way). The package maps to the
    " TADIR devclass of the new object(s); $TMP keeps them local.
    DATA(lr_api) = cl_mime_repository_api=>if_mr_api~get_api( ).
    CALL METHOD lr_api->create_folder
      EXPORTING
        i_url                     = ls_req-path
        i_description             = ls_req-description
        i_dev_package             = lv_devclass
        i_corr_number             = CONV trkorr( ls_req-transport_request )
        i_suppress_package_dialog = abap_true
        i_suppress_dialogs        = abap_true
      EXCEPTIONS
        parameter_missing  = 1
        error_occured      = 2
        cancelled          = 3
        permission_failure = 4
        folder_exists      = 5
        OTHERS             = 6.
    IF sy-subrc <> 0.
      DATA(lv_sap_msg) = mime_last_sap_message( ).
      CASE sy-subrc.
        WHEN 5.
          ev_error = VALUE ty_error( status = 'error'
            error = VALUE ty_error_body( code = 'OBJECT_EXISTS'
                                         message = |MIME folder already exists: { ls_req-path }| ) ).
        WHEN 1.
          ev_error = VALUE ty_error( status = 'error'
            error = VALUE ty_error_body( code = 'INVALID_ARGUMENT'
                                         message = |invalid MIME folder request: { lv_sap_msg }| ) ).
        WHEN 3.
          ev_error = VALUE ty_error( status = 'error'
            error = VALUE ty_error_body( code = 'VALIDATION_ERROR'
                                         message = |MIME folder create rejected: { lv_sap_msg }| ) ).
        WHEN 4.
          ev_error = VALUE ty_error( status = 'error'
            error = VALUE ty_error_body( code = 'SAP_ERROR'
                                         message = |MIME folder permission failure: { lv_sap_msg }| ) ).
        WHEN OTHERS.
          ev_error = VALUE ty_error( status = 'error'
            error = VALUE ty_error_body( code = 'SAP_ERROR'
                                         message = |MIME folder create failed: { lv_sap_msg }| ) ).
      ENDCASE.
      RETURN.
    ENDIF.

    es_payload = VALUE ty_mime_folder_write(
      status = 'success'
      data = VALUE ty_mime_folder_data( path   = ls_req-path
                                        kind   = lv_kind
                                        action = 'created' ) ).
  ENDMETHOD.
  METHOD mime_delete_folder.
    CLEAR: es_payload, ev_error.
    DATA ls_req TYPE ty_mime_folder_delete.
    TRY.
        /ui2/cl_json=>deserialize( EXPORTING json        = iv_body
                                             pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                                    CHANGING  data        = ls_req ).
      CATCH cx_root INTO DATA(lx_json).
        ev_error = VALUE ty_error( status = 'error'
          error = VALUE ty_error_body( code    = 'INVALID_ARGUMENT'
                                       message = |invalid JSON body: { lx_json->get_text( ) }| ) ).
        RETURN.
    ENDTRY.
    DATA(lv_invalid) = validate_mime_path( ls_req-path ).
    IF lv_invalid IS NOT INITIAL.
      ev_error = VALUE ty_error( status = 'error'
        error = VALUE ty_error_body( code = 'INVALID_ARGUMENT' message = lv_invalid ) ).
      RETURN.
    ENDIF.

    " Deterministic existence check: CL_MIME_REPOSITORY_API's delete raises
    " inconsistent codes for missing roots vs missing nested folders.
    IF mime_url_exists( ls_req-path ) = abap_false.
      ev_error = VALUE ty_error( status = 'error'
        error = VALUE ty_error_body( code    = 'NOT_FOUND'
                                     message = |MIME folder not found: { ls_req-path }| ) ).
      RETURN.
    ENDIF.

    " Recursive delete removes children; a non-empty folder without it is
    " rejected by the repository (surfaced as VALIDATION_ERROR).
    DATA(lr_api) = cl_mime_repository_api=>if_mr_api~get_api( ).
    CALL METHOD lr_api->delete
      EXPORTING
        i_url              = ls_req-path
        i_delete_children  = COND boole_d( WHEN iv_recursive = abap_true THEN 'X' ELSE '' )
        i_corr_number      = iv_transport
        i_suppress_dialogs = abap_true
      EXCEPTIONS
        parameter_missing  = 1
        error_occured      = 2
        cancelled          = 3
        permission_failure = 4
        not_found          = 5
        OTHERS             = 6.
    IF sy-subrc <> 0.
      DATA(lv_sap_msg) = mime_last_sap_message( ).
      CASE sy-subrc.
        WHEN 5.
          ev_error = VALUE ty_error( status = 'error'
            error = VALUE ty_error_body( code = 'NOT_FOUND'
                                         message = |MIME folder not found: { ls_req-path }| ) ).
        WHEN 1.
          ev_error = VALUE ty_error( status = 'error'
            error = VALUE ty_error_body( code = 'INVALID_ARGUMENT'
                                         message = |invalid MIME delete request: { lv_sap_msg }| ) ).
        WHEN 3.
          ev_error = VALUE ty_error( status = 'error'
            error = VALUE ty_error_body( code = 'VALIDATION_ERROR'
                                         message = |MIME folder delete rejected: { lv_sap_msg }| ) ).
        WHEN 4.
          ev_error = VALUE ty_error( status = 'error'
            error = VALUE ty_error_body( code = 'SAP_ERROR'
                                         message = |MIME folder permission failure: { lv_sap_msg }| ) ).
        WHEN OTHERS.
          ev_error = VALUE ty_error( status = 'error'
            error = VALUE ty_error_body(
              code = COND #( WHEN lv_sap_msg CS 'not empty' THEN 'VALIDATION_ERROR' ELSE 'SAP_ERROR' )
              message = COND string(
                WHEN lv_sap_msg CS 'not empty'
                THEN |MIME folder is not empty; delete it with --recursive: { ls_req-path }|
                ELSE |MIME folder delete failed: { lv_sap_msg }| ) ) ).
      ENDCASE.
      RETURN.
    ENDIF.

    es_payload = VALUE ty_mime_delete_write(
      status = 'success'
      data = VALUE ty_mime_delete_data( path   = ls_req-path
                                        action = 'deleted' ) ).
  ENDMETHOD.
  METHOD mime_upload_resource.
    CLEAR: es_payload, ev_error.
    DATA ls_req TYPE ty_mime_resource_upload.
    DATA lv_parent TYPE string.
    TRY.
        /ui2/cl_json=>deserialize( EXPORTING json        = iv_body
                                             pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                                    CHANGING  data        = ls_req ).
      CATCH cx_root INTO DATA(lx_json).
        ev_error = VALUE ty_error( status = 'error'
          error = VALUE ty_error_body( code    = 'INVALID_ARGUMENT'
                                       message = |invalid JSON body: { lx_json->get_text( ) }| ) ).
        RETURN.
    ENDTRY.
    DATA(lv_invalid) = validate_mime_path( ls_req-path ).
    IF lv_invalid IS NOT INITIAL.
      ev_error = VALUE ty_error( status = 'error'
        error = VALUE ty_error_body( code = 'INVALID_ARGUMENT' message = lv_invalid ) ).
      RETURN.
    ENDIF.
    IF ls_req-content_base64 IS INITIAL.
      ev_error = VALUE ty_error( status = 'error'
        error = VALUE ty_error_body( code    = 'INVALID_ARGUMENT'
                                     message = 'contentBase64 is required' ) ).
      RETURN.
    ENDIF.
    " Resources always live below a MIME folder; single-segment paths cannot
    " hold files in the MIME tree.
    FIND REGEX '^(.+)/[^/]+$' IN ls_req-path SUBMATCHES lv_parent.
    IF lv_parent IS INITIAL.
      ev_error = VALUE ty_error( status = 'error'
        error = VALUE ty_error_body( code    = 'INVALID_ARGUMENT'
                                     message = |resource path must be a file inside a MIME folder; got '{ ls_req-path }'| ) ).
      RETURN.
    ENDIF.

    " The target folder must already exist — push never auto-creates folders.
    " CL_MIME_REPOSITORY_API's get_io_for_url raises inconsistent codes for
    " missing roots vs nested folders, so existence is resolved segment-wise.
    IF mime_url_exists( lv_parent ) = abap_false.
      ev_error = VALUE ty_error( status = 'error'
        error = VALUE ty_error_body( code    = 'NOT_FOUND'
                                     message = |parent MIME folder not found: { lv_parent } (create it first)| ) ).
      RETURN.
    ENDIF.

    DATA(lv_content) = cl_http_utility=>if_http_utility~decode_x_base64( ls_req-content_base64 ).
    DATA(lr_api) = cl_mime_repository_api=>if_mr_api~get_api( ).
    CALL METHOD lr_api->put
      EXPORTING
        i_url                     = ls_req-path
        i_content                 = lv_content
        i_corr_number             = CONV trkorr( ls_req-transport_request )
        i_suppress_package_dialog = abap_true
        i_suppress_dialogs        = abap_true
      EXCEPTIONS
        parameter_missing      = 1
        error_occured          = 2
        cancelled              = 3
        permission_failure     = 4
        data_inconsistency     = 5
        new_loio_already_exists = 6
        is_folder              = 7
        OTHERS                 = 8.
    IF sy-subrc <> 0.
      DATA(lv_sap_msg) = mime_last_sap_message( ).
      CASE sy-subrc.
        WHEN 1 OR 7.
          ev_error = VALUE ty_error( status = 'error'
            error = VALUE ty_error_body( code    = 'INVALID_ARGUMENT'
                                         message = |invalid MIME resource request: { lv_sap_msg }| ) ).
        WHEN 3.
          ev_error = VALUE ty_error( status = 'error'
            error = VALUE ty_error_body( code    = 'VALIDATION_ERROR'
                                         message = |MIME resource upload rejected: { lv_sap_msg }| ) ).
        WHEN 6.
          ev_error = VALUE ty_error( status = 'error'
            error = VALUE ty_error_body( code = 'OBJECT_EXISTS'
                                         message = |MIME resource already exists: { ls_req-path }| ) ).
        WHEN OTHERS.
          ev_error = VALUE ty_error( status = 'error'
            error = VALUE ty_error_body( code    = 'SAP_ERROR'
                                         message = |MIME resource upload failed: { lv_sap_msg }| ) ).
      ENDCASE.
      RETURN.
    ENDIF.

    es_payload = VALUE ty_mime_resource_write(
      status = 'success'
      data = VALUE ty_mime_resource_data( path = ls_req-path ) ).
  ENDMETHOD.
  METHOD mime_last_sap_message.
    " Read the message of the most recent RAISING exception (sy-msg* fields).
    DATA lv_text TYPE string.
    IF sy-msgid IS NOT INITIAL.
      MESSAGE ID sy-msgid TYPE 'I' NUMBER sy-msgno
        WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4 INTO lv_text.
    ENDIF.
    IF lv_text IS INITIAL.
      rv_message = 'no SAP message text supplied'.
    ELSE.
      rv_message = lv_text.
    ENDIF.
  ENDMETHOD.
ENDCLASS.

CLASS lcl_http IMPLEMENTATION.
  METHOD dispatch_http.
    DATA lv_match_name   TYPE string.
    DATA lv_url          TYPE string.
    DATA lv_parent_url   TYPE string.
    DATA lv_node_name_raw TYPE string.
    DATA lv_node_name    TYPE icfname.
    DATA lv_transport    TYPE trkorr.
    DATA lv_transport_raw TYPE string.
    DATA lv_guid         TYPE icfnodguid.
    DATA lv_parent_guid  TYPE icfparguid.
    DATA lv_service_name TYPE icfservice-icf_name.
    DATA lv_info_url     TYPE string.
    DATA ls_http         TYPE ty_http_service_data.
    DATA ls_docu         TYPE icfdocu.
    DATA ls_insert_docu  TYPE icfdocu.
    DATA ls_icfserdesc   TYPE icfserdesc.
    DATA ls_existing_service TYPE icfservice.
    DATA ls_current_service TYPE icfservice.
    DATA lt_serv_info    TYPE icfservtbl.
    DATA ls_serv_info    LIKE LINE OF lt_serv_info.
    DATA ls_handler      TYPE icfhandler.
    DATA lt_existing     TYPE TABLE OF icfhandler.
    DATA lt_icfhndlist   TYPE icfhndlist.
    DATA lv_original_language TYPE string.
    DATA lv_alt_name      TYPE icfservice-icfaltnme.
    DATA lv_icf_message   TYPE string.
    DATA lv_change_subrc  TYPE sy-subrc.

    " Resolve the endpoint key to an SICF URL; a bare name means /sap/<name>.
    FIND REGEX '^/http/(.+)$' IN iv_path IGNORING CASE SUBMATCHES lv_match_name.
    IF sy-subrc <> 0 OR lv_match_name IS INITIAL.
      lcl_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code = 'HTTP_SERVICE_INVALID'
                     iv_msg = 'HTTP Service name is required' ).
      RETURN.
    ENDIF.

    IF iv_method = 'GET'.
      IF lv_match_name CP '/*'.
        lv_url = lv_match_name.
      ELSE.
        lv_url = |/sap/{ to_lower( lv_match_name ) }|.
      ENDIF.

      " Locate the node and read its canonical URL, documentation and handlers.
      CALL METHOD cl_icf_tree=>if_icf_tree~service_from_url
        EXPORTING
          url        = lv_url
          hostnumber = 0
        IMPORTING
          icfnodguid = lv_guid
        EXCEPTIONS
          wrong_url    = 4
          no_authority = 5
          OTHERS       = 99.
      IF sy-subrc <> 0.
        lcl_response=>respond_error( io_server = io_server
                       iv_status = 404
                       iv_reason = 'Not Found'
                       iv_code = 'HTTP_SERVICE_NOT_FOUND'
                       iv_msg = |SICF service not found: { lv_url }| ).
        RETURN.
      ENDIF.

      SELECT SINGLE *
        FROM icfservice
        WHERE icfnodguid = @lv_guid
        INTO @ls_existing_service.
      IF sy-subrc <> 0.
        lcl_response=>respond_error( io_server = io_server
                       iv_status = 404
                       iv_reason = 'Not Found'
                       iv_code = 'HTTP_SERVICE_NOT_FOUND'
                       iv_msg = |SICF service metadata not found: { lv_url }| ).
        RETURN.
      ENDIF.
      lv_service_name = ls_existing_service-icf_name.
      lv_parent_guid = ls_existing_service-icfparguid.

      CALL METHOD cl_icf_tree=>if_icf_tree~get_info_from_serv
        EXPORTING
          icf_name   = lv_service_name
          icfparguid = lv_parent_guid
          icf_langu  = sy-langu
        IMPORTING
          serv_info = lt_serv_info
          icfdocu   = ls_docu
          url       = lv_info_url
        EXCEPTIONS
          wrong_name        = 1
          wrong_parguid     = 2
          incorrect_service = 3
          no_authority      = 4
          OTHERS            = 5.
      IF sy-subrc <> 0 OR lt_serv_info IS INITIAL.
        lcl_response=>respond_error( io_server = io_server
                       iv_status = 500
                       iv_reason = 'Internal Server Error'
                       iv_code = 'HTTP_SERVICE_READ_FAILED'
                       iv_msg = |Could not read SICF service: { lv_url }| ).
        RETURN.
      ENDIF.

      READ TABLE lt_serv_info INDEX 1 INTO ls_serv_info.
      READ TABLE ls_serv_info-handlertbl INDEX 1 INTO ls_handler.
      CASE sy-langu.
        WHEN '1'. lv_original_language = 'ZH'.
        WHEN '2'. lv_original_language = 'KO'.
        WHEN 'D'. lv_original_language = 'DE'.
        WHEN 'E'. lv_original_language = 'EN'.
        WHEN 'F'. lv_original_language = 'FR'.
        WHEN 'I'. lv_original_language = 'IT'.
        WHEN 'J'. lv_original_language = 'JA'.
        WHEN 'N'. lv_original_language = 'NL'.
        WHEN 'P'. lv_original_language = 'PT'.
        WHEN 'R'. lv_original_language = 'RU'.
        WHEN 'S'. lv_original_language = 'ES'.
        WHEN OTHERS. lv_original_language = 'EN'.
      ENDCASE.

      " 037 US2 (S06): Read all language rows from ICFDOCU for descriptionByLang[].
      " ICFDOCU stores one row per (node, parentGuid, language); sy-langu row
      " is already in ls_docu — we add the remaining languages to the response.
      DATA lt_docu_all TYPE TABLE OF icfdocu.
      SELECT * FROM icfdocu
        WHERE icf_name = @lv_service_name
          AND icfparguid = @lv_parent_guid
        INTO TABLE @lt_docu_all.
      DATA lt_description_by_lang TYPE tt_http_header_lang.
      LOOP AT lt_docu_all INTO DATA(ls_docu_all).
        " SWITCH maps sy-langu 1-char → ISO 639-1; no END/ENDCASE needed
        " (CASE inside DATA(lv_x) = ... is rejected by the compiler here).
        DATA(lv_lang) = SWITCH string( ls_docu_all-icf_langu
          WHEN '1' THEN 'ZH' WHEN '2' THEN 'KO' WHEN 'D' THEN 'DE'
          WHEN 'E' THEN 'EN' WHEN 'F' THEN 'FR' WHEN 'I' THEN 'IT'
          WHEN 'J' THEN 'JA' WHEN 'N' THEN 'NL' WHEN 'P' THEN 'PT'
          WHEN 'R' THEN 'RU' WHEN 'S' THEN 'ES'
          ELSE ls_docu_all-icf_langu ).
        APPEND VALUE ty_http_header_lang(
          language    = lv_lang
          description = CONV string( ls_docu_all-icf_docu ) ) TO lt_description_by_lang.
      ENDLOOP.

      ls_http = VALUE #( format_version = '1'
                         header = VALUE #( description = COND #( WHEN ls_docu-icf_docu IS INITIAL
                                                                 THEN CONV string( lv_service_name )
                                                                 ELSE CONV string( ls_docu-icf_docu ) )
                                                                 original_language = lv_original_language
                                                                 abap_language_version = resolve_handler_lang_version( CONV string( ls_handler-icfhandler ) )
                                                                 description_by_lang = lt_description_by_lang )
                         general_information = VALUE #( handler_class = COND #( WHEN sy-subrc = 0
                                                                                 THEN CONV string( ls_handler-icfhandler )
                                                                                 ELSE `` )
                                                        url = COND #( WHEN lv_info_url IS INITIAL
                                                                       THEN lv_url
                                                                       ELSE lv_info_url )
                                                        service_id = lv_url ) ).
      lcl_response=>respond_json( io_server = io_server
                    iv_status = 200
                    iv_reason = 'OK'
                    is_payload = VALUE ty_http_service( status = 'success' data = ls_http ) ).
      RETURN.
    ENDIF.

    IF iv_method <> 'POST'.
      lcl_response=>respond_error( io_server = io_server
                     iv_status = 405
                     iv_reason = 'Method Not Allowed'
                     iv_code = 'METHOD_NOT_ALLOWED'
                     iv_msg = |GET and POST only on /http/{ lv_match_name }| ).
      RETURN.
    ENDIF.

    " Deserialize the official HTTP Service JSON and extract transport separately.
    TRY.
        /ui2/cl_json=>deserialize( EXPORTING json = iv_body
                                                   pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                                          CHANGING data = ls_http ).
      CATCH cx_root INTO DATA(lx_json).
        lcl_response=>respond_error( io_server = io_server
                       iv_status = 400
                       iv_reason = 'Bad Request'
                       iv_code = 'HTTP_SERVICE_INVALID'
                       iv_msg = lx_json->get_text( ) ).
        RETURN.
    ENDTRY.

    FIND FIRST OCCURRENCE OF REGEX '"transportRequest"\s*:\s*"([^"]*)"'
      IN iv_body IGNORING CASE SUBMATCHES lv_transport_raw.
    IF sy-subrc = 0.
      lv_transport = lv_transport_raw.
    ENDIF.

    lv_url = ls_http-general_information-url.
    IF ls_http-format_version <> '1' OR ls_http-header-description IS INITIAL OR lv_url IS INITIAL.
      lcl_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code = 'HTTP_SERVICE_INVALID'
                     iv_msg = 'formatVersion, header.description and generalInformation.url are required' ).
      RETURN.
    ENDIF.

    WHILE strlen( lv_url ) > 1 AND substring( val = lv_url off = strlen( lv_url ) - 1 len = 1 ) = '/'.
      lv_url = substring( val = lv_url off = 0 len = strlen( lv_url ) - 1 ).
    ENDWHILE.

    FIND REGEX '^(.+)/([^/]+)$' IN lv_url SUBMATCHES lv_parent_url lv_node_name_raw.
    IF sy-subrc <> 0 OR lv_node_name_raw IS INITIAL OR strlen( lv_node_name_raw ) > 15.
      lcl_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code = 'HTTP_SERVICE_INVALID'
                     iv_msg = 'generalInformation.url must contain a SICF node name of at most 15 characters' ).
      RETURN.
    ENDIF.
    lv_node_name = to_lower( lv_node_name_raw ).
    IF lv_parent_url IS INITIAL.
      lv_parent_url = '/'.
    ENDIF.

    ls_docu-icf_langu = sy-langu.
    ls_docu-icf_docu = ls_http-header-description.
    ls_insert_docu = ls_docu-icf_docu.
    IF ls_http-general_information-handler_class IS NOT INITIAL.
      APPEND CONV icf_hand( ls_http-general_information-handler_class ) TO lt_icfhndlist.
    ENDIF.

    " Existing URLs are changed in place; new URLs create and activate a node.
    CALL METHOD cl_icf_tree=>if_icf_tree~service_from_url
      EXPORTING
        url        = lv_url
        hostnumber = 0
      IMPORTING
        icfnodguid = lv_guid
      EXCEPTIONS
        wrong_url    = 4
        no_authority = 5
        OTHERS       = 99.
    IF sy-subrc = 0.
      SELECT SINGLE *
        FROM icfservice
        WHERE icfnodguid = @lv_guid
        INTO @ls_existing_service.
      IF sy-subrc = 0 AND to_lower( ls_existing_service-icf_name ) = lv_node_name.
      lv_service_name = ls_existing_service-icf_name.
      lv_parent_guid = ls_existing_service-icfparguid.
      CALL METHOD cl_icf_tree=>if_icf_tree~get_info_from_serv
        EXPORTING
          icf_name   = lv_service_name
          icfparguid = lv_parent_guid
          icf_langu  = sy-langu
        IMPORTING
          serv_info = lt_serv_info
        EXCEPTIONS
          wrong_name        = 1
          wrong_parguid     = 2
          incorrect_service = 3
          no_authority      = 4
          OTHERS            = 5.
      IF sy-subrc <> 0 OR lt_serv_info IS INITIAL.
        lcl_response=>respond_error( io_server = io_server
                       iv_status = 500
                       iv_reason = 'Internal Server Error'
                       iv_code = 'HTTP_SERVICE_READ_FAILED'
                       iv_msg = |Could not read SICF service metadata: { lv_url }| ).
        RETURN.
      ENDIF.
      READ TABLE lt_serv_info INDEX 1 INTO ls_serv_info.
      lv_alt_name = ls_serv_info-service-icfaltnme.
      IF ls_serv_info-service-icfaltnme <> ls_serv_info-service-icfaltnme_orig.
        lv_alt_name = ls_serv_info-service-icfaltnme_orig.
      ENDIF.

      " CL_ICF_TREE rejects handlers that are already assigned to the node.
      SELECT * FROM icfhandler
        WHERE icf_name = @lv_service_name
          AND icfparguid = @lv_parent_guid
        INTO TABLE @lt_existing.
      LOOP AT lt_existing ASSIGNING FIELD-SYMBOL(<ls_existing>).
        DELETE TABLE lt_icfhndlist FROM <ls_existing>-icfhandler.
      ENDLOOP.

      MOVE-CORRESPONDING ls_serv_info-service TO ls_icfserdesc.
      CALL METHOD cl_icf_tree=>if_icf_tree~change_node
        EXPORTING
          icf_name   = ls_serv_info-service-orig_name
          icfaltnme  = lv_alt_name
          icfparguid = lv_parent_guid
          icfdocu    = ls_docu
          doculang   = sy-langu
          icfhandlst = lt_icfhndlist
          icfactive  = 'X'
          package    = '$TMP'
          application = ''
          icfserdesc = ls_icfserdesc
        EXCEPTIONS
          empty_icf_name            = 1
          no_new_virtual_host       = 2
          special_service_error     = 3
          parent_not_existing       = 4
          enqueue_error             = 5
          node_already_existing     = 6
          empty_docu                = 7
          doculang_not_installed    = 8
          security_info_error       = 9
          user_password_error       = 10
          password_encryption_error = 11
          invalid_url               = 12
          invalid_otr_concept       = 13
          formflg401_error          = 14
          handler_error             = 15
          transport_error           = 16
          tadir_error               = 17
          package_not_found         = 18
          wrong_application         = 19
          not_allow_application     = 20
          no_application            = 21
          invalid_icfparguid        = 22
          alt_name_invalid          = 23
          alternate_name_exist     = 24
          wrong_icf_name            = 25
          no_authority              = 26
          OTHERS                    = 27.
      lv_change_subrc = sy-subrc.
      IF sy-subrc <> 0.
        MESSAGE ID sy-msgid TYPE 'S' NUMBER sy-msgno
          WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4 INTO lv_icf_message.
        lcl_response=>respond_error( io_server = io_server
                       iv_status = 500
                       iv_reason = 'Internal Server Error'
                       iv_code = 'HTTP_SERVICE_WRITE_FAILED'
                       iv_msg = |SICF service update failed (subrc={ lv_change_subrc }, { sy-msgid } { sy-msgno }): { lv_icf_message }|
                         && |; name={ ls_existing_service-orig_name }, parent={ lv_parent_guid },|
                         && | alt={ lv_alt_name }, handlers={ lines( lt_icfhndlist ) }| ).
        RETURN.
      ENDIF.

      lcl_response=>respond_json( io_server = io_server
                    iv_status = 200
                    iv_reason = 'OK'
                    is_payload = VALUE ty_http_write(
                      status = 'success'
                      data = VALUE #( name = lv_service_name type = 'HTTP' action = 'updated' ) ) ).
      RETURN.
    ENDIF.
    ENDIF.

    CALL METHOD cl_icf_tree=>if_icf_tree~service_from_url
      EXPORTING
        url        = lv_parent_url
        hostnumber = 0
      IMPORTING
        icfnodguid = lv_parent_guid
      EXCEPTIONS
        wrong_url    = 4
        no_authority = 5
        OTHERS       = 99.
    IF sy-subrc <> 0.
      lcl_response=>respond_error( io_server = io_server
                     iv_status = 404
                     iv_reason = 'Not Found'
                     iv_code = 'HTTP_SERVICE_PARENT_NOT_FOUND'
                     iv_msg = |SICF parent node not found: { lv_parent_url }| ).
      RETURN.
    ENDIF.

    lv_alt_name = lv_node_name.
    CALL METHOD cl_icf_tree=>if_icf_tree~insert_node
      EXPORTING
        icf_name   = lv_node_name
        icfparguid = lv_parent_guid
        icfdocu    = ls_insert_docu
        icfhandlst = lt_icfhndlist
        icfactive  = 'X'
        package    = '$TMP'
        application = ''
        doculang   = sy-langu
      IMPORTING
        icfnodguid = lv_guid
      EXCEPTIONS
          empty_icf_name            = 1
          no_new_virtual_host       = 2
          special_service_error     = 3
          parent_not_existing       = 4
          enqueue_error             = 5
          node_already_existing     = 6
          empty_docu                = 7
          doculang_not_installed    = 8
          security_info_error       = 9
          user_password_error       = 10
          password_encryption_error = 11
          invalid_url               = 12
          invalid_otr_concept       = 13
          formflg401_error          = 14
          handler_error             = 15
          transport_error           = 16
          tadir_error               = 17
          package_not_found         = 18
          wrong_application         = 19
          not_allow_application     = 20
          no_application            = 21
          invalid_icfparguid        = 22
          alt_name_invalid          = 23
          alternate_name_exist     = 24
          wrong_icf_name            = 25
          no_authority              = 26
          OTHERS                    = 27.
    IF sy-subrc <> 0.
        MESSAGE ID sy-msgid TYPE 'S' NUMBER sy-msgno
          WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4 INTO lv_icf_message.
      lcl_response=>respond_error( io_server = io_server
                     iv_status = 500
                     iv_reason = 'Internal Server Error'
                     iv_code = 'HTTP_SERVICE_WRITE_FAILED'
                       iv_msg = |SICF service creation failed (subrc={ sy-subrc }, { sy-msgid } { sy-msgno }): { lv_icf_message }| ).
      RETURN.
    ENDIF.

    lcl_response=>respond_json( io_server = io_server
                  iv_status = 200
                  iv_reason = 'OK'
                  is_payload = VALUE ty_http_write(
                    status = 'success'
                    data = VALUE #( name = lv_node_name type = 'HTTP' action = 'created' ) ) ).
  ENDMETHOD.
  METHOD resolve_handler_lang_version.
    " Map the handler class's ABAP language version to the abap-file-format
    " header value ('standard' | 'cloudDevelopment'). 'standard' is the default
    " and the only outcome on on-prem; a genuine SAP Cloud Platform object
    " version (id '5') maps to 'cloudDevelopment'. Any introspection failure
    " (missing class, unsupported type, no authority) falls back to 'standard'
    " so the GET response stays usable.
    rv_version = 'standard'.
    IF iv_class_name IS INITIAL.
      RETURN.
    ENDIF.
    TRY.
        DATA(lo_lang_version) = cl_abap_language_version=>get_instance( ).
        DATA(ls_object_version) = lo_lang_version->get_version_of_object(
          iv_object_type  = 'CLAS'
          iv_object_name  = CONV if_abap_language_version=>ty_object_name( iv_class_name )
          iv_object_state = if_abap_language_version=>gc_object_state-active ).
        IF ls_object_version-id = if_abap_language_version=>gc_version-sap_cloud_platform.
          rv_version = 'cloudDevelopment'.
        ENDIF.
      CATCH cx_root.
        " Silent fallback: introspection failures must not break the response.
    ENDTRY.
  ENDMETHOD.
ENDCLASS.

CLASS lcl_ddic IMPLEMENTATION.
  METHOD dispatch_ddic.
    DATA lv_type TYPE string.
    DATA lv_name TYPE string.
    DATA lv_match_type TYPE string.
    DATA lv_match_name TYPE string.
    DATA lv_pkg TYPE string.
    DATA lv_req TYPE string.
    FIND REGEX '^/ddic/(doma|dtel|tabl|stru|enqu|nrob|ttyp|msag)(?:/(.+))?$' IN iv_path IGNORING CASE
      SUBMATCHES lv_match_type lv_match_name.
    IF sy-subrc <> 0 OR lv_match_type IS INITIAL.
      lcl_response=>respond_error( io_server = io_server
                     iv_status = 404
                     iv_reason = 'Not Found'
                     iv_code = 'NOT_FOUND'
                     iv_msg = |unsupported ddic path: { iv_path }| ).
      RETURN.
    ENDIF.
    lv_type = to_upper( lv_match_type ).
    IF lv_match_name IS NOT INITIAL.
      lv_name = to_upper( lv_match_name ).
    ENDIF.

    DATA lv_package TYPE devclass.
    DATA lv_request TYPE trkorr.
    " 036: TTYP/MSAG accept both POST (create) and PUT (update) through the
    " same DDIF/table write path — the SAP APIs are upsert-shaped.
    IF ( iv_method = 'POST' OR iv_method = 'PUT' ) AND ( lv_type = 'TTYP' OR lv_type = 'MSAG' ).
      FIND FIRST OCCURRENCE OF REGEX '"package"\s*:\s*"([^"]+)"' IN iv_body IGNORING CASE
        SUBMATCHES lv_pkg.
      lv_package = COND devclass( WHEN sy-subrc = 0 THEN lv_pkg ELSE '$TMP' ).
      FIND FIRST OCCURRENCE OF REGEX '"transport(?:Request)?"\s*:\s*"([^"]+)"' IN iv_body IGNORING CASE
        SUBMATCHES lv_req.
      IF sy-subrc = 0.
        lv_request = lv_req.
      ENDIF.

      DATA ls_write     TYPE ty_ddic_create.
      DATA ls_write_err TYPE ty_error.
      IF lv_type = 'TTYP'.
        write_ddic_table_type( EXPORTING iv_name    = CONV ttypename( lv_name )
                                         iv_payload = iv_body
                                         iv_package = lv_package
                                         iv_request = lv_request
                               IMPORTING es_payload = ls_write
                                         ev_error   = ls_write_err ).
      ELSE.
        write_ddic_message_class( EXPORTING iv_name    = CONV arbgb( lv_name )
                                            iv_payload = iv_body
                                            iv_package = lv_package
                                            iv_request = lv_request
                                  IMPORTING es_payload = ls_write
                                            ev_error   = ls_write_err ).
      ENDIF.
      IF ls_write_err IS NOT INITIAL.
        lcl_response=>respond_error( io_server  = io_server
                       iv_status  = 200
                       iv_reason  = 'OK'
                       iv_code    = ls_write_err-error-code
                       iv_msg     = ls_write_err-error-message
                       iv_details = ls_write_err-error-details ).
      ELSE.
        lcl_response=>respond_json( io_server = io_server iv_status = 200 iv_reason = 'OK' is_payload = ls_write ).
      ENDIF.
      RETURN.
    ENDIF.

    IF iv_method = 'POST'.
      " Extract package/transportRequest from the wire payload via static regex
      " (the per-type handlers do the full JSON deserialize for typed fields).
      FIND FIRST OCCURRENCE OF REGEX '"package"\s*:\s*"([^"]+)"' IN iv_body IGNORING CASE
        SUBMATCHES lv_pkg.
      IF sy-subrc = 0.
        lv_package = lv_pkg.
      ELSE.
        lv_package = '$TMP'.
      ENDIF.
      FIND FIRST OCCURRENCE OF REGEX '"transportRequest"\s*:\s*"([^"]+)"' IN iv_body IGNORING CASE
        SUBMATCHES lv_req.
      IF sy-subrc = 0.
        lv_request = lv_req.
      ENDIF.

      DATA ls_create     TYPE ty_ddic_create.
      DATA ls_create_err TYPE ty_error.
      CASE lv_type.
        WHEN 'DOMA'.
          create_ddic_domain( EXPORTING iv_name    = CONV domname( lv_name )
                                        iv_payload = iv_body
                                        iv_package = lv_package
                                        iv_request = lv_request
                              IMPORTING es_payload = ls_create
                                        ev_error   = ls_create_err ).
        WHEN 'DTEL'.
          create_ddic_data_element( EXPORTING iv_name    = CONV rollname( lv_name )
                                            iv_payload = iv_body
                                            iv_package = lv_package
                                            iv_request = lv_request
                                  IMPORTING es_payload = ls_create
                                            ev_error   = ls_create_err ).
        WHEN 'TABL'.
          create_ddic_table( EXPORTING iv_name    = CONV tabname( lv_name )
                                       iv_payload = iv_body
                                       iv_package = lv_package
                                       iv_request = lv_request
                             IMPORTING es_payload = ls_create
                                       ev_error   = ls_create_err ).
        WHEN 'STRU'.
          create_ddic_structure( EXPORTING iv_name    = CONV tabname( lv_name )
                                          iv_payload = iv_body
                                          iv_package = lv_package
                                          iv_request = lv_request
                                IMPORTING es_payload = ls_create
                                          ev_error   = ls_create_err ).
        WHEN 'ENQU'.
          " PR5: ENQU (lock object) goes through ICF. The wire body is the
          " AFF JSON document (formats/enqu/json.ts); the ABAP side translates
          " to DDIF_ENQU_PUT to persist primaryTable / lockParameters /
          " lockModules. See create_ddic_enqu for the implementation.
          create_ddic_enqu( EXPORTING iv_name    = CONV viewname( lv_name )
                                      iv_payload = iv_body
                                      iv_package = lv_package
                                      iv_request = lv_request
                            IMPORTING es_payload = ls_create
                                      ev_error   = ls_create_err ).
        WHEN 'NROB'.
          " PR5: NROB (number range object) — same ICF path. Wire body is
          " the AFF JSON (interval.* + configuration.*). Persists via
          " NRIV writes. See create_ddic_nrob for the implementation.
          create_ddic_nrob( EXPORTING iv_name    = CONV nrobj( lv_name )
                                      iv_payload = iv_body
                                      iv_package = lv_package
                                      iv_request = lv_request
                            IMPORTING es_payload = ls_create
                                      ev_error   = ls_create_err ).
      ENDCASE.
      IF ls_create_err IS NOT INITIAL.
        lcl_response=>respond_error( io_server  = io_server
                       iv_status  = 200
                       iv_reason  = 'OK'
                       iv_code    = ls_create_err-error-code
                       iv_msg     = ls_create_err-error-message
                       iv_details = ls_create_err-error-details ).
      ELSE.
        lcl_response=>respond_json( io_server = io_server iv_status = 200 iv_reason = 'OK' is_payload = ls_create ).
      ENDIF.
    ELSEIF iv_method = 'GET'.
      get_ddic_object( EXPORTING iv_type    = lv_type
                                 iv_name    = lv_name
                       IMPORTING es_payload = DATA(lr_get)
                                 ev_error   = DATA(ls_get_err) ).
      IF ls_get_err IS NOT INITIAL.
        " get_ddic_object failures are single-message (not a BAPI table); no
        " details to surface, so iv_details is omitted on purpose.
        lcl_response=>respond_error( io_server = io_server
                       iv_status = 200
                       iv_reason = 'OK'
                       iv_code   = ls_get_err-error-code
                       iv_msg    = ls_get_err-error-message ).
      ELSE.
        DATA(ls_get_response) = VALUE ty_ddic_get( status = 'success'
                                                    data = lr_get ).
        lcl_response=>respond_json( io_server = io_server iv_status = 200 iv_reason = 'OK' is_payload = ls_get_response ).
      ENDIF.
    ELSE.
      lcl_response=>respond_error( io_server = io_server
                     iv_status = 405
                     iv_reason = 'Method Not Allowed'
                     iv_code = 'METHOD_NOT_ALLOWED'
                     iv_msg = |{ iv_method } not supported on /ddic/{ lv_type }| ).
    ENDIF.
  ENDMETHOD.
  METHOD get_uuid.
    TRY.
        rv_uuid = cl_system_uuid=>if_system_uuid_static~create_uuid_c32( ).
      CATCH cx_uuid_error.
        CLEAR rv_uuid.
    ENDTRY.
  ENDMETHOD.
  METHOD build_table_header.
    CLEAR es_object_new.
    es_object_new-key_guid = get_uuid( ).
    es_object_new-object_name = iv_table_name.

    APPEND VALUE coms_gox_def_text( language = sy-langu description = iv_description )
      TO es_object_new-object_text.

    DATA ls_details TYPE coms_gox_table_entry_fields.
    ls_details-fieldname = 'TABCLASS'.  ls_details-fieldvalue = iv_tabclass.    APPEND ls_details TO es_object_new-details.
    ls_details-fieldname = 'CONTFLAG'.  ls_details-fieldvalue = iv_delivery_class. APPEND ls_details TO es_object_new-details.
    ls_details-fieldname = 'TABART'.    ls_details-fieldvalue = iv_data_class.  APPEND ls_details TO es_object_new-details.
    ls_details-fieldname = 'TABKAT'.    ls_details-fieldvalue = iv_size_category. APPEND ls_details TO es_object_new-details.
    ls_details-fieldname = 'EXCLASS'.   ls_details-fieldvalue = iv_exclass.     APPEND ls_details TO es_object_new-details.

    APPEND es_object_new TO et_object_new.
  ENDMETHOD.
  METHOD build_field_entries.
    DATA ls_object_new TYPE coms_gox_def_header.
    DATA ls_details    TYPE coms_gox_table_entry_fields.
    DATA lv_position   TYPE i.
    DATA lv_uuid       TYPE sysuuid-c.

    lv_position = iv_start_pos - 1.
    LOOP AT it_fields ASSIGNING FIELD-SYMBOL(<ls_field>).
      ADD 1 TO lv_position.
      lv_uuid = get_uuid( ).
      CLEAR ls_object_new.
      ls_object_new-object_type = 'TABLE_FIELD'.
      ls_object_new-object_name = <ls_field>-fieldName.
      ls_object_new-key_guid    = lv_uuid.
      ls_object_new-parent_key  = iv_parent_key.

      ls_details-fieldname = 'POSITION'. ls_details-fieldvalue = lv_position. APPEND ls_details TO ls_object_new-details.

      IF <ls_field>-keyFlag = abap_true.
        ls_details-fieldname = 'KEYFLAG'. ls_details-fieldvalue = <ls_field>-keyFlag. APPEND ls_details TO ls_object_new-details.
        ls_details-fieldname = 'NOTNULL'. ls_details-fieldvalue = 'X'. APPEND ls_details TO ls_object_new-details.
      ELSEIF <ls_field>-notNull = abap_true.
        ls_details-fieldname = 'NOTNULL'. ls_details-fieldvalue = <ls_field>-notNull. APPEND ls_details TO ls_object_new-details.
      ENDIF.

      IF <ls_field>-rollname IS NOT INITIAL.
        ls_details-fieldname = 'ROLLNAME'. ls_details-fieldvalue = <ls_field>-rollname. APPEND ls_details TO ls_object_new-details.
      ELSEIF <ls_field>-dataType IS NOT INITIAL.
        ls_details-fieldname = 'DATATYPE'. ls_details-fieldvalue = <ls_field>-dataType. APPEND ls_details TO ls_object_new-details.
        IF <ls_field>-length IS NOT INITIAL.
          ls_details-fieldname = 'LENG'. ls_details-fieldvalue = <ls_field>-length. APPEND ls_details TO ls_object_new-details.
        ENDIF.
        IF <ls_field>-decimals IS NOT INITIAL.
          ls_details-fieldname = 'DECIMALS'. ls_details-fieldvalue = <ls_field>-decimals. APPEND ls_details TO ls_object_new-details.
        ENDIF.
        IF <ls_field>-ddtext IS NOT INITIAL.
          ls_details-fieldname = 'DDTEXT'. ls_details-fieldvalue = <ls_field>-ddtext. APPEND ls_details TO ls_object_new-details.
        ENDIF.
        ls_details-fieldname = 'LANGUAGE'. ls_details-fieldvalue = sy-langu. APPEND ls_details TO ls_object_new-details.
      ENDIF.
      IF <ls_field>-precField IS NOT INITIAL.
        ls_details-fieldname = 'PRECFIELD'. ls_details-fieldvalue = <ls_field>-precField. APPEND ls_details TO ls_object_new-details.
      ENDIF.

      IF <ls_field>-refTable IS NOT INITIAL AND <ls_field>-refField IS NOT INITIAL.
        ls_details-fieldname = 'REFTABLE'. ls_details-fieldvalue = <ls_field>-refTable. APPEND ls_details TO ls_object_new-details.
        ls_details-fieldname = 'REFFIELD'. ls_details-fieldvalue = <ls_field>-refField. APPEND ls_details TO ls_object_new-details.
      ENDIF.
      IF <ls_field>-checkTable IS NOT INITIAL.
        ls_details-fieldname = 'CHECKTABLE'. ls_details-fieldvalue = <ls_field>-checkTable. APPEND ls_details TO ls_object_new-details.
      ENDIF.

      APPEND ls_object_new TO et_object_new.
    ENDLOOP.
  ENDMETHOD.
  METHOD apply_ddic_table_settings.

    " P2.1: TABT writeback - apply buffering/storageType/loadUnit/logChanges/
    " translation to an existing TABL. Read current DD09L via DDIF_TABL_GET,
    " mutate the requested fields, and persist via DDIF_TABL_PUT. Each field
    " is gated by an `iv_payload CS '"<key>"'` substring check so partial
    " payloads (e.g. CLI sends only `buffering`) don't clobber untouched
    " SAP-side settings.
    DATA ls_header TYPE dd02v.
    DATA ls_technical TYPE dd09v.
    DATA lt_dd03p TYPE STANDARD TABLE OF dd03p WITH EMPTY KEY.
    DATA lt_dd05m TYPE STANDARD TABLE OF dd05m WITH EMPTY KEY.
    DATA lt_dd08v TYPE STANDARD TABLE OF dd08v WITH EMPTY KEY.
    DATA lt_dd35v TYPE STANDARD TABLE OF dd35v WITH EMPTY KEY.
    DATA lt_dd36m TYPE STANDARD TABLE OF dd36m WITH EMPTY KEY.
    DATA lv_error_message TYPE string.

    " Read current technical settings + foreign-key/index/text metadata.
    CALL FUNCTION 'DDIF_TABL_GET'
      EXPORTING
        name     = iv_name
        state    = 'A'
        langu    = sy-langu
      IMPORTING
        dd02v_wa = ls_header
        dd09l_wa = ls_technical
      TABLES
        dd03p_tab = lt_dd03p
        dd05m_tab = lt_dd05m
        dd08v_tab = lt_dd08v
        dd35v_tab = lt_dd35v
        dd36m_tab = lt_dd36m
      EXCEPTIONS
        illegal_input = 1
        OTHERS = 2.
    IF sy-subrc <> 0 OR ls_header-tabname IS INITIAL.
      ev_error = VALUE ty_error( status = 'error'
                                 error = VALUE ty_error_body(
                                   code = 'DDIC_OBJECT_NOT_FOUND'
                                   message = |TABL { iv_name } not found while applying technical settings| ) ).
      RETURN.
    ENDIF.

    " Apply logChanges -> DD09L-protokoll (X / space).
    IF iv_payload CS '"logChanges"'.
      ls_technical-protokoll = COND #( WHEN is_settings-log_changes = abap_true
                                       THEN 'X' ELSE space ).
    ENDIF.

    " Apply translation -> DD09L-uebersetz (enum mapping per AFF schema).
    IF iv_payload CS '"translation"'.
      CASE is_settings-translation.
        WHEN 'noLanguageKey'.
          ls_technical-uebersetz = space.
        WHEN 'standard'.
          ls_technical-uebersetz = 'X'.
        WHEN 'loadTable'.
          ls_technical-uebersetz = 'L'.
        WHEN 'objectSpecific'.
          ls_technical-uebersetz = 'T'.
        WHEN 'notRelevant'.
          ls_technical-uebersetz = 'N'.
        WHEN OTHERS.
          lv_error_message = |unsupported TABT translation value { is_settings-translation }|.
      ENDCASE.
    ENDIF.

    " Apply buffering.state -> DD09L-bufallow (N / X / A).
    IF iv_payload CS '"state"'.
      CASE is_settings-buffering-state.
        WHEN 'notAllowed'.
          ls_technical-bufallow = 'N'.
        WHEN 'switchedOn'.
          ls_technical-bufallow = 'X'.
        WHEN 'allowedButSwitchedOff'.
          ls_technical-bufallow = 'A'.
        WHEN OTHERS.
          lv_error_message = |unsupported TABT buffering state { is_settings-buffering-state }|.
      ENDCASE.
    ENDIF.

    " Apply buffering.type -> DD09L-pufferung (space / P / G / X).
    IF iv_payload CS '"type"'.
      CASE is_settings-buffering-type.
        WHEN 'noBuffer'.
          ls_technical-pufferung = space.
        WHEN 'single'.
          ls_technical-pufferung = 'P'.
        WHEN 'generic'.
          ls_technical-pufferung = 'G'.
        WHEN 'full'.
          ls_technical-pufferung = 'X'.
        WHEN OTHERS.
          lv_error_message = |unsupported TABT buffering type { is_settings-buffering-type }|.
      ENDCASE.
    ENDIF.

    " Apply generic-buffer key-field count.
    IF iv_payload CS '"nrOfKeyFlds4GenericBuff"'.
      ls_technical-schfeldanz = is_settings-buffering-nr_of_key_flds4_generic_buff.
    ENDIF.

    " Apply storageType -> DD09L-roworcolst (R / C / space).
    IF iv_payload CS '"storageType"'.
      CASE is_settings-db_specific_settings-storage_type.
        WHEN 'undefined'.
          ls_technical-roworcolst = space.
        WHEN 'rowStore'.
          ls_technical-roworcolst = 'R'.
        WHEN 'columnStore'.
          ls_technical-roworcolst = 'C'.
        WHEN OTHERS.
          lv_error_message = |unsupported TABT storage type { is_settings-db_specific_settings-storage_type }|.
      ENDCASE.
    ENDIF.

    " Apply loadUnit -> DD09L-load_unit (space / P / A / Q).
    IF iv_payload CS '"loadUnit"'.
      CASE is_settings-db_specific_settings-load_unit.
        WHEN 'columnPreferred'.
          ls_technical-load_unit = space.
        WHEN 'pagePreferred'.
          ls_technical-load_unit = 'P'.
        WHEN 'columnEnforced'.
          ls_technical-load_unit = 'A'.
        WHEN 'pageEnforced'.
          ls_technical-load_unit = 'Q'.
        WHEN OTHERS.
          lv_error_message = |unsupported TABT load unit { is_settings-db_specific_settings-load_unit }|.
      ENDCASE.
    ENDIF.

    " Reject on any unknown enum value before persisting (atomic semantics).
    IF lv_error_message IS NOT INITIAL.
      ev_error = VALUE ty_error( status = 'error'
                                 error = VALUE ty_error_body(
                                   code = 'DDIC_FIELD_UNSUPPORTED'
                                   message = lv_error_message ) ).
      RETURN.
    ENDIF.

    " Persist via DDIF_TABL_PUT. Foreign-key/index/text tables are forwarded
    " unchanged so we don't lose metadata the read pulled in.
    CALL FUNCTION 'DDIF_TABL_PUT'
      EXPORTING
        name     = iv_name
        dd02v_wa = ls_header
        dd09l_wa = ls_technical
      TABLES
        dd03p_tab = lt_dd03p
        dd05m_tab = lt_dd05m
        dd08v_tab = lt_dd08v
        dd35v_tab = lt_dd35v
        dd36m_tab = lt_dd36m
      EXCEPTIONS
        tabl_not_found     = 1
        name_inconsistent  = 2
        tabl_inconsistent  = 3
        put_failure        = 4
        put_refused        = 5
        OTHERS             = 6.
    IF sy-subrc <> 0.
      ev_error = VALUE ty_error( status = 'error'
                                 error = VALUE ty_error_body(
                                   code = 'DDIC_SETTINGS_WRITE_FAILED'
                                   message = |Could not apply technical settings to TABL { iv_name }| ) ).
    ENDIF.

  ENDMETHOD.
  METHOD create_ddic_table.
    DATA lt_object_new TYPE comt_gox_def_header.
    DATA lt_object_old TYPE comt_gox_def_header.
    DATA lt_bapireturn TYPE bapirettab.
    DATA lt_transport  TYPE comt_gox_trans_object.
    DATA lt_fields     TYPE tt_field.
    DATA ls_mandt      TYPE ty_field.
    DATA lv_start      TYPE i.
    DATA ls_header_local TYPE coms_gox_def_header.
    DATA lt_field_entries TYPE comt_gox_def_header.

    " 037 US1: AFF nested wire. CLI emits generalInformation.deliveryClass
    " etc. under the generalInformation object; the flat top-level
    " deliveryClass/dataClass/sizeCategory/clientDependent are gone.
    DATA: BEGIN OF ls_attr,
            name                  TYPE string,
            header                TYPE ty_ddic_header,
            general_information   TYPE ty_tabl_general_information,
            fields                TYPE tt_field,
          END OF ls_attr.
    /ui2/cl_json=>deserialize( EXPORTING json = iv_payload
                               CHANGING data = ls_attr ).
    IF ls_attr-name IS INITIAL.
      ls_attr-name = iv_name.
    ENDIF.
    lt_fields = ls_attr-fields.

    IF ls_attr-general_information-client_dependent = abap_true.
      " The CLI strips any CLIENT/MANDT entry from the wire before posting
      " (see src/abap_cli/dictionary/ddic-json.ts:stripClientFields), so under
      " normal operation `lt_fields` does not contain MANDT here. We still
      " guard against a duplicate-MANDT insert so older clients (or hand-
      " crafted payloads) don't fail with a misleading "Field already exists"
      " error from the BAPI layer.
      READ TABLE lt_fields TRANSPORTING NO FIELDS WITH KEY fieldName = 'MANDT'.
      IF sy-subrc <> 0.
        ls_mandt-fieldName = 'MANDT'.
        ls_mandt-rollname   = 'MANDT'.
        ls_mandt-keyFlag    = abap_true.
        ls_mandt-notNull    = abap_true.
        INSERT ls_mandt INTO lt_fields INDEX 1.
      ENDIF.
    ENDIF.

    build_table_header( EXPORTING iv_table_name    = CONV tabname( ls_attr-name )
                                  iv_description   = CONV ddtext( ls_attr-header-description )
                                  iv_delivery_class = CONV dd02v-contflag( ls_attr-general_information-delivery_class )
                                  iv_data_class    = CONV dd09l-tabart( ls_attr-general_information-data_class_category )
                                  iv_size_category = CONV dd09l-tabkat( ls_attr-general_information-size_category )
                        IMPORTING es_object_new    = ls_header_local
                                  et_object_new     = lt_object_new
                                  et_bapireturn    = lt_bapireturn ).
    lv_start = COND #( WHEN ls_attr-general_information-client_dependent = abap_true THEN 2 ELSE 1 ).

    build_field_entries( EXPORTING iv_parent_key = ls_header_local-key_guid
                                   iv_table_name = CONV tabname( ls_attr-name )
                                   it_fields     = lt_fields
                                   iv_start_pos  = lv_start
                         IMPORTING et_object_new = lt_field_entries
                                   et_bapireturn = lt_bapireturn ).

    APPEND LINES OF lt_field_entries TO lt_object_new.

    CALL FUNCTION 'GOX_GEN_TABLE_STD'
      EXPORTING
        iv_object_name = CONV char32( ls_attr-name )
        it_object_new  = lt_object_new
        it_object_old  = lt_object_old
        iv_devclass    = iv_package
        iv_request_wb  = iv_request
      IMPORTING
        et_bapireturn  = lt_bapireturn
        et_transport   = lt_transport.

    DATA lv_ok TYPE abap_bool VALUE abap_true.
    DATA lv_msg TYPE string.
    DATA lt_details TYPE string_table.
    DATA lv_error TYPE string.
    LOOP AT lt_bapireturn INTO DATA(ls_err) WHERE type CA 'EAX'.
      lv_ok = abap_false.
      IF ls_err-message IS INITIAL.
        MESSAGE ID ls_err-id TYPE 'S' NUMBER ls_err-number
          WITH ls_err-message_v1 ls_err-message_v2 ls_err-message_v3 ls_err-message_v4
          INTO lv_error.
      ELSE.
        lv_error = ls_err-message.
      ENDIF.
      APPEND lv_error TO lt_details.
      IF lv_msg IS INITIAL. lv_msg = lv_error. ELSE. lv_msg = lv_msg && |; { lv_error }|. ENDIF.
    ENDLOOP.
    IF lv_ok = abap_false.
      ev_error = VALUE ty_error( status = 'error'
                                 error = VALUE ty_error_body( code = 'DDIC_CREATE_FAILED'
                                                              message = lv_msg
                                                              details = lt_details ) ).
      RETURN.
    ENDIF.
      " P2.1: TABT writeback. When payload carries logChanges/translation/
      " buffering/dbSpecificSettings, deserialize into a dedicated settings
      " struct (avoids nesting all TABT keys under ty_tabl_general_information
      " which only carries create-time fields) and forward to apply_ddic_table_settings.
      IF iv_payload CS '"logChanges"'
         OR iv_payload CS '"translation"'
         OR iv_payload CS '"buffering"'
         OR iv_payload CS '"dbSpecificSettings"'.
        DATA ls_settings TYPE ty_ddic_table_settings.
        /ui2/cl_json=>deserialize( EXPORTING json = iv_payload
                                     pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                               CHANGING data = ls_settings ).
        apply_ddic_table_settings( EXPORTING iv_name     = CONV tabname( ls_attr-name )
                                             iv_payload  = iv_payload
                                             is_settings = ls_settings
                                    IMPORTING ev_error    = ev_error ).
        IF ev_error IS NOT INITIAL.
          RETURN.
        ENDIF.
      ENDIF.

    es_payload = VALUE ty_ddic_create( status = 'success'
                                       data = VALUE ty_ddic_create_data( name   = ls_attr-name
                                                                         type   = 'TABL'
                                                                         action = 'created' ) ).
  ENDMETHOD.
  METHOD create_ddic_structure.
    DATA lt_object_new TYPE comt_gox_def_header.
    DATA lt_object_old TYPE comt_gox_def_header.
    DATA lt_bapireturn TYPE bapirettab.
    DATA lt_transport  TYPE comt_gox_trans_object.
    DATA lt_fields     TYPE tt_field.
    DATA ls_header_local TYPE coms_gox_def_header.
    DATA lt_field_entries TYPE comt_gox_def_header.

    " 037 US1: AFF nested — STRU has no deliveryClass/dataClass/sizeCategory;
    " only header.description carries the description.
    DATA: BEGIN OF ls_attr,
            name   TYPE string,
            header TYPE ty_ddic_header,
            fields TYPE tt_field,
          END OF ls_attr.
    /ui2/cl_json=>deserialize( EXPORTING json = iv_payload CHANGING data = ls_attr ).
    IF ls_attr-name IS INITIAL.
      ls_attr-name = iv_name.
    ENDIF.
    lt_fields = ls_attr-fields.

    build_table_header( EXPORTING iv_table_name    = CONV tabname( ls_attr-name )
                                  iv_description   = CONV ddtext( ls_attr-header-description )
                                  iv_tabclass      = 'INTTAB'
                                  iv_delivery_class = 'A'
                                  iv_data_class    = 'APPL0'
                                  iv_size_category = '0'
                                  iv_exclass       = '3'
                        IMPORTING es_object_new    = ls_header_local
                                  et_object_new    = lt_object_new
                                  et_bapireturn    = lt_bapireturn ).
    build_field_entries( EXPORTING iv_parent_key = ls_header_local-key_guid
                                   iv_table_name = CONV tabname( ls_attr-name )
                                   it_fields     = lt_fields
                         IMPORTING et_object_new = lt_field_entries
                                   et_bapireturn = lt_bapireturn ).
    APPEND LINES OF lt_field_entries TO lt_object_new.

    CALL FUNCTION 'GOX_GEN_TABLE_STD'
      EXPORTING
        iv_object_name = CONV char32( ls_attr-name )
        it_object_new  = lt_object_new
        it_object_old  = lt_object_old
        iv_devclass    = iv_package
        iv_request_wb  = iv_request
      IMPORTING
        et_bapireturn  = lt_bapireturn
        et_transport   = lt_transport.

    DATA lv_ok TYPE abap_bool VALUE abap_true.
    DATA lt_details TYPE string_table.
    DATA lv_msg TYPE string.
    DATA lv_error TYPE string.
    LOOP AT lt_bapireturn INTO DATA(ls_err) WHERE type CA 'EAX'.
      lv_ok = abap_false.
      IF ls_err-message IS INITIAL.
        MESSAGE ID ls_err-id TYPE 'S' NUMBER ls_err-number
          WITH ls_err-message_v1 ls_err-message_v2 ls_err-message_v3 ls_err-message_v4
          INTO lv_error.
      ELSE.
        lv_error = ls_err-message.
      ENDIF.
      APPEND lv_error TO lt_details.
      IF lv_msg IS INITIAL. lv_msg = lv_error. ELSE. lv_msg = lv_msg && |; { lv_error }|. ENDIF.
    ENDLOOP.
    IF lv_ok = abap_false.
      ev_error = VALUE ty_error( status = 'error'
                                 error = VALUE ty_error_body( code = 'DDIC_CREATE_FAILED'
                                                              message = lv_msg
                                                              details = lt_details ) ).
      RETURN.
    ENDIF.
    es_payload = VALUE ty_ddic_create( status = 'success'
                                       data = VALUE ty_ddic_create_data( name   = ls_attr-name
                                                                         type   = 'STRU'
                                                                         action = 'created' ) ).
  ENDMETHOD.
  METHOD create_ddic_data_element.
    " GOX_GEN_DTEL_STD: domain reference OR built-in type + screen texts.
    DATA lt_object_new TYPE comt_gox_def_header.
    DATA lt_object_old TYPE comt_gox_def_header.
    DATA lt_bapireturn TYPE bapirettab.
    DATA lt_transport  TYPE comt_gox_trans_object.
    DATA ls_object_new TYPE coms_gox_def_header.
    DATA ls_details    TYPE coms_gox_table_entry_fields.

    " 037 US1: AFF nested — category drives which DDIC fields are populated.
    " Five categories (per dtel-v1.json):
    "   'domain'                    → DOMNAME = data_type_info.type_name
    "   'predefinedType'            → DATATYPE / LENG / DECIMALS from
    "                                 data_type_info.predefined_*
    "   'referenceToPredefinedType' → DATATYPE / REFTYPE / LENG
    "   'referenceDictionaryType'   → TATYPE / TAPR (TTYP reference)
    "   'referenceClasIntType'      → CLASSTYPE / CLSNAME / REFCLSNAME / LENG
    DATA: BEGIN OF ls_attr,
            name                  TYPE string,
            header                TYPE ty_ddic_header,
            data_type_information TYPE ty_dtel_data_type_info,
            short_text            TYPE string,
            medium_text           TYPE string,
            long_text             TYPE string,
            header_text           TYPE string,
          END OF ls_attr.
    /ui2/cl_json=>deserialize( EXPORTING json = iv_payload
                               CHANGING data = ls_attr ).
    IF ls_attr-name IS INITIAL.
      ls_attr-name = iv_name.
    ENDIF.

    " Category-driven DDIC detail mapping. Unknown categories raise
    " DTEL_CATEGORY_UNSUPPORTED via the caller dispatch_ddic path (the
    " SAP-side check happens here so the ICF envelope returns a clean
    " DTEL_CATEGORY_UNSUPPORTED instead of a generic DDIC_CREATE_FAILED).
    CASE ls_attr-data_type_information-category.
      WHEN 'domain'.
        IF ls_attr-data_type_information-type_name IS NOT INITIAL.
          ls_details-fieldname = 'DOMNAME'.
          ls_details-fieldvalue = ls_attr-data_type_information-type_name.
          APPEND ls_details TO ls_object_new-details.
        ENDIF.
      WHEN 'predefinedType'.
        IF ls_attr-data_type_information-predefined_data_type IS NOT INITIAL.
          ls_details-fieldname = 'DATATYPE'.
          ls_details-fieldvalue = ls_attr-data_type_information-predefined_data_type.
          APPEND ls_details TO ls_object_new-details.
        ENDIF.
        IF ls_attr-data_type_information-predefined_length IS NOT INITIAL.
          ls_details-fieldname = 'LENG'.
          ls_details-fieldvalue = ls_attr-data_type_information-predefined_length.
          APPEND ls_details TO ls_object_new-details.
        ENDIF.
        IF ls_attr-data_type_information-predefined_decimals IS NOT INITIAL.
          ls_details-fieldname = 'DECIMALS'.
          ls_details-fieldvalue = ls_attr-data_type_information-predefined_decimals.
          APPEND ls_details TO ls_object_new-details.
        ENDIF.
      WHEN 'referenceToPredefinedType'.
        IF ls_attr-data_type_information-type_name IS NOT INITIAL.
          ls_details-fieldname = 'DATATYPE'.
          ls_details-fieldvalue = ls_attr-data_type_information-type_name.
          APPEND ls_details TO ls_object_new-details.
        ENDIF.
        ls_details-fieldname = 'REFTYPE'. ls_details-fieldvalue = 'P'.
        APPEND ls_details TO ls_object_new-details.
        IF ls_attr-data_type_information-predefined_length IS NOT INITIAL.
          ls_details-fieldname = 'LENG'.
          ls_details-fieldvalue = ls_attr-data_type_information-predefined_length.
          APPEND ls_details TO ls_object_new-details.
        ENDIF.
      WHEN 'referenceDictionaryType'.
        " TATYPE + TAPR encode a dictionary-type reference (e.g. TTYP).
        ls_details-fieldname = 'TATYPE'. ls_details-fieldvalue = '1'.
        APPEND ls_details TO ls_object_new-details.
        IF ls_attr-data_type_information-type_name IS NOT INITIAL.
          ls_details-fieldname = 'TAPR'.
          ls_details-fieldvalue = ls_attr-data_type_information-type_name.
          APPEND ls_details TO ls_object_new-details.
        ENDIF.
      WHEN 'referenceClasIntType'.
        " CLASSTYPE + CLSNAME + REFCLSNAME + LENG encode a class/interface ref.
        IF ls_attr-data_type_information-type_name IS NOT INITIAL.
          ls_details-fieldname = 'CLSNAME'.
          ls_details-fieldvalue = ls_attr-data_type_information-type_name.
          APPEND ls_details TO ls_object_new-details.
        ENDIF.
        ls_details-fieldname = 'CLASSTYPE'. ls_details-fieldvalue = '0'.
        APPEND ls_details TO ls_object_new-details.
        ls_details-fieldname = 'REFCLSNAME'.
        ls_details-fieldvalue = ls_attr-data_type_information-type_name.
        APPEND ls_details TO ls_object_new-details.
        IF ls_attr-data_type_information-predefined_length IS NOT INITIAL.
          ls_details-fieldname = 'LENG'.
          ls_details-fieldvalue = ls_attr-data_type_information-predefined_length.
          APPEND ls_details TO ls_object_new-details.
        ENDIF.
      WHEN OTHERS.
        ev_error = VALUE ty_error( status = 'error'
                                   error = VALUE ty_error_body( code = 'DTEL_CATEGORY_UNSUPPORTED'
                                                                message = |DTEL { ls_attr-name } unsupported category: { ls_attr-data_type_information-category }|
                                                                details = VALUE #( ( |expected one of: domain, predefinedType, referenceToPredefinedType, referenceDictionaryType, referenceClasIntType| ) ) ) ).
        RETURN.
    ENDCASE.

    " Column header (reptext) + its length marker.
    IF ls_attr-header_text IS NOT INITIAL.
      ls_details-fieldname = 'REPTEXT'. ls_details-fieldvalue = ls_attr-header_text.
      APPEND ls_details TO ls_object_new-details.
      ls_details-fieldname = 'HEADLEN'. ls_details-fieldvalue = '55'.
      APPEND ls_details TO ls_object_new-details.
    ENDIF.
    " Screen texts: short / medium / long + length markers.
    IF ls_attr-short_text IS NOT INITIAL.
      ls_details-fieldname = 'SCRTEXT_S'. ls_details-fieldvalue = ls_attr-short_text.
      APPEND ls_details TO ls_object_new-details.
      ls_details-fieldname = 'SCRLEN1'. ls_details-fieldvalue = '10'.
      APPEND ls_details TO ls_object_new-details.
    ENDIF.
    IF ls_attr-medium_text IS NOT INITIAL.
      ls_details-fieldname = 'SCRTEXT_M'. ls_details-fieldvalue = ls_attr-medium_text.
      APPEND ls_details TO ls_object_new-details.
      ls_details-fieldname = 'SCRLEN2'. ls_details-fieldvalue = '20'.
      APPEND ls_details TO ls_object_new-details.
    ENDIF.
    IF ls_attr-long_text IS NOT INITIAL.
      ls_details-fieldname = 'SCRTEXT_L'. ls_details-fieldvalue = ls_attr-long_text.
      APPEND ls_details TO ls_object_new-details.
      ls_details-fieldname = 'SCRLEN3'. ls_details-fieldvalue = '40'.
      APPEND ls_details TO ls_object_new-details.
    ENDIF.

    ls_details-fieldname = 'DDLANGUAGE'. ls_details-fieldvalue = sy-langu.
    APPEND ls_details TO ls_object_new-details.

    ls_object_new-key_guid     = get_uuid( ).
    ls_object_new-object_name  = ls_attr-name.
    APPEND VALUE coms_gox_def_text( language = sy-langu description = ls_attr-header-description )
      TO ls_object_new-object_text.
    APPEND ls_object_new TO lt_object_new.

    CALL FUNCTION 'GOX_GEN_DTEL_STD'
      EXPORTING
        iv_object_name = CONV char32( ls_attr-name )
        it_object_new  = lt_object_new
        it_object_old  = lt_object_old
        iv_devclass    = iv_package
        iv_request_wb  = iv_request
      IMPORTING
        et_bapireturn  = lt_bapireturn
        et_transport   = lt_transport.

    DATA lv_ok TYPE abap_bool VALUE abap_true.
    DATA lv_msg TYPE string.
    DATA lt_details TYPE string_table.
    DATA lv_error TYPE string.
    LOOP AT lt_bapireturn INTO DATA(ls_err) WHERE type CA 'EAX'.
      lv_ok = abap_false.
      IF ls_err-message IS INITIAL.
        MESSAGE ID ls_err-id TYPE 'S' NUMBER ls_err-number
          WITH ls_err-message_v1 ls_err-message_v2 ls_err-message_v3 ls_err-message_v4
          INTO lv_error.
      ELSE.
        lv_error = ls_err-message.
      ENDIF.
      APPEND lv_error TO lt_details.
      IF lv_msg IS INITIAL. lv_msg = lv_error. ELSE. lv_msg = lv_msg && |; { lv_error }|. ENDIF.
    ENDLOOP.
    IF lv_ok = abap_false.
      ev_error = VALUE ty_error( status = 'error'
                                 error = VALUE ty_error_body( code = 'DDIC_CREATE_FAILED'
                                                              message = lv_msg
                                                              details = lt_details ) ).
      RETURN.
    ENDIF.
    es_payload = VALUE ty_ddic_create( status = 'success'
                                       data = VALUE ty_ddic_create_data( name   = ls_attr-name
                                                                         type   = 'DTEL'
                                                                         action = 'created' ) ).
  ENDMETHOD.
  METHOD create_ddic_domain.
    " GOX_GEN_DOMA_STD: datatype/length/decimals + sign/lowercase/convExit.
    DATA lt_object_new TYPE comt_gox_def_header.
    DATA lt_object_old TYPE comt_gox_def_header.
    DATA lt_bapireturn TYPE bapirettab.
    DATA lt_transport  TYPE comt_gox_trans_object.
    DATA ls_object_new TYPE coms_gox_def_header.
    DATA ls_details    TYPE coms_gox_table_entry_fields.

    " 037 US1: AFF nested — dataType/length/decimals/signFlag/lowercase/
    " convExit all live under format.*. signFlag is a wire string ('X' / '');
    " any non-empty value is treated as 'X' for back-compat with hand-crafted
    " boolean true values.
    DATA: BEGIN OF ls_attr,
            name                   TYPE string,
            header                 TYPE ty_ddic_header,
            format                 TYPE ty_doma_format,
            output_characteristics TYPE ty_doma_output,
            fixed_values           TYPE tt_doma_fixed_value,
          END OF ls_attr.
    /ui2/cl_json=>deserialize( EXPORTING json = iv_payload
                               CHANGING data = ls_attr ).
    IF ls_attr-name IS INITIAL.
      ls_attr-name = iv_name.
    ENDIF.

    ls_details-fieldname = 'DATATYPE'. ls_details-fieldvalue = ls_attr-format-data_type.
    APPEND ls_details TO ls_object_new-details.
    ls_details-fieldname = 'LENG'. ls_details-fieldvalue = ls_attr-format-length.
    APPEND ls_details TO ls_object_new-details.
    IF ls_attr-format-decimals IS NOT INITIAL.
      ls_details-fieldname = 'DECIMALS'. ls_details-fieldvalue = ls_attr-format-decimals.
      APPEND ls_details TO ls_object_new-details.
    ENDIF.
    IF ls_attr-format-sign_flag IS NOT INITIAL.
      ls_details-fieldname = 'SIGNFLAG'. ls_details-fieldvalue = ls_attr-format-sign_flag.
      APPEND ls_details TO ls_object_new-details.
    ENDIF.
    IF ls_attr-format-lowercase IS NOT INITIAL.
      ls_details-fieldname = 'LOWERCASE'. ls_details-fieldvalue = ls_attr-format-lowercase.
      APPEND ls_details TO ls_object_new-details.
    ENDIF.
    IF ls_attr-format-conv_exit IS NOT INITIAL.
      ls_details-fieldname = 'CONVEXIT'. ls_details-fieldvalue = ls_attr-format-conv_exit.
      APPEND ls_details TO ls_object_new-details.
    ENDIF.
    ls_details-fieldname = 'DDLANGUAGE'. ls_details-fieldvalue = sy-langu.
    APPEND ls_details TO ls_object_new-details.

    ls_object_new-key_guid     = get_uuid( ).
    ls_object_new-object_name  = ls_attr-name.
    APPEND VALUE coms_gox_def_text( language = sy-langu description = ls_attr-header-description )
      TO ls_object_new-object_text.
    APPEND ls_object_new TO lt_object_new.

    CALL FUNCTION 'GOX_GEN_DOMA_STD'
      EXPORTING
        iv_object_name = CONV char32( ls_attr-name )
        it_object_new  = lt_object_new
        it_object_old  = lt_object_old
        iv_devclass    = iv_package
        iv_request_wb  = iv_request
      IMPORTING
        et_bapireturn  = lt_bapireturn
        et_transport   = lt_transport.

    DATA lv_ok TYPE abap_bool VALUE abap_true.
    DATA lv_msg TYPE string.
    DATA lt_details TYPE string_table.
    DATA lv_error TYPE string.
    LOOP AT lt_bapireturn INTO DATA(ls_err) WHERE type CA 'EAX'.
      lv_ok = abap_false.
      IF ls_err-message IS INITIAL.
        MESSAGE ID ls_err-id TYPE 'S' NUMBER ls_err-number
          WITH ls_err-message_v1 ls_err-message_v2 ls_err-message_v3 ls_err-message_v4
          INTO lv_error.
      ELSE.
        lv_error = ls_err-message.
      ENDIF.
      APPEND lv_error TO lt_details.
      IF lv_msg IS INITIAL. lv_msg = lv_error. ELSE. lv_msg = lv_msg && |; { lv_error }|. ENDIF.
    ENDLOOP.
    IF lv_ok = abap_false.
      ev_error = VALUE ty_error( status = 'error'
                                 error = VALUE ty_error_body( code = 'DDIC_CREATE_FAILED'
                                                              message = lv_msg
                                                              details = lt_details ) ).
      RETURN.
    ENDIF.
    es_payload = VALUE ty_ddic_create( status = 'success'
                                       data = VALUE ty_ddic_create_data( name   = ls_attr-name
                                                                         type   = 'DOMA'
                                                                         action = 'created' ) ).
  ENDMETHOD.
  METHOD create_ddic_enqu.
    " PR5: ENQU create. The CLI posts the AFF enqu-v1 document (camelCase) plus
    " the lock object name (which the document itself does not carry — its
    " primaryTable.name is the table being locked, not the object).
    "
    " Persistence goes through DDIF_ENQU_PUT. There is no GOX_GEN_ENQU_STD, so
    " the create_ddic_table / create_ddic_domain pattern (GOX_GEN_*_STD with
    " iv_devclass + iv_request_wb) has no lock-object equivalent — and
    " DDIF_ENQU_PUT itself takes no package parameter. Only $TMP (local) objects
    " are supported for now; a transported lock object would additionally need
    " a TADIR entry.
    TYPES: BEGIN OF ty_request,
             name             TYPE string,
             format_version   TYPE string,
             header           TYPE zcl_abap_vibe_enqu_format=>ty_header,
             primary_table    TYPE zcl_abap_vibe_enqu_format=>ty_lock_table,
             secondary_tables TYPE zcl_abap_vibe_enqu_format=>tt_lock_table,
             lock_parameters  TYPE zcl_abap_vibe_enqu_format=>tt_lock_parameter,
             lock_modules     TYPE zcl_abap_vibe_enqu_format=>ty_lock_modules,
           END OF ty_request,
           BEGIN OF ty_table_mode,
             tabname TYPE tabname,
             enqmode TYPE dd27p-enqmode,
           END OF ty_table_mode,
           tt_table_mode TYPE STANDARD TABLE OF ty_table_mode WITH EMPTY KEY.

    DATA ls_request     TYPE ty_request.
    DATA lv_name        TYPE viewname.
    DATA lv_root        TYPE tabname.
    DATA lv_package     TYPE devclass.
    DATA ls_dd25v       TYPE dd25v.
    DATA lt_dd26e       TYPE STANDARD TABLE OF dd26e WITH EMPTY KEY.
    DATA lt_dd27p       TYPE STANDARD TABLE OF dd27p WITH EMPTY KEY.
    DATA lt_table_modes TYPE tt_table_mode.
    DATA ls_table_mode  TYPE ty_table_mode.
    DATA ls_secondary   TYPE zcl_abap_vibe_enqu_format=>ty_lock_table.
    DATA ls_param       TYPE zcl_abap_vibe_enqu_format=>ty_lock_parameter.
    DATA ls_dfies       TYPE dfies.
    DATA lv_pos         TYPE i.
    DATA lv_rc          TYPE sy-subrc.
    DATA lv_master      TYPE sy-langu.

    CLEAR es_payload.
    lv_package = to_upper( COND devclass( WHEN iv_package IS INITIAL THEN '$TMP' ELSE iv_package ) ).

    /ui2/cl_json=>deserialize( EXPORTING json        = iv_payload
                                         pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                               CHANGING  data        = ls_request ).

    lv_name = iv_name.
    IF ls_request-name IS NOT INITIAL.
      lv_name = to_upper( ls_request-name ).
    ENDIF.
    lv_root = to_upper( ls_request-primary_table-name ).

    IF lv_name IS INITIAL.
      ev_error = VALUE ty_error( status = 'error'
        error = VALUE ty_error_body( code    = 'INVALID_ARGUMENT'
                                     message = 'lock object name is required (send it as "name" or in the URL)' ) ).
      RETURN.
    ENDIF.
    IF lv_root IS INITIAL.
      ev_error = VALUE ty_error( status = 'error'
        error = VALUE ty_error_body( code    = 'INVALID_ARGUMENT'
                                     message = 'primaryTable.name is required' ) ).
      RETURN.
    ENDIF.
    IF lv_package <> '$TMP'.
      ev_error = VALUE ty_error( status = 'error'
        error = VALUE ty_error_body( code    = 'ENQU_PACKAGE_NOT_SUPPORTED'
                                     message = |ENQU create supports package $TMP only (got { lv_package }); a transported lock object additionally needs a TADIR entry| ) ).
      RETURN.
    ENDIF.

    " One lock mode per participating table, root table first. DD26E carries
    " exactly that positional list (see read_enqu).
    APPEND VALUE ty_table_mode( tabname = lv_root
                                enqmode = enqmode_from_lock_mode( ls_request-primary_table-lock_mode ) ) TO lt_table_modes.
    LOOP AT ls_request-secondary_tables INTO ls_secondary.
      IF ls_secondary-name IS INITIAL.
        CONTINUE.
      ENDIF.
      APPEND VALUE ty_table_mode( tabname = to_upper( ls_secondary-name )
                                  enqmode = enqmode_from_lock_mode( ls_secondary-lock_mode ) ) TO lt_table_modes.
    ENDLOOP.
    LOOP AT lt_table_modes INTO ls_table_mode.
      lv_pos = lv_pos + 1.
      APPEND VALUE dd26e( viewname   = lv_name
                          tabname    = ls_table_mode-tabname
                          fortabname = lv_root
                          enqmode    = ls_table_mode-enqmode
                          tabpos     = lv_pos ) TO lt_dd26e.
    ENDLOOP.
    CLEAR lv_pos.

    " Lock parameters, with field metadata taken from the base table so DD27P
    " gets the same shape SE11 writes.
    LOOP AT ls_request-lock_parameters INTO ls_param.
      IF ls_param-active = abap_false.
        CONTINUE.
      ENDIF.
      IF ls_param-field IS INITIAL OR ls_param-table IS INITIAL.
        ev_error = VALUE ty_error( status = 'error'
          error = VALUE ty_error_body( code    = 'INVALID_ARGUMENT'
                                       message = 'every lockParameters entry needs table and field' ) ).
        RETURN.
      ENDIF.

      CLEAR ls_dfies.
      CALL FUNCTION 'DDIF_FIELDINFO_GET'
        EXPORTING
          tabname        = CONV ddobjname( to_upper( ls_param-table ) )
          fieldname      = CONV dfies-fieldname( to_upper( ls_param-field ) )
          langu          = sy-langu
        IMPORTING
          dfies_wa       = ls_dfies
        EXCEPTIONS
          not_found      = 1
          internal_error = 2
          OTHERS         = 3.
      IF sy-subrc <> 0.
        ev_error = VALUE ty_error( status = 'error'
          error = VALUE ty_error_body( code    = 'INVALID_ARGUMENT'
                                       message = |field { ls_param-field } of table { ls_param-table } does not exist| ) ).
        RETURN.
      ENDIF.

      CLEAR ls_table_mode.
      READ TABLE lt_table_modes INTO ls_table_mode WITH KEY tabname = to_upper( ls_param-table ).
      lv_pos = lv_pos + 1.
      APPEND VALUE dd27p(
        viewname   = lv_name
        objpos     = lv_pos
        ddlanguage = sy-langu
        viewfield  = to_upper( ls_param-field )
        tabname    = to_upper( ls_param-table )
        fieldname  = to_upper( ls_param-field )
        keyflag    = ls_dfies-keyflag
        rollname   = ls_dfies-rollname
        rollnamevi = ls_dfies-rollname
        domname    = ls_dfies-domname
        datatype   = ls_dfies-datatype
        flength    = ls_dfies-leng
        inttype    = ls_dfies-inttype
        intlen     = ls_dfies-intlen
        decimals   = ls_dfies-decimals
        headlen    = ls_dfies-headlen
        outputlen  = ls_dfies-outputlen
        ddtext     = ls_dfies-fieldtext
        reptext    = ls_dfies-reptext
        scrtext_s  = ls_dfies-scrtext_s
        scrtext_m  = ls_dfies-scrtext_m
        scrtext_l  = ls_dfies-scrtext_l
        enqmode    = space ) TO lt_dd27p.
    ENDLOOP.

    ls_dd25v-viewname   = lv_name.
    ls_dd25v-as4local   = 'A'.
    ls_dd25v-aggtype    = 'E'.
    ls_dd25v-roottab    = lv_root.
    ls_dd25v-ddtext     = ls_request-header-description.
    " Honour the document's original language (reverse of the two-letter code
    " the read path emits); fall back to the session language.
    lv_master = language_key_from_code( ls_request-header-original_language ).
    IF lv_master IS INITIAL.
      lv_master = sy-langu.
    ENDIF.
    ls_dd25v-ddlanguage = lv_master.
    ls_dd25v-masterlang = lv_master.
    ls_dd25v-as4user    = sy-uname.
    ls_dd25v-as4date    = sy-datum.
    ls_dd25v-as4time    = sy-uzeit.

    CALL FUNCTION 'DDIF_ENQU_PUT'
      EXPORTING
        name              = lv_name
        dd25v_wa          = ls_dd25v
      TABLES
        dd26e_tab         = lt_dd26e
        dd27p_tab         = lt_dd27p
      EXCEPTIONS
        enqu_not_found    = 1
        name_inconsistent = 2
        enqu_inconsistent = 3
        put_failure       = 4
        put_refused       = 5
        OTHERS            = 6.
    IF sy-subrc <> 0.
      ev_error = VALUE ty_error( status = 'error'
        error = VALUE ty_error_body( code    = 'ENQU_CREATE_FAILED'
                                     message = |DDIF_ENQU_PUT failed for { lv_name } (subrc={ sy-subrc })| ) ).
      RETURN.
    ENDIF.

    CALL FUNCTION 'DDIF_ENQU_ACTIVATE'
      EXPORTING
        name        = lv_name
        prid        = 0
      IMPORTING
        rc          = lv_rc
      EXCEPTIONS
        not_found   = 1
        put_failure = 2
        OTHERS      = 3.
    IF sy-subrc <> 0.
      ev_error = VALUE ty_error( status = 'error'
        error = VALUE ty_error_body( code    = 'ENQU_CREATE_FAILED'
                                     message = |DDIF_ENQU_ACTIVATE failed for { lv_name } (subrc={ sy-subrc })| ) ).
      RETURN.
    ENDIF.

    es_payload = VALUE ty_ddic_create( status = 'success'
                                       data   = VALUE ty_ddic_create_data( name   = lv_name
                                                                           type   = 'ENQU'
                                                                           action = 'created' ) ).
  ENDMETHOD.

  METHOD language_key_from_code.
    " AFF two-letter language code -> SAP language key; the inverse of
    " zcl_abap_vibe_enqu_format#language_code. Returns initial for anything
    " unknown so callers can fall back to the session language.
    CASE to_lower( iv_code ).
      WHEN 'de'.  rv_key = 'D'.
      WHEN 'en'.  rv_key = 'E'.
      WHEN 'zh'.  rv_key = '1'.
      WHEN 'fr'.  rv_key = 'F'.
      WHEN 'es'.  rv_key = 'S'.
      WHEN OTHERS. CLEAR rv_key.
    ENDCASE.
  ENDMETHOD.

  METHOD enqmode_from_lock_mode.
    " AFF lockMode -> DDIC domain ENQMODE. The eleven domain values and their
    " texts line up 1:1 with the AFF enum (see read_enqu / wiki/objects/enqu.md).
    CASE to_upper( iv_lock_mode ).
      WHEN 'EXCLUSIVE'.                 rv_enqmode = 'E'.
      WHEN 'SHARED'.                    rv_enqmode = 'S'.
      WHEN 'EXCLUSIVENOTCUMULATIVE'.    rv_enqmode = 'X'.
      WHEN 'SETOPTIMISTIC'.             rv_enqmode = 'O'.
      WHEN 'PROMOTEOPTIMISTIC'.         rv_enqmode = 'R'.
      WHEN 'CONFLICTCHECKEXTENDEDEXCL'. rv_enqmode = 'U'.
      WHEN 'CONFLICTCHECKEXCLUSIVE'.    rv_enqmode = 'V'.
      WHEN 'CONFLICTCHECKSHARED'.       rv_enqmode = 'W'.
      WHEN 'PROMOTIONCHECKOPTIMIZED'.   rv_enqmode = 'C'.
      WHEN 'RESERVED1'.                 rv_enqmode = 'T'.
      WHEN 'RESERVED2'.                 rv_enqmode = '+'.
      WHEN OTHERS.                      rv_enqmode = 'E'.
    ENDCASE.
  ENDMETHOD.
  METHOD create_ddic_nrob.
    " PR5: NROB (number range object) create. Persists via the canonical
    " NUMBER_RANGE_OBJECT_UPDATE FM with indicator='I' (insert). There is no
    " GOX_GEN_NROB_STD, so transport binding has to be done by hand via
    " TR_TADIR_INTERFACE after a successful insert. For now, mirrors ENQU:
    " only $TMP is supported (a transported NROB additionally needs a TADIR
    " entry which this code path does not yet write).
    "
    " AFF → TNRO mapping. The mapping below was reverse-engineered from the
    " FM source (functions/groups/snr2/fmodules/number_range_object_update)
    " and the DDIC source of TNRO / TNROT (DDL via /sap/bc/adt/ddic/tables/
    " tnro/source/main). Entries marked [guess] are best-effort mappings that
    " the next session should validate against a real SNRO + NUMBER_RANGE_
    " OBJECT_UPDATE round-trip — they were not directly visible in either the
    " FM or the DDL.
    "
    "   AFF header.description          → TNROT.txtshort (TNROT.txt is the
    "                                       long description and is left to
    "                                       the user via SE11 in this first
    "                                       cut — keeping only the short
    "                                       text matches the "Minimal Template"
    "                                       pattern in wiki/objects/nrob.md)
    "   AFF header.originalLanguage     → TNROT.langu (via the AFF two-letter
    "                                       code, same helper ENQU uses)
    "   AFF interval.numberLengthDomain → TNRO.domlen
    "   AFF interval.percentWarning     → TNRO.percentage
    "   AFF interval.subType            → TNRO.dtelsobj
    "   AFF interval.untilYear          → TNRO.yearind (X if true)
    "   AFF interval.rolling            → TNRO.nonrswap [guess, inverted:
    "                                       "rolling" in AFF → "no swap" set
    "                                       empty in TNRO]
    "   AFF interval.prefix             → unmapped [guess: no obvious TNRO
    "                                       column; SNRO stores prefix via
    "                                       element group, not via TNRO]
    "   AFF configuration.buffering     → TNRO.buffer (verified against
    "                                       NRBUFFERTYPE fixed values via
    "                                       ADT domain source: mainBuffer=X,
    "                                       parallel=P, none=space)
    "   AFF configuration.bufferedNumbers → TNRO.noivbuffer
    "   AFF configuration.transactionId  → TNRO.rfcdest [guess: RFC dest is
    "                                       the closest match, but SE38 may
    "                                       prefer a dedicated field]
    "
    " TNRO / TNROT fields left at initial value: nrtab, nrintfld, nrextfld,
    " nrfld, nrsobjfld, nrelefld, nreltxt*, code, textind, nrcheckascii,
    " ignore_group, abap_language_version, status, changed_at/by, audit fields.
    " These are filled by SAP with sensible defaults when FM runs dialog,
    " and stay blank for the create-from-ICF path.
    TYPES: BEGIN OF ty_request,
             name          TYPE string,
             format_version TYPE string,
             header        TYPE zcl_abap_vibe_nrob_format=>ty_header,
             interval      TYPE zcl_abap_vibe_nrob_format=>ty_interval,
             configuration TYPE zcl_abap_vibe_nrob_format=>ty_configuration,
           END OF ty_request.

    DATA ls_request     TYPE ty_request.
    DATA lv_name        TYPE nrobj.
    DATA lv_package     TYPE devclass.
    DATA lv_language    TYPE sy-langu.
    DATA ls_tnro        TYPE tnro.
    DATA ls_tnrot       TYPE tnrot.
    DATA lt_errors      TYPE STANDARD TABLE OF inoer WITH EMPTY KEY.
    DATA lv_returncode  TYPE char1.
    DATA ls_error       TYPE inoer.
    DATA lt_details     TYPE string_table.
    DATA lv_msg         TYPE string.

    CLEAR es_payload.
    lv_package = to_upper( COND devclass( WHEN iv_package IS INITIAL THEN '$TMP' ELSE iv_package ) ).

    /ui2/cl_json=>deserialize( EXPORTING json        = iv_payload
                                         pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                               CHANGING  data        = ls_request ).

    lv_name = iv_name.
    IF ls_request-name IS NOT INITIAL.
      lv_name = to_upper( ls_request-name ).
    ENDIF.

    " Required-field guard. AFF validation runs on the CLI side, so the body
    " is normally well-formed; this catches hand-crafted payloads.
    IF lv_name IS INITIAL.
      ev_error = VALUE ty_error( status = 'error'
        error = VALUE ty_error_body( code    = 'INVALID_ARGUMENT'
                                     message = 'number range object name is required' ) ).
      RETURN.
    ENDIF.
    IF ls_request-interval-number_length_domain IS INITIAL
       OR ls_request-interval-sub_type IS INITIAL
       OR ls_request-header-description IS INITIAL.
      ev_error = VALUE ty_error( status = 'error'
        error = VALUE ty_error_body( code    = 'INVALID_ARGUMENT'
                                     message = 'NROB create needs header.description, interval.numberLengthDomain and interval.subType' ) ).
      RETURN.
    ENDIF.
    IF lv_package <> '$TMP'.
      ev_error = VALUE ty_error( status = 'error'
        error = VALUE ty_error_body( code    = 'NROB_TRANSPORT_NOT_SUPPORTED'
                                     message = |NROB create supports package $TMP only (got { lv_package }); a transported number range object additionally needs a TADIR entry| ) ).
      RETURN.
    ENDIF.

    " Map AFF → TNRO row. See the comment block above for the column-by-column
    " rationale; [guess] markers are the fields the next session must validate.
    ls_tnro-object     = lv_name.
    ls_tnro-domlen     = to_upper( ls_request-interval-number_length_domain ).
    ls_tnro-percentage = CONV nrperc( ls_request-interval-percent_warning ).
    ls_tnro-dtelsobj   = to_upper( ls_request-interval-sub_type ).
    IF ls_request-interval-until_year = abap_true.
      ls_tnro-yearind = 'X'.
    ENDIF.
    IF ls_request-interval-rolling = abap_false.
      ls_tnro-nonrswap = 'X'.
    ENDIF.
    " buffering → TNRO.buffer. Confirmed against domain NRBUFFERTYPE
    " (probed via /sap/bc/adt/ddic/domains/nrbuffertype/source/main, fixed
    " values X=main memory / space=no buffering / P=parallel):
    "   AFF mainBuffer -> 'X'
    "   AFF parallel   -> 'P'
    "   AFF none       -> ' '
    CASE ls_request-configuration-buffering.
      WHEN 'parallel'. ls_tnro-buffer = 'P'.
      WHEN 'none'.     ls_tnro-buffer = ' '.
      WHEN OTHERS.     ls_tnro-buffer = 'X'.
    ENDCASE.
    ls_tnro-noivbuffer = CONV nrivbuffer( ls_request-configuration-buffered_numbers ).
    IF ls_request-configuration-transaction_id IS NOT INITIAL.
      ls_tnro-rfcdest = to_upper( ls_request-configuration-transaction_id ).
    ENDIF.

    " Map AFF → TNROT row. The description carries both txt and txtshort —
    " txt is the long form (60 chars), txtshort is the 30-char abbreviated
    " form SE11 displays in lists. AFF caps description at 60 chars (see
    " schema), so the same string fits both, with txtshort truncated.
    lv_language = language_key_from_code( ls_request-header-original_language ).
    IF lv_language IS INITIAL.
      lv_language = sy-langu.
    ENDIF.
    ls_tnrot-object = lv_name.
    ls_tnrot-langu  = lv_language.
    ls_tnrot-txt    = ls_request-header-description.
    ls_tnrot-txtshort = ls_request-header-description(30).

    CALL FUNCTION 'NUMBER_RANGE_OBJECT_UPDATE'
      EXPORTING
        indicator         = 'I'
        object_attributes = ls_tnro
        object_text       = ls_tnrot
      IMPORTING
        returncode        = lv_returncode
      TABLES
        errors            = lt_errors
      EXCEPTIONS
        object_already_exists     = 1
        object_attributes_missing = 2
        object_not_found          = 3
        object_text_missing       = 4
        wrong_indicator           = 5
        OTHERS                    = 6.
    IF sy-subrc <> 0.
      ev_error = VALUE ty_error( status = 'error'
        error = VALUE ty_error_body( code    = 'NROB_CREATE_FAILED'
                                     message = |NUMBER_RANGE_OBJECT_UPDATE failed for { lv_name } (subrc={ sy-subrc }) ) ).
      RETURN.
    ENDIF.

    " Walk the errors table; returncode='E' is a hard failure, anything else
    " with non-empty errors table is surfaced as details so the CLI keeps the
    " payload but tells the operator something went sideways.
    LOOP AT lt_errors INTO ls_error WHERE msgid IS NOT INITIAL OR msgnumber IS NOT INITIAL.
      MESSAGE ID ls_error-msgid TYPE 'S' NUMBER ls_error-msgnumber
        WITH ls_error-msgvar1 ls_error-msgvar2 ls_error-msgvar3 ls_error-msgvar4
        INTO DATA(lv_err_text).
      IF lv_err_text IS INITIAL.
        lv_err_text = |{ ls_error-msgid }{ ls_error-msgnumber } { ls_error-msgvar1 }|.
      ENDIF.
      APPEND lv_err_text TO lt_details.
      IF lv_msg IS INITIAL. lv_msg = lv_err_text. ELSE. lv_msg = lv_msg && |; { lv_err_text }|. ENDIF.
    ENDLOOP.
    IF lv_returncode CA 'EAX'.
      ev_error = VALUE ty_error( status = 'error'
        error = VALUE ty_error_body( code    = 'NROB_CREATE_FAILED'
                                     message = lv_msg
                                     details = lt_details ) ).
      RETURN.
    ENDIF.

    es_payload = VALUE ty_ddic_create( status = 'success'
                                       data   = VALUE ty_ddic_create_data( name   = lv_name
                                                                           type   = 'NROB'
                                                                           action = 'created' ) ).
  ENDMETHOD.
  METHOD get_ddic_object.
    " Pull a DDIC object definition and return the wire JSON (mirrors the
    " create payload so round-trip is consistent). Object missing → DDIC_OBJECT_NOT_FOUND.
    " Typed field-symbols: es_payload is REF TO data, so component access on
    " the dereferenced object needs a static structure type.
    FIELD-SYMBOLS <ls_doma_payload> TYPE ty_ddic_get_doma_data.
    FIELD-SYMBOLS <ls_dtel_payload> TYPE ty_ddic_get_dtel_data.
    CASE iv_type.
      WHEN 'DOMA'.
        DATA ls_doma TYPE dd01v.
        CALL FUNCTION 'DDIF_DOMA_GET'
          EXPORTING
            name      = CONV domname( iv_name )
            state     = 'A'
            langu     = sy-langu
          IMPORTING
            dd01v_wa  = ls_doma
          EXCEPTIONS
            illegal_input = 1
            OTHERS        = 2.
        IF sy-subrc <> 0 OR ls_doma-domname IS INITIAL.
          ev_error = VALUE ty_error( status = 'error'
                                     error = VALUE ty_error_body( code = 'DDIC_OBJECT_NOT_FOUND'
                                                                  message = |DOMA { iv_name } not found| ) ).
          RETURN.
        ENDIF.
        CREATE DATA es_payload TYPE ty_ddic_get_doma_data.
        ASSIGN es_payload->* TO <ls_doma_payload>.
        " 037 US1: read-side returns AFF nested wire so CLI `wireToLocal` can
        " populate the local `format.*` block from the same field names.
        <ls_doma_payload>-name        = iv_name.
        <ls_doma_payload>-type        = 'DOMA'.
        <ls_doma_payload>-description = ls_doma-ddtext.
        <ls_doma_payload>-format-data_type = ls_doma-datatype.
        <ls_doma_payload>-format-length    = CONV string( ls_doma-leng ).
        IF ls_doma-decimals IS NOT INITIAL.
          <ls_doma_payload>-format-decimals = |{ ls_doma-decimals }|.
        ENDIF.
        <ls_doma_payload>-format-sign_flag = ls_doma-signflag.
        <ls_doma_payload>-format-lowercase = ls_doma-lowercase.
        <ls_doma_payload>-format-conv_exit = ls_doma-convexit.
      WHEN 'DTEL'.
        DATA ls_dtel TYPE dd04v.
        CALL FUNCTION 'DDIF_DTEL_GET'
          EXPORTING
            name     = CONV rollname( iv_name )
            state    = 'A'
            langu    = sy-langu
          IMPORTING
            dd04v_wa = ls_dtel
          EXCEPTIONS
            illegal_input = 1
            OTHERS        = 2.
        IF sy-subrc <> 0 OR ls_dtel-rollname IS INITIAL.
          ev_error = VALUE ty_error( status = 'error'
                                     error = VALUE ty_error_body( code = 'DDIC_OBJECT_NOT_FOUND'
                                                                  message = |DTEL { iv_name } not found| ) ).
          RETURN.
        ENDIF.
        CREATE DATA es_payload TYPE ty_ddic_get_dtel_data.
        ASSIGN es_payload->* TO <ls_dtel_payload>.
        " 037 US1: read-side returns AFF nested wire so CLI `wireToLocal` can
        " populate `dataTypeInformation.{category,typeName,...}`. Pick category
        " from DD04L-DOMNAME: DOMNAME set → 'domain', else 'predefinedType'.
        <ls_dtel_payload>-name        = iv_name.
        <ls_dtel_payload>-type        = 'DTEL'.
        <ls_dtel_payload>-description = ls_dtel-ddtext.
        IF ls_dtel-domname IS NOT INITIAL.
          <ls_dtel_payload>-data_type_information-category  = 'domain'.
          <ls_dtel_payload>-data_type_information-type_name = ls_dtel-domname.
        ELSE.
          <ls_dtel_payload>-data_type_information-category             = 'predefinedType'.
          <ls_dtel_payload>-data_type_information-predefined_data_type = ls_dtel-datatype.
          <ls_dtel_payload>-data_type_information-predefined_length    = CONV string( ls_dtel-leng ).
          IF ls_dtel-decimals IS NOT INITIAL.
            <ls_dtel_payload>-data_type_information-predefined_decimals = ls_dtel-decimals.
          ENDIF.
        ENDIF.
        <ls_dtel_payload>-short_text  = ls_dtel-scrtext_s.
        <ls_dtel_payload>-medium_text = ls_dtel-scrtext_m.
        <ls_dtel_payload>-long_text   = ls_dtel-scrtext_l.
        <ls_dtel_payload>-header_text = ls_dtel-reptext.
      WHEN 'TABL'.
        DATA(ls_tabl_artifact) = zcl_abap_vibe_tabl_format=>generate(
          iv_name        = CONV tabname( iv_name )
          iv_object_type = 'TABL' ).
        IF ls_tabl_artifact-success = abap_false.
          ev_error = VALUE ty_error( status = 'error'
                                     error = VALUE ty_error_body( code = COND string( WHEN ls_tabl_artifact-error_code IS INITIAL
                                                                                      THEN 'DDIC_OBJECT_NOT_FOUND'
                                                                                      ELSE ls_tabl_artifact-error_code )
                                                                  message = ls_tabl_artifact-error_message ) ).
          RETURN.
        ENDIF.
        CREATE DATA es_payload TYPE zcl_abap_vibe_tabl_format=>ty_result.
        ASSIGN es_payload->* TO FIELD-SYMBOL(<ls_tabl_payload>).
        <ls_tabl_payload> = ls_tabl_artifact.
      WHEN 'STRU'.
        DATA(ls_stru_artifact) = zcl_abap_vibe_tabl_format=>generate(
          iv_name        = CONV tabname( iv_name )
          iv_object_type = 'STRU' ).
        IF ls_stru_artifact-success = abap_false.
          ev_error = VALUE ty_error( status = 'error'
                                     error = VALUE ty_error_body( code = COND string( WHEN ls_stru_artifact-error_code IS INITIAL
                                                                                      THEN 'DDIC_OBJECT_NOT_FOUND'
                                                                                      ELSE ls_stru_artifact-error_code )
                                                                  message = ls_stru_artifact-error_message ) ).
          RETURN.
        ENDIF.
        CREATE DATA es_payload TYPE zcl_abap_vibe_tabl_format=>ty_result.
        ASSIGN es_payload->* TO FIELD-SYMBOL(<ls_stru_payload>).
        <ls_stru_payload> = ls_stru_artifact.
      WHEN 'TTYP'.
        " 036: ECC EHP5/6 has no ADT tabletypes endpoint — this is the fallback.
        DATA(ls_ttyp_artifact) = zcl_abap_vibe_ttyp_format=>generate(
          iv_name        = CONV ttypename( iv_name )
          iv_object_type = 'TTYP' ).
        IF ls_ttyp_artifact-success = abap_false.
          ev_error = VALUE ty_error( status = 'error'
                                     error = VALUE ty_error_body( code = COND string( WHEN ls_ttyp_artifact-error_code IS INITIAL
                                                                                      THEN 'DDIC_OBJECT_NOT_FOUND'
                                                                                      ELSE ls_ttyp_artifact-error_code )
                                                                  message = ls_ttyp_artifact-error_message ) ).
          RETURN.
        ENDIF.
        CREATE DATA es_payload TYPE zcl_abap_vibe_ttyp_format=>ty_result.
        ASSIGN es_payload->* TO FIELD-SYMBOL(<ls_ttyp_payload>).
        <ls_ttyp_payload> = ls_ttyp_artifact.
      WHEN 'MSAG'.
        " 036: ECC EHP5/6 has no ADT messageclass endpoint — this is the fallback.
        DATA(ls_msag_artifact) = zcl_abap_vibe_msag_format=>generate( iv_name = CONV arbgb( iv_name ) ).
        IF ls_msag_artifact-success = abap_false.
          ev_error = VALUE ty_error( status = 'error'
                                     error = VALUE ty_error_body( code = COND string( WHEN ls_msag_artifact-error_code IS INITIAL
                                                                                      THEN 'DDIC_OBJECT_NOT_FOUND'
                                                                                      ELSE ls_msag_artifact-error_code )
                                                                  message = ls_msag_artifact-error_message ) ).
          RETURN.
        ENDIF.
        CREATE DATA es_payload TYPE zcl_abap_vibe_msag_format=>ty_result.
        ASSIGN es_payload->* TO FIELD-SYMBOL(<ls_msag_payload>).
        <ls_msag_payload> = ls_msag_artifact.
      WHEN 'ENQU'.
        " PR5: ENQU (lock object). The CLI's wire shape is the AFF JSON
        " document (formats/enqu/json.ts). Read via DDIF_ENQU_GET and
        " serialize to the same shape so the CLI round-trips lossless.
        DATA(ls_enqu_artifact) = zcl_abap_vibe_enqu_format=>generate( iv_name = CONV viewname( iv_name ) ).
        IF ls_enqu_artifact-success = abap_false.
          ev_error = VALUE ty_error( status = 'error'
                                     error = VALUE ty_error_body( code = COND string( WHEN ls_enqu_artifact-error_code IS INITIAL
                                                                                      THEN 'DDIC_OBJECT_NOT_FOUND'
                                                                                      ELSE ls_enqu_artifact-error_code )
                                                                  message = ls_enqu_artifact-error_message ) ).
          RETURN.
        ENDIF.
        CREATE DATA es_payload TYPE zcl_abap_vibe_enqu_format=>ty_result.
        ASSIGN es_payload->* TO FIELD-SYMBOL(<ls_enqu_payload>).
        <ls_enqu_payload> = ls_enqu_artifact.
      WHEN 'NROB'.
        " PR5: NROB (number range object). Read NRIV and serialise to the
        " AFF JSON document the CLI expects (interval.* + configuration.*).
        DATA(ls_nrob_artifact) = zcl_abap_vibe_nrob_format=>generate( iv_name = CONV nrobj( iv_name ) ).
        IF ls_nrob_artifact-success = abap_false.
          ev_error = VALUE ty_error( status = 'error'
                                     error = VALUE ty_error_body( code = COND string( WHEN ls_nrob_artifact-error_code IS INITIAL
                                                                                      THEN 'DDIC_OBJECT_NOT_FOUND'
                                                                                      ELSE ls_nrob_artifact-error_code )
                                                                  message = ls_nrob_artifact-error_message ) ).
          RETURN.
        ENDIF.
        CREATE DATA es_payload TYPE zcl_abap_vibe_nrob_format=>ty_result.
        ASSIGN es_payload->* TO FIELD-SYMBOL(<ls_nrob_payload>).
        <ls_nrob_payload> = ls_nrob_artifact.
      WHEN OTHERS.
        ev_error = VALUE ty_error( status = 'error'
                                   error = VALUE ty_error_body( code = 'DDIC_NOT_SUPPORTED'
                                                                message = |unsupported DDIC type { iv_type }| ) ).
    ENDCASE.
  ENDMETHOD.
  METHOD write_ddic_table_type.
    " 036 ICF fallback write. DDIF_TTYP_PUT is the only supported API on ECC
    " EHP5/6; the SAP LUW is lock → PUT → activate → unlock, with unlock in
    " every exit path so a failed activation never leaves a stale enqueue.
    DATA ls_dd40v TYPE dd40v.
    DATA lt_dd42v TYPE STANDARD TABLE OF dd42v WITH EMPTY KEY.
    DATA lt_dd43v TYPE STANDARD TABLE OF dd43v WITH EMPTY KEY.
    DATA lv_rc TYPE sy-subrc.
    DATA lv_access TYPE string.
    DATA lv_row_type TYPE string.
    DATA lv_description TYPE string.

    " The wire payload nests the AFF document under `main`. The fields we need
    " are scalars, so static regex extraction beats a full deserialize here.
    FIND FIRST OCCURRENCE OF REGEX '"accessType"\s*:\s*"([^"]+)"' IN iv_payload IGNORING CASE
      SUBMATCHES lv_access.
    FIND FIRST OCCURRENCE OF REGEX '"rowType"\s*:\s*"([^"]+)"' IN iv_payload IGNORING CASE
      SUBMATCHES lv_row_type.
    FIND FIRST OCCURRENCE OF REGEX '"description"\s*:\s*"([^"]*)"' IN iv_payload IGNORING CASE
      SUBMATCHES lv_description.
    IF lv_row_type IS INITIAL.
      ev_error = VALUE ty_error( status = 'error'
                                 error = VALUE ty_error_body( code = 'VALIDATION_ERROR'
                                                              message = |TTYP { iv_name } payload has no lineType.rowType| ) ).
      RETURN.
    ENDIF.

    ls_dd40v-typename = iv_name.
    ls_dd40v-rowtype = to_upper( lv_row_type ).
    ls_dd40v-rowkind = 'S'.
    ls_dd40v-ddtext = lv_description.
    ls_dd40v-ddlanguage = sy-langu.
    ls_dd40v-typelen = 0.
    ls_dd40v-accessmode = SWITCH dd40v-accessmode( to_lower( lv_access )
      WHEN 'sorted' THEN 'S'
      WHEN 'hashed' THEN 'H'
      ELSE 'T' ).
    IF ls_dd40v-accessmode <> 'T'.
      ls_dd40v-keydef = 'D'.
      ls_dd40v-keykind = COND dd40v-keykind( WHEN ls_dd40v-accessmode = 'H' THEN 'U' ELSE 'N' ).
    ENDIF.

    CALL FUNCTION 'ENQUEUE_E_TABLE'
      EXPORTING
        mode_rstable = 'E'
        tabname      = CONV tabname( iv_name )
      EXCEPTIONS
        foreign_lock = 1
        system_failure = 2
        OTHERS       = 3.
    IF sy-subrc <> 0.
      ev_error = VALUE ty_error( status = 'error'
                                 error = VALUE ty_error_body( code = 'LOCK_FAILED'
                                                              message = |TTYP { iv_name } is locked by another user| ) ).
      RETURN.
    ENDIF.

    CALL FUNCTION 'DDIF_TTYP_PUT'
      EXPORTING
        name              = iv_name
        dd40v_wa          = ls_dd40v
      TABLES
        dd42v_tab         = lt_dd42v
        dd43v_tab         = lt_dd43v
      EXCEPTIONS
        ttyp_not_found    = 1
        name_inconsistent = 2
        ttyp_inconsistent = 3
        put_failure       = 4
        put_refused       = 5
        OTHERS            = 6.
    lv_rc = sy-subrc.
    IF lv_rc = 0.
      CALL FUNCTION 'DDIF_TTYP_ACTIVATE'
        EXPORTING
          name        = iv_name
        IMPORTING
          rc          = lv_rc
        EXCEPTIONS
          not_found   = 1
          put_failure = 2
          OTHERS      = 3.
      IF sy-subrc <> 0.
        lv_rc = sy-subrc.
      ENDIF.
    ENDIF.

    CALL FUNCTION 'DEQUEUE_E_TABLE'
      EXPORTING
        mode_rstable = 'E'
        tabname      = CONV tabname( iv_name ).

    IF lv_rc <> 0.
      ev_error = VALUE ty_error( status = 'error'
                                 error = VALUE ty_error_body( code = 'DDIC_CREATE_FAILED'
                                                              message = |TTYP { iv_name } write failed (rc={ lv_rc })| ) ).
      RETURN.
    ENDIF.

    es_payload = VALUE ty_ddic_create( status = 'success'
                                       data = VALUE ty_ddic_create_data( name   = iv_name
                                                                         type   = 'TTYP'
                                                                         action = 'updated' ) ).
  ENDMETHOD.
  METHOD write_ddic_message_class.
    " 036 ICF fallback write. T100A/T100 are plain tables; the SAP-sanctioned
    " write path is RS_CORR_INSERT for the header + direct MODIFY of T100.
    DATA lv_rc TYPE sy-subrc.
    DATA lv_description TYPE string.
    DATA lt_t100 TYPE STANDARD TABLE OF t100 WITH EMPTY KEY.

    FIND FIRST OCCURRENCE OF REGEX '"description"\s*:\s*"([^"]*)"' IN iv_payload IGNORING CASE
      SUBMATCHES lv_description.

    DATA lv_offset TYPE i.
    DATA lv_number TYPE string.
    DATA lv_text TYPE string.
    DATA lv_rest TYPE string.
    lv_rest = iv_payload.
    " Walk the `messages` array pair by pair; the payload is machine-generated
    " so the `number` / `text` order is stable.
    WHILE lv_rest IS NOT INITIAL.
      FIND FIRST OCCURRENCE OF REGEX '"number"\s*:\s*"([^"]+)"\s*,\s*"text"\s*:\s*"([^"]*)"'
        IN lv_rest IGNORING CASE MATCH OFFSET lv_offset SUBMATCHES lv_number lv_text.
      IF sy-subrc <> 0.
        EXIT.
      ENDIF.
      APPEND VALUE t100( sprsl = sy-langu
                         arbgb = iv_name
                         msgnr = lv_number
                         text  = lv_text ) TO lt_t100.
      lv_rest = substring( val = lv_rest off = lv_offset + 1 ).
    ENDWHILE.

    CALL FUNCTION 'ENQUEUE_E_TABLEE'
      EXPORTING
        mode_rstable = 'E'
        tabname      = 'T100'
        varkey       = CONV char120( iv_name )
      EXCEPTIONS
        foreign_lock   = 1
        system_failure = 2
        OTHERS         = 3.
    IF sy-subrc <> 0.
      ev_error = VALUE ty_error( status = 'error'
                                 error = VALUE ty_error_body( code = 'LOCK_FAILED'
                                                              message = |MSAG { iv_name } is locked by another user| ) ).
      RETURN.
    ENDIF.

    DATA ls_t100a TYPE t100a.
    ls_t100a-arbgb = iv_name.
    ls_t100a-stext = lv_description.
    ls_t100a-masterlang = sy-langu.
    ls_t100a-lastuser = sy-uname.
    ls_t100a-ldate = sy-datum.
    ls_t100a-ltime = sy-uzeit.
    MODIFY t100a FROM ls_t100a.
    lv_rc = sy-subrc.
    IF lv_rc = 0 AND lines( lt_t100 ) > 0.
      MODIFY t100 FROM TABLE lt_t100.
      lv_rc = sy-subrc.
    ENDIF.
    IF lv_rc = 0.
      COMMIT WORK AND WAIT.
    ELSE.
      ROLLBACK WORK.
    ENDIF.

    CALL FUNCTION 'DEQUEUE_E_TABLEE'
      EXPORTING
        mode_rstable = 'E'
        tabname      = 'T100'
        varkey       = CONV char120( iv_name ).

    IF lv_rc <> 0.
      ev_error = VALUE ty_error( status = 'error'
                                 error = VALUE ty_error_body( code = 'DDIC_CREATE_FAILED'
                                                              message = |MSAG { iv_name } write failed (rc={ lv_rc })| ) ).
      RETURN.
    ENDIF.

    es_payload = VALUE ty_ddic_create( status = 'success'
                                       data = VALUE ty_ddic_create_data( name   = iv_name
                                                                         type   = 'MSAG'
                                                                         action = 'updated' ) ).
  ENDMETHOD.
ENDCLASS.

CLASS lcl_textpool IMPLEMENTATION.
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
      lcl_response=>respond_error( io_server = io_server
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
      lcl_response=>respond_error( io_server = io_server
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
        lcl_response=>respond_error( io_server = io_server
                       iv_status = 404
                       iv_reason = 'Not Found'
                       iv_code   = ls_error_get-error-code
                       iv_msg    = ls_error_get-error-message ).
      ELSE.
        lcl_response=>respond_json( io_server = io_server iv_status = 200 iv_reason = 'OK' is_payload = ls_payload_get ).
      ENDIF.
    ELSEIF iv_method = 'POST'.
      " Write is not available through a non-interactive API on this release.
      lcl_response=>respond_error( io_server = io_server
                     iv_status = 200
                     iv_reason = 'OK'
                     iv_code   = 'TEXTPOOL_WRITE_UNSUPPORTED'
                     iv_msg    = 'Textpool writing is not available through a non-interactive API on this SAP release' ).
    ELSE.
      lcl_response=>respond_error( io_server = io_server
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
      ev_error = VALUE ty_error( status = 'error'
                                 error = VALUE ty_error_body( code = 'TEXTPOOL_OBJECT_NOT_FOUND'
                                                              message = |{ iv_object } not found| ) ).
      RETURN.
    ENDIF.

    DATA(lt_elements) = VALUE tt_textpool_elem( ).
    LOOP AT lt_pool INTO ls_pool.
      " Category filter: symbols → ID = 'I'; selections → ID = 'S'; headings → ID = 'H'.
      IF iv_category = 'TEXTS' AND ls_pool-id <> 'I'. CONTINUE. ENDIF.
      IF iv_category = 'SELECTIONS' AND ls_pool-id <> 'S'. CONTINUE. ENDIF.
      IF iv_category = 'HEADINGS' AND ls_pool-id <> 'H'. CONTINUE. ENDIF.
      IF lcl_response=>escape_probe_needed( ) = abap_true.
        " Old /UI2/CL_JSON (vhcala4hci) does not escape — escape text elements.
        APPEND VALUE ty_textpool_elem( id   = lcl_response=>escape_json_string( CONV string( ls_pool-key ) )
                                       text = lcl_response=>escape_json_string( CONV string( ls_pool-entry ) ) ) TO lt_elements.
      ELSE.
        APPEND VALUE ty_textpool_elem( id = CONV string( ls_pool-key ) text = CONV string( ls_pool-entry ) ) TO lt_elements.
      ENDIF.
    ENDLOOP.

    es_payload = VALUE ty_textpool_get( status = 'success'
                                        data = VALUE ty_textpool_data( object   = iv_object
                                                                       type     = iv_objtype
                                                                       category = iv_category
                                                                       elements = lt_elements ) ).
  ENDMETHOD.
ENDCLASS.

CLASS lcl_tcode IMPLEMENTATION.
  METHOD dispatch_tcode.
    " Resolve only the configured transaction entry; parameter and object
    " transaction chains deliberately remain explicit as entry_only in v1.
    DATA lv_tcode_raw TYPE string.
    DATA lv_tcode     TYPE tstc-tcode.
    DATA ls_payload   TYPE ty_tcode.
    DATA ls_error     TYPE ty_error.

    IF iv_method <> 'GET'.
      lcl_response=>respond_error( io_server = io_server
                     iv_status = 405
                     iv_reason = 'Method Not Allowed'
                     iv_code   = 'METHOD_NOT_ALLOWED'
                     iv_msg    = 'GET only on /tcode/<tcode>' ).
      RETURN.
    ENDIF.

    lv_tcode_raw = to_upper( substring( val = iv_path off = strlen( '/tcode/' ) ) ).
    IF lv_tcode_raw IS INITIAL OR strlen( lv_tcode_raw ) > 20 OR lv_tcode_raw CS ` `.
      lcl_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = 'INVALID_ARGUMENT'
                     iv_msg    = 'tcode must be a non-empty transaction code of at most 20 characters without whitespace' ).
      RETURN.
    ENDIF.

    lv_tcode = lv_tcode_raw.
    AUTHORITY-CHECK OBJECT 'S_TCODE'
      ID 'TCD' FIELD lv_tcode.
    IF sy-subrc <> 0.
      lcl_response=>respond_error( io_server = io_server
                     iv_status = 403
                     iv_reason = 'Forbidden'
                     iv_code   = 'TCODE_NOT_AUTHORIZED'
                     iv_msg    = |not authorized to inspect transaction { lv_tcode }| ).
      RETURN.
    ENDIF.

    read_tcode( EXPORTING iv_tcode = lv_tcode
                IMPORTING es_payload = ls_payload
                          ev_error = ls_error ).
    IF ls_error IS NOT INITIAL.
      DATA(lv_status) = COND i( WHEN ls_error-error-code = 'TCODE_NOT_FOUND' THEN 404 ELSE 500 ).
      lcl_response=>respond_error( io_server = io_server
                     iv_status = lv_status
                     iv_reason = COND string( WHEN lv_status = 404 THEN 'Not Found' ELSE 'Internal Server Error' )
                     iv_code   = ls_error-error-code
                     iv_msg    = ls_error-error-message ).
      RETURN.
    ENDIF.

    lcl_response=>respond_json( io_server = io_server
                  iv_status = 200
                  iv_reason = 'OK'
                  is_payload = ls_payload ).
  ENDMETHOD.
  METHOD read_tcode.
    " TSTC is the canonical configured initial program/screen mapping. It is
    " intentionally not presented as a fully followed parameter-transaction chain.
    CLEAR: es_payload, ev_error.
    SELECT SINGLE pgmna, dypno
      FROM tstc
      WHERE tcode = @iv_tcode
      INTO @DATA(ls_tstc).
    IF sy-subrc <> 0.
      ev_error = VALUE ty_error(
        status = 'error'
        error = VALUE #( code = 'TCODE_NOT_FOUND'
                         message = |transaction { iv_tcode } was not found| ) ).
      RETURN.
    ENDIF.

    DATA(lv_description) = VALUE string( ).
    SELECT SINGLE ttext
      FROM tstct
      WHERE sprsl = @sy-langu
        AND tcode = @iv_tcode
      INTO @lv_description.

    es_payload = VALUE ty_tcode(
      status = 'success'
      data = VALUE #(
        tcode = iv_tcode
        description = lv_description
        entry = VALUE #( program = ls_tstc-pgmna screen = ls_tstc-dypno )
        target = VALUE #( kind = 'program' name = ls_tstc-pgmna resolved = abap_true )
        resolution_state = 'entry_only'
        resolution_chain = VALUE #( ( tcode = iv_tcode
                                      kind = 'program'
                                      name = ls_tstc-pgmna
                                      screen = ls_tstc-dypno
                                      relation = 'entry' ) ) ) ).
  ENDMETHOD.
  METHOD dispatch_tran.
    " /tran/<tcode>  —  Read SE93 transaction metadata as abap-file-format tran-v1.
    "
    "   GET  → read TSTC + TSTCT + TSTCC + TSTCP + TSTCA, map to tran-v1 schema
    "   POST → not implemented in this iteration (501). Write path needs the
    "          RPY_TRANSACTION_INSERT + RS_CORR_INSERT chain (or BDC for OO) and
    "          will land in a follow-up PR after S/4H validation on s4h.
    "
    " Wire payload uses /ui2/cl_json pretty_mode-camel_case so field names on the
    " wire (generalInformation, transactionServices, ...) match the ABAP struct
    " names (general_information, transaction_services, ...) one-to-one.
    DATA lv_match_name TYPE string.

    FIND REGEX '^/tran/(.+)$' IN iv_path IGNORING CASE SUBMATCHES lv_match_name.
    IF sy-subrc <> 0 OR lv_match_name IS INITIAL.
      lcl_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code = 'TRAN_SERVICE_INVALID'
                     iv_msg = 'Transaction code is required' ).
      RETURN.
    ENDIF.

    IF iv_method = 'GET'.
      DATA(ls_tstc) = read_tran_tstc( CONV tstc-tcode( lv_match_name ) ).
      IF ls_tstc IS INITIAL.
        lcl_response=>respond_error( io_server = io_server
                       iv_status = 404
                       iv_reason = 'Not Found'
                       iv_code = 'TRAN_OBJECT_NOT_FOUND'
                       iv_msg = |Transaction { lv_match_name } not found| ).
        RETURN.
      ENDIF.
      DATA(ls_payload) = build_tran_payload( CONV tstc-tcode( lv_match_name ) ).
      lcl_response=>respond_json( io_server = io_server
                    iv_status = 200
                    iv_reason = 'OK'
                    is_payload = VALUE ty_tran_service_response( status = 'success' data = ls_payload ) ).
      RETURN.
    ENDIF.

    IF iv_method = 'POST' OR iv_method = 'PUT'.
      lcl_response=>respond_error( io_server = io_server
                     iv_status = 501
                     iv_reason = 'Not Implemented'
                     iv_code = 'TRAN_WRITE_NOT_IMPLEMENTED'
                     iv_msg = |Transaction write is not yet implemented for { lv_match_name } on this handler| ).
      RETURN.
    ENDIF.

    lcl_response=>respond_error( io_server = io_server
                   iv_status = 405
                   iv_reason = 'Method Not Allowed'
                   iv_code = 'METHOD_NOT_ALLOWED'
                   iv_msg = |GET only on /tran/{ lv_match_name }| ).
  ENDMETHOD.
  METHOD read_tran_tstc.
    " Read the TSTC row for iv_tcode. Clear when not found so callers can
    " use IS INITIAL to detect a 404 case.
    CLEAR es_tstc.
    SELECT SINGLE * FROM tstc WHERE tcode = @iv_tcode INTO @es_tstc.
  ENDMETHOD.
  METHOD build_tran_payload.
    " Map TSTC + auxiliary tables to the abap-file-format tran-v1 schema.
    " Returns an empty struct when the transaction does not exist.
    CLEAR es_payload.

    DATA(ls_tstc) = read_tran_tstc( iv_tcode ).
    IF ls_tstc IS INITIAL.
      RETURN.
    ENDIF.

    " Primary-language short text. Prefer the current login language; fall back
    " to whatever entry exists.
    DATA ls_tstct TYPE tstct.
    SELECT SINGLE * FROM tstct
      WHERE tcode = @iv_tcode AND sprsl = @sy-langu
      INTO @ls_tstct.
    IF sy-subrc <> 0.
      SELECT SINGLE * FROM tstct
        WHERE tcode = @iv_tcode
        INTO @ls_tstct.
    ENDIF.
    DATA(lv_description)   = ls_tstct-ttext.
    " 037 US2 (S07): map SAP sy-langu 1-char code to ISO 639-1 alpha-2 (matches
    " dispatch_http mapping so CLI wire round-trips cleanly).
    DATA(lv_original_lang) = SWITCH string( ls_tstct-sprsl
      WHEN '1' THEN 'ZH' WHEN '2' THEN 'KO' WHEN 'D' THEN 'DE'
      WHEN 'E' THEN 'EN' WHEN 'F' THEN 'FR' WHEN 'I' THEN 'IT'
      WHEN 'J' THEN 'JA' WHEN 'N' THEN 'NL' WHEN 'P' THEN 'PT'
      WHEN 'R' THEN 'RU' WHEN 'S' THEN 'ES'
      ELSE ls_tstct-sprsl ).

    " Derive transaction type from TSTC-CINFO bit pattern (abapGit
    " zcl_abapgit_object_tran constants: lc_hex_par = x'02', lc_hex_rep = x'80',
    " lc_hex_var = x'90' = rep + x'10' for variants, lc_hex_oo = x'08').
    DATA(lv_cinfo) = ls_tstc-cinfo.
    DATA(lv_transaction_type) = 'dialogTransaction'.
    " Variant carries the report bit plus 0x10, so it is tested before report.
    DATA lc_hex_var TYPE x VALUE '90'.
    DATA lc_hex_obj TYPE x VALUE '08'.
    DATA lc_hex_rep TYPE x VALUE '80'.
    DATA lc_hex_par TYPE x VALUE '02'.
    IF lv_cinfo O lc_hex_var.
      lv_transaction_type = 'variantTransaction'.
    ELSEIF lv_cinfo O lc_hex_obj.
      lv_transaction_type = 'ooTransaction'.
    ELSEIF lv_cinfo O lc_hex_rep.
      lv_transaction_type = 'reportTransaction'.
    ELSEIF lv_cinfo O lc_hex_par.
      lv_transaction_type = 'parameterTransaction'.
    ENDIF.

    es_payload = VALUE ty_tran_data(
      format_version = '1'
      header = VALUE ty_tran_header(
        description       = lv_description
        original_language = lv_original_lang ) ).

    " TSTCP rows (parameter transaction SPA/GPA values + OO transaction
    " class/method encoded as '\CLASS=...\METHOD=...' in PARAM).
    DATA lt_tstcp TYPE TABLE OF tstcp.
    SELECT * FROM tstcp WHERE tcode = @iv_tcode INTO TABLE @lt_tstcp.

    CASE lv_transaction_type.
      WHEN 'dialogTransaction'.
        es_payload-general_information = VALUE ty_tran_general(
          transaction_type   = lv_transaction_type
          dialog_transaction = VALUE ty_tran_dialog(
            program_name         = ls_tstc-pgmna
            program_dynnr        = ls_tstc-dypno
            stv_maintenance_mode = 'notAllowed' ) ).
      WHEN 'parameterTransaction'.
        " Parameter transaction: first TSTCP-PARAM holds the called tcode and
        " the SPA/GPA defaults as 'NAME VALUE' pairs separated by spaces.
        DATA(lv_param_string) = VALUE string( ).
        READ TABLE lt_tstcp INTO DATA(ls_param_row) INDEX 1.
        IF sy-subrc = 0.
          lv_param_string = ls_param_row-param.
        ENDIF.
        DATA(lv_called_tcode) = lv_param_string.
        " Trim to first whitespace — the called tcode lives in the leading segment.
        DATA(lv_space_pos) = find( val = lv_called_tcode sub = ` ` ).
        IF lv_space_pos >= 0.
          lv_called_tcode = substring( val = lv_called_tcode len = lv_space_pos ).
        ENDIF.
        " Subsequent rows carry individual 'NAME VALUE' pairs.
        DATA lt_pv TYPE tt_tran_pv.
        LOOP AT lt_tstcp INTO ls_param_row FROM 2.
          SPLIT ls_param_row-param AT space INTO DATA(lv_pv_name) DATA(lv_pv_value).
          IF lv_pv_name IS NOT INITIAL.
            APPEND VALUE ty_tran_pv(
              parameter_name  = lv_pv_name
              parameter_value = lv_pv_value ) TO lt_pv.
          ENDIF.
        ENDLOOP.
        es_payload-general_information = VALUE ty_tran_general(
          transaction_type      = lv_transaction_type
          parameter_transaction = VALUE ty_tran_param(
            par_parent_transaction_code = lv_called_tcode
            skip_initial_screen_mode    = 'skip'
            parameter_values            = lt_pv ) ).
      WHEN 'reportTransaction'.
        es_payload-general_information = VALUE ty_tran_general(
          transaction_type   = lv_transaction_type
          report_transaction = VALUE ty_tran_report(
            report_name  = ls_tstc-pgmna
            report_dynnr = ls_tstc-dypno ) ).
      WHEN 'ooTransaction'.
        " OO transaction: TSTCP-PARAM carries '\CLASS=...\METHOD=...' segments.
        " abapGit's split_parameters pattern: walk the string, picking out the
        " \CLASS= and \METHOD= tokens; default values for the method also live
        " in TSTCP as additional NAME VALUE pairs.
        DATA(lv_oo_param) = VALUE string( ).
        READ TABLE lt_tstcp INTO ls_param_row INDEX 1.
        IF sy-subrc = 0.
          lv_oo_param = ls_param_row-param.
        ENDIF.
        DATA(lv_oo_class)  = VALUE string( ).
        DATA(lv_oo_method) = VALUE string( ).
        FIND FIRST OCCURRENCE OF REGEX '\\CLASS=([^\\]+)' IN lv_oo_param
          SUBMATCHES lv_oo_class.
        FIND FIRST OCCURRENCE OF REGEX '\\METHOD=([^\\]+)' IN lv_oo_param
          SUBMATCHES lv_oo_method.
        es_payload-general_information = VALUE ty_tran_general(
          transaction_type = lv_transaction_type
          oo_transaction   = VALUE ty_tran_oo(
            class_name  = lv_oo_class
            method_name = lv_oo_method ) ).
      WHEN 'variantTransaction'.
        " Variant: first TSTCP-PARAM holds '@' + core tcode (abapGit split).
        DATA(lv_variant_param) = VALUE string( ).
        READ TABLE lt_tstcp INTO ls_param_row INDEX 1.
        IF sy-subrc = 0.
          lv_variant_param = ls_param_row-param.
        ENDIF.
        DATA(lv_var_parent) = lv_variant_param.
        DATA(lv_at_pos) = find( val = lv_var_parent sub = '@' ).
        IF lv_at_pos >= 0.
          lv_var_parent = substring( val = lv_var_parent off = lv_at_pos + 1 ).
          DATA(lv_var_space) = find( val = lv_var_parent sub = ` ` ).
          IF lv_var_space >= 0.
            lv_var_parent = substring( val = lv_var_parent len = lv_var_space ).
          ENDIF.
        ENDIF.
        es_payload-general_information = VALUE ty_tran_general(
          transaction_type    = lv_transaction_type
          variant_transaction = VALUE ty_tran_variant(
            var_parent_transaction_code = lv_var_parent ) ).
    ENDCASE.

    " TSTCC → userInterface.uiAttributes. The official field names are
    " S_WEBGUI / S_WIN32 / S_PLATIN for GUI modes, S_SERVICE for the IAC
    " service name, S_PERVAS for pervasive mode. UI classification is derived
    " from which GUI flags are set: webgui + win32/platin ⇒ professional,
    " webgui only ⇒ easy web.
    DATA ls_tstcc TYPE tstcc.
    SELECT SINGLE * FROM tstcc WHERE tcode = @iv_tcode INTO @ls_tstcc.
    IF sy-subrc = 0.
      DATA(lv_webgui_on) = boolc( ls_tstcc-s_webgui <> ' ' ).
      DATA(lv_win32_on)  = boolc( ls_tstcc-s_win32  <> ' ' ).
      DATA(lv_platin_on) = boolc( ls_tstcc-s_platin <> ' ' ).
      es_payload-user_interface = VALUE ty_tran_user_interface(
        ui_attributes = VALUE ty_tran_ui(
          ui_classification = COND #(
            WHEN lv_webgui_on = abap_true
              AND ( lv_win32_on = abap_true OR lv_platin_on = abap_true )
              THEN 'professionalUserTransaction'
            WHEN lv_webgui_on = abap_true
              THEN 'easyWebTransaction'
            ELSE 'professionalUserTransaction' )
          iac_service_name  = ls_tstcc-s_service
          pervasive_mode    = COND #( WHEN ls_tstcc-s_pervas = 'D' THEN 'disabled' ELSE 'enabled' )
          webgui_mode       = COND #( WHEN lv_webgui_on = abap_true THEN 'supported' ELSE 'notSupported' )
          platin_mode       = COND #( WHEN lv_platin_on = abap_true THEN 'supported' ELSE 'notSupported' )
          win32_mode        = COND #( WHEN lv_win32_on = abap_true THEN 'supported' ELSE 'notSupported' ) ) ).
    ENDIF.

    " TSTCA → authorizations.startAuthorizationObject + authorizationDefaults.
    " TSTCA stores one row per (tcode, objct, field, value). The first
    " row's OBJCT is the start authorization object name; subsequent rows for
    " the same OBJCT are its field values. Multiple OBJCT groups indicate
    " multiple authorization objects — only the first group is surfaced here;
    " extending this requires TSTCA → USOBX/USOBT cross-references.
    DATA lt_tstca TYPE TABLE OF tstca.
    SELECT * FROM tstca WHERE tcode = @iv_tcode ORDER BY PRIMARY KEY INTO TABLE @lt_tstca.
    IF sy-subrc = 0 AND lines( lt_tstca ) > 0.
      DATA ls_first_tstca TYPE tstca.
      READ TABLE lt_tstca INTO ls_first_tstca INDEX 1.
      DATA lt_sao_fv TYPE tt_tran_sao_fv.
      LOOP AT lt_tstca INTO DATA(ls_tstca) WHERE objct = ls_first_tstca-objct.
        APPEND VALUE ty_tran_sao_fv(
          auth_field_name  = ls_tstca-field
          auth_field_value = ls_tstca-value ) TO lt_sao_fv.
      ENDLOOP.
      es_payload-authorizations = VALUE ty_tran_auth(
        start_authorization_object = VALUE ty_tran_sao(
          auth_object_name         = ls_first_tstca-objct
          auth_object_field_values = lt_sao_fv )
        authorization_defaults     = VALUE ty_tran_ad(
          maintenance_mode        = 'manual'
          default_values_required = 'yes' ) ).
    ENDIF.
  ENDMETHOD.
ENDCLASS.

CLASS lcl_data IMPLEMENTATION.
  METHOD dispatch_data.
    " Route /data/<sub> → sub-handlers. Only /data/query is supported in v1.
    IF iv_path <> '/data/query'.
      lcl_response=>respond_error( io_server = io_server
                     iv_status = 404
                     iv_reason = 'Not Found'
                     iv_code   = 'NOT_FOUND'
                     iv_msg    = |unsupported path: /sap/zabap_vibe{ iv_path }| ).
      RETURN.
    ENDIF.
    IF iv_method <> 'POST'.
      lcl_response=>respond_error( io_server = io_server
                     iv_status = 405
                     iv_reason = 'Method Not Allowed'
                     iv_code   = 'METHOD_NOT_ALLOWED'
                     iv_msg    = 'POST only on /data/query' ).
      RETURN.
    ENDIF.

    " 1. Parse the wire payload.
    DATA(ls_req) = VALUE ty_query_request( ).
    DATA(lv_ok) = abap_false.
    DATA(lv_err_code) = VALUE string( ).
    DATA(lv_err_msg) = VALUE string( ).
    DATA(lv_err_details) = VALUE string( ).
    parse_data_query( EXPORTING iv_body = iv_body
                      IMPORTING es_req = ls_req
                                ev_ok = lv_ok
                                ev_err_code = lv_err_code
                                ev_err_msg = lv_err_msg
                                ev_err_details = lv_err_details ).
    IF lv_ok = abap_false.
      lcl_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = lv_err_code
                     iv_msg    = lv_err_msg ).
      RETURN.
    ENDIF.

    " 2. Validate table + read metadata.
    DATA(ls_meta) = VALUE ty_query_metadata( ).
    read_table_metadata( EXPORTING iv_name = ls_req-table
                         IMPORTING es_meta = ls_meta
                                   ev_ok = lv_ok
                                   ev_err_code = lv_err_code
                                   ev_err_msg = lv_err_msg
                                   ev_err_details = lv_err_details
                                   ev_err_http = DATA(lv_http) ).
    IF lv_ok = abap_false.
      lcl_response=>respond_error( io_server = io_server
                     iv_status = lv_http
                     iv_reason = COND string( WHEN lv_http = 404 THEN 'Not Found' ELSE 'Bad Request' )
                     iv_code   = lv_err_code
                     iv_msg    = lv_err_msg ).
      RETURN.
    ENDIF.

    " 3. Validate fields projection.
    DATA(lt_requested_fields) = VALUE string_table( ).
    DATA(lt_excluded) = VALUE string_table( ).
    IF ls_req-fields IS NOT INITIAL.
      LOOP AT ls_req-fields INTO DATA(lv_fname).
        DATA(lv_match) = abap_false.
        LOOP AT ls_meta-fields INTO DATA(ls_field) WHERE name = lv_fname.
          lv_match = abap_true.
          IF ls_field-dataType CP gc_large_object_types.
            " Explicit projection of a large-object field is rejected.
            lcl_response=>respond_error( io_server = io_server
                           iv_status = 400
                           iv_reason = 'Bad Request'
                           iv_code   = 'INVALID_FIELD'
                           iv_msg    = |field { lv_fname } is a large-object field ({ ls_field-dataType }) and is not supported for projection in v1| ).
            RETURN.
          ENDIF.
        ENDLOOP.
        IF lv_match = abap_false.
          DATA(lv_valid_fields) = VALUE string( ).
          LOOP AT ls_meta-fields INTO DATA(ls_vf).
            IF sy-tabix > 1. lv_valid_fields = lv_valid_fields && ','. ENDIF.
            lv_valid_fields = lv_valid_fields && ls_vf-name.
          ENDLOOP.
          lcl_response=>respond_error( io_server = io_server
                         iv_status = 400
                         iv_reason = 'Bad Request'
                         iv_code   = 'INVALID_FIELD'
                         iv_msg    = |field { lv_fname } is not in table { ls_meta-name }| ).
          RETURN.
        ENDIF.
        APPEND lv_fname TO lt_requested_fields.
      ENDLOOP.
    ELSE.
      " Default projection = all fields minus large-object types.
      LOOP AT ls_meta-fields INTO DATA(ls_df).
        IF ls_df-dataType CP gc_large_object_types.
          APPEND ls_df-name TO lt_excluded.
        ELSE.
          APPEND ls_df-name TO lt_requested_fields.
        ENDIF.
      ENDLOOP.
    ENDIF.

    " 4. Build a CSV of output fields for the dynamic SELECT.
    DATA(lv_fields_csv) = VALUE string( ).
    LOOP AT lt_requested_fields INTO DATA(lv_out).
      IF sy-tabix > 1. lv_fields_csv = lv_fields_csv && ','. ENDIF.
      lv_fields_csv = lv_fields_csv && lv_out.
    ENDLOOP.

    " 5. Server-side limit / offset re-validation.
    IF ls_req-limit < 1 OR ls_req-limit > gc_query_limit_max.
      lcl_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = 'LIMIT_EXCEEDED'
                     iv_msg    = |limit must be an integer in [1, { gc_query_limit_max }] (got { ls_req-limit })| ).
      RETURN.
    ENDIF.
    IF ls_req-offset < 0 OR ls_req-offset > gc_query_offset_max.
      lcl_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = 'OFFSET_EXCEEDED'
                     iv_msg    = |offset must be an integer in [0, { gc_query_offset_max }] (got { ls_req-offset })| ).
      RETURN.
    ENDIF.

    " 6. Validate order-by (direction + field).
    " Parse directly from the raw body JSON — /ui2/cl_json's string representation
    " of the orderby array elements is ambiguous across versions.
    DATA(lt_orderby) = VALUE tt_query_orderby( ).
    FIND REGEX '"orderBy"\s*:\s*\[' IN iv_body.
    IF sy-subrc = 0.
      DATA(lv_ob_rest) = substring( val = iv_body off = sy-fdpos + 1 ).
      DO 20 TIMES.
        FIND REGEX '"field"\s*:\s*"([A-Za-z_][A-Za-z0-9_]*)"' IN lv_ob_rest SUBMATCHES DATA(lv_ob_field).
        IF sy-subrc <> 0. EXIT. ENDIF.
        FIND REGEX '"direction"\s*:\s*"(ASC|DESC)"' IN lv_ob_rest SUBMATCHES DATA(lv_ob_dir).
        IF sy-subrc <> 0. lv_ob_dir = 'ASC'. ENDIF.
        READ TABLE ls_meta-fields TRANSPORTING NO FIELDS WITH KEY name = lv_ob_field.
        IF sy-subrc <> 0.
          lcl_response=>respond_error( io_server = io_server
                         iv_status = 400
                         iv_reason = 'Bad Request'
                         iv_code   = 'INVALID_FIELD'
                         iv_msg    = |orderBy field { lv_ob_field } is not in table { ls_meta-name }| ).
          RETURN.
        ENDIF.
        APPEND VALUE ty_query_orderby( field = lv_ob_field direction = lv_ob_dir ) TO lt_orderby.
        DATA(lv_ob_fp) = find( val = lv_ob_rest sub = '"field"' ).
        IF lv_ob_fp < 0. EXIT. ENDIF.
        lv_ob_rest = substring( val = lv_ob_rest off = lv_ob_fp + 1 ).
      ENDDO.
    ENDIF.

    " Default ORDER BY when none was supplied — SAP requires ORDER BY when OFFSET is used.
    " Note: ty_query_field has no keyFlag attribute, so we cannot pick a default
    " key column. Instead, fall back to MANDT (always present in client-dependent
    " tables) — pagination with offset on no-order-by is therefore non-deterministic
    " for non-client tables; the caller should pass --order-by for reliable paging.
    IF lt_orderby IS INITIAL AND ls_req-offset > 0.
      LOOP AT ls_meta-fields INTO DATA(ls_dflt_f) WHERE name = 'MANDT'.
        APPEND VALUE ty_query_orderby( field = 'MANDT' direction = 'ASCENDING' ) TO lt_orderby.
        EXIT.
      ENDLOOP.
    ENDIF.

    " 7. Parse where clause (US3 grammar: field op value [AND ...]).
    DATA(lt_where) = VALUE tt_where_condition( ).
    IF ls_req-where IS NOT INITIAL.
      DATA(lv_where_ok) = abap_false.
      DATA(lv_where_err_code) = VALUE string( ).
      DATA(lv_where_err_msg) = VALUE string( ).
      DATA(lv_where_err_offset) = VALUE i( ).
      parse_where_clause( EXPORTING iv_where = ls_req-where
                                   it_fields = ls_meta-fields
                         IMPORTING et_conditions = lt_where
                                   ev_ok = lv_where_ok
                                   ev_err_code = lv_where_err_code
                                   ev_err_msg = lv_where_err_msg
                                   ev_err_offset = lv_where_err_offset ).
      IF lv_where_ok = abap_false.
        lcl_response=>respond_error( io_server = io_server
                       iv_status = 400
                       iv_reason = 'Bad Request'
                       iv_code   = lv_where_err_code
                       iv_msg    = |{ lv_where_err_msg } (offset { lv_where_err_offset })| ).
        RETURN.
      ENDIF.
    ENDIF.

    " 8. Count-only path.
    IF ls_req-countonly = abap_true.
      DATA ls_count     TYPE ty_select_count.
      DATA ls_count_err TYPE ty_error.
      execute_count( EXPORTING is_meta = ls_meta
                               it_where = lt_where
                     IMPORTING es_payload = ls_count
                               ev_error   = ls_count_err ).
      IF ls_count_err IS NOT INITIAL.
        " execute_count failures are single-message (cx_root text, not a BAPI
        " table); no details to surface, so iv_details is omitted on purpose.
        lcl_response=>respond_error( io_server = io_server
                       iv_status = 200
                       iv_reason = 'OK'
                       iv_code   = ls_count_err-error-code
                       iv_msg    = ls_count_err-error-message ).
      ELSE.
        lcl_response=>respond_json( io_server = io_server iv_status = 200 iv_reason = 'OK' is_payload = ls_count ).
      ENDIF.
      RETURN.
    ENDIF.

    " 9. Run the data query.
    DATA ls_sel     TYPE ty_select_result.
    DATA ls_sel_err TYPE ty_error.
    TRY.
        execute_select( EXPORTING is_meta = ls_meta
                                  iv_fields_csv = lv_fields_csv
                                  it_where = lt_where
                                  it_orderby = lt_orderby
                                  iv_limit = ls_req-limit
                                  iv_offset = ls_req-offset
                        IMPORTING es_payload = ls_sel
                                  ev_error   = ls_sel_err ).
      CATCH cx_root INTO DATA(lx_dispatch_err).
        lcl_response=>respond_error( io_server = io_server
                       iv_status = 500
                       iv_reason = 'Internal Server Error'
                       iv_code = 'QUERY_FAILED'
                       iv_msg  = |execute_select runtime error: { lx_dispatch_err->get_text( ) }| ).
        RETURN.
    ENDTRY.
    IF ls_sel_err IS NOT INITIAL.
      " execute_select failures are single-message (cx_root text, not a BAPI
      " table); no details to surface, so iv_details is omitted on purpose.
      lcl_response=>respond_error( io_server = io_server
                     iv_status = 200
                     iv_reason = 'OK'
                     iv_code   = ls_sel_err-error-code
                     iv_msg    = ls_sel_err-error-message ).
    ELSE.
      lcl_response=>respond_json( io_server = io_server iv_status = 200 iv_reason = 'OK' is_payload = ls_sel ).
    ENDIF.
  ENDMETHOD.
  METHOD parse_data_query.
    " Deserialize the wire payload (camelCase). Generate default values for
    " missing fields so the consumer always sees a valid request.
    CLEAR: es_req, ev_ok, ev_err_code, ev_err_msg, ev_err_details.
    ev_ok = abap_false.
    DATA(lv_part) = iv_body.
    IF lv_part IS INITIAL.
      ev_ok = abap_true.
      es_req-limit = gc_query_limit_def.
      es_req-offset = 0.
      RETURN.
    ENDIF.
    " Use /ui2/cl_json to deserialize the entire payload into a JSON-friendly shape.
    " We then copy into the typed struct with defaults.
    DATA: BEGIN OF ls_raw,
            table    TYPE string,
            fields   TYPE string_table,
            where    TYPE string,
            limit    TYPE i,
            offset   TYPE i,
            orderby  TYPE string_table,
            countonly TYPE abap_bool,
          END OF ls_raw.
    TRY.
        /ui2/cl_json=>deserialize( EXPORTING json = lv_part
                                   CHANGING data = ls_raw ).
      CATCH cx_root INTO DATA(lx_parse).
        ev_err_code = 'INVALID_ARGUMENT'.
        ev_err_msg  = |invalid JSON payload: { lx_parse->get_text( ) }|.
        RETURN.
    ENDTRY.
    IF ls_raw-table IS INITIAL.
      ev_err_code = 'INVALID_ARGUMENT'.
      ev_err_msg  = 'table is required'.
      RETURN.
    ENDIF.
    es_req-table    = to_upper( ls_raw-table ).
    es_req-fields   = ls_raw-fields.
    es_req-where    = ls_raw-where.
    es_req-limit    = COND i( WHEN ls_raw-limit IS INITIAL THEN gc_query_limit_def ELSE ls_raw-limit ).
    es_req-offset   = COND i( WHEN ls_raw-offset IS INITIAL THEN 0 ELSE ls_raw-offset ).
    es_req-orderby  = ls_raw-orderby.
    es_req-countonly = ls_raw-countonly.
    ev_ok = abap_true.
  ENDMETHOD.
  METHOD read_table_metadata.
    " Read DD02L (table header) + DD03L (field list) for the requested table.
    CLEAR: es_meta, ev_ok, ev_err_code, ev_err_msg, ev_err_details, ev_err_http.
    ev_ok = abap_false.
    DATA(lv_name) = to_upper( condense( val = iv_name del = ` ` ) ).
    IF strlen( lv_name ) = 0.
      ev_err_code = 'INVALID_ARGUMENT'.
      ev_err_msg  = 'table is required'.
      ev_err_http = 400.
      RETURN.
    ENDIF.

    " DD02L — table header.
    DATA(ls_dd02l) = VALUE dd02l( ).
    SELECT SINGLE tabname, tabclass FROM dd02l
      INTO CORRESPONDING FIELDS OF @ls_dd02l
      WHERE tabname = @lv_name AND as4local = 'A'.
    IF sy-subrc <> 0 OR ls_dd02l-tabname IS INITIAL.
      ev_err_code = 'TABLE_NOT_FOUND'.
      ev_err_msg  = |table { lv_name } does not exist|.
      ev_err_http = 404.
      RETURN.
    ENDIF.

    " Only TRANSP (transparent table) and VIEW (DDIC view) are queryable.
    IF ls_dd02l-tabclass <> 'TRANSP' AND ls_dd02l-tabclass <> 'VIEW'.
      ev_err_code = 'TABLE_TYPE_NOT_SUPPORTED'.
      ev_err_msg  = |table { lv_name } is of type { ls_dd02l-tabclass }; only TRANSP and VIEW are queryable|.
      ev_err_details = |\{ "objectType": "{ ls_dd02l-tabclass }" \}|.
      ev_err_http = 400.
      RETURN.
    ENDIF.

    " DD03L — field list (ordered via POSITION).
    " Note: INTO CORRESPONDING FIELDS OF is required — a positional INTO TABLE
    " would map fieldname→TABNAME, datatype→FIELDNAME, ... (vhcala4hci quirk).
    DATA lt_dd03l TYPE TABLE OF dd03l.
    SELECT fieldname, datatype, leng, decimals FROM dd03l
      INTO CORRESPONDING FIELDS OF TABLE @lt_dd03l
      WHERE tabname = @lv_name AND as4local = 'A'
      ORDER BY position.
    IF sy-subrc <> 0.
      " Empty field list — should not happen for TRANSP/VIEW, but handle gracefully.
    ENDIF.

    es_meta-name = ls_dd02l-tabname.
    es_meta-tabclass = ls_dd02l-tabclass.
    es_meta-clientDependent = abap_false.
    LOOP AT lt_dd03l INTO DATA(ls_dd03l).
      APPEND VALUE #( name = ls_dd03l-fieldname
                       dataType = ls_dd03l-datatype
                       length = ls_dd03l-leng
                       decimals = ls_dd03l-decimals ) TO es_meta-fields.
      IF ls_dd03l-fieldname = 'MANDT'.
        es_meta-clientDependent = abap_true.
      ENDIF.
    ENDLOOP.
    ev_ok = abap_true.
  ENDMETHOD.
  METHOD parse_where_clause.
    " AND-only where grammar per research R8.
    "   where := condition { "AND" condition }
    "   condition := field op value
    "   op := "=" | "<>" | ">" | ">=" | "<" | "<=" | "LIKE"
    "   field := [A-Za-z_][A-Za-z0-9_]*
    "   value := "'" <chars, '' escape> "'" | [+-]?[0-9]+(\.[0-9]+)?
    CLEAR: et_conditions, ev_ok, ev_err_code, ev_err_msg, ev_err_offset.
    ev_ok = abap_false.
    IF iv_where IS INITIAL.
      ev_ok = abap_true.
      RETURN.
    ENDIF.

    " Tokenize by top-level AND (whitespace tolerant, case-insensitive).
    DATA(lv_rest) = iv_where.
    DATA(lv_pos) = 0.
    DATA(lv_bind_idx) = 0.

    " Build a quick lookup of valid field names for faster checks.
    DATA(lt_field_names) = VALUE string_table( ).
    LOOP AT it_fields INTO DATA(ls_fld).
      APPEND ls_fld-name TO lt_field_names.
    ENDLOOP.

    WHILE lv_rest IS NOT INITIAL.
      lv_pos = strlen( iv_where ) - strlen( lv_rest ).
      DATA(lv_and_ix) = find( val = lv_rest sub = 'AND' case = abap_false ).
      IF lv_and_ix > 0.
        " Check that AND is a standalone keyword (whitespace around it).
        DATA(lv_char_before) = COND string( WHEN lv_and_ix = 0 THEN ' '
          ELSE substring( val = lv_rest off = lv_and_ix - 1 len = 1 ) ).
        DATA(lv_char_after)  = COND string( WHEN lv_and_ix + 3 = strlen( lv_rest ) THEN ' '
          ELSE substring( val = lv_rest off = lv_and_ix + 3 len = 1 ) ).
        IF lv_char_before CA ' ' AND lv_char_after CA ' '.
          " OK — proper AND separator.
        ELSE.
          " Probably an 'AND' inside a value or field name; treat as not-an-AND.
          lv_and_ix = -1.
        ENDIF.
      ENDIF.

      DATA(lv_chunk) = VALUE string( ).
      IF lv_and_ix < 0.
        lv_chunk = condense( lv_rest ).
        lv_rest = ''.
      ELSE.
        lv_chunk = condense( substring( val = lv_rest off = 0 len = lv_and_ix ) ).
        lv_rest = substring( val = lv_rest off = lv_and_ix + 3 ).
      ENDIF.

      IF lv_chunk IS INITIAL.
        ev_err_code = 'INVALID_WHERE'.
        ev_err_msg  = 'empty condition'.
        ev_err_offset = lv_pos.
        RETURN.
      ENDIF.

      " Parse one condition: field op value.
      DATA(lv_op_ix) = -1.
      DATA(lv_op_len) = 0.
      DATA(lv_op) = VALUE string( ).
      " Find the first operator in the chunk (longest-match order, manual loop
      " because inline struct construction is rejected by the SAP parser).
      DATA(lt_ops_op) = VALUE string_table( ).
      APPEND '>=' TO lt_ops_op.
      APPEND '<=' TO lt_ops_op.
      APPEND '<>' TO lt_ops_op.
      APPEND '>'  TO lt_ops_op.
      APPEND '<'  TO lt_ops_op.
      APPEND '='  TO lt_ops_op.
      " Populate lt_ops_len via INSERT INTO rather than VALUE (the parser
      " mis-tokenizes "VALUE STANDARD TABLE OF i( )" in nested contexts).
      DATA lt_ops_len TYPE STANDARD TABLE OF i.
      DO 6 TIMES.
        CASE sy-index.
          WHEN 1. APPEND 2 TO lt_ops_len.
          WHEN 2. APPEND 2 TO lt_ops_len.
          WHEN 3. APPEND 2 TO lt_ops_len.
          WHEN 4. APPEND 1 TO lt_ops_len.
          WHEN 5. APPEND 1 TO lt_ops_len.
          WHEN 6. APPEND 1 TO lt_ops_len.
        ENDCASE.
      ENDDO.
      DO 6 TIMES.
        DATA(lv_k) = sy-index.
        DATA lv_op_candidate TYPE string.
        lv_op_candidate = ''.
        READ TABLE lt_ops_op INTO lv_op_candidate INDEX lv_k.
        DATA(lv_len_candidate) = 0.
        READ TABLE lt_ops_len INTO lv_len_candidate INDEX lv_k.
        DATA(lv_ix) = find( val = lv_chunk sub = lv_op_candidate case = abap_false ).
        IF lv_ix >= 0 AND ( lv_op_ix < 0 OR lv_ix < lv_op_ix ).
          lv_op_ix = lv_ix.
          lv_op_len = lv_len_candidate.
          lv_op = lv_op_candidate.
        ENDIF.
      ENDDO.
      IF lv_op_ix <= 0.
        ev_err_code = 'INVALID_WHERE'.
        ev_err_msg  = |condition '{ lv_chunk }' missing or invalid operator (use =, <>, >, >=, <, <=, LIKE)|.
        ev_err_offset = lv_pos.
        RETURN.
      ENDIF.

      DATA(lv_field) = condense( lv_chunk+0(lv_op_ix) ).
      DATA(lv_value) = condense( substring( val = lv_chunk off = lv_op_ix + lv_op_len ) ).

      " LIKE keyword — check presence.
      IF lv_op = '='.
        " Distinguish = from LIKE if the chunk explicitly says LIKE.
        IF lv_field CP '*LIKE*'.
          lv_op = 'LIKE'.
        ENDIF.
      ENDIF.

      " Field validation: regex + uppercase + lookup.
      IF lv_field NA `ABCDEFGHIJKLMNOPQRSTUVWXYZ_` AND lv_field NA `abcdefghijklmnopqrstuvwxyz_`.
        ev_err_code = 'INVALID_WHERE'.
        ev_err_msg  = |field '{ lv_field }' is invalid|.
        ev_err_offset = lv_pos.
        RETURN.
      ENDIF.
      lv_field = to_upper( lv_field ).
      IF lv_field = 'MANDT'.
        ev_err_code = 'INVALID_WHERE'.
        ev_err_msg  = 'MANDT filter rejected (implicit session client only)'.
        ev_err_offset = lv_pos.
        RETURN.
      ENDIF.
      READ TABLE lt_field_names TRANSPORTING NO FIELDS WITH KEY table_line = lv_field.
      IF sy-subrc <> 0.
        ev_err_code = 'INVALID_WHERE'.
        ev_err_msg  = |field '{ lv_field }' is not in table|.
        ev_err_offset = lv_pos.
        RETURN.
      ENDIF.

      " Read field type for type adaptation.
      DATA(ls_field_meta) = VALUE ty_query_field( ).
      READ TABLE it_fields INTO ls_field_meta WITH KEY name = lv_field.
      IF sy-subrc <> 0.
        ev_err_code = 'INVALID_WHERE'.
        ev_err_msg  = |field '{ lv_field }' lookup failed|.
        ev_err_offset = lv_pos.
        RETURN.
      ENDIF.

      " Value extraction.
      DATA(lv_value_kind) = VALUE string( ).
      DATA(lv_value_str) = VALUE string( ).
      IF strlen( lv_value ) > 0 AND substring( val = lv_value off = 0 len = 1 ) = `'`.
        " String literal — find the matching closing ' (allowing '' escape),
        " then reject any residual tokens after the closing quote (e.g.
        " "OR ..." after a value).
        DATA(lv_len) = strlen( lv_value ).
        DATA(lv_str_ix) = 1.
        WHILE lv_str_ix < lv_len.
          IF substring( val = lv_value off = lv_str_ix len = 1 ) = `'`.
            IF lv_str_ix + 1 < lv_len AND substring( val = lv_value off = lv_str_ix + 1 len = 1 ) = `'`.
              lv_str_ix = lv_str_ix + 2.
              CONTINUE.
            ENDIF.
            EXIT.  " closing quote found
          ENDIF.
          lv_str_ix = lv_str_ix + 1.
        ENDWHILE.
        IF lv_str_ix >= lv_len OR substring( val = lv_value off = lv_str_ix len = 1 ) <> `'`.
          ev_err_code = 'INVALID_WHERE'.
          ev_err_msg  = |unterminated string literal in condition '{ lv_chunk }'|.
          ev_err_offset = lv_pos.
          RETURN.
        ENDIF.
        " Check for residual tokens after the closing quote.
        DATA(lv_residual) = substring( val = lv_value off = lv_str_ix + 1 ).
        " Use NOT IS INITIAL with a length check (parser flagged IS NOT INITIAL
        " as "Unexpected operator IS" when the operand includes substring()).
        IF strlen( condense( lv_residual ) ) > 0.
          ev_err_code = 'INVALID_WHERE'.
          ev_err_msg  = |unexpected tokens after value in condition '{ lv_chunk }' (use AND to chain conditions)|.
          ev_err_offset = lv_pos.
          RETURN.
        ENDIF.
        lv_value_str = substring( val = lv_value off = 1 len = lv_str_ix - 1 ).
        " Replace '' with ' (SQL escape).
        REPLACE ALL OCCURRENCES OF `''` IN lv_value_str WITH `'`.
        lv_value_kind = 'string'.
      ELSEIF lv_value CO '0123456789.-+'.
        IF lv_value IS INITIAL OR lv_value = '-' OR lv_value = '+'.
          ev_err_code = 'INVALID_WHERE'.
          ev_err_msg  = |invalid numeric literal '{ lv_value }' in condition '{ lv_chunk }'|.
          ev_err_offset = lv_pos.
          RETURN.
        ENDIF.
        lv_value_str = lv_value.
        lv_value_kind = 'number'.
      ELSEIF lv_value IS NOT INITIAL.
        " Bare token — treat as string literal without quotes.
        lv_value_str = lv_value.
        lv_value_kind = 'string'.
      ELSE.
        ev_err_code = 'INVALID_WHERE'.
        ev_err_msg  = |missing value in condition '{ lv_chunk }'|.
        ev_err_offset = lv_pos.
        RETURN.
      ENDIF.

      " Type adaptation.
      IF lv_op = 'LIKE'.
        " LIKE allowed only on CHAR / NUMC / DATS / TIMS fields.
        IF NOT ( ls_field_meta-dataType = 'CHAR' OR ls_field_meta-dataType = 'NUMC'
              OR ls_field_meta-dataType = 'DATS' OR ls_field_meta-dataType = 'TIMS' ).
          ev_err_code = 'INVALID_WHERE'.
          ev_err_msg  = |LIKE not supported on field { lv_field } (type { ls_field_meta-dataType })|.
          ev_err_offset = lv_pos.
          RETURN.
        ENDIF.
      ENDIF.
      IF lv_value_kind = 'number'.
        " Numeric values only on numeric fields.
        IF NOT ( ls_field_meta-dataType = 'INT1' OR ls_field_meta-dataType = 'INT2'
              OR ls_field_meta-dataType = 'INT4' OR ls_field_meta-dataType = 'INT8'
              OR ls_field_meta-dataType = 'DEC' OR ls_field_meta-dataType = 'QUAN'
              OR ls_field_meta-dataType = 'CURR' OR ls_field_meta-dataType = 'FLTP' ).
          ev_err_code = 'INVALID_WHERE'.
          ev_err_msg  = |numeric value '{ lv_value_str }' not allowed on field { lv_field } (type { ls_field_meta-dataType })|.
          ev_err_offset = lv_pos.
          RETURN.
        ENDIF.
      ENDIF.

      lv_bind_idx = lv_bind_idx + 1.
      APPEND VALUE #( field = lv_field
                       operator = lv_op
                       value = lv_value_str
                       valueKind = lv_value_kind
                       bindVar = |LV_WHERE_V{ lv_bind_idx }| ) TO et_conditions.
    ENDWHILE.

    ev_ok = abap_true.
  ENDMETHOD.
  METHOD execute_select.
    " Dynamic Open SQL with host-variable binding (research R1).
    " Build the dynamic row type from DD03L metadata, then SELECT with a
    " generated WHERE clause whose values are bound as host variables.
    " Take limit+1 to detect truncation.
    " Note: lt_rows is created via CREATE DATA lr_rows TYPE HANDLE lo_table_type
    " (see below) and assigned to <lt_rows>; no standalone DATA declaration.
    " The whole body is wrapped in TRY so any runtime error (RTTI, dynamic SQL,
    " conversion) is surfaced as a structured QUERY_FAILED instead of a 500.
    TRY.
    DATA(lv_meta) = is_meta.

    " Build dynamic row type from the FULL field list (lv_meta-fields).
    " We SELECT * into this full row type and filter columns at serialization
    " time by iv_fields_csv — this keeps ORDER BY valid for any field and avoids
    " the projection-vs-ORDER-BY conflict on this SAP version.
    " IMPORTANT: do NOT use cl_abap_elemdescr=>describe_by_name( 'NUMC' | 'CLNT' ... )
    " — on vhcala4hci this raises a non-catchable short dump for built-in types.
    " Use the explicit type-factory methods instead (get_c/get_n/get_d/get_p).
    DATA(lt_components) = VALUE abap_component_tab( ).
    LOOP AT lv_meta-fields INTO DATA(ls_dd03l).
      DATA lo_elem TYPE REF TO cl_abap_elemdescr.
      DATA(lv_len) = ls_dd03l-length.
      IF lv_len <= 0. lv_len = 100. ENDIF.
      CASE ls_dd03l-dataType.
        WHEN 'CLNT' OR 'CHAR' OR 'CUKY' OR 'UNIT' OR 'LANG' OR 'RAW'.
          lo_elem = cl_abap_elemdescr=>get_c( lv_len ).
        WHEN 'NUMC'.
          lo_elem = cl_abap_elemdescr=>get_n( lv_len ).
        WHEN 'DATS'.
          lo_elem = cl_abap_elemdescr=>get_d( ).
        WHEN 'TIMS'.
          lo_elem = cl_abap_elemdescr=>get_t( ).
        WHEN 'DEC' OR 'QUAN' OR 'CURR'.
          lo_elem = cl_abap_elemdescr=>get_p( p_length = lv_len p_decimals = ls_dd03l-decimals ).
        WHEN OTHERS.
          " INT1/INT2/INT4/INT8/STRG/RSTR/unknown — CHAR fallback.
          lo_elem = cl_abap_elemdescr=>get_c( lv_len ).
      ENDCASE.
      IF lo_elem IS BOUND.
        APPEND VALUE #( name = ls_dd03l-name
                         type = CAST cl_abap_datadescr( lo_elem ) ) TO lt_components.
      ENDIF.
    ENDLOOP.
    DATA(lo_row_type) = cl_abap_structdescr=>create( lt_components ).
    DATA(lo_table_type) = cl_abap_tabledescr=>create( lo_row_type ).
    DATA lr_rows TYPE REF TO data.
    CREATE DATA lr_rows TYPE HANDLE lo_table_type.
    FIELD-SYMBOLS <lt_rows> TYPE ANY TABLE.
    ASSIGN lr_rows->* TO <lt_rows>.

    " Pre-declare host vars (ABAP forbids re-`DATA` inside CASE branches).
    DATA: lv_where_v1     TYPE string,
          lv_where_v1_kind TYPE string,
          lv_where_v2     TYPE string,
          lv_where_v2_kind TYPE string,
          lv_where_v3     TYPE string,
          lv_where_v3_kind TYPE string,
          lv_where_v4     TYPE string,
          lv_where_v4_kind TYPE string,
          lv_where_v5     TYPE string,
          lv_where_v5_kind TYPE string,
          lv_where_v_max  TYPE string.

    " WHERE clause: build a string-table of `field = @lv_var` expressions.
    " The host variables are declared in the current scope (one per condition)
    " so the WHERE clause can reference them.
    DATA(lt_where_tab) = VALUE string_table( ).
    DATA(lv_cond_idx) = 0.
    LOOP AT it_where INTO DATA(ls_where).
      lv_cond_idx = lv_cond_idx + 1.
      CASE lv_cond_idx.
        WHEN 1.
          lv_where_v1 = ls_where-value.
          lv_where_v1_kind = ls_where-valueKind.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_where_v1| TO lt_where_tab.
        WHEN 2.
          lv_where_v2 = ls_where-value.
          lv_where_v2_kind = ls_where-valueKind.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_where_v2| TO lt_where_tab.
        WHEN 3.
          lv_where_v3 = ls_where-value.
          lv_where_v3_kind = ls_where-valueKind.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_where_v3| TO lt_where_tab.
        WHEN 4.
          lv_where_v4 = ls_where-value.
          lv_where_v4_kind = ls_where-valueKind.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_where_v4| TO lt_where_tab.
        WHEN 5.
          lv_where_v5 = ls_where-value.
          lv_where_v5_kind = ls_where-valueKind.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_where_v5| TO lt_where_tab.
        WHEN OTHERS.
          " Beyond 5 conditions — build a fixed stack of host variables.
          " Most ad-hoc queries are well under this; v1 limit is 5.
          lv_where_v_max = ls_where-value.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_where_v_max| TO lt_where_tab.
      ENDCASE.
    ENDLOOP.

    " ORDER BY (dynamic).
    DATA(lt_ob_tab) = VALUE string_table( ).
    LOOP AT it_orderby INTO DATA(ls_ob).
      " This SAP version's dynamic ORDER BY rejects the ASC/DESC abbreviation —
      " use the full ASCENDING / DESCENDING keywords.
      DATA(lv_dir_full) = COND string( WHEN ls_ob-direction = 'DESC' OR ls_ob-direction = 'DESCENDING' THEN 'DESCENDING' ELSE 'ASCENDING' ).
      APPEND |{ ls_ob-field } { lv_dir_full }| TO lt_ob_tab.
    ENDLOOP.

    " UP TO @lv_limit (limit+1) and OFFSET.
    DATA(lv_limit) = iv_limit + 1.
    DATA(lv_offset) = iv_offset.

    " Execute the SELECT. SAP NetWeaver constraint: OFFSET requires ORDER BY,
    " and dynamic Open SQL requires UP TO / OFFSET AFTER INTO TABLE.
    " dispatch_data adds a MANDT order-by when offset > 0 and no order-by was
    " given, so lt_ob_tab is non-empty whenever we need OFFSET.
    TRY.
        IF iv_offset = 0 AND lt_where_tab IS INITIAL AND lt_ob_tab IS INITIAL.
          SELECT * FROM (lv_meta-name)
            INTO TABLE @<lt_rows>
            UP TO @lv_limit ROWS.
        ELSEIF iv_offset = 0 AND lt_where_tab IS INITIAL.
          SELECT * FROM (lv_meta-name)
            ORDER BY (lt_ob_tab)
            INTO TABLE @<lt_rows>
            UP TO @lv_limit ROWS.
        ELSEIF iv_offset = 0 AND lt_ob_tab IS INITIAL.
          SELECT * FROM (lv_meta-name)
            WHERE (lt_where_tab)
            INTO TABLE @<lt_rows>
            UP TO @lv_limit ROWS.
        ELSEIF iv_offset = 0.
          SELECT * FROM (lv_meta-name)
            WHERE (lt_where_tab)
            ORDER BY (lt_ob_tab)
            INTO TABLE @<lt_rows>
            UP TO @lv_limit ROWS.
        ELSEIF lt_where_tab IS INITIAL.
          " offset > 0 — order-by guaranteed by dispatch_data fallback.
          SELECT * FROM (lv_meta-name)
            ORDER BY (lt_ob_tab)
            INTO TABLE @<lt_rows>
            UP TO @lv_limit ROWS OFFSET @iv_offset.
        ELSE.
          SELECT * FROM (lv_meta-name)
            WHERE (lt_where_tab)
            ORDER BY (lt_ob_tab)
            INTO TABLE @<lt_rows>
            UP TO @lv_limit ROWS OFFSET @iv_offset.
        ENDIF.
      CATCH cx_root INTO DATA(lx_query).
        ev_error = VALUE ty_error( status = 'error'
                                   error = VALUE ty_error_body( code = 'QUERY_FAILED'
                                                                message = lx_query->get_text( ) ) ).
        RETURN.
    ENDTRY.

    " Truncation detection: probe has limit+1 rows.
    " Note: <lt_rows> is a fully generic table (data references), so DELETE
    " with index arithmetic is rejected. Use sy-dbcnt (set by SELECT INTO TABLE)
    " plus the per-row LOOP counter — both cheap and side-effect-free.
    DATA(lv_truncated) = abap_false.
    DATA(lv_row_count) = sy-dbcnt.
    " sy-dbcnt may be 0 if the SELECT path failed silently; fall back to counting.
    IF lv_row_count = 0.
      LOOP AT <lt_rows> ASSIGNING FIELD-SYMBOL(<ls_cnt>).
        lv_row_count = lv_row_count + 1.
      ENDLOOP.
    ENDIF.
    IF lv_row_count > iv_limit.
      lv_truncated = abap_true.
      lv_row_count = iv_limit.
    ENDIF.

    " Build the projected row set (only iv_fields_csv columns, in CSV order).
    " The projected type reuses the full row type's component descriptors, so
    " value serialization is native (/ui2/cl_json pretty_mode-none: uppercase
    " field names, typed values — Q1 B).
    DATA(lt_out_fields) = VALUE string_table( ).
    SPLIT iv_fields_csv AT ',' INTO TABLE lt_out_fields.

    DATA(lt_full_components) = lo_row_type->get_components( ).
    DATA(lt_proj_components) = VALUE abap_component_tab( ).
    DATA lv_fname TYPE string.
    LOOP AT lt_out_fields INTO lv_fname.
      READ TABLE lt_full_components INTO DATA(ls_comp) WITH KEY name = lv_fname.
      IF sy-subrc = 0. APPEND ls_comp TO lt_proj_components. ENDIF.
    ENDLOOP.
    DATA(lo_proj_type) = cl_abap_structdescr=>create( lt_proj_components ).
    DATA(lo_proj_table) = cl_abap_tabledescr=>create( lo_proj_type ).
    DATA lr_proj TYPE REF TO data.
    CREATE DATA lr_proj TYPE HANDLE lo_proj_table.
    FIELD-SYMBOLS <lt_proj> TYPE ANY TABLE.
    ASSIGN lr_proj->* TO <lt_proj>.

    DATA(lv_row_idx) = 0.
    FIELD-SYMBOLS:
      <ls_src>      TYPE any,
      <ls_dst>      TYPE any,
      <lv_src_cell> TYPE any,
      <lv_dst_cell> TYPE any.
    LOOP AT <lt_rows> ASSIGNING <ls_src>.
      lv_row_idx = lv_row_idx + 1.
      IF lv_row_idx > iv_limit. EXIT. ENDIF.  " drop the limit+1 probe row
      INSERT INITIAL LINE INTO TABLE <lt_proj> ASSIGNING <ls_dst>.
      LOOP AT lt_out_fields INTO lv_fname.
        ASSIGN COMPONENT lv_fname OF STRUCTURE <ls_src> TO <lv_src_cell>.
        IF sy-subrc <> 0. CONTINUE. ENDIF.
        ASSIGN COMPONENT lv_fname OF STRUCTURE <ls_dst> TO <lv_dst_cell>.
        IF sy-subrc <> 0. CONTINUE. ENDIF.
        <lv_dst_cell> = <lv_src_cell>.
      ENDLOOP.
    ENDLOOP.

    " Old /UI2/CL_JSON (vhcala4hci) does not escape — escape char-like cells.
    IF lcl_response=>escape_probe_needed( ) = abap_true.
      lcl_response=>escape_json_strings( CHANGING cv_data = <lt_proj> ).
    ENDIF.

    " Serialize rows independently: pretty_mode-none keeps DDIC-uppercase field
    " names with native typed values; embedded as a partial JSON piece below.
    DATA(lv_rows_json) = /ui2/cl_json=>serialize( data        = <lt_proj>
                                                  pretty_name = /ui2/cl_json=>pretty_mode-none ).

    " Envelope — camelCase naming via serialize_response at the dispatcher.
    DATA lv_object_type TYPE string.
    IF lv_meta-tabclass = 'VIEW'.
      lv_object_type = 'VIEW'.
    ELSE.
      lv_object_type = 'TABL'.
    ENDIF.
    es_payload = VALUE ty_select_result(
      status = 'success'
      data = VALUE ty_select_result_data(
        table           = lv_meta-name
        object_type     = lv_object_type
        fields          = lt_out_fields
        rows            = lv_rows_json
        row_count       = lv_row_count
        truncated       = lv_truncated
        excluded_fields = is_meta-excludedFields
        duration_ms     = 1 ) ).
    CATCH cx_root INTO DATA(lx_exec_top).
      ev_error = VALUE ty_error( status = 'error'
                                 error = VALUE ty_error_body( code = 'QUERY_FAILED'
                                                              message = |execute_select: { lx_exec_top->get_text( ) }| ) ).
      RETURN.
    ENDTRY.
  ENDMETHOD.
  METHOD execute_count.
    " SELECT COUNT(*) FROM (table) WHERE (cond) — same parameter binding.
    DATA(lv_meta) = is_meta.

    " Pre-declare host vars (ABAP forbids re-`DATA` inside CASE branches).
    DATA: lv_where_v1  TYPE string,
          lv_where_v2  TYPE string,
          lv_where_v3  TYPE string,
          lv_where_v4  TYPE string,
          lv_where_v5  TYPE string,
          lv_where_v_max TYPE string.

    " WHERE clause (host vars).
    DATA(lt_where_tab) = VALUE string_table( ).
    DATA(lv_cond_idx) = 0.
    LOOP AT it_where INTO DATA(ls_where).
      lv_cond_idx = lv_cond_idx + 1.
      CASE lv_cond_idx.
        WHEN 1.
          lv_where_v1 = ls_where-value.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_where_v1| TO lt_where_tab.
        WHEN 2.
          lv_where_v2 = ls_where-value.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_where_v2| TO lt_where_tab.
        WHEN 3.
          lv_where_v3 = ls_where-value.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_where_v3| TO lt_where_tab.
        WHEN 4.
          lv_where_v4 = ls_where-value.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_where_v4| TO lt_where_tab.
        WHEN 5.
          lv_where_v5 = ls_where-value.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_where_v5| TO lt_where_tab.
        WHEN OTHERS.
          lv_where_v_max = ls_where-value.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_where_v_max| TO lt_where_tab.
      ENDCASE.
    ENDLOOP.

    DATA(lv_count) = 0.
    TRY.
        IF lt_where_tab IS INITIAL.
          SELECT COUNT(*) FROM (lv_meta-name) INTO @lv_count.
        ELSE.
          SELECT COUNT(*) FROM (lv_meta-name) WHERE (lt_where_tab) INTO @lv_count.
        ENDIF.
      CATCH cx_root INTO DATA(lx_q).
        ev_error = VALUE ty_error( status = 'error'
                                   error = VALUE ty_error_body( code = 'QUERY_FAILED'
                                                                message = lx_q->get_text( ) ) ).
        RETURN.
    ENDTRY.

    es_payload = VALUE ty_select_count(
      status = 'success'
      data = VALUE ty_select_count_data(
        table       = lv_meta-name
        count       = lv_count
        duration_ms = 1 ) ).
  ENDMETHOD.
ENDCLASS.

CLASS lcl_version IMPLEMENTATION.
  METHOD dispatch_version_management.
    IF iv_method <> 'GET'.
      lcl_response=>respond_error( io_server = io_server
                     iv_status = 405
                     iv_reason = 'Method Not Allowed'
                     iv_code = 'METHOD_NOT_ALLOWED'
                     iv_msg = |GET only on Version Management endpoints| ).
      RETURN.
    ENDIF.

    DATA(lv_query) = io_server->request->get_header_field( '~query_string' ).
    DATA(lv_objtype) = to_upper( lcl_response=>query_param( iv_query = lv_query iv_name = 'objectType' ) ).
    DATA(lv_objname) = to_upper( lcl_response=>query_param( iv_query = lv_query iv_name = 'objectName' ) ).
    DATA(lv_destination) = to_upper( lcl_response=>query_param( iv_query = lv_query iv_name = 'destination' ) ).

    IF lv_objtype IS INITIAL OR lv_objname IS INITIAL OR lv_destination IS INITIAL.
      lcl_response=>respond_error( io_server = io_server
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
      lcl_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code = 'VERSION_TYPE_NOT_SUPPORTED'
                     iv_msg = |unsupported Version Management object type: { lv_objtype }| ).
      RETURN.
    ENDIF.

    IF strlen( lv_destination ) > 60
        OR lv_destination CN 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@._-'.
      lcl_response=>respond_error( io_server = io_server
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
          lcl_response=>respond_error( io_server = io_server
                         iv_status = 502
                         iv_reason = 'Bad Gateway'
                         iv_code = 'REMOTE_VERSIONS_FAILED'
                         iv_msg = lx_versions->get_text( ) ).
          RETURN.
      ENDTRY.

      " No versions — object has not been transported to production
      IF lt_versions IS INITIAL.
        DATA(ls_empty_source) = VALUE ty_remote_source(
          status = 'success'
          data = VALUE #( objectType = lv_objtype
                          objectName = lv_objname
                          version = '00000'
                          source = '' ) ).
        lcl_response=>respond_json( io_server = io_server
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
        lcl_response=>respond_error( io_server = io_server
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

      DATA(ls_source) = VALUE ty_remote_source(
        status = 'success'
        data = VALUE #( objectType = lv_objtype
                        objectName = lv_objname
                        version = '00000'
                        source = lv_source ) ).
      lcl_response=>respond_json( io_server = io_server
                    iv_status = 200
                    iv_reason = 'OK'
                    is_payload = ls_source ).
      RETURN.
    ENDIF.

    lcl_response=>respond_error( io_server = io_server
                   iv_status = 404
                   iv_reason = 'Not Found'
                   iv_code = 'NOT_FOUND'
                   iv_msg = |unknown Version Management path: { iv_path }| ).
  ENDMETHOD.
ENDCLASS.
