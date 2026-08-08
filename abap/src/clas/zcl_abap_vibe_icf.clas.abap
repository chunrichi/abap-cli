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
      END OF ty_error,
      BEGIN OF ty_remote_source_data,
        objectType  TYPE string,
        objectName  TYPE string,
        version     TYPE string,
        source      TYPE string,
      END OF ty_remote_source_data,
      BEGIN OF ty_remote_source,
        status TYPE string,
        data   TYPE ty_remote_source_data,
      END OF ty_remote_source.
    CONSTANTS gc_service TYPE string VALUE 'zabap_vibe'.
    CONSTANTS gc_version TYPE string VALUE '0.3.0'.

    " ----- routing + helpers -----
    METHODS respond_json
      IMPORTING io_server  TYPE REF TO if_http_server
                iv_status  TYPE i
                iv_reason  TYPE string
                is_payload TYPE any.
    METHODS respond_raw_json
      IMPORTING io_server TYPE REF TO if_http_server
                iv_status TYPE i
                iv_reason TYPE string
                iv_json   TYPE string.
    METHODS respond_error
      IMPORTING io_server TYPE REF TO if_http_server
                iv_status TYPE i
                iv_reason TYPE string
                iv_code   TYPE string
                iv_msg    TYPE string.

    " ----- DDIC + textpool dispatchers (inlined per user adjustment) -----
    METHODS dispatch_ddic
      IMPORTING io_server   TYPE REF TO if_http_server
                iv_path     TYPE string
                iv_method   TYPE string
                iv_body     TYPE string.
    METHODS dispatch_textpool
      IMPORTING io_server   TYPE REF TO if_http_server
                iv_path     TYPE string
                iv_method   TYPE string.
    METHODS dispatch_version_management
      IMPORTING io_server TYPE REF TO if_http_server
                iv_path   TYPE string
                iv_method TYPE string.
    METHODS query_param
      IMPORTING iv_query TYPE string
                iv_name  TYPE string
      RETURNING VALUE(rv_value) TYPE string.

    " ----- textpool helpers (RS_TEXTPOOL_READ / target-specific write) -----
    TYPES:
      BEGIN OF ty_textpool_elem,
        id   TYPE string,
        text TYPE string,
      END OF ty_textpool_elem,
      tt_textpool_elem TYPE STANDARD TABLE OF ty_textpool_elem WITH EMPTY KEY.

    METHODS get_textpool_elements
      IMPORTING iv_category TYPE string
                iv_object   TYPE string
                iv_objtype  TYPE string
      EXPORTING VALUE(ev_payload) TYPE string.
    METHODS set_textpool_elements
      IMPORTING iv_category TYPE string
                iv_object   TYPE string
                iv_objtype  TYPE string
                iv_body     TYPE string
      EXPORTING VALUE(ev_payload) TYPE string.

    " ----- DDIC shared helpers (extracted from reference implementation) -----
    TYPES:
      BEGIN OF ty_field,
        fieldName   TYPE fieldname,
        rollname    TYPE rollname,
        dataType    TYPE dd03p-datatype,
        length      TYPE dd03p-leng,
        decimals    TYPE dd03p-decimals,
        keyFlag     TYPE abap_bool,
        notNull     TYPE abap_bool,
        ddtext      TYPE dd03p-ddtext,
        refTable    TYPE dd03p-reftable,
        refField    TYPE dd03p-reffield,
        checkTable  TYPE dd03p-checktable,
      END OF ty_field,
      tt_field TYPE STANDARD TABLE OF ty_field WITH EMPTY KEY.

    " ----- 016: read-only table data query (SE16N equivalent) -----
    " Wire payload type (camelCase — matches /ui2/cl_json pretty_mode-camel_case).
    TYPES:
      BEGIN OF ty_query_request,
        table    TYPE string,
        fields   TYPE string_table,
        where    TYPE string,
        limit    TYPE i,
        offset   TYPE i,
        orderby  TYPE string_table,
        countonly TYPE abap_bool,
      END OF ty_query_request,
      BEGIN OF ty_query_orderby,
        field     TYPE string,
        direction TYPE string,
      END OF ty_query_orderby,
      tt_query_orderby TYPE STANDARD TABLE OF ty_query_orderby WITH EMPTY KEY,
      BEGIN OF ty_query_field,
        name      TYPE string,
        dataType  TYPE string,
        length    TYPE i,
        decimals  TYPE i,
      END OF ty_query_field,
      tt_query_field TYPE STANDARD TABLE OF ty_query_field WITH EMPTY KEY,
      BEGIN OF ty_query_metadata,
        name           TYPE string,
        tabclass       TYPE string,
        clientDependent TYPE abap_bool,
        fields         TYPE tt_query_field,
        excludedFields TYPE string_table,
      END OF ty_query_metadata,
      BEGIN OF ty_where_condition,
        field     TYPE string,
        operator  TYPE string,
        value     TYPE string,
        valueKind TYPE string,    " 'string' | 'number'
        bindVar   TYPE string,    " host-variable name to embed in @-placeholder
      END OF ty_where_condition,
      tt_where_condition TYPE STANDARD TABLE OF ty_where_condition WITH EMPTY KEY.

    " Constants for the query engine.
    CONSTANTS:
      gc_query_limit_max  TYPE i VALUE 10000,
      gc_query_offset_max TYPE i VALUE 100000,
      gc_query_limit_def  TYPE i VALUE 100.

    " Large-object datatype set — STRG/RSTR/LCHR/LRAW are excluded from output when
    " --fields is not specified, and rejected explicitly when it is (spec FR-016).
    CONSTANTS:
      gc_large_object_types TYPE string VALUE 'STRG|RSTR|LCHR|LRAW'.

    METHODS dispatch_data
      IMPORTING io_server TYPE REF TO if_http_server
                iv_path   TYPE string
                iv_method TYPE string
                iv_body   TYPE string.

    METHODS parse_data_query
      IMPORTING iv_body       TYPE string
      EXPORTING VALUE(es_req) TYPE ty_query_request
                VALUE(ev_ok)  TYPE abap_bool
                VALUE(ev_err_code) TYPE string
                VALUE(ev_err_msg)  TYPE string
                VALUE(ev_err_details) TYPE string.

    METHODS read_table_metadata
      IMPORTING iv_name       TYPE clike
      EXPORTING VALUE(es_meta) TYPE ty_query_metadata
                VALUE(ev_ok)   TYPE abap_bool
                VALUE(ev_err_code) TYPE string
                VALUE(ev_err_msg)  TYPE string
                VALUE(ev_err_details) TYPE string
                VALUE(ev_err_http)  TYPE i.

    METHODS parse_where_clause
      IMPORTING iv_where      TYPE string
                it_fields     TYPE tt_query_field
      EXPORTING VALUE(et_conditions) TYPE tt_where_condition
                VALUE(ev_ok)   TYPE abap_bool
                VALUE(ev_err_code) TYPE string
                VALUE(ev_err_msg)  TYPE string
                VALUE(ev_err_offset) TYPE i.

    METHODS execute_select
      IMPORTING is_meta      TYPE ty_query_metadata
                iv_fields_csv TYPE string
                it_where      TYPE tt_where_condition
                it_orderby    TYPE tt_query_orderby
                iv_limit      TYPE i
                iv_offset     TYPE i
      EXPORTING VALUE(ev_payload) TYPE string.

    METHODS execute_count
      IMPORTING is_meta      TYPE ty_query_metadata
                it_where      TYPE tt_where_condition
      EXPORTING VALUE(ev_payload) TYPE string.

    METHODS serialize_value
      IMPORTING iv_value TYPE any
                iv_type  TYPE string
      RETURNING VALUE(rv_str) TYPE string.

    METHODS get_uuid
      RETURNING VALUE(rv_uuid) TYPE sysuuid-c.

    METHODS build_table_header
      IMPORTING iv_table_name     TYPE tabname
                iv_description    TYPE ddtext
                iv_tabclass       TYPE dd02l-tabclass DEFAULT 'TRANSP'
                iv_delivery_class TYPE dd02v-contflag DEFAULT 'A'
                iv_data_class     TYPE dd09l-tabart DEFAULT 'APPL0'
                iv_size_category  TYPE dd09l-tabkat DEFAULT '0'
                iv_exclass        TYPE dd02v-exclass DEFAULT '2'
      EXPORTING es_object_new     TYPE coms_gox_def_header
                et_object_new     TYPE comt_gox_def_header
                et_bapireturn     TYPE bapirettab.

    METHODS build_field_entries
      IMPORTING iv_parent_key TYPE comt_gox_key_guid
                iv_table_name TYPE tabname
                it_fields     TYPE tt_field
                iv_start_pos  TYPE i DEFAULT 1
      EXPORTING et_object_new TYPE comt_gox_def_header
                et_bapireturn TYPE bapirettab.

    " ----- DDIC operations (POST create/overwrite, GET pull) -----
    METHODS create_ddic_table
      IMPORTING iv_name    TYPE tabname
                iv_payload TYPE string
                iv_package TYPE devclass
                iv_request TYPE trkorr
      EXPORTING VALUE(ev_payload) TYPE string.

    METHODS create_ddic_structure
      IMPORTING iv_name    TYPE tabname
                iv_payload TYPE string
                iv_package TYPE devclass
                iv_request TYPE trkorr
      EXPORTING VALUE(ev_payload) TYPE string.

    METHODS create_ddic_data_element
      IMPORTING iv_name    TYPE rollname
                iv_payload TYPE string
                iv_package TYPE devclass
                iv_request TYPE trkorr
      EXPORTING VALUE(ev_payload) TYPE string.

    METHODS create_ddic_domain
      IMPORTING iv_name    TYPE domname
                iv_payload TYPE string
                iv_package TYPE devclass
                iv_request TYPE trkorr
      EXPORTING VALUE(ev_payload) TYPE string.

    METHODS get_ddic_object
      IMPORTING iv_type    TYPE string
                iv_name    TYPE string
      EXPORTING VALUE(ev_payload) TYPE string.
