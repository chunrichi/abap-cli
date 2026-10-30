CLASS zcl_abap_vibe_icf_mime DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.

    CLASS-METHODS dispatch_mime
      IMPORTING io_server TYPE REF TO if_http_server
                iv_path   TYPE string
                iv_method TYPE string
                iv_body   TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS respond_mime_error
      IMPORTING io_server TYPE REF TO if_http_server
                is_error  TYPE zcl_abap_vibe_icf_types=>ty_error.
    CLASS-METHODS validate_mime_path
      IMPORTING iv_path TYPE string
      RETURNING VALUE(rv_error) TYPE string.
    " Deterministic URL existence check: walks the MIME path segment-wise with
    " folder-scoped SKWF namespace lookups (the same resolution create_folder
    " uses). CL_MIME_REPOSITORY_API's own get_io_for_url raises inconsistent
    " error codes for missing roots vs missing nested folders.
    CLASS-METHODS mime_url_exists
      IMPORTING iv_url TYPE string
      RETURNING VALUE(rv_exists) TYPE abap_bool.
    CLASS-METHODS mime_create_folder
      IMPORTING iv_body   TYPE string
      EXPORTING es_payload TYPE zcl_abap_vibe_icf_types=>ty_mime_folder_write
                ev_error   TYPE zcl_abap_vibe_icf_types=>ty_error.
    CLASS-METHODS mime_delete_folder
      IMPORTING iv_body      TYPE string
                iv_recursive TYPE abap_bool
                iv_transport TYPE trkorr
      EXPORTING es_payload   TYPE zcl_abap_vibe_icf_types=>ty_mime_delete_write
                ev_error     TYPE zcl_abap_vibe_icf_types=>ty_error.
    CLASS-METHODS mime_upload_resource
      IMPORTING iv_body   TYPE string
      EXPORTING es_payload TYPE zcl_abap_vibe_icf_types=>ty_mime_resource_write
                ev_error   TYPE zcl_abap_vibe_icf_types=>ty_error.
    CLASS-METHODS mime_last_sap_message
      RETURNING VALUE(rv_message) TYPE string.
ENDCLASS.

