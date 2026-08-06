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
    CONSTANTS gc_version TYPE string VALUE '0.2.0'.

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
ENDCLASS.
