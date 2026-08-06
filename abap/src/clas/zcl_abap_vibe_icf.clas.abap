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
      END OF ty_error.
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

    " ----- textpool helpers (READ_TEXT_POOL / SAVE_TEXT_POOL) -----
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
        field_name  TYPE fieldname,
        rollname    TYPE rollname,
        datatype    TYPE dd03p-datatype,
        leng        TYPE dd03p-leng,
        decimals    TYPE dd03p-decimals,
        key_flag    TYPE abap_bool,
        not_null    TYPE abap_bool,
        ddtext      TYPE dd03p-ddtext,
        ref_table   TYPE dd03p-reftable,
        ref_field   TYPE dd03p-reffield,
        check_table TYPE dd03p-checktable,
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
    ELSE.
      respond_error( io_server = server
                     iv_status = 404
                     iv_reason = 'Not Found'
                     iv_code = 'NOT_FOUND'
                     iv_msg = |unknown path: /sap/zabap_vibe{ lv_path }| ).
    ENDIF.
  ENDMETHOD.

  METHOD dispatch_textpool.
    " 014 US4: read/write textpool via classic READ_TEXT_POOL / SAVE_TEXT_POOL
    " (ECC fallback path). Routes /textpool/<category>?object=<name>&type=<type>.
    " category: texts|selections|headings; object = program/class name; type = PROG|CLAS|FUGR.
    DATA(lv_path) = iv_path.
    DATA lv_category TYPE string.
    DATA lv_object   TYPE string.
    DATA lv_objtype  TYPE string.

    FIND REGEX '^/textpool/(texts|selections|headings)' IN lv_path IGNORING CASE
      SUBMATCHES DATA(lt_cat).
    IF sy-subrc <> 0 OR lines( lt_cat ) < 1.
      respond_error( io_server = io_server
                     iv_status = 404
                     iv_reason = 'Not Found'
                     iv_code = 'NOT_FOUND'
                     iv_msg = |unsupported textpool path: { iv_path }| ).
      RETURN.
    ENDIF.
    lv_category = to_upper( lt_cat[ 1 ] ).

    " Query params from the request URL.
    DATA(lv_query) = io_server->request->get_header_field( '~query_string' ).
    IF lv_query IS NOT INITIAL.
      FIND FIRST OCCURRENCE OF REGEX 'object=([^&]+)' IN lv_query IGNORING CASE SUBMATCHES DATA(lt_obj).
      IF sy-subrc = 0 AND lines( lt_obj ) >= 1. lv_object = to_upper( lt_obj[ 1 ] ). ENDIF.
      FIND FIRST OCCURRENCE OF REGEX 'type=([^&]+)' IN lv_query IGNORING CASE SUBMATCHES DATA(lt_type).
      IF sy-subrc = 0 AND lines( lt_type ) >= 1. lv_objtype = to_upper( lt_type[ 1 ] ). ENDIF.
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
    " READ_TEXT_POOL reads the program/class text pool; category selects the rows.
    DATA lt_pool TYPE TABLE OF textpool.
    DATA ls_pool TYPE textpool.
    DATA lv_id    TYPE c LENGTH 2.
    DATA lv_retry TYPE i.

    " Read the text pool (active state). ID filtering: texts='' (symbols use key 01..), selections='S', headings='H'.
    CALL FUNCTION 'READ_TEXT_POOL'
      EXPORTING
        program    = iv_object
        state      = 'A'
      IMPORTING
        header     = DATA(lv_hdr)
      TABLES
        pooltab    = lt_pool
      EXCEPTIONS
        object_not_found = 1
        OTHERS           = 2.
    IF sy-subrc <> 0.
      ev_payload = |{ "status": "error", "error": { "code": "TEXTPOOL_OBJECT_NOT_FOUND", "message": "{ iv_object } not found" } }|.
      RETURN.
    ENDIF.

    DATA lv_json TYPE string.
    lv_json = `[`.
    DATA lv_first TYPE abap_bool VALUE abap_true.
    LOOP AT lt_pool INTO ls_pool.
      " Category filter: texts → ID IS INITIAL; selections → ID = 'S'; headings → ID = 'H'.
      IF iv_category = 'TEXTS' AND ls_pool-id IS NOT INITIAL. CONTINUE. ENDIF.
      IF iv_category = 'SELECTIONS' AND ls_pool-id <> 'S'. CONTINUE. ENDIF.
      IF iv_category = 'HEADINGS' AND ls_pool-id <> 'H'. CONTINUE. ENDIF.
      IF lv_first = abap_true.
        lv_first = abap_false.
      ELSE.
        lv_json = lv_json && `,`.
      ENDIF.
      lv_json = lv_json && |{ "id": "{ ls_pool-key }", "text": "{ ls_pool-entry }" }|.
    ENDLOOP.
    lv_json = lv_json && `]`.

    ev_payload = |{ "status": "success", "data": { "object": "{ iv_object }", "type": "{ iv_objtype }", "category": "{ iv_category }", "elements": { lv_json } } }|.
  ENDMETHOD.

  METHOD set_textpool_elements.
    " SAVE_TEXT_POOL persists the full text pool. The body is the .properties-style
    " entries for the given category; we merge them into the existing pool.
    " (Full multi-category merge is handled here; the CLI sends one category per call.)
    DATA lt_pool TYPE TABLE OF textpool.
    DATA ls_pool TYPE textpool.
    DATA lv_id    TYPE c LENGTH 2.
    DATA lv_ok    TYPE abap_bool VALUE abap_true.

    CALL FUNCTION 'READ_TEXT_POOL'
      EXPORTING
        program    = iv_object
        state      = 'A'
      IMPORTING
        header     = DATA(lv_hdr)
      TABLES
        pooltab    = lt_pool
      EXCEPTIONS
        object_not_found = 1
        OTHERS           = 2.
    IF sy-subrc <> 0.
      ev_payload = |{ "status": "error", "error": { "code": "TEXTPOOL_OBJECT_NOT_FOUND", "message": "{ iv_object } not found" } }|.
      RETURN.
    ENDIF.

    " Remove existing rows for this category so re-push is idempotent.
    DATA(lv_keep_id) = COND #( WHEN iv_category = 'SELECTIONS' THEN 'S'
                               WHEN iv_category = 'HEADINGS'   THEN 'H'
                               ELSE '' ).
    DELETE lt_pool WHERE id = lv_keep_id.

    " Parse the posted JSON elements (array of { id, text, maxLength? }).
    " The body is a wire envelope: { "elements": [ ... ] }.
    DATA: BEGIN OF ls_body, elements TYPE TABLE OF ty_textpool_elem WITH EMPTY KEY, END OF ls_body.
    /ui2/cl_json=>deserialize( EXPORTING json = iv_body CHANGING data = ls_body ).
    LOOP AT ls_body-elements INTO DATA(ls_elem).
      ls_pool-id    = lv_keep_id.
      ls_pool-key   = ls_elem-id.
      ls_pool-entry = ls_elem-text.
      APPEND ls_pool TO lt_pool.
    ENDLOOP.

    CALL FUNCTION 'SAVE_TEXT_POOL'
      EXPORTING
        program   = iv_object
        state     = 'A'
      TABLES
        pooltab   = lt_pool
      EXCEPTIONS
        OTHERS    = 2.
    IF sy-subrc <> 0.
      ev_payload = |{ "status": "error", "error": { "code": "TEXTPOOL_WRITE_FAILED", "message": "SAVE_TEXT_POOL failed (subrc={ sy-subrc })" } }|.
      RETURN.
    ENDIF.

    DATA(lv_written) = lines( ls_body-elements ).
    ev_payload = |{ "status": "success", "data": { "object": "{ iv_object }", "type": "{ iv_objtype }", "category": "{ iv_category }", "written": { lv_written } } }|.
  ENDMETHOD.

  METHOD dispatch_ddic.
    DATA lv_type TYPE string.
    DATA lv_name TYPE string.
    FIND REGEX '^/ddic/(doma|dtel|tabl|stru)(?:/(.+))?$' IN iv_path IGNORING CASE
      SUBMATCHES DATA(lt_parts).
    IF sy-subrc <> 0 OR lines( lt_parts ) < 1.
      respond_error( io_server = io_server
                     iv_status = 404
                     iv_reason = 'Not Found'
                     iv_code = 'NOT_FOUND'
                     iv_msg = |unsupported ddic path: { iv_path }| ).
      RETURN.
    ENDIF.
    lv_type = to_upper( lt_parts[ 1 ] ).
    IF lines( lt_parts ) >= 2.
      lv_name = to_upper( lt_parts[ 2 ] ).
    ENDIF.

    DATA lv_package TYPE devclass.
    DATA lv_request TYPE trkorr.
    IF iv_method = 'POST'.
      " Extract package/transportRequest from the wire payload via static regex
      " (the per-type handlers do the full JSON deserialize for typed fields).
      FIND FIRST OCCURRENCE OF REGEX '"package"\s*:\s*"([^"]+)"' IN iv_body IGNORING CASE
        SUBMATCHES DATA(lt_pkg).
      IF sy-subrc = 0 AND lines( lt_pkg ) >= 1.
        lv_package = lt_pkg[ 1 ].
      ELSE.
        lv_package = '$TMP'.
      ENDIF.
      FIND FIRST OCCURRENCE OF REGEX '"transportRequest"\s*:\s*"([^"]+)"' IN iv_body IGNORING CASE
        SUBMATCHES DATA(lt_req).
      IF sy-subrc = 0 AND lines( lt_req ) >= 1.
        lv_request = lt_req[ 1 ].
      ENDIF.

      CASE lv_type.
        WHEN 'DOMA'.
          create_ddic_domain( EXPORTING iv_name    = lv_name
                                        iv_payload = iv_body
                                        iv_package = lv_package
                                        iv_request = lv_request
                              IMPORTING ev_payload = DATA(lv_payload) ).
        WHEN 'DTEL'.
          create_ddic_data_element( EXPORTING iv_name    = lv_name
                                            iv_payload = iv_body
                                            iv_package = lv_package
                                            iv_request = lv_request
                                  IMPORTING ev_payload = DATA(lv_payload) ).
        WHEN 'TABL'.
          create_ddic_table( EXPORTING iv_name    = lv_name
                                       iv_payload = iv_body
                                       iv_package = lv_package
                                       iv_request = lv_request
                             IMPORTING ev_payload = DATA(lv_payload) ).
        WHEN 'STRU'.
          create_ddic_structure( EXPORTING iv_name    = lv_name
                                          iv_payload = iv_body
                                          iv_package = lv_package
                                          iv_request = lv_request
                                IMPORTING ev_payload = DATA(lv_payload) ).
      ENDCASE.
      respond_raw_json( io_server = io_server
                        iv_status = 200
                        iv_reason = 'OK'
                        iv_json   = lv_payload ).
    ELSEIF iv_method = 'GET'.
      get_ddic_object( EXPORTING iv_type    = lv_type
                                 iv_name    = lv_name
                       IMPORTING ev_payload = DATA(lv_payload) ).
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
      ls_object_new-object_name = <ls_field>-field_name.
      ls_object_new-key_guid    = lv_uuid.
      ls_object_new-parent_key  = iv_parent_key.

      ls_details-fieldname = 'POSITION'. ls_details-fieldvalue = lv_position. APPEND ls_details TO ls_object_new-details.

      IF <ls_field>-key_flag = abap_true.
        ls_details-fieldname = 'KEYFLAG'. ls_details-fieldvalue = <ls_field>-key_flag. APPEND ls_details TO ls_object_new-details.
        ls_details-fieldname = 'NOTNULL'. ls_details-fieldvalue = 'X'. APPEND ls_details TO ls_object_new-details.
      ELSEIF <ls_field>-not_null = abap_true.
        ls_details-fieldname = 'NOTNULL'. ls_details-fieldvalue = <ls_field>-not_null. APPEND ls_details TO ls_object_new-details.
      ENDIF.

      IF <ls_field>-rollname IS NOT INITIAL.
        ls_details-fieldname = 'ROLLNAME'. ls_details-fieldvalue = <ls_field>-rollname. APPEND ls_details TO ls_object_new-details.
      ELSEIF <ls_field>-datatype IS NOT INITIAL.
        ls_details-fieldname = 'DATATYPE'. ls_details-fieldvalue = <ls_field>-datatype. APPEND ls_details TO ls_object_new-details.
        IF <ls_field>-leng IS NOT INITIAL.
          ls_details-fieldname = 'LENG'. ls_details-fieldvalue = <ls_field>-leng. APPEND ls_details TO ls_object_new-details.
        ENDIF.
        IF <ls_field>-decimals IS NOT INITIAL.
          ls_details-fieldname = 'DECIMALS'. ls_details-fieldvalue = <ls_field>-decimals. APPEND ls_details TO ls_object_new-details.
        ENDIF.
        IF <ls_field>-ddtext IS NOT INITIAL.
          ls_details-fieldname = 'DDTEXT'. ls_details-fieldvalue = <ls_field>-ddtext. APPEND ls_details TO ls_object_new-details.
        ENDIF.
        ls_details-fieldname = 'LANGUAGE'. ls_details-fieldvalue = sy-langu. APPEND ls_details TO ls_object_new-details.
      ENDIF.

      IF <ls_field>-ref_table IS NOT INITIAL AND <ls_field>-ref_field IS NOT INITIAL.
        ls_details-fieldname = 'REFTABLE'. ls_details-fieldvalue = <ls_field>-ref_table. APPEND ls_details TO ls_object_new-details.
        ls_details-fieldname = 'REFFIELD'. ls_details-fieldvalue = <ls_field>-ref_field. APPEND ls_details TO ls_object_new-details.
      ENDIF.
      IF <ls_field>-check_table IS NOT INITIAL.
        ls_details-fieldname = 'CHECKTABLE'. ls_details-fieldvalue = <ls_field>-check_table. APPEND ls_details TO ls_object_new-details.
      ENDIF.

      APPEND ls_object_new TO et_object_new.
    ENDLOOP.
  ENDMETHOD.

  METHOD create_ddic_table.
    DATA lt_object_new TYPE comt_gox_def_header.
    DATA lt_bapireturn TYPE bapirettab.
    DATA lt_transport  TYPE comt_gox_trans_object.
    DATA lt_fields     TYPE tt_field.

    DATA: BEGIN OF ls_attr, name TYPE string, description TYPE string, deliveryClass TYPE string,
             dataClass TYPE string, sizeCategory TYPE string, clientDependent TYPE abap_bool,
             allowMaintenance TYPE abap_bool, END OF ls_attr.
    /ui2/cl_json=>deserialize( EXPORTING json = iv_payload
                               CHANGING data = ls_attr ).
    IF ls_attr-name IS INITIAL.
      ls_attr-name = iv_name.
    ENDIF.

    DATA(lv_fields_json) = ''.
    FIND REGEX '"fields"\s*:\s*\[[^\]]*\]' IN iv_payload IGNORING CASE
      MATCH DATA(lv_fields_json).
    IF sy-subrc = 0 AND lv_fields_json IS NOT INITIAL.
      DATA: BEGIN OF ls_field_outer, fields TYPE TABLE OF ty_field WITH EMPTY KEY, END OF ls_field_outer.
      /ui2/cl_json=>deserialize( EXPORTING json = lv_fields_json
                                 CHANGING data = ls_field_outer-fields ).
      lt_fields = ls_field_outer-fields.
    ENDIF.

    IF ls_attr-clientDependent = abap_true.
      DATA ls_mandt TYPE ty_field.
      ls_mandt-field_name = 'MANDT'.
      ls_mandt-rollname   = 'MANDT'.
      ls_mandt-key_flag   = abap_true.
      ls_mandt-not_null   = abap_true.
      INSERT ls_mandt INTO lt_fields INDEX 1.
    ENDIF.

    build_table_header( EXPORTING iv_table_name    = ls_attr-name
                                  iv_description   = ls_attr-description
                                  iv_delivery_class = ls_attr-deliveryClass
                                  iv_data_class    = ls_attr-dataClass
                                  iv_size_category = ls_attr-sizeCategory
                        IMPORTING es_object_new    = DATA(ls_header_local)
                                  et_object_new    = lt_object_new
                                  et_bapireturn    = lt_bapireturn ).

    DATA lv_start TYPE i.
    lv_start = COND #( WHEN ls_attr-clientDependent = abap_true THEN 2 ELSE 1 ).

    build_field_entries( EXPORTING iv_parent_key = ls_header_local-key_guid
                                   iv_table_name = ls_attr-name
                                   it_fields     = lt_fields
                                   iv_start_pos  = lv_start
                         IMPORTING et_object_new = DATA(lt_field_entries)
                                   et_bapireturn = lt_bapireturn ).

    APPEND LINES OF lt_field_entries TO lt_object_new.

    CALL FUNCTION 'GOX_GEN_TABLE_STD'
      EXPORTING
        iv_object_name = ls_attr-name
        it_object_new  = lt_object_new
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
      ev_payload = |{ "status": "error", "error": { "code": "DDIC_CREATE_FAILED", "message": "{ lv_msg }" } }|.
      RETURN.
    ENDIF.

    ev_payload = |{ "status": "success", "data": { "name": "{ ls_attr-name }", "type": "TABL", "action": "created" } }|.
  ENDMETHOD.

  METHOD create_ddic_structure.
    DATA lt_object_new TYPE comt_gox_def_header.
    DATA lt_bapireturn TYPE bapirettab.
    DATA lt_transport  TYPE comt_gox_trans_object.
    DATA lt_fields     TYPE tt_field.

    DATA: BEGIN OF ls_attr, name TYPE string, description TYPE string, END OF ls_attr.
    /ui2/cl_json=>deserialize( EXPORTING json = iv_payload CHANGING data = ls_attr ).
    IF ls_attr-name IS INITIAL.
      ls_attr-name = iv_name.
    ENDIF.

    DATA(lv_fields_json) = ''.
    FIND REGEX '"fields"\s*:\s*\[[^\]]*\]' IN iv_payload IGNORING CASE
      MATCH DATA(lv_fields_json).
    IF sy-subrc = 0 AND lv_fields_json IS NOT INITIAL.
      DATA: BEGIN OF ls_field_outer, fields TYPE TABLE OF ty_field WITH EMPTY KEY, END OF ls_field_outer.
      /ui2/cl_json=>deserialize( EXPORTING json = lv_fields_json
                                 CHANGING data = ls_field_outer-fields ).
      lt_fields = ls_field_outer-fields.
    ENDIF.

    build_table_header( EXPORTING iv_table_name    = ls_attr-name
                                  iv_description   = ls_attr-description
                                  iv_tabclass      = 'INTTAB'
                                  iv_delivery_class = 'A'
                                  iv_data_class    = 'APPL0'
                                  iv_size_category = '0'
                                  iv_exclass       = '3'
                        IMPORTING es_object_new    = DATA(ls_header_local)
                                  et_object_new    = lt_object_new
                                  et_bapireturn    = lt_bapireturn ).
    build_field_entries( EXPORTING iv_parent_key = ls_header_local-key_guid
                                   iv_table_name = ls_attr-name
                                   it_fields     = lt_fields
                         IMPORTING et_object_new = DATA(lt_field_entries)
                                   et_bapireturn = lt_bapireturn ).
    APPEND LINES OF lt_field_entries TO lt_object_new.

    CALL FUNCTION 'GOX_GEN_TABLE_STD'
      EXPORTING
        iv_object_name = ls_attr-name
        it_object_new  = lt_object_new
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
      ev_payload = |{ "status": "error", "error": { "code": "DDIC_CREATE_FAILED", "message": "{ lv_msg }" } }|.
      RETURN.
    ENDIF.
    ev_payload = |{ "status": "success", "data": { "name": "{ ls_attr-name }", "type": "STRU", "action": "created" } }|.
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
        iv_object_name = ls_attr-name
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
      ev_payload = |{ "status": "error", "error": { "code": "DDIC_CREATE_FAILED", "message": "{ lv_msg }" } }|.
      RETURN.
    ENDIF.
    ev_payload = |{ "status": "success", "data": { "name": "{ ls_attr-name }", "type": "DTEL", "action": "created" } }|.
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
        iv_object_name = ls_attr-name
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
      ev_payload = |{ "status": "error", "error": { "code": "DDIC_CREATE_FAILED", "message": "{ lv_msg }" } }|.
      RETURN.
    ENDIF.
    ev_payload = |{ "status": "success", "data": { "name": "{ ls_attr-name }", "type": "DOMA", "action": "created" } }|.
  ENDMETHOD.

  METHOD get_ddic_object.
    " US3: pull a DDIC object definition and return the wire JSON (mirrors the
    " create payload so round-trip is consistent). Object missing → DDIC_OBJECT_NOT_FOUND.
    CASE iv_type.
      WHEN 'DOMA'.
        DATA ls_doma TYPE dd01v.
        CALL FUNCTION 'DDIF_DOMA_GET'
          EXPORTING
            name      = iv_name
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
        ev_payload = |{ "status": "success", "data": { "name": "{ iv_name }", "type": "DOMA", "description": "{ ls_doma-ddtext }", "dataType": "{ ls_doma-datatype }", "length": { ls_doma-leng }, "decimals": { ls_doma-decimals }, "signFlag": { ls_doma-signflag }, "lowercase": { ls_doma-lowercase }, "convExit": "{ ls_doma-convexit }" } } }|.
      WHEN 'DTEL'.
        DATA ls_dtel TYPE dd04v.
        CALL FUNCTION 'DDIF_DTEL_GET'
          EXPORTING
            name     = iv_name
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
        ev_payload = |{ "status": "success", "data": { "name": "{ iv_name }", "type": "DTEL", "description": "{ ls_dtel-ddtext }", "domain": "{ ls_dtel-domname }", "dataType": "{ ls_dtel-datatype }", "length": { ls_dtel-leng }, "decimals": { ls_dtel-decimals }, "shortText": "{ ls_dtel-scrtext_s }", "mediumText": "{ ls_dtel-scrtext_m }", "longText": "{ ls_dtel-scrtext_l }", "headerText": "{ ls_dtel-reptext }" } } }|.
      WHEN 'TABL'.
        " DDIF_TABL_GET reads both transparent tables and structures; the
        " tabclass in dd02v distinguishes them.
        DATA ls_tabl TYPE dd02v.
        DATA ls_tabl09 TYPE dd09l.
        DATA lt_tabl03 TYPE TABLE OF dd03p.
        CALL FUNCTION 'DDIF_TABL_GET'
          EXPORTING
            name     = iv_name
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
        LOOP AT lt_tabl03 INTO DATA(ls_field).
          IF lv_first = abap_true.
            lv_first = abap_false.
          ELSE.
            lv_fields = lv_fields && `,`.
          ENDIF.
          lv_fields = lv_fields
            && |{ "fieldName": "{ ls_field-fieldname }", "rollname": "{ ls_field-rollname }", "dataType": "{ ls_field-datatype }", "length": { ls_field-leng }, "decimals": { ls_field-decimals }, "keyFlag": { ls_field-keyflag }, "notNull": { ls_field-notnull } }|.
        ENDLOOP.
        lv_fields = lv_fields && `]`.
        ev_payload = |{ "status": "success", "data": { "name": "{ iv_name }", "type": "{ iv_type }", "description": "{ ls_tabl-ddtext }", "deliveryClass": "{ ls_tabl-contflag }", "dataClass": "{ ls_tabl09-tabart }", "sizeCategory": "{ ls_tabl09-tabkat }", "clientDependent": true, "fields": { lv_fields } } }|.
      WHEN 'STRU'.
        " Structure read via DDIF_TABL_GET (tabclass INTTAB), same shape as TABL.
        DATA ls_stru TYPE dd02v.
        DATA lt_stru03 TYPE TABLE OF dd03p.
        CALL FUNCTION 'DDIF_TABL_GET'
          EXPORTING
            name     = iv_name
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
        LOOP AT lt_stru03 INTO DATA(ls_field2).
          IF lv_first2 = abap_true.
            lv_first2 = abap_false.
          ELSE.
            lv_fields2 = lv_fields2 && `,`.
          ENDIF.
          lv_fields2 = lv_fields2
            && |{ "fieldName": "{ ls_field2-fieldname }", "rollname": "{ ls_field2-rollname }", "dataType": "{ ls_field2-datatype }", "length": { ls_field2-leng }, "decimals": { ls_field2-decimals }, "keyFlag": { ls_field2-keyflag } }|.
        ENDLOOP.
        lv_fields2 = lv_fields2 && `]`.
        ev_payload = |{ "status": "success", "data": { "name": "{ iv_name }", "type": "STRU", "description": "{ ls_stru-ddtext }", "fields": { lv_fields2 } } }|.
      WHEN OTHERS.
        ev_payload = |{ "status": "error", "error": { "code": "DDIC_NOT_SUPPORTED", "message": "unsupported DDIC type { iv_type }" } }|.
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