CLASS zcl_abap_vibe_icf_mime IMPLEMENTATION.
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
        zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                      iv_status = 200
                      iv_reason = 'OK'
                      is_payload = ls_create ).
        RETURN.
      ENDIF.

      IF iv_method = 'PUT'.
        DATA(lv_query) = io_server->request->get_header_field( '~query_string' ).
        DATA(lv_recursive) = COND abap_bool(
          WHEN to_upper( zcl_abap_vibe_icf_response=>query_param( iv_query = lv_query iv_name = 'recursive' ) ) = 'TRUE'
          THEN abap_true ELSE abap_false ).
        DATA(lv_transport) = zcl_abap_vibe_icf_response=>query_param( iv_query = lv_query iv_name = 'transport' ).
        mime_delete_folder( EXPORTING iv_body      = iv_body
                                      iv_recursive = lv_recursive
                                      iv_transport = CONV trkorr( lv_transport )
                            IMPORTING es_payload   = DATA(ls_delete)
                                      ev_error     = DATA(ls_delete_err) ).
        IF ls_delete_err IS NOT INITIAL.
          respond_mime_error( io_server = io_server is_error = ls_delete_err ).
          RETURN.
        ENDIF.
        zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                      iv_status = 200
                      iv_reason = 'OK'
                      is_payload = ls_delete ).
        RETURN.
      ENDIF.

      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
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
        zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                      iv_status = 200
                      iv_reason = 'OK'
                      is_payload = ls_upload ).
        RETURN.
      ENDIF.

      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 405
                     iv_reason = 'Method Not Allowed'
                     iv_code   = 'METHOD_NOT_ALLOWED'
                     iv_msg    = 'POST only on /mime/resources' ).
      RETURN.
    ENDIF.

    zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                   iv_status = 404
                   iv_reason = 'Not Found'
                   iv_code   = 'NOT_FOUND'
                   iv_msg    = |unsupported path: /sap/abap_cli{ iv_path }| ).
  ENDMETHOD.
  METHOD respond_mime_error.
    DATA(lv_status) = COND i(
      WHEN is_error-error-code = 'NOT_FOUND'        THEN 404
      WHEN is_error-error-code = 'INVALID_ARGUMENT' THEN 400
      WHEN is_error-error-code = 'OBJECT_EXISTS'    THEN 409
      WHEN is_error-error-code = 'VALIDATION_ERROR' THEN 422
      ELSE 500 ).
    zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
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
    DATA ls_req TYPE zcl_abap_vibe_icf_types=>ty_mime_folder_create.
    TRY.
        /ui2/cl_json=>deserialize( EXPORTING json        = iv_body
                                             pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                                    CHANGING  data        = ls_req ).
      CATCH cx_root INTO DATA(lx_json).
        ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
          error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code    = 'INVALID_ARGUMENT'
                                       message = |invalid JSON body: { lx_json->get_text( ) }| ) ).
        RETURN.
    ENDTRY.
    DATA(lv_invalid) = validate_mime_path( ls_req-path ).
    IF lv_invalid IS NOT INITIAL.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
        error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'INVALID_ARGUMENT' message = lv_invalid ) ).
      RETURN.
    ENDIF.
    DATA(lv_devclass) = COND devclass( WHEN ls_req-package IS INITIAL THEN '$TMP' ELSE ls_req-package ).
    DATA(lv_kind) = COND string(
      WHEN substring( val = ls_req-path off = 1 ) CS '/' THEN 'folder' ELSE 'root' ).

    " Deterministic duplicate check before calling the repository API (whose
    " folder_exists exception surfaces inconsistently for existing roots).
    IF mime_url_exists( ls_req-path ) = abap_true.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
        error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code    = 'OBJECT_EXISTS'
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
          ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
            error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'OBJECT_EXISTS'
                                         message = |MIME folder already exists: { ls_req-path }| ) ).
        WHEN 1.
          ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
            error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'INVALID_ARGUMENT'
                                         message = |invalid MIME folder request: { lv_sap_msg }| ) ).
        WHEN 3.
          ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
            error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'VALIDATION_ERROR'
                                         message = |MIME folder create rejected: { lv_sap_msg }| ) ).
        WHEN 4.
          ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
            error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'SAP_ERROR'
                                         message = |MIME folder permission failure: { lv_sap_msg }| ) ).
        WHEN OTHERS.
          ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
            error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'SAP_ERROR'
                                         message = |MIME folder create failed: { lv_sap_msg }| ) ).
      ENDCASE.
      RETURN.
    ENDIF.

    es_payload = VALUE zcl_abap_vibe_icf_types=>ty_mime_folder_write(
      status = 'success'
      data = VALUE zcl_abap_vibe_icf_types=>ty_mime_folder_data( path   = ls_req-path
                                        kind   = lv_kind
                                        action = 'created' ) ).
  ENDMETHOD.
  METHOD mime_delete_folder.
    CLEAR: es_payload, ev_error.
    DATA ls_req TYPE zcl_abap_vibe_icf_types=>ty_mime_folder_delete.
    TRY.
        /ui2/cl_json=>deserialize( EXPORTING json        = iv_body
                                             pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                                    CHANGING  data        = ls_req ).
      CATCH cx_root INTO DATA(lx_json).
        ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
          error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code    = 'INVALID_ARGUMENT'
                                       message = |invalid JSON body: { lx_json->get_text( ) }| ) ).
        RETURN.
    ENDTRY.
    DATA(lv_invalid) = validate_mime_path( ls_req-path ).
    IF lv_invalid IS NOT INITIAL.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
        error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'INVALID_ARGUMENT' message = lv_invalid ) ).
      RETURN.
    ENDIF.

    " Deterministic existence check: CL_MIME_REPOSITORY_API's delete raises
    " inconsistent codes for missing roots vs missing nested folders.
    IF mime_url_exists( ls_req-path ) = abap_false.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
        error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code    = 'NOT_FOUND'
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
          ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
            error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'NOT_FOUND'
                                         message = |MIME folder not found: { ls_req-path }| ) ).
        WHEN 1.
          ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
            error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'INVALID_ARGUMENT'
                                         message = |invalid MIME delete request: { lv_sap_msg }| ) ).
        WHEN 3.
          ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
            error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'VALIDATION_ERROR'
                                         message = |MIME folder delete rejected: { lv_sap_msg }| ) ).
        WHEN 4.
          ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
            error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'SAP_ERROR'
                                         message = |MIME folder permission failure: { lv_sap_msg }| ) ).
        WHEN OTHERS.
          ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
            error = VALUE zcl_abap_vibe_icf_types=>ty_error_body(
              code = COND #( WHEN lv_sap_msg CS 'not empty' THEN 'VALIDATION_ERROR' ELSE 'SAP_ERROR' )
              message = COND string(
                WHEN lv_sap_msg CS 'not empty'
                THEN |MIME folder is not empty; delete it with --recursive: { ls_req-path }|
                ELSE |MIME folder delete failed: { lv_sap_msg }| ) ) ).
      ENDCASE.
      RETURN.
    ENDIF.

    es_payload = VALUE zcl_abap_vibe_icf_types=>ty_mime_delete_write(
      status = 'success'
      data = VALUE zcl_abap_vibe_icf_types=>ty_mime_delete_data( path   = ls_req-path
                                        action = 'deleted' ) ).
  ENDMETHOD.
  METHOD mime_upload_resource.
    CLEAR: es_payload, ev_error.
    DATA ls_req TYPE zcl_abap_vibe_icf_types=>ty_mime_resource_upload.
    DATA lv_parent TYPE string.
    TRY.
        /ui2/cl_json=>deserialize( EXPORTING json        = iv_body
                                             pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                                    CHANGING  data        = ls_req ).
      CATCH cx_root INTO DATA(lx_json).
        ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
          error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code    = 'INVALID_ARGUMENT'
                                       message = |invalid JSON body: { lx_json->get_text( ) }| ) ).
        RETURN.
    ENDTRY.
    DATA(lv_invalid) = validate_mime_path( ls_req-path ).
    IF lv_invalid IS NOT INITIAL.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
        error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'INVALID_ARGUMENT' message = lv_invalid ) ).
      RETURN.
    ENDIF.
    IF ls_req-content_base64 IS INITIAL.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
        error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code    = 'INVALID_ARGUMENT'
                                     message = 'contentBase64 is required' ) ).
      RETURN.
    ENDIF.
    " Resources always live below a MIME folder; single-segment paths cannot
    " hold files in the MIME tree.
    FIND REGEX '^(.+)/[^/]+$' IN ls_req-path SUBMATCHES lv_parent.
    IF lv_parent IS INITIAL.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
        error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code    = 'INVALID_ARGUMENT'
                                     message = |resource path must be a file inside a MIME folder; got '{ ls_req-path }'| ) ).
      RETURN.
    ENDIF.

    " The target folder must already exist — push never auto-creates folders.
    " CL_MIME_REPOSITORY_API's get_io_for_url raises inconsistent codes for
    " missing roots vs nested folders, so existence is resolved segment-wise.
    IF mime_url_exists( lv_parent ) = abap_false.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
        error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code    = 'NOT_FOUND'
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
          ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
            error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code    = 'INVALID_ARGUMENT'
                                         message = |invalid MIME resource request: { lv_sap_msg }| ) ).
        WHEN 3.
          ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
            error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code    = 'VALIDATION_ERROR'
                                         message = |MIME resource upload rejected: { lv_sap_msg }| ) ).
        WHEN 6.
          ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
            error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'OBJECT_EXISTS'
                                         message = |MIME resource already exists: { ls_req-path }| ) ).
        WHEN OTHERS.
          ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
            error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code    = 'SAP_ERROR'
                                         message = |MIME resource upload failed: { lv_sap_msg }| ) ).
      ENDCASE.
      RETURN.
    ENDIF.

    es_payload = VALUE zcl_abap_vibe_icf_types=>ty_mime_resource_write(
      status = 'success'
      data = VALUE zcl_abap_vibe_icf_types=>ty_mime_resource_data( path = ls_req-path ) ).
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