ENDCLASS.

CLASS zcl_abap_vibe_icf IMPLEMENTATION.
  METHOD if_http_extension~handle_request.
    DATA(lv_path) = server->request->get_header_field( '~path_info' ).
    DATA(lv_method) = server->request->get_method( ).
    DATA(lv_body) = server->request->get_cdata( ).

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
    ELSEIF lv_path CP '/ddic/*'.
      dispatch_ddic( io_server = server iv_path = lv_path iv_method = lv_method iv_body = lv_body ).
    ELSEIF lv_path CP '/textpool/*'.
      dispatch_textpool( io_server = server iv_path = lv_path iv_method = lv_method ).
    ELSEIF lv_path CP '/data/*'.
      " 016: read-only table data query (SE16N equivalent).
      TRY.
          dispatch_data( io_server = server iv_path = lv_path iv_method = lv_method iv_body = lv_body ).
        CATCH cx_root INTO DATA(lx_top_dispatch).
          " Convert any runtime exception in /data/* handlers into a structured
          " QUERY_FAILED response (instead of leaking 500 HTML).
          respond_error( io_server = server
                         iv_status = 500
                         iv_reason = 'Internal Server Error'
                         iv_code   = 'QUERY_FAILED'
                         iv_msg    = |dispatch_data runtime error: { lx_top_dispatch->get_text( ) }| ).
      ENDTRY.
    ELSEIF lv_path CP '/version-source*'.
      dispatch_version_management( io_server = server iv_path = lv_path iv_method = lv_method ).
    ELSE.
      respond_error( io_server = server
                     iv_status = 404
                     iv_reason = 'Not Found'
                     iv_code = 'NOT_FOUND'
                     iv_msg = |unknown path: /sap/zabap_vibe{ lv_path }| ).
    ENDIF.
  ENDMETHOD.

  METHOD dispatch_version_management.
    IF iv_method <> 'GET'.
      respond_error( io_server = io_server
                     iv_status = 405
                     iv_reason = 'Method Not Allowed'
                     iv_code = 'METHOD_NOT_ALLOWED'
                     iv_msg = |GET only on Version Management endpoints| ).
      RETURN.
    ENDIF.

    DATA(lv_query) = io_server->request->get_header_field( '~query_string' ).
    DATA(lv_objtype) = to_upper( query_param( iv_query = lv_query iv_name = 'objectType' ) ).
    DATA(lv_objname) = to_upper( query_param( iv_query = lv_query iv_name = 'objectName' ) ).
    DATA(lv_destination) = to_upper( query_param( iv_query = lv_query iv_name = 'destination' ) ).

    IF lv_objtype IS INITIAL OR lv_objname IS INITIAL OR lv_destination IS INITIAL.
      respond_error( io_server = io_server
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
      respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code = 'VERSION_TYPE_NOT_SUPPORTED'
                     iv_msg = |unsupported Version Management object type: { lv_objtype }| ).
      RETURN.
    ENDIF.

    IF strlen( lv_destination ) > 60
        OR lv_destination CN 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@._-'.
      respond_error( io_server = io_server
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
          respond_error( io_server = io_server
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
        respond_json( io_server = io_server
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
        respond_error( io_server = io_server
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
      respond_json( io_server = io_server
                    iv_status = 200
                    iv_reason = 'OK'
                    is_payload = ls_source ).
      RETURN.
    ENDIF.

    respond_error( io_server = io_server
                   iv_status = 404
                   iv_reason = 'Not Found'
                   iv_code = 'NOT_FOUND'
                   iv_msg = |unknown Version Management path: { iv_path }| ).
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

  METHOD dispatch_textpool.
    " 014 US4: read textpool via RS_TEXTPOOL_READ; write support is target-specific.
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
      respond_error( io_server = io_server
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
      respond_error( io_server = io_server
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
                             IMPORTING ev_payload = DATA(lv_payload_get) ).
      respond_raw_json( io_server = io_server iv_status = 200 iv_reason = 'OK' iv_json = lv_payload_get ).
    ELSEIF iv_method = 'POST'.
      set_textpool_elements( EXPORTING iv_category = lv_category
                                       iv_object   = lv_object
                                       iv_objtype  = lv_objtype
                                       iv_body     = io_server->request->get_cdata( )
                             IMPORTING ev_payload = DATA(lv_payload_set) ).
      respond_raw_json( io_server = io_server iv_status = 200 iv_reason = 'OK' iv_json = lv_payload_set ).
    ELSE.
      respond_error( io_server = io_server
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
      ev_payload = `{ "status": "error", "error": { "code": "TEXTPOOL_OBJECT_NOT_FOUND", "message": "` && iv_object && ` not found" } }`.
      RETURN.
    ENDIF.

    DATA lv_json TYPE string.
    lv_json = `[`.
    DATA lv_first TYPE abap_bool VALUE abap_true.
    LOOP AT lt_pool INTO ls_pool.
      " Category filter: symbols → ID = 'I'; selections → ID = 'S'; headings → ID = 'H'.
      IF iv_category = 'TEXTS' AND ls_pool-id <> 'I'. CONTINUE. ENDIF.
      IF iv_category = 'SELECTIONS' AND ls_pool-id <> 'S'. CONTINUE. ENDIF.
      IF iv_category = 'HEADINGS' AND ls_pool-id <> 'H'. CONTINUE. ENDIF.
      IF lv_first = abap_true.
        lv_first = abap_false.
      ELSE.
        lv_json = lv_json && `,`.
      ENDIF.
      lv_json = lv_json && `{ "id": "` && ls_pool-key && `", "text": "` && ls_pool-entry && `" }`.
    ENDLOOP.
    lv_json = lv_json && `]`.

    ev_payload = `{ "status": "success", "data": { "object": "` && iv_object && `", "type": "` && iv_objtype && `", "category": "` && iv_category && `", "elements": ` && lv_json && ` } }`.
  ENDMETHOD.

  METHOD set_textpool_elements.
    ev_payload = `{ "status": "error", "error": { "code": "TEXTPOOL_WRITE_UNSUPPORTED", "message": "Textpool writing is not available through a non-interactive API on this SAP release" } }`.
  ENDMETHOD.

  METHOD dispatch_ddic.
    DATA lv_type TYPE string.
    DATA lv_name TYPE string.
    DATA lv_match_type TYPE string.
    DATA lv_match_name TYPE string.
    DATA lv_pkg TYPE string.
    DATA lv_req TYPE string.
    DATA lv_payload TYPE string.
    FIND REGEX '^/ddic/(doma|dtel|tabl|stru)(?:/(.+))?$' IN iv_path IGNORING CASE
      SUBMATCHES lv_match_type lv_match_name.
    IF sy-subrc <> 0 OR lv_match_type IS INITIAL.
      respond_error( io_server = io_server
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

      CASE lv_type.
        WHEN 'DOMA'.
          create_ddic_domain( EXPORTING iv_name    = CONV domname( lv_name )
                                        iv_payload = iv_body
                                        iv_package = lv_package
                                        iv_request = lv_request
                              IMPORTING ev_payload = lv_payload ).
        WHEN 'DTEL'.
          create_ddic_data_element( EXPORTING iv_name    = CONV rollname( lv_name )
                                            iv_payload = iv_body
                                            iv_package = lv_package
                                            iv_request = lv_request
                                  IMPORTING ev_payload = lv_payload ).
        WHEN 'TABL'.
          create_ddic_table( EXPORTING iv_name    = CONV tabname( lv_name )
                                       iv_payload = iv_body
                                       iv_package = lv_package
                                       iv_request = lv_request
                             IMPORTING ev_payload = lv_payload ).
        WHEN 'STRU'.
          create_ddic_structure( EXPORTING iv_name    = CONV tabname( lv_name )
                                          iv_payload = iv_body
                                          iv_package = lv_package
                                          iv_request = lv_request
                                IMPORTING ev_payload = lv_payload ).
      ENDCASE.
      respond_raw_json( io_server = io_server
                        iv_status = 200
                        iv_reason = 'OK'
                        iv_json   = lv_payload ).
    ELSEIF iv_method = 'GET'.
      get_ddic_object( EXPORTING iv_type    = lv_type
                                 iv_name    = lv_name
                       IMPORTING ev_payload = lv_payload ).
      respond_raw_json( io_server = io_server
                        iv_status = 200
                        iv_reason = 'OK'
                        iv_json   = lv_payload ).
    ELSE.
      respond_error( io_server = io_server
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

    DATA: BEGIN OF ls_attr, name TYPE string, description TYPE string, deliveryClass TYPE string,
             dataClass TYPE string, sizeCategory TYPE string, clientDependent TYPE abap_bool,
             allowMaintenance TYPE abap_bool, fields TYPE tt_field, END OF ls_attr.
    /ui2/cl_json=>deserialize( EXPORTING json = iv_payload
                               CHANGING data = ls_attr ).
    IF ls_attr-name IS INITIAL.
      ls_attr-name = iv_name.
    ENDIF.
    lt_fields = ls_attr-fields.

    IF ls_attr-clientDependent = abap_true.
      ls_mandt-fieldName = 'MANDT'.
      ls_mandt-rollname   = 'MANDT'.
      ls_mandt-keyFlag    = abap_true.
      ls_mandt-notNull    = abap_true.
      INSERT ls_mandt INTO lt_fields INDEX 1.
    ENDIF.

    build_table_header( EXPORTING iv_table_name    = CONV tabname( ls_attr-name )
                                  iv_description   = CONV ddtext( ls_attr-description )
                                  iv_delivery_class = CONV dd02v-contflag( ls_attr-deliveryClass )
                                  iv_data_class    = CONV dd09l-tabart( ls_attr-dataClass )
                                  iv_size_category = CONV dd09l-tabkat( ls_attr-sizeCategory )
                        IMPORTING es_object_new    = ls_header_local
                                  et_object_new     = lt_object_new
                                  et_bapireturn    = lt_bapireturn ).
    lv_start = COND #( WHEN ls_attr-clientDependent = abap_true THEN 2 ELSE 1 ).

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
    LOOP AT lt_bapireturn INTO DATA(ls_err) WHERE type CA 'EAX'.
      lv_ok = abap_false.
      IF lv_msg IS INITIAL.
        lv_msg = ls_err-message.
      ELSE.
        lv_msg = lv_msg && |; { ls_err-message }|.
      ENDIF.
    ENDLOOP.
    IF lv_ok = abap_false.
      ev_payload = |\{ "status": "error", "error": \{ "code": "DDIC_CREATE_FAILED", "message": "{ lv_msg }" \} \}|.
      RETURN.
    ENDIF.

    ev_payload = |\{ "status": "success", "data": \{ "name": "{ ls_attr-name }", "type": "TABL", "action": "created" \} \}|.
  ENDMETHOD.

  METHOD create_ddic_structure.
    DATA lt_object_new TYPE comt_gox_def_header.
    DATA lt_object_old TYPE comt_gox_def_header.
    DATA lt_bapireturn TYPE bapirettab.
    DATA lt_transport  TYPE comt_gox_trans_object.
    DATA lt_fields     TYPE tt_field.
    DATA ls_header_local TYPE coms_gox_def_header.
    DATA lt_field_entries TYPE comt_gox_def_header.

    DATA: BEGIN OF ls_attr, name TYPE string, description TYPE string, fields TYPE tt_field, END OF ls_attr.
    /ui2/cl_json=>deserialize( EXPORTING json = iv_payload CHANGING data = ls_attr ).
    IF ls_attr-name IS INITIAL.
      ls_attr-name = iv_name.
    ENDIF.
    lt_fields = ls_attr-fields.

    build_table_header( EXPORTING iv_table_name    = CONV tabname( ls_attr-name )
                                  iv_description   = CONV ddtext( ls_attr-description )
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
    DATA lv_msg TYPE string.
    DATA lv_error TYPE string.
    LOOP AT lt_bapireturn INTO DATA(ls_err) WHERE type CA 'EAX'.
      lv_ok = abap_false.
      IF ls_err-message IS INITIAL.
        CLEAR lv_error.
        CALL FUNCTION 'MESSAGE_TEXT_BUILD'
          EXPORTING
            msgid               = ls_err-id
            msgnr               = ls_err-number
            msgv1               = ls_err-message_v1
            msgv2               = ls_err-message_v2
            msgv3               = ls_err-message_v3
            msgv4               = ls_err-message_v4
          IMPORTING
            message_text_output = lv_error
          EXCEPTIONS
            OTHERS              = 1.
        IF lv_error IS INITIAL.
          lv_error = |{ ls_err-type } { ls_err-id } { ls_err-number } { ls_err-message_v1 } { ls_err-message_v2 } { ls_err-message_v3 } { ls_err-message_v4 }|.
        ENDIF.
      ELSE.
        lv_error = ls_err-message.
      ENDIF.
      IF lv_msg IS INITIAL. lv_msg = lv_error. ELSE. lv_msg = lv_msg && |; { lv_error }|. ENDIF.
    ENDLOOP.
    IF lv_ok = abap_false.
      ev_payload = |\{ "status": "error", "error": \{ "code": "DDIC_CREATE_FAILED", "message": "{ lv_msg }" \} \}|.
      RETURN.
    ENDIF.
    ev_payload = |\{ "status": "success", "data": \{ "name": "{ ls_attr-name }", "type": "STRU", "action": "created" \} \}|.
  ENDMETHOD.

  METHOD create_ddic_data_element.
    " GOX_GEN_DTEL_STD: domain reference OR built-in type + screen texts.
    DATA lt_object_new TYPE comt_gox_def_header.
    DATA lt_object_old TYPE comt_gox_def_header.
    DATA lt_bapireturn TYPE bapirettab.
    DATA lt_transport  TYPE comt_gox_trans_object.
    DATA ls_object_new TYPE coms_gox_def_header.
    DATA ls_details    TYPE coms_gox_table_entry_fields.

    DATA: BEGIN OF ls_attr, name TYPE string, description TYPE string, domain TYPE string,
             dataType TYPE string, length TYPE string, decimals TYPE string,
             shortText TYPE string, mediumText TYPE string, longText TYPE string,
             headerText TYPE string, END OF ls_attr.
    /ui2/cl_json=>deserialize( EXPORTING json = iv_payload
                               CHANGING data = ls_attr ).
    IF ls_attr-name IS INITIAL.
      ls_attr-name = iv_name.
    ENDIF.

    " Domain or built-in type.
    IF ls_attr-domain IS NOT INITIAL.
      ls_details-fieldname = 'DOMNAME'. ls_details-fieldvalue = ls_attr-domain.
      APPEND ls_details TO ls_object_new-details.
    ELSE.
      IF ls_attr-dataType IS NOT INITIAL.
        ls_details-fieldname = 'DATATYPE'. ls_details-fieldvalue = ls_attr-dataType.
        APPEND ls_details TO ls_object_new-details.
      ENDIF.
      IF ls_attr-length IS NOT INITIAL.
        ls_details-fieldname = 'LENG'. ls_details-fieldvalue = ls_attr-length.
        APPEND ls_details TO ls_object_new-details.
      ENDIF.
      IF ls_attr-decimals IS NOT INITIAL.
        ls_details-fieldname = 'DECIMALS'. ls_details-fieldvalue = ls_attr-decimals.
        APPEND ls_details TO ls_object_new-details.
      ENDIF.
    ENDIF.

    " Column header (reptext) + its length marker.
    IF ls_attr-headerText IS NOT INITIAL.
      ls_details-fieldname = 'REPTEXT'. ls_details-fieldvalue = ls_attr-headerText.
      APPEND ls_details TO ls_object_new-details.
      ls_details-fieldname = 'HEADLEN'. ls_details-fieldvalue = '55'.
      APPEND ls_details TO ls_object_new-details.
    ENDIF.
    " Screen texts: short / medium / long + length markers.
    IF ls_attr-shortText IS NOT INITIAL.
      ls_details-fieldname = 'SCRTEXT_S'. ls_details-fieldvalue = ls_attr-shortText.
      APPEND ls_details TO ls_object_new-details.
      ls_details-fieldname = 'SCRLEN1'. ls_details-fieldvalue = '10'.
      APPEND ls_details TO ls_object_new-details.
    ENDIF.
    IF ls_attr-mediumText IS NOT INITIAL.
      ls_details-fieldname = 'SCRTEXT_M'. ls_details-fieldvalue = ls_attr-mediumText.
      APPEND ls_details TO ls_object_new-details.
      ls_details-fieldname = 'SCRLEN2'. ls_details-fieldvalue = '20'.
      APPEND ls_details TO ls_object_new-details.
    ENDIF.
    IF ls_attr-longText IS NOT INITIAL.
      ls_details-fieldname = 'SCRTEXT_L'. ls_details-fieldvalue = ls_attr-longText.
      APPEND ls_details TO ls_object_new-details.
      ls_details-fieldname = 'SCRLEN3'. ls_details-fieldvalue = '40'.
      APPEND ls_details TO ls_object_new-details.
    ENDIF.

    ls_details-fieldname = 'DDLANGUAGE'. ls_details-fieldvalue = sy-langu.
    APPEND ls_details TO ls_object_new-details.

    ls_object_new-key_guid     = get_uuid( ).
    ls_object_new-object_name  = ls_attr-name.
    APPEND VALUE coms_gox_def_text( language = sy-langu description = ls_attr-description )
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
    LOOP AT lt_bapireturn INTO DATA(ls_err) WHERE type CA 'EAX'.
      lv_ok = abap_false.
      IF lv_msg IS INITIAL. lv_msg = ls_err-message. ELSE. lv_msg = lv_msg && |; { ls_err-message }|. ENDIF.
    ENDLOOP.
    IF lv_ok = abap_false.
      ev_payload = |\{ "status": "error", "error": \{ "code": "DDIC_CREATE_FAILED", "message": "{ lv_msg }" \} \}|.
      RETURN.
    ENDIF.
    ev_payload = |\{ "status": "success", "data": \{ "name": "{ ls_attr-name }", "type": "DTEL", "action": "created" \} \}|.
  ENDMETHOD.

  METHOD create_ddic_domain.
    " GOX_GEN_DOMA_STD: datatype/length/decimals + sign/lowercase/convExit.
    DATA lt_object_new TYPE comt_gox_def_header.
    DATA lt_object_old TYPE comt_gox_def_header.
    DATA lt_bapireturn TYPE bapirettab.
    DATA lt_transport  TYPE comt_gox_trans_object.
    DATA ls_object_new TYPE coms_gox_def_header.
    DATA ls_details    TYPE coms_gox_table_entry_fields.

    DATA: BEGIN OF ls_attr, name TYPE string, description TYPE string, dataType TYPE string,
             length TYPE string, decimals TYPE string, signFlag TYPE abap_bool,
             lowercase TYPE abap_bool, convExit TYPE string, END OF ls_attr.
    /ui2/cl_json=>deserialize( EXPORTING json = iv_payload
                               CHANGING data = ls_attr ).
    IF ls_attr-name IS INITIAL.
      ls_attr-name = iv_name.
    ENDIF.

    ls_details-fieldname = 'DATATYPE'. ls_details-fieldvalue = ls_attr-dataType.
    APPEND ls_details TO ls_object_new-details.
    ls_details-fieldname = 'LENG'. ls_details-fieldvalue = ls_attr-length.
    APPEND ls_details TO ls_object_new-details.
    IF ls_attr-decimals IS NOT INITIAL.
      ls_details-fieldname = 'DECIMALS'. ls_details-fieldvalue = ls_attr-decimals.
      APPEND ls_details TO ls_object_new-details.
    ENDIF.
    IF ls_attr-signFlag = abap_true.
      ls_details-fieldname = 'SIGNFLAG'. ls_details-fieldvalue = 'X'.
      APPEND ls_details TO ls_object_new-details.
    ENDIF.
    IF ls_attr-lowercase = abap_true.
      ls_details-fieldname = 'LOWERCASE'. ls_details-fieldvalue = 'X'.
      APPEND ls_details TO ls_object_new-details.
    ENDIF.
    IF ls_attr-convExit IS NOT INITIAL.
      ls_details-fieldname = 'CONVEXIT'. ls_details-fieldvalue = ls_attr-convExit.
      APPEND ls_details TO ls_object_new-details.
    ENDIF.
    ls_details-fieldname = 'DDLANGUAGE'. ls_details-fieldvalue = sy-langu.
    APPEND ls_details TO ls_object_new-details.

    ls_object_new-key_guid     = get_uuid( ).
    ls_object_new-object_name  = ls_attr-name.
    APPEND VALUE coms_gox_def_text( language = sy-langu description = ls_attr-description )
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
    LOOP AT lt_bapireturn INTO DATA(ls_err) WHERE type CA 'EAX'.
      lv_ok = abap_false.
      IF lv_msg IS INITIAL. lv_msg = ls_err-message. ELSE. lv_msg = lv_msg && |; { ls_err-message }|. ENDIF.
    ENDLOOP.
    IF lv_ok = abap_false.
      ev_payload = |\{ "status": "error", "error": \{ "code": "DDIC_CREATE_FAILED", "message": "{ lv_msg }" \} \}|.
      RETURN.
    ENDIF.
    ev_payload = |\{ "status": "success", "data": \{ "name": "{ ls_attr-name }", "type": "DOMA", "action": "created" \} \}|.
  ENDMETHOD.

  METHOD get_ddic_object.
    " US3: pull a DDIC object definition and return the wire JSON (mirrors the
    " create payload so round-trip is consistent). Object missing → DDIC_OBJECT_NOT_FOUND.
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
          ev_payload = `{ "status": "error", "error": { "code": "DDIC_OBJECT_NOT_FOUND", "message": "DOMA ` && iv_name && ` not found" } }`.
          RETURN.
        ENDIF.
         DATA lv_doma_length TYPE i.
         DATA lv_doma_decimals TYPE i.
         DATA lv_doma_sign_flag TYPE string.
         DATA lv_doma_lowercase TYPE string.
         lv_doma_length = ls_doma-leng.
         lv_doma_decimals = ls_doma-decimals.
         IF ls_doma-signflag = 'X'. lv_doma_sign_flag = 'true'. ELSE. lv_doma_sign_flag = 'false'. ENDIF.
         IF ls_doma-lowercase = 'X'. lv_doma_lowercase = 'true'. ELSE. lv_doma_lowercase = 'false'. ENDIF.
        ev_payload = |\{ "status": "success", "data": \{ "name": "{ iv_name }", "type": "DOMA",| &&
               | "description": "{ ls_doma-ddtext }", "dataType": "{ ls_doma-datatype }",| &&
           | "length": { lv_doma_length }, "decimals": { lv_doma_decimals }, "signFlag": { lv_doma_sign_flag },| &&
           | "lowercase": { lv_doma_lowercase }, "convExit": "{ ls_doma-convexit }" \} \}|.
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
          ev_payload = `{ "status": "error", "error": { "code": "DDIC_OBJECT_NOT_FOUND", "message": "DTEL ` && iv_name && ` not found" } }`.
          RETURN.
        ENDIF.
         DATA lv_dtel_length TYPE i.
         DATA lv_dtel_decimals TYPE i.
         lv_dtel_length = ls_dtel-leng.
         lv_dtel_decimals = ls_dtel-decimals.
        ev_payload = |\{ "status": "success", "data": \{ "name": "{ iv_name }", "type": "DTEL",| &&
               | "description": "{ ls_dtel-ddtext }", "domain": "{ ls_dtel-domname }",| &&
           | "dataType": "{ ls_dtel-datatype }", "length": { lv_dtel_length }, "decimals": { lv_dtel_decimals },| &&
               | "shortText": "{ ls_dtel-scrtext_s }", "mediumText": "{ ls_dtel-scrtext_m }",| &&
               | "longText": "{ ls_dtel-scrtext_l }", "headerText": "{ ls_dtel-reptext }" \} \}|.
      WHEN 'TABL'.
        " DDIF_TABL_GET reads both transparent tables and structures; the
        " tabclass in dd02v distinguishes them.
        DATA ls_tabl TYPE dd02v.
        DATA ls_tabl09 TYPE dd09l.
        DATA lt_tabl03 TYPE TABLE OF dd03p.
        CALL FUNCTION 'DDIF_TABL_GET'
          EXPORTING
            name     = CONV tabname( iv_name )
            state    = 'A'
            langu    = sy-langu
          IMPORTING
            dd02v_wa = ls_tabl
            dd09l_wa = ls_tabl09
          TABLES
            dd03p_tab = lt_tabl03
          EXCEPTIONS
            illegal_input = 1
            OTHERS        = 2.
        IF sy-subrc <> 0 OR ls_tabl-tabname IS INITIAL.
          ev_payload = `{ "status": "error", "error": { "code": "DDIC_OBJECT_NOT_FOUND", "message": "TABL ` && iv_name && ` not found" } }`.
          RETURN.
        ENDIF.
        " Build the fields array inline.
        DATA lv_fields TYPE string.
        lv_fields = `[`.
        DATA lv_first TYPE abap_bool VALUE abap_true.
        DATA lv_tabl_length TYPE i.
        DATA lv_tabl_decimals TYPE i.
        DATA lv_tabl_key_flag TYPE string.
        DATA lv_tabl_not_null TYPE string.
        DATA lv_tabl_client_dependent TYPE string VALUE 'false'.
        LOOP AT lt_tabl03 INTO DATA(ls_field).
          lv_tabl_length = ls_field-leng.
          lv_tabl_decimals = ls_field-decimals.
          IF ls_field-keyflag = 'X'. lv_tabl_key_flag = 'true'. ELSE. lv_tabl_key_flag = 'false'. ENDIF.
          IF ls_field-notnull = 'X'. lv_tabl_not_null = 'true'. ELSE. lv_tabl_not_null = 'false'. ENDIF.
          IF ls_field-fieldname = 'MANDT'. lv_tabl_client_dependent = 'true'. ENDIF.
          IF lv_first = abap_true.
            lv_first = abap_false.
          ELSE.
            lv_fields = lv_fields && `,`.
          ENDIF.
          lv_fields = lv_fields
            && |\{ "fieldName": "{ ls_field-fieldname }", "rollname": "{ ls_field-rollname }",| &&
            | "dataType": "{ ls_field-datatype }", "length": { lv_tabl_length }, "decimals": { lv_tabl_decimals },| &&
            | "keyFlag": { lv_tabl_key_flag }, "notNull": { lv_tabl_not_null } \}|.
        ENDLOOP.
        lv_fields = lv_fields && `]`.
        ev_payload = |\{ "status": "success", "data": \{ "name": "{ iv_name }", "type": "{ iv_type }",| &&
               | "description": "{ ls_tabl-ddtext }", "deliveryClass": "{ ls_tabl-contflag }",| &&
           | "dataClass": "{ ls_tabl09-tabart }", "sizeCategory": "{ ls_tabl09-tabkat }",| &&
           | "clientDependent": { lv_tabl_client_dependent }, "fields": { lv_fields } \} \}|.
      WHEN 'STRU'.
        " Structure read via DDIF_TABL_GET (tabclass INTTAB), same shape as TABL.
        DATA ls_stru TYPE dd02v.
        DATA lt_stru03 TYPE TABLE OF dd03p.
        CALL FUNCTION 'DDIF_TABL_GET'
          EXPORTING
            name     = CONV tabname( iv_name )
            state    = 'A'
            langu    = sy-langu
          IMPORTING
            dd02v_wa = ls_stru
          TABLES
            dd03p_tab = lt_stru03
          EXCEPTIONS
            illegal_input = 1
            OTHERS        = 2.
        IF sy-subrc <> 0 OR ls_stru-tabname IS INITIAL.
          ev_payload = `{ "status": "error", "error": { "code": "DDIC_OBJECT_NOT_FOUND", "message": "STRU ` && iv_name && ` not found" } }`.
          RETURN.
        ENDIF.
        DATA lv_fields2 TYPE string.
        lv_fields2 = `[`.
        DATA lv_first2 TYPE abap_bool VALUE abap_true.
        DATA lv_stru_length TYPE i.
        DATA lv_stru_decimals TYPE i.
        DATA lv_stru_key_flag TYPE string.
        LOOP AT lt_stru03 INTO DATA(ls_field2).
          lv_stru_length = ls_field2-leng.
          lv_stru_decimals = ls_field2-decimals.
          IF ls_field2-keyflag = 'X'. lv_stru_key_flag = 'true'. ELSE. lv_stru_key_flag = 'false'. ENDIF.
          IF lv_first2 = abap_true.
            lv_first2 = abap_false.
          ELSE.
            lv_fields2 = lv_fields2 && `,`.
          ENDIF.
          lv_fields2 = lv_fields2
              && |\{ "fieldName": "{ ls_field2-fieldname }", "rollname": "{ ls_field2-rollname }", "dataType": "{ ls_field2-datatype }", "length": { lv_stru_length }, "decimals": { lv_stru_decimals }, "keyFlag": { lv_stru_key_flag } \}|.
        ENDLOOP.
        lv_fields2 = lv_fields2 && `]`.
        ev_payload = |\{ "status": "success", "data": \{ "name": "{ iv_name }", "type": "STRU", "description": "{ ls_stru-ddtext }", "fields": { lv_fields2 } \} \}|.
      WHEN OTHERS.
        ev_payload = |\{ "status": "error", "error": \{ "code": "DDIC_NOT_SUPPORTED", "message": "unsupported DDIC type { iv_type }" \} \}|.
    ENDCASE.
  ENDMETHOD.

  METHOD respond_json.
    DATA(lv_json) = /ui2/cl_json=>serialize( data = is_payload
                                             pretty_name = /ui2/cl_json=>pretty_mode-camel_case ).
    io_server->response->set_status( code = iv_status reason = iv_reason ).
    io_server->response->set_content_type( content_type = 'application/json' ).
    io_server->response->set_cdata( data = lv_json ).
  ENDMETHOD.

  METHOD respond_raw_json.
    " The DDIC handlers already produce a complete JSON envelope string; write it
    " straight to the body without re-serializing (which would double-encode it).
    io_server->response->set_status( code = iv_status reason = iv_reason ).
    io_server->response->set_content_type( content_type = 'application/json' ).
    io_server->response->set_cdata( data = iv_json ).
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

  METHOD dispatch_data.
    " 016: route /data/<sub> → sub-handlers. Only /data/query is supported in v1.
    IF iv_path <> '/data/query'.
      respond_error( io_server = io_server
                     iv_status = 404
                     iv_reason = 'Not Found'
                     iv_code   = 'NOT_FOUND'
                     iv_msg    = |unsupported path: /sap/zabap_vibe{ iv_path }| ).
      RETURN.
    ENDIF.
    IF iv_method <> 'POST'.
      respond_error( io_server = io_server
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
      respond_error( io_server = io_server
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
      respond_error( io_server = io_server
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
            " 016: explicit projection of a large-object field is rejected.
            respond_error( io_server = io_server
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
          respond_error( io_server = io_server
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
      respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = 'LIMIT_EXCEEDED'
                     iv_msg    = |limit must be an integer in [1, { gc_query_limit_max }] (got { ls_req-limit })| ).
      RETURN.
    ENDIF.
    IF ls_req-offset < 0 OR ls_req-offset > gc_query_offset_max.
      respond_error( io_server = io_server
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
          respond_error( io_server = io_server
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
        respond_error( io_server = io_server
                       iv_status = 400
                       iv_reason = 'Bad Request'
                       iv_code   = lv_where_err_code
                       iv_msg    = |{ lv_where_err_msg } (offset { lv_where_err_offset })| ).
        RETURN.
      ENDIF.
    ENDIF.

    " 8. Count-only path (US4).
    IF ls_req-countonly = abap_true.
      DATA(lv_count_payload) = VALUE string( ).
      execute_count( EXPORTING is_meta = ls_meta
                               it_where = lt_where
                     IMPORTING ev_payload = lv_count_payload ).
      io_server->response->set_status( code = 200 reason = 'OK' ).
      io_server->response->set_content_type( content_type = 'application/json' ).
      io_server->response->set_cdata( data = lv_count_payload ).
      RETURN.
    ENDIF.

    " 9. Run the data query.
    DATA(lv_payload) = VALUE string( ).
    TRY.
        execute_select( EXPORTING is_meta = ls_meta
                                  iv_fields_csv = lv_fields_csv
                                  it_where = lt_where
                                  it_orderby = lt_orderby
                                  iv_limit = ls_req-limit
                                  iv_offset = ls_req-offset
                        IMPORTING ev_payload = lv_payload ).
      CATCH cx_root INTO DATA(lx_dispatch_err).
        respond_error( io_server = io_server
                       iv_status = 500
                       iv_reason = 'Internal Server Error'
                       iv_code = 'QUERY_FAILED'
                       iv_msg  = |execute_select runtime error: { lx_dispatch_err->get_text( ) }| ).
        RETURN.
    ENDTRY.
    io_server->response->set_status( code = 200 reason = 'OK' ).
    io_server->response->set_content_type( content_type = 'application/json' ).
    io_server->response->set_cdata( data = lv_payload ).
  ENDMETHOD.

  METHOD parse_data_query.
    " 016: deserialize the wire payload (camelCase). Generate default values for
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
    " 016: read DD02L (table header) + DD03L (field list) for the requested table.
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
    " 016: AND-only where grammar per research R8.
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
    " 016: dynamic Open SQL with host-variable binding (research R1).
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
    ASSIGN lr_rows->* TO FIELD-SYMBOL(<lt_rows>).

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
        " Runtime SQL failure — surface a structured QUERY_FAILED.
        " (No escape(): cl_abap_format may not exist on older NetWeaver.)
        DATA(lv_err_obj) = |\{ "status": "error", "error": \{ "code": "QUERY_FAILED", "message": "{ lx_query->get_text( ) }" \} \}|.
        ev_payload = lv_err_obj.
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

    " Build the JSON envelope.
    " Projection fields from iv_fields_csv (the row type contains all fields;
    " we emit only the projected ones here).
    DATA(lt_out_fields) = VALUE string_table( ).
    SPLIT iv_fields_csv AT ',' INTO TABLE lt_out_fields.

    " Build the fields array using CONCATENATE (most portable on all NetWeaver).
    DATA lv_ff TYPE string.
    DATA lv_fields_json TYPE string.
    lv_fields_json = '['.
    LOOP AT lt_out_fields INTO lv_ff.
      IF sy-tabix > 1.
        CONCATENATE lv_fields_json ',' '"' lv_ff '"' INTO lv_fields_json.
      ELSE.
        CONCATENATE lv_fields_json '"' lv_ff '"' INTO lv_fields_json.
      ENDIF.
    ENDLOOP.
    CONCATENATE lv_fields_json ']' INTO lv_fields_json.

    " excludedFields list (may be empty → '[]').
    DATA lv_ex TYPE string.
    DATA lv_excluded_json TYPE string.
    lv_excluded_json = '['.
    LOOP AT is_meta-excludedFields INTO lv_ex.
      IF sy-tabix > 1.
        CONCATENATE lv_excluded_json ',' '"' lv_ex '"' INTO lv_excluded_json.
      ELSE.
        CONCATENATE lv_excluded_json '"' lv_ex '"' INTO lv_excluded_json.
      ENDIF.
    ENDLOOP.
    CONCATENATE lv_excluded_json ']' INTO lv_excluded_json.

    DATA lv_fname TYPE string.
    DATA lv_meta_type TYPE string.
    DATA lv_cell_json TYPE string.
    DATA lv_rows_json TYPE string.
    DATA lv_first TYPE abap_bool VALUE abap_true.
    DATA lv_row_idx TYPE i VALUE 0.
    DATA lv_first_cell TYPE abap_bool.
    LOOP AT <lt_rows> ASSIGNING FIELD-SYMBOL(<ls_row>).
      lv_row_idx = lv_row_idx + 1.
      IF lv_row_idx > iv_limit.
        EXIT.  " drop the limit+1 probe row
      ENDIF.
      IF lv_first = abap_false.
        CONCATENATE lv_rows_json ',' INTO lv_rows_json.
      ENDIF.
      lv_first = abap_false.
      CONCATENATE lv_rows_json '{' INTO lv_rows_json.
      lv_first_cell = abap_true.
      LOOP AT lt_out_fields INTO lv_fname.
        ASSIGN COMPONENT lv_fname OF STRUCTURE <ls_row> TO FIELD-SYMBOL(<lv_cell>).
        IF sy-subrc <> 0. CONTINUE. ENDIF.
        lv_meta_type = ''.
        READ TABLE lv_meta-fields INTO DATA(ls_cell_meta) WITH KEY name = lv_fname.
        IF sy-subrc = 0. lv_meta_type = ls_cell_meta-dataType. ENDIF.
        IF lv_first_cell = abap_false.
          CONCATENATE lv_rows_json ',' INTO lv_rows_json.
        ENDIF.
        lv_first_cell = abap_false.
        lv_cell_json = serialize_value( iv_value = <lv_cell> iv_type = lv_meta_type ).
        CONCATENATE lv_rows_json '"' lv_fname '":' lv_cell_json INTO lv_rows_json.
      ENDLOOP.
      CONCATENATE lv_rows_json '}' INTO lv_rows_json.
    ENDLOOP.

    " Final envelope — CONCATENATE, one statement per line.
    DATA lv_object_type TYPE string.
    IF lv_meta-tabclass = 'VIEW'.
      lv_object_type = 'VIEW'.
    ELSE.
      lv_object_type = 'TABL'.
    ENDIF.
    DATA lv_trunc_str TYPE string.
    IF lv_truncated = abap_true.
      lv_trunc_str = 'true'.
    ELSE.
      lv_trunc_str = 'false'.
    ENDIF.
    DATA lv_rc_str TYPE string.
    lv_rc_str = |{ lv_row_count }|.
    DATA lv_env TYPE string.
    CONCATENATE '{"status":"success","data":{"table":"' lv_meta-name '","objectType":"' lv_object_type '",' INTO lv_env.
    CONCATENATE lv_env '"fields":' lv_fields_json INTO lv_env.
    CONCATENATE lv_env ',"rows":[' lv_rows_json ']' INTO lv_env.
    CONCATENATE lv_env ',"rowCount":' lv_rc_str INTO lv_env.
    CONCATENATE lv_env ',"truncated":' lv_trunc_str INTO lv_env.
    CONCATENATE lv_env ',"excludedFields":' lv_excluded_json ',"durationMs":1}}' INTO lv_env.
    ev_payload = lv_env.
    CATCH cx_root INTO DATA(lx_exec_top).
      ev_payload = |\{ "status": "error", "error": \{ "code": "QUERY_FAILED", "message": "execute_select: { lx_exec_top->get_text( ) }" \} \}|.
      RETURN.
    ENDTRY.
  ENDMETHOD.

  METHOD execute_count.
    " 016: SELECT COUNT(*) FROM (table) WHERE (cond) — same parameter binding.
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
        ev_payload = |\{ "status": "error", "error": \{ "code": "QUERY_FAILED", "message": "{ escape( val = lx_q->get_text( ) format = cl_abap_format=>e_html_js ) }" \} \}|.
        RETURN.
    ENDTRY.

    ev_payload =
      |\{ "status":"success","data":\{ "table":"{ lv_meta-name }","count":{ lv_count },"durationMs":1 \} \}|.
  ENDMETHOD.

  METHOD serialize_value.
    " 016: deterministic string serialization per research R5.
    " All values returned as JSON strings with stable formatting:
    "   d      → 'YYYYMMDD'
    "   t      → 'HHMMSS'
    "   i/int8 → decimal
    "   p      → decimal with '.' separator
    "   f      → decimal (use WRITE ... TO)
    "   c/n    → trimmed trailing spaces
    "   x      → lowercase hex
    "   clnt   → as-is
    DATA(lv_type_kind) = cl_abap_typedescr=>typekind_dref.
    TRY.
        DATA(lv_descr) = cl_abap_typedescr=>describe_by_data( iv_value ).
        lv_type_kind = lv_descr->type_kind.
      CATCH cx_root.
        " lv_type_kind stays at the default (data reference kind).
    ENDTRY.

    " iv_type is the DDIC datatype (from DD03L); default to type_kind if not supplied.
    DATA(lv_ddic_type) = iv_type.
    IF lv_ddic_type IS INITIAL.
      lv_ddic_type = lv_type_kind.
    ENDIF.

    DATA(lv_str) = VALUE string( ).
    CASE lv_ddic_type.
      WHEN 'D' OR 'DATS'.
        " Date — YYYYMMDD.
        lv_str = |"{ iv_value WIDTH = 8 }"|.
      WHEN 'T' OR 'TIMS'.
        " Time — HHMMSS.
        lv_str = |"{ iv_value WIDTH = 6 }"|.
      WHEN 'I' OR 'INT8' OR 'INT4' OR 'INT2' OR 'INT1' OR 'b' OR 's' OR '8'.
        " Integer — decimal.
        lv_str = |{ iv_value }|.
      WHEN 'P' OR 'DEC' OR 'QUAN' OR 'CURR' OR 'FLTP' OR 'F'.
        " Decimal — use cl_abap_conv_out_ce to force '.' separator.
        DATA(lv_value_string) = CONV string( iv_value ).
        " lo_conv->get( ) is not available on all NetWeaver versions; for vhcala4hci
        " simply format the string with condense + trailing-space trim. The
        " numeric formatting follows SAP's default (locale-independent '.' decimal).
        TRY.
            lv_str = |"{ lv_value_string }"|.
          CATCH cx_root.
            lv_str = |"{ lv_value_string }"|.
        ENDTRY.
      WHEN 'C' OR 'N' OR 'CLNT' OR 'g' OR 'CHAR' OR 'NUMC'.
        " Char / numc — trim trailing spaces, JSON-stringify.
        lv_str = |"{ condense( val = CONV string( iv_value ) del = ` ` ) }"|.
      WHEN 'X' OR 'RAW' OR 'y' OR 'xstring' OR 'RSTR' OR 'LRAW'.
        " RAW — hex (lowercase).
        lv_str = |"{ iv_value }"|.
      WHEN OTHERS.
        " Fallback — stringify without quotes, then JSON-escape.
        lv_str = |"{ condense( val = CONV string( iv_value ) del = ` ` ) }"|.
    ENDCASE.

    " The caller already emits the key as "key":value; here lv_str already holds
    " the quoted JSON value (e.g. "001"). Do NOT re-escape quotes — that would
    " turn "001" into \"001\". If a value contains a literal double-quote the
    " output may be invalid JSON for that cell; acceptable for v1.
    rv_str = lv_str.
  ENDMETHOD.

ENDCLASS.
