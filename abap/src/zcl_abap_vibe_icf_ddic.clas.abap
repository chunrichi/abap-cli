CLASS zcl_abap_vibe_icf_ddic DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.

    " ----- DDIC + textpool dispatchers (inlined per user adjustment) -----
    CLASS-METHODS dispatch_ddic
      IMPORTING io_server   TYPE REF TO if_http_server
                iv_path     TYPE string
                iv_method   TYPE string
                iv_body     TYPE string.
  PRIVATE SECTION.

    CLASS-METHODS get_uuid
      RETURNING VALUE(rv_uuid) TYPE sysuuid-c.

    CLASS-METHODS build_table_header
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

    CLASS-METHODS build_field_entries
      IMPORTING iv_parent_key TYPE comt_gox_key_guid
                iv_table_name TYPE tabname
                it_fields     TYPE zcl_abap_vibe_icf_types=>tt_field
                iv_start_pos  TYPE i DEFAULT 1
      EXPORTING et_object_new TYPE comt_gox_def_header
                et_bapireturn TYPE bapirettab.
    " TABT writeback - apply buffering/storageType/loadUnit/logChanges/translation
    " to an existing TABL via DDIF_TABL_GET + DDIF_TABL_PUT. The wire payload
    " nested `is_settings-general_information-*` paths; this type keeps them flat.
    CLASS-METHODS apply_ddic_table_settings
      IMPORTING iv_name     TYPE tabname
                iv_payload  TYPE string
                is_settings TYPE zcl_abap_vibe_icf_types=>ty_ddic_table_settings
      EXPORTING ev_error    TYPE zcl_abap_vibe_icf_types=>ty_error.

    CLASS-METHODS create_ddic_table
      IMPORTING iv_name    TYPE tabname
                iv_payload TYPE string
                iv_package TYPE devclass
                iv_request TYPE trkorr
      EXPORTING es_payload TYPE zcl_abap_vibe_icf_types=>ty_ddic_create
                ev_error   TYPE zcl_abap_vibe_icf_types=>ty_error.

    CLASS-METHODS create_ddic_structure
      IMPORTING iv_name    TYPE tabname
                iv_payload TYPE string
                iv_package TYPE devclass
                iv_request TYPE trkorr
      EXPORTING es_payload TYPE zcl_abap_vibe_icf_types=>ty_ddic_create
                ev_error   TYPE zcl_abap_vibe_icf_types=>ty_error.

    CLASS-METHODS create_ddic_data_element
      IMPORTING iv_name    TYPE rollname
                iv_payload TYPE string
                iv_package TYPE devclass
                iv_request TYPE trkorr
      EXPORTING es_payload TYPE zcl_abap_vibe_icf_types=>ty_ddic_create
                ev_error   TYPE zcl_abap_vibe_icf_types=>ty_error.

    CLASS-METHODS create_ddic_domain
      IMPORTING iv_name    TYPE domname
                iv_payload TYPE string
                iv_package TYPE devclass
                iv_request TYPE trkorr
      EXPORTING es_payload TYPE zcl_abap_vibe_icf_types=>ty_ddic_create
                ev_error   TYPE zcl_abap_vibe_icf_types=>ty_error.

    CLASS-METHODS create_ddic_enqu
      IMPORTING iv_name    TYPE viewname
                iv_payload TYPE string
                iv_package TYPE devclass
                iv_request TYPE trkorr
      EXPORTING es_payload TYPE zcl_abap_vibe_icf_types=>ty_ddic_create
                ev_error   TYPE zcl_abap_vibe_icf_types=>ty_error.

    CLASS-METHODS language_key_from_code
      IMPORTING iv_code       TYPE string
      RETURNING VALUE(rv_key) TYPE sy-langu.

    CLASS-METHODS enqmode_from_lock_mode
      IMPORTING iv_lock_mode      TYPE string
      RETURNING VALUE(rv_enqmode) TYPE dd27p-enqmode.

    CLASS-METHODS create_ddic_nrob
      IMPORTING iv_name    TYPE nrobj
                iv_payload TYPE string
                iv_package TYPE devclass
                iv_request TYPE trkorr
      EXPORTING es_payload TYPE zcl_abap_vibe_icf_types=>ty_ddic_create
                ev_error   TYPE zcl_abap_vibe_icf_types=>ty_error.

    CLASS-METHODS get_ddic_object
      IMPORTING iv_type    TYPE string
                iv_name    TYPE string
      EXPORTING es_payload TYPE REF TO data
                ev_error   TYPE zcl_abap_vibe_icf_types=>ty_error.

    " ICF fallback writes for the two types ECC EHP5/6 cannot serve via ADT.
    CLASS-METHODS write_ddic_table_type
      IMPORTING iv_name    TYPE ttypename
                iv_payload TYPE string
                iv_package TYPE devclass
                iv_request TYPE trkorr
      EXPORTING es_payload TYPE zcl_abap_vibe_icf_types=>ty_ddic_create
                ev_error   TYPE zcl_abap_vibe_icf_types=>ty_error.

    CLASS-METHODS write_ddic_message_class
      IMPORTING iv_name    TYPE arbgb
                iv_payload TYPE string
                iv_package TYPE devclass
                iv_request TYPE trkorr
      EXPORTING es_payload TYPE zcl_abap_vibe_icf_types=>ty_ddic_create
                ev_error   TYPE zcl_abap_vibe_icf_types=>ty_error.

    " DDIC long text (SAPscript documentation) for DOMA/DTEL, exposed as
    " /ddic/<type>/<name>/docu. AFF docu-v1 is language-less, so reads/writes
    " target the object's TADIR master language.
    CLASS-METHODS read_ddic_docu
      IMPORTING iv_type    TYPE string
                iv_name    TYPE string
      EXPORTING es_payload TYPE REF TO data
                ev_error   TYPE zcl_abap_vibe_icf_types=>ty_error.

    CLASS-METHODS write_ddic_docu
      IMPORTING iv_type    TYPE string
                iv_name    TYPE string
                iv_payload TYPE string
      EXPORTING es_payload TYPE zcl_abap_vibe_icf_types=>ty_docu_write
                ev_error   TYPE zcl_abap_vibe_icf_types=>ty_error.

    " Resolve the SAPscript identity of a DDIC object's documentation:
    " DOMA -> (ID 'DO', TYP 'T'), DTEL -> (ID 'DE', TYP 'E'), plus the
    " object's TADIR master language (fallback: logon language).
    CLASS-METHODS docu_spec
      IMPORTING iv_type     TYPE string
                iv_name     TYPE string
      EXPORTING ev_id       TYPE dokhl-id
                ev_typ      TYPE dokhl-typ
                ev_language TYPE dokhl-langu.

    CLASS-METHODS docu_message
      RETURNING VALUE(rv_text) TYPE string.

    " VIEW (database view) — local-extension AFF document persisted via
    " DDIF_VIEW_*. Deletion goes through RS_DD_DELETE_OBJ (ICF-safe, $TMP only).
    CLASS-METHODS create_ddic_view
      IMPORTING iv_name    TYPE viewname
                iv_payload TYPE string
                iv_package TYPE devclass
                iv_request TYPE trkorr
      EXPORTING es_payload TYPE zcl_abap_vibe_icf_types=>ty_ddic_create
                ev_error   TYPE zcl_abap_vibe_icf_types=>ty_error.

    CLASS-METHODS delete_ddic_object
      IMPORTING iv_type    TYPE string
                iv_name    TYPE string
      EXPORTING es_payload TYPE zcl_abap_vibe_icf_types=>ty_ddic_delete
                ev_error   TYPE zcl_abap_vibe_icf_types=>ty_error.

    CLASS-METHODS last_message
      RETURNING VALUE(rv_message) TYPE string.

    CLASS-METHODS language_code_from_key
      IMPORTING iv_key         TYPE sy-langu
      RETURNING VALUE(rv_code) TYPE string.

    CLASS-METHODS view_class_to_wire
      IMPORTING iv_class        TYPE dd25v-viewclass
      RETURNING VALUE(rv_class) TYPE string.

    CLASS-METHODS view_class_from_wire
      IMPORTING iv_class        TYPE string
      RETURNING VALUE(rv_class) TYPE dd25v-viewclass.
ENDCLASS.

CLASS zcl_abap_vibe_icf_ddic IMPLEMENTATION.
  METHOD dispatch_ddic.
    DATA lv_type TYPE string.
    DATA lv_name TYPE string.
    DATA lv_match_type TYPE string.
    DATA lv_match_name TYPE string.
    DATA lv_pkg TYPE string.
    DATA lv_req TYPE string.

    " Documentation companion route: /ddic/<doma|dtel>/<name>/docu.
    DATA lv_docu_type TYPE string.
    DATA lv_docu_name TYPE string.
    FIND REGEX '^/ddic/(doma|dtel)/(.+)/docu$' IN iv_path IGNORING CASE
      SUBMATCHES lv_docu_type lv_docu_name.
    IF sy-subrc = 0.
      lv_docu_type = to_upper( lv_docu_type ).
      lv_docu_name = to_upper( lv_docu_name ).
      IF iv_method = 'GET'.
        read_ddic_docu( EXPORTING iv_type    = lv_docu_type
                                  iv_name    = lv_docu_name
                        IMPORTING es_payload = DATA(lr_docu)
                                  ev_error   = DATA(ls_docu_err) ).
        IF ls_docu_err IS NOT INITIAL.
          zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                         iv_status = 200
                         iv_reason = 'OK'
                         iv_code   = ls_docu_err-error-code
                         iv_msg    = ls_docu_err-error-message ).
        ELSE.
          DATA(ls_docu_get) = VALUE zcl_abap_vibe_icf_types=>ty_ddic_get( status = 'success'
                                                                           data   = lr_docu ).
          zcl_abap_vibe_icf_response=>respond_json( io_server = io_server iv_status = 200
                                                    iv_reason = 'OK' is_payload = ls_docu_get ).
        ENDIF.
      ELSEIF iv_method = 'POST' OR iv_method = 'PUT'.
        write_ddic_docu( EXPORTING iv_type    = lv_docu_type
                                   iv_name    = lv_docu_name
                                   iv_payload = iv_body
                         IMPORTING es_payload = DATA(ls_docu_write)
                                   ev_error   = DATA(ls_docu_write_err) ).
        IF ls_docu_write_err IS NOT INITIAL.
          zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                         iv_status = 200
                         iv_reason = 'OK'
                         iv_code   = ls_docu_write_err-error-code
                         iv_msg    = ls_docu_write_err-error-message
                         iv_details = ls_docu_write_err-error-details ).
        ELSE.
          zcl_abap_vibe_icf_response=>respond_json( io_server = io_server iv_status = 200
                                                    iv_reason = 'OK' is_payload = ls_docu_write ).
        ENDIF.
      ELSE.
        zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                       iv_status = 405
                       iv_reason = 'Method Not Allowed'
                       iv_code = 'METHOD_NOT_ALLOWED'
                       iv_msg = |{ iv_method } not supported on /ddic/{ lv_docu_type }/<name>/docu| ).
      ENDIF.
      RETURN.
    ENDIF.
    " /docu suffix on a type without documentation support.
    FIND REGEX '^/ddic/([a-z]+)/(.+)/docu$' IN iv_path IGNORING CASE
      SUBMATCHES lv_docu_type lv_docu_name.
    IF sy-subrc = 0.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code = 'DOCU_TYPE_UNSUPPORTED'
                     iv_msg = |long text is supported for DOMA and DTEL only, not { lv_docu_type }| ).
      RETURN.
    ENDIF.

    FIND REGEX '^/ddic/(doma|dtel|tabl|stru|enqu|nrob|ttyp|msag|view)(?:/(.+))?$' IN iv_path IGNORING CASE
      SUBMATCHES lv_match_type lv_match_name.
    IF sy-subrc <> 0 OR lv_match_type IS INITIAL.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
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
    " VIEW deletion: there is no ADT delete path for views, so the CLI
    " DELETEs through this ICF route. RS_DD_DELETE_OBJ is the only ICF-safe
    " delete (RS_DD_DELETE opens a confirm dynpro).
    IF iv_method = 'DELETE'.
      IF lv_type = 'VIEW'.
        delete_ddic_object( EXPORTING iv_type = lv_type
                                      iv_name = lv_name
                            IMPORTING es_payload = DATA(ls_delete_response)
                                      ev_error   = DATA(ls_delete_error) ).
        IF ls_delete_error IS NOT INITIAL.
          zcl_abap_vibe_icf_response=>respond_error( io_server  = io_server
                         iv_status  = 200
                         iv_reason  = 'OK'
                         iv_code    = ls_delete_error-error-code
                         iv_msg     = ls_delete_error-error-message
                         iv_details = ls_delete_error-error-details ).
        ELSE.
          zcl_abap_vibe_icf_response=>respond_json( io_server = io_server iv_status = 200 iv_reason = 'OK' is_payload = ls_delete_response ).
        ENDIF.
        RETURN.
      ENDIF.
    ENDIF.
    " TTYP/MSAG accept both POST (create) and PUT (update) through the
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

      DATA ls_write     TYPE zcl_abap_vibe_icf_types=>ty_ddic_create.
      DATA ls_write_err TYPE zcl_abap_vibe_icf_types=>ty_error.
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
        zcl_abap_vibe_icf_response=>respond_error( io_server  = io_server
                       iv_status  = 200
                       iv_reason  = 'OK'
                       iv_code    = ls_write_err-error-code
                       iv_msg     = ls_write_err-error-message
                       iv_details = ls_write_err-error-details ).
      ELSE.
        zcl_abap_vibe_icf_response=>respond_json( io_server = io_server iv_status = 200 iv_reason = 'OK' is_payload = ls_write ).
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

      DATA ls_create     TYPE zcl_abap_vibe_icf_types=>ty_ddic_create.
      DATA ls_create_err TYPE zcl_abap_vibe_icf_types=>ty_error.
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
          " ENQU (lock object) goes through ICF. The wire body is the
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
          " NROB (number range object) — same ICF path. Wire body is
          " the AFF JSON (interval.* + configuration.*). Persists via
          " NRIV writes. See create_ddic_nrob for the implementation.
          create_ddic_nrob( EXPORTING iv_name    = CONV nrobj( lv_name )
                                      iv_payload = iv_body
                                      iv_package = lv_package
                                      iv_request = lv_request
                            IMPORTING es_payload = ls_create
                                      ev_error   = ls_create_err ).
        WHEN 'VIEW'.
          " Database view — handcrafted view-v1 document (DD25V / DD26V /
          " DD27P / DD28J / DD28V). See create_ddic_view.
          create_ddic_view( EXPORTING iv_name    = CONV viewname( lv_name )
                                      iv_payload = iv_body
                                      iv_package = lv_package
                                      iv_request = lv_request
                            IMPORTING es_payload = ls_create
                                      ev_error   = ls_create_err ).
      ENDCASE.
      IF ls_create_err IS NOT INITIAL.
        zcl_abap_vibe_icf_response=>respond_error( io_server  = io_server
                       iv_status  = 200
                       iv_reason  = 'OK'
                       iv_code    = ls_create_err-error-code
                       iv_msg     = ls_create_err-error-message
                       iv_details = ls_create_err-error-details ).
      ELSE.
        zcl_abap_vibe_icf_response=>respond_json( io_server = io_server iv_status = 200 iv_reason = 'OK' is_payload = ls_create ).
      ENDIF.
    ELSEIF iv_method = 'GET'.
      get_ddic_object( EXPORTING iv_type    = lv_type
                                 iv_name    = lv_name
                       IMPORTING es_payload = DATA(lr_get)
                                 ev_error   = DATA(ls_get_err) ).
      IF ls_get_err IS NOT INITIAL.
        " get_ddic_object failures are single-message (not a BAPI table); no
        " details to surface, so iv_details is omitted on purpose.
        zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                       iv_status = 200
                       iv_reason = 'OK'
                       iv_code   = ls_get_err-error-code
                       iv_msg    = ls_get_err-error-message ).
      ELSE.
        DATA(ls_get_response) = VALUE zcl_abap_vibe_icf_types=>ty_ddic_get( status = 'success'
                                                    data = lr_get ).
        zcl_abap_vibe_icf_response=>respond_json( io_server = io_server iv_status = 200 iv_reason = 'OK' is_payload = ls_get_response ).
      ENDIF.
    ELSE.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 405
                     iv_reason = 'Method Not Allowed'
                     iv_code = 'METHOD_NOT_ALLOWED'
                     iv_msg = |{ iv_method } not supported on /ddic/{ lv_type }| ).
    ENDIF.
  ENDMETHOD.
  METHOD read_ddic_docu.
    CLEAR: es_payload, ev_error.
    DATA lv_id       TYPE dokhl-id.
    DATA lv_typ      TYPE dokhl-typ.
    DATA lv_language TYPE dokhl-langu.
    docu_spec( EXPORTING iv_type     = iv_type
                         iv_name     = iv_name
               IMPORTING ev_id       = lv_id
                         ev_typ      = lv_typ
                         ev_language = lv_language ).

    " DOCU_GET/DOCU_DEL/DOCU_INIT take DOKHL field types; a string actual
    " parameter is rejected at runtime (CALL_FUNCTION_CONFLICT_TYPE), so
    " convert the DDIC name into the documented parameter type first.
    DATA lv_object TYPE dokhl-object.
    lv_object = iv_name.
    DATA lt_lines TYPE tline_tab.
    DATA ls_head  TYPE thead.
    CALL FUNCTION 'DOCU_GET'
      EXPORTING
        id     = lv_id
        object = lv_object
        langu  = lv_language
        typ    = lv_typ
      IMPORTING
        head   = ls_head
      TABLES
        line   = lt_lines
      EXCEPTIONS
        no_docu_on_screen = 1
        no_docu_self_def  = 2
        no_docu_temp      = 3
        ret_code          = 4
        OTHERS            = 5.
    DATA lv_subrc TYPE syst-subrc.
    lv_subrc = sy-subrc.
    IF lv_subrc = 4.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
        error = VALUE zcl_abap_vibe_icf_types=>ty_error_body(
          code    = 'DOCU_NOT_FOUND'
          message = |No documentation for { iv_type } { iv_name } in language { lv_language }| ) ).
      RETURN.
    ELSEIF lv_subrc <> 0.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
        error = VALUE zcl_abap_vibe_icf_types=>ty_error_body(
          code    = 'DOCU_READ_FAILED'
          message = |Could not read documentation for { iv_type } { iv_name }: { docu_message( ) }| ) ).
      RETURN.
    ENDIF.

    CREATE DATA es_payload TYPE zcl_abap_vibe_icf_types=>ty_docu_read_data.
    FIELD-SYMBOLS <ls_docu_data> TYPE zcl_abap_vibe_icf_types=>ty_docu_read_data.
    ASSIGN es_payload->* TO <ls_docu_data>.
    <ls_docu_data>-name           = iv_name.
    <ls_docu_data>-type           = iv_type.
    <ls_docu_data>-language       = lv_language.
    <ls_docu_data>-format_version = '1'.
    LOOP AT lt_lines INTO DATA(ls_line).
      DATA lv_text TYPE string.
      lv_text = ls_line-tdline.
      IF strlen( lv_text ) > 72.
        lv_text = lv_text(72).
      ENDIF.
      APPEND VALUE zcl_abap_vibe_icf_types=>ty_docu_line( format = ls_line-tdformat
                                                          line   = lv_text ) TO <ls_docu_data>-lines.
    ENDLOOP.
  ENDMETHOD.

  METHOD write_ddic_docu.
    CLEAR: es_payload, ev_error.
    DATA lv_id       TYPE dokhl-id.
    DATA lv_typ      TYPE dokhl-typ.
    DATA lv_language TYPE dokhl-langu.
    docu_spec( EXPORTING iv_type     = iv_type
                         iv_name     = iv_name
               IMPORTING ev_id       = lv_id
                         ev_typ      = lv_typ
                         ev_language = lv_language ).
    DATA lv_object TYPE dokhl-object.
    lv_object = iv_name.

    DATA ls_request TYPE zcl_abap_vibe_icf_types=>ty_docu_write_request.
    TRY.
        /ui2/cl_json=>deserialize( EXPORTING json        = iv_payload
                                             pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                                   CHANGING  data        = ls_request ).
      CATCH cx_root INTO DATA(lx_json).
        ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
          error = VALUE zcl_abap_vibe_icf_types=>ty_error_body(
            code    = 'DOCU_INVALID_PAYLOAD'
            message = |invalid documentation JSON: { lx_json->get_text( ) }| ) ).
        RETURN.
    ENDTRY.

    " AFF docu-v1 bounds: format <= 2 chars, line <= 72 chars (SAP silently
    " truncates longer lines in DOKTL-DOKTEXT, which would drift a round-trip).
    DATA lv_position TYPE i.
    LOOP AT ls_request-lines INTO DATA(ls_request_line).
      ADD 1 TO lv_position.
      IF strlen( ls_request_line-format ) > 2.
        ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
          error = VALUE zcl_abap_vibe_icf_types=>ty_error_body(
            code    = 'DOCU_FORMAT_TOO_LONG'
            message = |line { lv_position }: format { ls_request_line-format } exceeds 2 characters|
            details = VALUE #( ( |format must be at most 2 characters (AFF docu-v1)| ) ) ) ).
        RETURN.
      ENDIF.
      IF strlen( ls_request_line-line ) > 72.
        ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
          error = VALUE zcl_abap_vibe_icf_types=>ty_error_body(
            code    = 'DOCU_LINE_TOO_LONG'
            message = |line { lv_position }: { strlen( ls_request_line-line ) } characters exceed the 72-character SAPscript limit|
            details = VALUE #( ( |split long text into multiple lines of at most 72 characters| ) ) ) ).
        RETURN.
      ENDIF.
    ENDLOOP.

    " Empty lines delete the documentation instead of creating an empty one
    " (DOCU_UPDATE with an empty TLINE table leaves a zero-line document).
    IF ls_request-lines IS INITIAL.
      CALL FUNCTION 'DOCU_DEL'
        EXPORTING
          id     = lv_id
          object = lv_object
          langu  = lv_language
          typ    = lv_typ
        EXCEPTIONS
          ret_code = 1
          OTHERS   = 2.
      DATA lv_del_subrc TYPE syst-subrc.
      lv_del_subrc = sy-subrc.
      IF lv_del_subrc <> 0.
        ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
          error = VALUE zcl_abap_vibe_icf_types=>ty_error_body(
            code    = 'DOCU_WRITE_FAILED'
            message = |Could not delete documentation for { iv_type } { iv_name }: { docu_message( ) }| ) ).
        RETURN.
      ENDIF.
      COMMIT WORK.
      es_payload = VALUE zcl_abap_vibe_icf_types=>ty_docu_write(
        status = 'success'
        data   = VALUE zcl_abap_vibe_icf_types=>ty_docu_write_data( name     = iv_name
                                                                    type     = 'DOCU'
                                                                    language = lv_language
                                                                    action   = 'deleted' ) ).
      RETURN.
    ENDIF.

    DATA ls_dokil TYPE dokil.
    DATA lv_found TYPE syst-subrc.
    CALL FUNCTION 'DOCU_INIT'
      EXPORTING
        id     = lv_id
        object = lv_object
        langu  = lv_language
        typ    = lv_typ
      IMPORTING
        xdokil = ls_dokil
        found  = lv_found
      EXCEPTIONS
        OTHERS = 5.
    DATA lv_init_subrc TYPE syst-subrc.
    lv_init_subrc = sy-subrc.
    IF lv_init_subrc <> 0.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
        error = VALUE zcl_abap_vibe_icf_types=>ty_error_body(
          code    = 'DOCU_WRITE_FAILED'
          message = |Could not initialise documentation for { iv_type } { iv_name }: { docu_message( ) }| ) ).
      RETURN.
    ENDIF.

    DATA ls_head TYPE thead.
    ls_head-tdobject = 'DOKU'.
    ls_head-tdname   = iv_name.
    ls_head-tdid     = lv_id.
    ls_head-tdspras  = lv_language.

    DATA lt_tline TYPE tline_tab.
    LOOP AT ls_request-lines INTO ls_request_line.
      APPEND VALUE tline( tdformat = ls_request_line-format
                          tdline   = ls_request_line-line ) TO lt_tline.
    ENDLOOP.

    CALL FUNCTION 'DOCU_UPDATE'
      EXPORTING
        head    = ls_head
        state   = 'A'
        typ     = lv_typ
        version = ls_dokil-version
      TABLES
        line    = lt_tline
      EXCEPTIONS
        OTHERS  = 5.
    DATA lv_update_subrc TYPE syst-subrc.
    lv_update_subrc = sy-subrc.
    IF lv_update_subrc <> 0.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
        error = VALUE zcl_abap_vibe_icf_types=>ty_error_body(
          code    = 'DOCU_WRITE_FAILED'
          message = |Could not write documentation for { iv_type } { iv_name }: { docu_message( ) }| ) ).
      RETURN.
    ENDIF.
    COMMIT WORK.

    es_payload = VALUE zcl_abap_vibe_icf_types=>ty_docu_write(
      status = 'success'
      data   = VALUE zcl_abap_vibe_icf_types=>ty_docu_write_data( name     = iv_name
                                                                  type     = 'DOCU'
                                                                  language = lv_language
                                                                  action   = 'saved' ) ).
  ENDMETHOD.

  METHOD docu_spec.
    CASE iv_type.
      WHEN 'DOMA'.
        ev_id  = 'DO'.
        ev_typ = 'T'.
      WHEN OTHERS.
        ev_id  = 'DE'.
        ev_typ = 'E'.
    ENDCASE.
    SELECT SINGLE masterlang FROM tadir INTO ev_language
      WHERE pgmid = 'R3TR'
        AND object = iv_type
        AND obj_name = iv_name.
    IF sy-subrc <> 0 OR ev_language IS INITIAL.
      ev_language = sy-langu.
    ENDIF.
  ENDMETHOD.

  METHOD docu_message.
    DATA lv_text TYPE string.
    IF sy-msgid IS NOT INITIAL.
      MESSAGE ID sy-msgid TYPE 'S' NUMBER sy-msgno
        WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4 INTO lv_text.
    ENDIF.
    rv_text = COND string( WHEN lv_text IS NOT INITIAL THEN lv_text
                           ELSE |subrc={ sy-subrc }| ).
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

    " TABT writeback - apply buffering/storageType/loadUnit/logChanges
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
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body(
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
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body(
                                   code = 'DDIC_FIELD_UNSUPPORTED'
                                   message = lv_error_message ) ).
      RETURN.
    ENDIF.

    " Persist the technical settings straight into the active DD09L row.
    " DDIF_TABL_PUT + DDIF_TABL_ACTIVATE cannot switch an existing table's
    " technical settings here: the PUT only stages a DD09L 'L' record, the
    " subsequent DDIF_TABL_ACTIVATE/DD_TABL_ACTIVATE returns result=8 because
    " no inactive DD02L version exists (verified on S/4HANA 8.134). Writing the
    " active record keeps SE11/DDIF_TABL_GET readbacks consistent; buffering
    " changes become effective for the table buffer on the next activation /
    " application-server restart.
    UPDATE dd09l
       SET protokoll    = ls_technical-protokoll
           bufallow     = ls_technical-bufallow
           pufferung    = ls_technical-pufferung
           schfeldanz   = ls_technical-schfeldanz
           roworcolst   = ls_technical-roworcolst
           load_unit    = ls_technical-load_unit
           uebersetz    = ls_technical-uebersetz
           as4user      = sy-uname
           as4date      = sy-datum
           as4time      = sy-uzeit
     WHERE tabname = iv_name
       AND as4local = 'A'.
    IF sy-subrc <> 0 AND sy-dbcnt = 0.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body(
                                   code = 'DDIC_SETTINGS_WRITE_FAILED'
                                   message = |Could not apply technical settings to TABL { iv_name }| ) ).
      RETURN.
    ENDIF.
    " Drop the half-written inactive DD09L record left by older builds.
    DELETE FROM dd09l WHERE tabname = iv_name AND as4local <> 'A'.
    COMMIT WORK.

  ENDMETHOD.
  METHOD create_ddic_table.
    DATA lt_object_new TYPE comt_gox_def_header.
    DATA lt_object_old TYPE comt_gox_def_header.
    DATA lt_bapireturn TYPE bapirettab.
    DATA lt_transport  TYPE comt_gox_trans_object.
    DATA lt_fields     TYPE zcl_abap_vibe_icf_types=>tt_field.
    DATA ls_mandt      TYPE zcl_abap_vibe_icf_types=>ty_field.
    DATA lv_start      TYPE i.
    DATA ls_header_local TYPE coms_gox_def_header.
    DATA lt_field_entries TYPE comt_gox_def_header.

    " AFF nested wire. CLI emits generalInformation.deliveryClass
    " etc. under the generalInformation object; the flat top-level
    " deliveryClass/dataClass/sizeCategory/clientDependent are gone.
    DATA: BEGIN OF ls_attr,
            name                  TYPE string,
            header                TYPE zcl_abap_vibe_icf_types=>ty_ddic_header,
            general_information   TYPE zcl_abap_vibe_icf_types=>ty_tabl_general_information,
            fields                TYPE zcl_abap_vibe_icf_types=>tt_field,
          END OF ls_attr.
    /ui2/cl_json=>deserialize( EXPORTING json        = iv_payload
                                         pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                               CHANGING  data        = ls_attr ).
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
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'DDIC_CREATE_FAILED'
                                                              message = lv_msg
                                                              details = lt_details ) ).
      RETURN.
    ENDIF.
      " Flush the create (GOX_GEN_TABLE_STD writes the active version) before
      " DDIF_TABL_PUT + DDIF_TABL_ACTIVATE read/write the DD09L records; without
      " the commit the activation sees the object as not yet created (rc=8).
      COMMIT WORK.

      " TABT writeback. When payload carries logChanges/translation
      " buffering/dbSpecificSettings, deserialize into a dedicated settings
      " struct (avoids nesting all TABT keys under zcl_abap_vibe_icf_types=>ty_tabl_general_information
      " which only carries create-time fields) and forward to apply_ddic_table_settings.
      IF iv_payload CS '"logChanges"'
         OR iv_payload CS '"translation"'
         OR iv_payload CS '"buffering"'
         OR iv_payload CS '"dbSpecificSettings"'.
        DATA ls_settings TYPE zcl_abap_vibe_icf_types=>ty_ddic_table_settings.
        ls_settings-log_changes          = ls_attr-general_information-log_changes.
        ls_settings-writable_by_amdp     = ls_attr-general_information-writable_by_amdp.
        ls_settings-translation          = ls_attr-general_information-translation.
        ls_settings-buffering            = ls_attr-general_information-buffering.
        ls_settings-db_specific_settings = ls_attr-general_information-db_specific_settings.
        apply_ddic_table_settings( EXPORTING iv_name     = CONV tabname( ls_attr-name )
                                             iv_payload  = iv_payload
                                             is_settings = ls_settings
                                    IMPORTING ev_error    = ev_error ).
        IF ev_error IS NOT INITIAL.
          RETURN.
        ENDIF.
      ENDIF.

    es_payload = VALUE zcl_abap_vibe_icf_types=>ty_ddic_create( status = 'success'
                                       data = VALUE zcl_abap_vibe_icf_types=>ty_ddic_create_data( name   = ls_attr-name
                                                                         type   = 'TABL'
                                                                         action = 'created' ) ).
  ENDMETHOD.
  METHOD create_ddic_structure.
    DATA lt_object_new TYPE comt_gox_def_header.
    DATA lt_object_old TYPE comt_gox_def_header.
    DATA lt_bapireturn TYPE bapirettab.
    DATA lt_transport  TYPE comt_gox_trans_object.
    DATA lt_fields     TYPE zcl_abap_vibe_icf_types=>tt_field.
    DATA ls_header_local TYPE coms_gox_def_header.
    DATA lt_field_entries TYPE comt_gox_def_header.

    " AFF nested — STRU has no deliveryClass/dataClass/sizeCategory
    " only header.description carries the description.
    DATA: BEGIN OF ls_attr,
            name   TYPE string,
            header TYPE zcl_abap_vibe_icf_types=>ty_ddic_header,
            fields TYPE zcl_abap_vibe_icf_types=>tt_field,
          END OF ls_attr.
    /ui2/cl_json=>deserialize( EXPORTING json        = iv_payload
                                         pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                               CHANGING  data        = ls_attr ).
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
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'DDIC_CREATE_FAILED'
                                                              message = lv_msg
                                                              details = lt_details ) ).
      RETURN.
    ENDIF.
    es_payload = VALUE zcl_abap_vibe_icf_types=>ty_ddic_create( status = 'success'
                                       data = VALUE zcl_abap_vibe_icf_types=>ty_ddic_create_data( name   = ls_attr-name
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

    " AFF nested — category drives which DDIC fields are populated.
    " Five categories (per dtel-v1.json):
    "   'domain'                    → DOMNAME = data_type_info.type_name
    "   'predefinedType'            → DATATYPE / LENG / DECIMALS from
    "                                 data_type_info.predefined_*
    "   'referenceToPredefinedType' → DATATYPE / REFTYPE / LENG
    "   'referenceDictionaryType'   → TATYPE / TAPR (TTYP reference)
    "   'referenceClasIntType'      → CLASSTYPE / CLSNAME / REFCLSNAME / LENG
    DATA: BEGIN OF ls_attr,
            name                  TYPE string,
            header                TYPE zcl_abap_vibe_icf_types=>ty_ddic_header,
            data_type_information TYPE zcl_abap_vibe_icf_types=>ty_dtel_data_type_info,
            short_text            TYPE string,
            medium_text           TYPE string,
            long_text             TYPE string,
            header_text           TYPE string,
          END OF ls_attr.
    /ui2/cl_json=>deserialize( EXPORTING json        = iv_payload
                                         pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                               CHANGING  data        = ls_attr ).
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
        IF ls_attr-data_type_information-predefined_type-data_type IS NOT INITIAL.
          ls_details-fieldname = 'DATATYPE'.
          ls_details-fieldvalue = ls_attr-data_type_information-predefined_type-data_type.
          APPEND ls_details TO ls_object_new-details.
        ENDIF.
        IF ls_attr-data_type_information-predefined_type-length > 0.
          ls_details-fieldname = 'LENG'.
          ls_details-fieldvalue = |{ ls_attr-data_type_information-predefined_type-length }|.
          APPEND ls_details TO ls_object_new-details.
        ENDIF.
        IF ls_attr-data_type_information-predefined_type-decimals > 0.
          ls_details-fieldname = 'DECIMALS'.
          ls_details-fieldvalue = |{ ls_attr-data_type_information-predefined_type-decimals }|.
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
      WHEN OTHERS.
        ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                   error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'DTEL_CATEGORY_UNSUPPORTED'
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
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'DDIC_CREATE_FAILED'
                                                              message = lv_msg
                                                              details = lt_details ) ).
      RETURN.
    ENDIF.
    es_payload = VALUE zcl_abap_vibe_icf_types=>ty_ddic_create( status = 'success'
                                       data = VALUE zcl_abap_vibe_icf_types=>ty_ddic_create_data( name   = ls_attr-name
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

    " AFF nested — dataType/length/decimals/signFlag/lowercase
    " convExit all live under format.*. signFlag is a wire string ('X' / '');
    " any non-empty value is treated as 'X' for back-compat with hand-crafted
    " boolean true values.
    DATA: BEGIN OF ls_attr,
            name                   TYPE string,
            header                 TYPE zcl_abap_vibe_icf_types=>ty_ddic_header,
            format                 TYPE zcl_abap_vibe_icf_types=>ty_doma_format,
            output_characteristics TYPE zcl_abap_vibe_icf_types=>ty_doma_output,
            fixed_values           TYPE zcl_abap_vibe_icf_types=>tt_doma_fixed_value,
          END OF ls_attr.
    /ui2/cl_json=>deserialize( EXPORTING json        = iv_payload
                                         pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                               CHANGING  data        = ls_attr ).
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
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'DDIC_CREATE_FAILED'
                                                              message = lv_msg
                                                              details = lt_details ) ).
      RETURN.
    ENDIF.
    es_payload = VALUE zcl_abap_vibe_icf_types=>ty_ddic_create( status = 'success'
                                       data = VALUE zcl_abap_vibe_icf_types=>ty_ddic_create_data( name   = ls_attr-name
                                                                         type   = 'DOMA'
                                                                         action = 'created' ) ).
  ENDMETHOD.
  METHOD create_ddic_enqu.
    " ENQU create. The CLI posts the AFF enqu-v1 document (camelCase) plus
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
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
        error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code    = 'INVALID_ARGUMENT'
                                     message = 'lock object name is required (send it as "name" or in the URL)' ) ).
      RETURN.
    ENDIF.
    IF lv_root IS INITIAL.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
        error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code    = 'INVALID_ARGUMENT'
                                     message = 'primaryTable.name is required' ) ).
      RETURN.
    ENDIF.
    IF lv_package <> '$TMP'.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
        error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code    = 'ENQU_PACKAGE_NOT_SUPPORTED'
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
        ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
          error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code    = 'INVALID_ARGUMENT'
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
        ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
          error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code    = 'INVALID_ARGUMENT'
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
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
        error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code    = 'ENQU_CREATE_FAILED'
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
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
        error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code    = 'ENQU_CREATE_FAILED'
                                     message = |DDIF_ENQU_ACTIVATE failed for { lv_name } (subrc={ sy-subrc })| ) ).
      RETURN.
    ENDIF.

    es_payload = VALUE zcl_abap_vibe_icf_types=>ty_ddic_create( status = 'success'
                                       data   = VALUE zcl_abap_vibe_icf_types=>ty_ddic_create_data( name   = lv_name
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
    " NROB (number range object) create. Persists via the canonical
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
    DATA lv_desc_len    TYPE i.

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
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
        error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code    = 'INVALID_ARGUMENT'
                                     message = 'number range object name is required' ) ).
      RETURN.
    ENDIF.
    IF ls_request-interval-number_length_domain IS INITIAL
       OR ls_request-interval-sub_type IS INITIAL
       OR ls_request-header-description IS INITIAL.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
        error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code    = 'INVALID_ARGUMENT'
                                     message = 'NROB create needs header.description, interval.numberLengthDomain and interval.subType' ) ).
      RETURN.
    ENDIF.
    IF lv_package <> '$TMP'.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
        error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code    = 'NROB_TRANSPORT_NOT_SUPPORTED'
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
    " txt is the long form (60 chars NROBJTXT), txtshort is the abbreviated
    " form (20 chars NROBJSTXT) SE11 displays in lists. Both lengths verified
    " against the data element ADT source. AFF caps description at 60 chars
    " (see schema), so the same string fits txt; txtshort is truncated safely
    " via substring to avoid a "length out of bounds" runtime on short input.
    lv_language = language_key_from_code( ls_request-header-original_language ).
    IF lv_language IS INITIAL.
      lv_language = sy-langu.
    ENDIF.
    ls_tnrot-object = lv_name.
    ls_tnrot-langu  = lv_language.
    ls_tnrot-txt    = ls_request-header-description.
    " NROBJSTXT is CHAR 20 — take up to 20 chars, never more (would dump).
    lv_desc_len = strlen( ls_request-header-description ).
    IF lv_desc_len > 20.
      ls_tnrot-txtshort = ls_request-header-description(20).
    ELSE.
      ls_tnrot-txtshort = ls_request-header-description.
    ENDIF.

    " NUMBER_RANGE_OBJECT_UPDATE in non-dialog mode loads g_tnro_act / xtnrot
    " into memory but does NOT actually MODIFY TNRO / TNROT — the dialog
    " driver (SAPMSNR2 / SAPMSNUM) does the INSERTs after the FM. In batch
    " (ICF) mode, we have to write directly. The FM is still called first so
    " its check_object validation runs against the user-supplied data; if the
    " validation fails we never touch the DB.
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
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
        error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code    = 'NROB_CREATE_FAILED'
                                     message = |NUMBER_RANGE_OBJECT_UPDATE failed for { lv_name } (subrc={ sy-subrc })| ) ).
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
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
        error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code    = 'NROB_CREATE_FAILED'
                                     message = lv_msg
                                     details = lt_details ) ).
      RETURN.
    ENDIF.

    " Validation passed — now INSERT directly. NUMBER_RANGE_OBJECT_UPDATE
    " in batch (g_dialog = no) does NOT write TNRO / TNROT itself, the dialog
    " flow does. On this system the FM returned returncode=space but no row
    " appeared in TNRO (verified 2026-09-17: count(TNRO where object='ZNR_*')
    " stayed at 0 after the FM said success). So we INSERT here.
    INSERT tnro FROM ls_tnro.
    IF sy-subrc <> 0.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
        error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code    = 'NROB_INSERT_FAILED'
                                     message = |INSERT tnro failed for { lv_name } (subrc={ sy-subrc })| ) ).
      ROLLBACK WORK.
      RETURN.
    ENDIF.
    INSERT tnrot FROM ls_tnrot.
    IF sy-subrc <> 0.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
        error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code    = 'NROB_INSERT_FAILED'
                                     message = |INSERT tnrot failed for { lv_name } (subrc={ sy-subrc })| ) ).
      ROLLBACK WORK.
      RETURN.
    ENDIF.
    COMMIT WORK AND WAIT.

    es_payload = VALUE zcl_abap_vibe_icf_types=>ty_ddic_create( status = 'success'
                                       data   = VALUE zcl_abap_vibe_icf_types=>ty_ddic_create_data( name   = lv_name
                                                                           type   = 'NROB'
                                                                           action = 'created' ) ).
  ENDMETHOD.
  METHOD get_ddic_object.
    " Pull a DDIC object definition and return the wire JSON (mirrors the
    " create payload so round-trip is consistent). Object missing → DDIC_OBJECT_NOT_FOUND.
    " Typed field-symbols: es_payload is REF TO data, so component access on
    " the dereferenced object needs a static structure type.
    FIELD-SYMBOLS <ls_doma_payload> TYPE zcl_abap_vibe_icf_types=>ty_ddic_get_doma_data.
    FIELD-SYMBOLS <ls_dtel_payload> TYPE zcl_abap_vibe_icf_types=>ty_ddic_get_dtel_data.
    FIELD-SYMBOLS <ls_view_payload> TYPE zcl_abap_vibe_icf_types=>ty_view_data.
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
          ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                     error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'DDIC_OBJECT_NOT_FOUND'
                                                                  message = |DOMA { iv_name } not found| ) ).
          RETURN.
        ENDIF.
        CREATE DATA es_payload TYPE zcl_abap_vibe_icf_types=>ty_ddic_get_doma_data.
        ASSIGN es_payload->* TO <ls_doma_payload>.
        " read-side returns AFF nested wire so CLI `wireToLocal` can
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
          ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                     error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'DDIC_OBJECT_NOT_FOUND'
                                                                  message = |DTEL { iv_name } not found| ) ).
          RETURN.
        ENDIF.
        CREATE DATA es_payload TYPE zcl_abap_vibe_icf_types=>ty_ddic_get_dtel_data.
        ASSIGN es_payload->* TO <ls_dtel_payload>.
        " read-side returns AFF nested wire so CLI `wireToLocal` can
        " populate `dataTypeInformation.{category,typeName,...}`. Pick category
        " from DD04L-DOMNAME: DOMNAME set → 'domain', else 'predefinedType'.
        <ls_dtel_payload>-name        = iv_name.
        <ls_dtel_payload>-type        = 'DTEL'.
        <ls_dtel_payload>-description = ls_dtel-ddtext.
        IF ls_dtel-domname IS NOT INITIAL.
          <ls_dtel_payload>-data_type_information-category  = 'domain'.
          <ls_dtel_payload>-data_type_information-type_name = ls_dtel-domname.
        ELSE.
          <ls_dtel_payload>-data_type_information-category = 'predefinedType'.
          <ls_dtel_payload>-data_type_information-predefined_type-data_type = ls_dtel-datatype.
          <ls_dtel_payload>-data_type_information-predefined_type-length    = ls_dtel-leng.
          <ls_dtel_payload>-data_type_information-predefined_type-decimals  = ls_dtel-decimals.
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
          ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                     error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = COND string( WHEN ls_tabl_artifact-error_code IS INITIAL
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
          ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                     error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = COND string( WHEN ls_stru_artifact-error_code IS INITIAL
                                                                                      THEN 'DDIC_OBJECT_NOT_FOUND'
                                                                                      ELSE ls_stru_artifact-error_code )
                                                                  message = ls_stru_artifact-error_message ) ).
          RETURN.
        ENDIF.
        CREATE DATA es_payload TYPE zcl_abap_vibe_tabl_format=>ty_result.
        ASSIGN es_payload->* TO FIELD-SYMBOL(<ls_stru_payload>).
        <ls_stru_payload> = ls_stru_artifact.
      WHEN 'TTYP'.
        " ECC EHP5/6 has no ADT tabletypes endpoint — this is the fallback.
        DATA(ls_ttyp_artifact) = zcl_abap_vibe_ttyp_format=>generate(
          iv_name        = CONV ttypename( iv_name )
          iv_object_type = 'TTYP' ).
        IF ls_ttyp_artifact-success = abap_false.
          ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                     error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = COND string( WHEN ls_ttyp_artifact-error_code IS INITIAL
                                                                                      THEN 'DDIC_OBJECT_NOT_FOUND'
                                                                                      ELSE ls_ttyp_artifact-error_code )
                                                                  message = ls_ttyp_artifact-error_message ) ).
          RETURN.
        ENDIF.
        CREATE DATA es_payload TYPE zcl_abap_vibe_ttyp_format=>ty_result.
        ASSIGN es_payload->* TO FIELD-SYMBOL(<ls_ttyp_payload>).
        <ls_ttyp_payload> = ls_ttyp_artifact.
      WHEN 'MSAG'.
        " ECC EHP5/6 has no ADT messageclass endpoint — this is the fallback.
        DATA(ls_msag_artifact) = zcl_abap_vibe_msag_format=>generate( iv_name = CONV arbgb( iv_name ) ).
        IF ls_msag_artifact-success = abap_false.
          ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                     error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = COND string( WHEN ls_msag_artifact-error_code IS INITIAL
                                                                                      THEN 'DDIC_OBJECT_NOT_FOUND'
                                                                                      ELSE ls_msag_artifact-error_code )
                                                                  message = ls_msag_artifact-error_message ) ).
          RETURN.
        ENDIF.
        CREATE DATA es_payload TYPE zcl_abap_vibe_msag_format=>ty_result.
        ASSIGN es_payload->* TO FIELD-SYMBOL(<ls_msag_payload>).
        <ls_msag_payload> = ls_msag_artifact.
      WHEN 'ENQU'.
        " ENQU (lock object). The CLI's wire shape is the AFF JSON
        " document (formats/enqu/json.ts). Read via DDIF_ENQU_GET and
        " serialize to the same shape so the CLI round-trips lossless.
        DATA(ls_enqu_artifact) = zcl_abap_vibe_enqu_format=>generate( iv_name = CONV viewname( iv_name ) ).
        IF ls_enqu_artifact-success = abap_false.
          ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                     error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = COND string( WHEN ls_enqu_artifact-error_code IS INITIAL
                                                                                      THEN 'DDIC_OBJECT_NOT_FOUND'
                                                                                      ELSE ls_enqu_artifact-error_code )
                                                                  message = ls_enqu_artifact-error_message ) ).
          RETURN.
        ENDIF.
        CREATE DATA es_payload TYPE zcl_abap_vibe_enqu_format=>ty_result.
        ASSIGN es_payload->* TO FIELD-SYMBOL(<ls_enqu_payload>).
        <ls_enqu_payload> = ls_enqu_artifact.
      WHEN 'NROB'.
        " NROB (number range object). Read NRIV and serialise to the
        " AFF JSON document the CLI expects (interval.* + configuration.*).
        DATA(ls_nrob_artifact) = zcl_abap_vibe_nrob_format=>generate( iv_name = CONV nrobj( iv_name ) ).
        IF ls_nrob_artifact-success = abap_false.
          ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                     error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = COND string( WHEN ls_nrob_artifact-error_code IS INITIAL
                                                                                      THEN 'DDIC_OBJECT_NOT_FOUND'
                                                                                      ELSE ls_nrob_artifact-error_code )
                                                                  message = ls_nrob_artifact-error_message ) ).
          RETURN.
        ENDIF.
        CREATE DATA es_payload TYPE zcl_abap_vibe_nrob_format=>ty_result.
        ASSIGN es_payload->* TO FIELD-SYMBOL(<ls_nrob_payload>).
        <ls_nrob_payload> = ls_nrob_artifact.
      WHEN 'VIEW'.
        DATA lv_view_state TYPE ddgotstate.
        DATA ls_view_header TYPE dd25v.
        DATA lt_view_tables TYPE TABLE OF dd26v.
        DATA lt_view_fields TYPE TABLE OF dd27p.
        DATA lt_view_joins TYPE TABLE OF dd28j.
        DATA lt_view_selections TYPE TABLE OF dd28v.
        DATA lv_view_name TYPE ddobjname.
        DATA lv_view_package TYPE devclass.
        lv_view_name = iv_name.
        CALL FUNCTION 'DDIF_VIEW_GET'
          EXPORTING
            name     = lv_view_name
            state    = 'A'
            langu    = sy-langu
          IMPORTING
            gotstate = lv_view_state
            dd25v_wa = ls_view_header
          TABLES
            dd26v_tab = lt_view_tables
            dd27p_tab = lt_view_fields
            dd28j_tab = lt_view_joins
            dd28v_tab = lt_view_selections
          EXCEPTIONS
            illegal_input = 1
            OTHERS        = 2.
        IF sy-subrc <> 0 OR lv_view_state <> 'A' OR ls_view_header-viewname IS INITIAL.
          ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                     error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'DDIC_OBJECT_NOT_FOUND'
                                                                  message = |VIEW { iv_name } not found| ) ).
          RETURN.
        ENDIF.
        CREATE DATA es_payload TYPE zcl_abap_vibe_icf_types=>ty_view_data.
        ASSIGN es_payload->* TO <ls_view_payload>.
        <ls_view_payload>-format_version = '1'.
        <ls_view_payload>-type = 'VIEW'.
        <ls_view_payload>-name = iv_name.
        SELECT SINGLE devclass FROM tadir
          WHERE pgmid = 'R3TR' AND object = 'VIEW' AND obj_name = @iv_name
          INTO @lv_view_package.
        <ls_view_payload>-package = lv_view_package.
        <ls_view_payload>-header-description = ls_view_header-ddtext.
        <ls_view_payload>-header-original_language = language_code_from_key( ls_view_header-ddlanguage ).
        <ls_view_payload>-header-abap_language_version = 'standard'.
        <ls_view_payload>-view_class = view_class_to_wire( ls_view_header-viewclass ).
        <ls_view_payload>-root_table = ls_view_header-roottab.
        LOOP AT lt_view_tables INTO DATA(ls_view_table).
          APPEND VALUE zcl_abap_vibe_icf_types=>ty_view_table(
            table_name         = ls_view_table-tabname
            table_position     = CONV i( ls_view_table-tabpos )
            foreign_table_name = ls_view_table-fortabname
            for_field          = ls_view_table-forfield
            for_direction      = ls_view_table-fordir ) TO <ls_view_payload>-tables.
        ENDLOOP.
        LOOP AT lt_view_fields INTO DATA(ls_view_field).
          APPEND VALUE zcl_abap_vibe_icf_types=>ty_view_field(
            view_field_name      = ls_view_field-viewfield
            table_name           = ls_view_field-tabname
            field_name           = ls_view_field-fieldname
            key_flag             = boolc( ls_view_field-keyflag = 'X' )
            roll_name            = ls_view_field-rollname
            view_field_roll_name = ls_view_field-rollnamevi ) TO <ls_view_payload>-fields.
        ENDLOOP.
        LOOP AT lt_view_joins INTO DATA(ls_view_join).
          APPEND VALUE zcl_abap_vibe_icf_types=>ty_view_join(
            left_table  = ls_view_join-ltab
            left_field  = ls_view_join-lfield
            operator    = ls_view_join-operator
            right_table = ls_view_join-rtab
            right_field = ls_view_join-rfield
            source      = ls_view_join-source ) TO <ls_view_payload>-join_conditions.
        ENDLOOP.
        LOOP AT lt_view_selections INTO DATA(ls_view_selection).
          APPEND VALUE zcl_abap_vibe_icf_types=>ty_view_selection(
            field_name = ls_view_selection-fieldname
            negation   = ls_view_selection-negation
            operator   = ls_view_selection-operator
            constants  = ls_view_selection-constants
            and_or     = ls_view_selection-and_or ) TO <ls_view_payload>-selection_conditions.
        ENDLOOP.
      WHEN OTHERS.
        ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                   error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'DDIC_NOT_SUPPORTED'
                                                                message = |unsupported DDIC type { iv_type }| ) ).
    ENDCASE.
  ENDMETHOD.
  METHOD write_ddic_table_type.
    " ICF fallback write. DDIF_TTYP_PUT is the only supported API on ECC
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
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'VALIDATION_ERROR'
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
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'LOCK_FAILED'
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
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'DDIC_CREATE_FAILED'
                                                              message = |TTYP { iv_name } write failed (rc={ lv_rc })| ) ).
      RETURN.
    ENDIF.

    es_payload = VALUE zcl_abap_vibe_icf_types=>ty_ddic_create( status = 'success'
                                       data = VALUE zcl_abap_vibe_icf_types=>ty_ddic_create_data( name   = iv_name
                                                                         type   = 'TTYP'
                                                                         action = 'updated' ) ).
  ENDMETHOD.
  METHOD write_ddic_message_class.
    " ICF fallback write. A/ are plain tables; the SAP-sanctioned
    " write path is RS_CORR_INSERT for the header + direct MODIFY of.
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
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'LOCK_FAILED'
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
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'DDIC_CREATE_FAILED'
                                                              message = |MSAG { iv_name } write failed (rc={ lv_rc })| ) ).
      RETURN.
    ENDIF.

    es_payload = VALUE zcl_abap_vibe_icf_types=>ty_ddic_create( status = 'success'
                                       data = VALUE zcl_abap_vibe_icf_types=>ty_ddic_create_data( name   = iv_name
                                                                         type   = 'MSAG'
                                                                         action = 'updated' ) ).
  ENDMETHOD.
  METHOD create_ddic_view.
    " Persist a database view from the local view-v1 document, mirroring the
    " abapGit view recipe:
    "   RS_CORR_INSERT (TADIR + package/transport) →
    "   DDIF_VIEW_PUT (all four TABLES parameters must be named, even empty) →
    "   DDIF_VIEW_ACTIVATE (PUT only writes the inactive 'L' version).
    DATA ls_request TYPE zcl_abap_vibe_icf_types=>ty_view_write_request.
    DATA ls_dd25v TYPE dd25v.
    DATA lt_dd26v TYPE TABLE OF dd26v.
    DATA lt_dd27p TYPE TABLE OF dd27p.
    DATA lt_dd28j TYPE TABLE OF dd28j.
    DATA lt_dd28v TYPE TABLE OF dd28v.
    DATA ls_dd03l TYPE dd03l.
    DATA lt_table_names TYPE TABLE OF tabname.
    DATA lv_name TYPE string.
    DATA lv_view_name TYPE ddobjname.
    DATA lv_package TYPE devclass.
    DATA lv_master TYPE sy-langu.
    DATA lv_view_class TYPE dd25v-viewclass.
    DATA lv_root TYPE tabname.
    DATA lv_table TYPE tabname.
    DATA lv_field TYPE fieldname.
    DATA lv_view_field TYPE fieldname.
    DATA lv_for_table TYPE tabname.
    DATA lv_left_table TYPE tabname.
    DATA lv_left_field TYPE fieldname.
    DATA lv_right_table TYPE tabname.
    DATA lv_right_field TYPE fieldname.
    DATA lv_operator TYPE dd28j-operator.
    DATA lv_source TYPE dd28j-source.
    DATA lv_pos TYPE i.
    DATA lv_num4 TYPE n LENGTH 4.
    DATA lv_existed TYPE abap_bool.

    TRY.
        /ui2/cl_json=>deserialize( EXPORTING json        = iv_payload
                                             pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                                   CHANGING  data        = ls_request ).
      CATCH cx_root.
        ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                   error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'VIEW_INVALID_PAYLOAD'
                                                                message = 'request body is not a valid view-v1 JSON document' ) ).
        RETURN.
    ENDTRY.

    lv_name = to_upper( condense( val = iv_name del = ` ` ) ).
    IF lv_name IS INITIAL OR strlen( lv_name ) > 16 OR lv_name CS ` `.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'VIEW_NAME_INVALID'
                                              message = |view name must be a non-empty name of at most 16 characters without whitespace (got '{ lv_name }')| ) ).
      RETURN.
    ENDIF.
    IF ls_request-name IS NOT INITIAL
       AND to_upper( condense( val = ls_request-name del = ` ` ) ) <> lv_name.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'VIEW_NAME_INVALID'
                                              message = |payload name { ls_request-name } does not match URL view { lv_name }| ) ).
      RETURN.
    ENDIF.
    lv_view_name = lv_name.
    lv_package = to_upper( condense( val = ls_request-package del = ` ` ) ).
    IF lv_package IS INITIAL.
      lv_package = '$TMP'.
    ENDIF.
    lv_master = language_key_from_code( ls_request-header-original_language ).
    IF lv_master IS INITIAL.
      lv_master = sy-langu.
    ENDIF.

    IF ls_request-header-description IS INITIAL.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'VIEW_REQUIRED_FIELD'
                                              message = 'header.description is required' ) ).
      RETURN.
    ENDIF.

    lv_view_class = view_class_from_wire( ls_request-view_class ).
    IF lv_view_class IS INITIAL.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'VIEW_TYPE_INVALID'
                                              message = |unsupported viewClass '{ ls_request-view_class }'; expected databaseView, maintenanceView, helpView or projectionView| ) ).
      RETURN.
    ENDIF.
    IF lines( ls_request-tables ) = 0.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'VIEW_REQUIRED_FIELD'
                                              message = 'tables[] must contain at least the root table' ) ).
      RETURN.
    ENDIF.
    IF lines( ls_request-fields ) = 0.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'VIEW_REQUIRED_FIELD'
                                              message = 'fields[] must contain at least one view field' ) ).
      RETURN.
    ENDIF.

    " Step 1: involved tables (DD26V). The root table is tables[1]; every
    " later table points back to the root (same shape SE11 writes).
    lv_pos = 0.
    LOOP AT ls_request-tables INTO DATA(ls_view_table).
      lv_pos = lv_pos + 1.
      lv_table = to_upper( condense( val = ls_view_table-table_name del = ` ` ) ).
      IF lv_table IS INITIAL.
        ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                   error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'VIEW_REQUIRED_FIELD'
                                                message = |tables[{ lv_pos }].tableName is required| ) ).
        RETURN.
      ENDIF.
      SELECT SINGLE tabname FROM dd02l INTO @DATA(lv_found_table)
        WHERE tabname = @lv_table AND as4local = 'A'.
      IF sy-subrc <> 0.
        ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                   error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'VIEW_TABLE_NOT_FOUND'
                                                message = |table { lv_table } does not exist| ) ).
        RETURN.
      ENDIF.
      APPEND lv_table TO lt_table_names.
      IF lv_pos = 1.
        lv_root = lv_table.
        lv_for_table = lv_table.
      ELSE.
        lv_for_table = lv_root.
      ENDIF.
      lv_num4 = lv_pos.
      APPEND VALUE dd26v( ddlanguage = lv_master
                          viewname   = lv_view_name
                          tabname    = lv_table
                          tabpos     = lv_num4
                          fortabname = lv_for_table
                          forfield   = to_upper( condense( val = ls_view_table-for_field del = ` ` ) )
                          fordir     = to_upper( ls_view_table-for_direction ) ) TO lt_dd26v.
    ENDLOOP.
    IF ls_request-root_table IS NOT INITIAL
       AND to_upper( condense( val = ls_request-root_table del = ` ` ) ) <> lv_root.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'VIEW_REQUIRED_FIELD'
                                              message = |rootTable { ls_request-root_table } must equal the first tables[] entry ({ lv_root })| ) ).
      RETURN.
    ENDIF.

    " Step 2: view fields (DD27P). keyflag / rollname are derived from the
    " underlying table field so the minimal payload only needs table+field.
    lv_pos = 0.
    LOOP AT ls_request-fields INTO DATA(ls_view_field_in).
      lv_pos = lv_pos + 1.
      lv_table = to_upper( condense( val = ls_view_field_in-table_name del = ` ` ) ).
      lv_field = to_upper( condense( val = ls_view_field_in-field_name del = ` ` ) ).
      IF lv_table IS INITIAL OR lv_field IS INITIAL.
        ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                   error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'VIEW_REQUIRED_FIELD'
                                                message = |fields[{ lv_pos }].tableName and fields[{ lv_pos }].fieldName are required| ) ).
        RETURN.
      ENDIF.
      IF NOT line_exists( lt_table_names[ table_line = lv_table ] ).
        ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                   error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'VIEW_FIELD_INVALID'
                                                message = |fields[{ lv_pos }] references table { lv_table }, which is not in tables[]| ) ).
        RETURN.
      ENDIF.
      SELECT SINGLE * FROM dd03l INTO @ls_dd03l
        WHERE tabname = @lv_table AND fieldname = @lv_field AND as4local = 'A'.
      IF sy-subrc <> 0.
        ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                   error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'VIEW_FIELD_INVALID'
                                                message = |field { lv_table }-{ lv_field } does not exist| ) ).
        RETURN.
      ENDIF.
      lv_view_field = lv_field.
      IF ls_view_field_in-view_field_name IS NOT INITIAL.
        lv_view_field = to_upper( condense( val = ls_view_field_in-view_field_name del = ` ` ) ).
      ENDIF.
      lv_num4 = lv_pos.
      APPEND VALUE dd27p( viewname   = lv_view_name
                          objpos     = lv_num4
                          ddlanguage = lv_master
                          viewfield  = lv_view_field
                          tabname    = lv_table
                          fieldname  = lv_field
                          keyflag    = ls_dd03l-keyflag
                          rollname   = ls_dd03l-rollname
                          rollnamevi = ls_dd03l-rollname ) TO lt_dd27p.
    ENDLOOP.

    " Step 3: join conditions (DD28J). Inner joins only; source 'S' is what
    " SE11 writes for a database view.
    LOOP AT ls_request-join_conditions INTO DATA(ls_view_join_in).
      lv_left_table = to_upper( condense( val = ls_view_join_in-left_table del = ` ` ) ).
      lv_left_field = to_upper( condense( val = ls_view_join_in-left_field del = ` ` ) ).
      lv_right_table = to_upper( condense( val = ls_view_join_in-right_table del = ` ` ) ).
      lv_right_field = to_upper( condense( val = ls_view_join_in-right_field del = ` ` ) ).
      IF lv_left_table IS INITIAL OR lv_left_field IS INITIAL
         OR lv_right_table IS INITIAL OR lv_right_field IS INITIAL.
        ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                   error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'VIEW_REQUIRED_FIELD'
                                                message = 'joinConditions[] entries require leftTable, leftField, rightTable and rightField' ) ).
        RETURN.
      ENDIF.
      IF NOT line_exists( lt_table_names[ table_line = lv_left_table ] )
         OR NOT line_exists( lt_table_names[ table_line = lv_right_table ] ).
        ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                   error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'VIEW_FIELD_INVALID'
                                                message = |join condition { lv_left_table }-{ lv_left_field } = { lv_right_table }-{ lv_right_field } references a table that is not in tables[]| ) ).
        RETURN.
      ENDIF.
      lv_operator = to_upper( condense( val = ls_view_join_in-operator del = ` ` ) ).
      IF lv_operator IS INITIAL.
        lv_operator = 'EQ'.
      ENDIF.
      lv_source = to_upper( condense( val = ls_view_join_in-source del = ` ` ) ).
      IF lv_source IS INITIAL.
        lv_source = 'S'.
      ENDIF.
      APPEND VALUE dd28j( viewname = lv_view_name
                          ltab     = lv_left_table
                          lfield   = lv_left_field
                          operator = lv_operator
                          rtab     = lv_right_table
                          rfield   = lv_right_field
                          source   = lv_source ) TO lt_dd28j.
    ENDLOOP.

    " Step 4: selection conditions (DD28V). Database views normally have none;
    " the parameter still must be named in DDIF_VIEW_PUT.
    lv_pos = 0.
    LOOP AT ls_request-selection_conditions INTO DATA(ls_view_selection_in).
      lv_pos = lv_pos + 1.
      lv_num4 = lv_pos.
      APPEND VALUE dd28v( ddlanguage = lv_master
                          condname   = lv_view_name
                          position   = lv_num4
                          tabname    = lv_root
                          fieldname  = to_upper( condense( val = ls_view_selection_in-field_name del = ` ` ) )
                          negation   = to_upper( condense( val = ls_view_selection_in-negation del = ` ` ) )
                          operator   = to_upper( condense( val = ls_view_selection_in-operator del = ` ` ) )
                          constants  = ls_view_selection_in-constants
                          and_or     = to_upper( condense( val = ls_view_selection_in-and_or del = ` ` ) ) ) TO lt_dd28v.
    ENDLOOP.

    " Step 5: header (DD25V).
    ls_dd25v-viewname   = lv_view_name.
    ls_dd25v-ddlanguage = lv_master.
    ls_dd25v-masterlang = lv_master.
    ls_dd25v-ddtext     = ls_request-header-description.
    ls_dd25v-viewclass  = lv_view_class.
    ls_dd25v-roottab    = lv_root.
    ls_dd25v-aggtype    = 'V'.
    ls_dd25v-authclass  = '00'.
    ls_dd25v-readonly   = 'X'.
    ls_dd25v-viewgrant  = 'R'.
    ls_dd25v-as4user    = sy-uname.
    ls_dd25v-as4date    = sy-datum.
    ls_dd25v-as4time    = sy-uzeit.

    SELECT SINGLE viewname FROM dd25l INTO @DATA(lv_existing_view)
      WHERE viewname = @lv_view_name.
    lv_existed = boolc( sy-subrc = 0 ).

    " Step 6: TADIR / package / transport.
    CALL FUNCTION 'RS_CORR_INSERT'
      EXPORTING object          = lv_view_name
                object_class    = 'VIEW'
                devclass        = lv_package
                master_language = lv_master
                korrnum         = iv_request
                mode            = 'I'
                global_lock     = abap_true
                suppress_dialog = abap_true
      EXCEPTIONS cancelled           = 1
                 permission_failure  = 2
                 unknown_objectclass = 3
                 OTHERS              = 4.
    IF sy-subrc <> 0.
      DATA(lv_corr_subrc) = sy-subrc.
      DATA(lv_corr_msg) = last_message( ).
      IF lv_corr_msg IS INITIAL.
        lv_corr_msg = |RS_CORR_INSERT failed for VIEW { lv_name } (sy-subrc { lv_corr_subrc })|.
      ENDIF.
      DATA(lv_corr_code) = SWITCH string( lv_corr_subrc
        WHEN 1 THEN 'VIEW_TRANSPORT_REQUIRED'
        WHEN 2 THEN 'VIEW_NOT_AUTHORIZED'
        WHEN 3 THEN 'VIEW_PACKAGE_ASSIGN_FAILED'
        ELSE 'VIEW_PACKAGE_ASSIGN_FAILED' ).
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = lv_corr_code
                                              message = lv_corr_msg ) ).
      RETURN.
    ENDIF.

    " Step 7: write the inactive version. All four TABLES parameters are named
    " on purpose: an unnamed DD28V_TAB makes DDIF_VIEW_PUT return
    " VIEW_INCONSISTENT (rc=3) on join views.
    CALL FUNCTION 'DDIF_VIEW_PUT'
      EXPORTING name     = lv_view_name
                dd25v_wa = ls_dd25v
      TABLES    dd26v_tab = lt_dd26v
                dd27p_tab = lt_dd27p
                dd28j_tab = lt_dd28j
                dd28v_tab = lt_dd28v
      EXCEPTIONS view_not_found    = 1
                 name_inconsistent = 2
                 view_inconsistent = 3
                 put_failure       = 4
                 put_refused       = 5
                 OTHERS            = 6.
    IF sy-subrc <> 0.
      DATA(lv_put_subrc) = sy-subrc.
      DATA(lv_put_msg) = last_message( ).
      IF lv_put_msg IS INITIAL.
        lv_put_msg = |DDIF_VIEW_PUT failed for { lv_name } (sy-subrc { lv_put_subrc })|.
      ENDIF.
      DATA(lv_put_code) = SWITCH string( lv_put_subrc
        WHEN 2 THEN 'VIEW_NAME_INVALID'
        WHEN 3 THEN 'VIEW_INCONSISTENT'
        WHEN 5 THEN 'VIEW_WRITE_REFUSED'
        ELSE 'VIEW_WRITE_FAILED' ).
      " A brand-new local object that never landed has no DDIC rows yet; drop
      " the TADIR row so a retry starts clean.
      IF lv_existed = abap_false AND lv_package = '$TMP'.
        DELETE FROM tadir WHERE pgmid = 'R3TR' AND object = 'VIEW' AND obj_name = @lv_view_name.
      ENDIF.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = lv_put_code
                                              message = lv_put_msg ) ).
      RETURN.
    ENDIF.

    " Step 8: activate (DDIF_VIEW_PUT only writes the 'L' version).
    DATA lv_activation_rc TYPE sy-subrc.
    CALL FUNCTION 'DDIF_VIEW_ACTIVATE'
      EXPORTING name     = lv_view_name
                auth_chk = abap_true
      IMPORTING rc       = lv_activation_rc
      EXCEPTIONS not_found   = 1
                 put_failure = 2
                 OTHERS      = 3.
    IF sy-subrc <> 0 OR lv_activation_rc <> 0.
      DATA(lv_act_subrc) = sy-subrc.
      DATA(lv_act_msg) = last_message( ).
      IF lv_act_msg IS INITIAL.
        lv_act_msg = |DDIF_VIEW_ACTIVATE failed for { lv_name } (sy-subrc { lv_act_subrc }, rc { lv_activation_rc })|.
      ENDIF.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'VIEW_ACTIVATION_FAILED'
                                              message = lv_act_msg ) ).
      RETURN.
    ENDIF.

    es_payload = VALUE zcl_abap_vibe_icf_types=>ty_ddic_create( status = 'success'
                                       data = VALUE zcl_abap_vibe_icf_types=>ty_ddic_create_data(
                                         name   = lv_name
                                         type   = 'VIEW'
                                         action = COND string( WHEN lv_existed = abap_true THEN 'updated' ELSE 'created' ) ) ).
  ENDMETHOD.

  METHOD delete_ddic_object.
    " DELETE /ddic/view/<name> (SHLP will reuse the same shape). RS_DD_DELETE_OBJ
    " is the only ICF-safe delete path: RS_DD_DELETE opens the SAPLSPO1 confirm
    " dynpro, which cannot run in the plugin context. An inactive-only object is
    " activated first — deleting it directly raises E2 341 in plugin mode.
    DATA lv_name TYPE string.
    DATA lv_objname TYPE ddobjname.
    DATA lv_object_type TYPE string.
    DATA lv_tadir_object TYPE string.
    DATA lv_rs_dd_objtype TYPE rsedd0-ddobjtype.
    DATA lv_package TYPE devclass.
    DATA lv_object_exists TYPE abap_bool.
    DATA lv_tadir_exists TYPE abap_bool.
    DATA lv_activation_rc TYPE sy-subrc.

    lv_object_type = to_upper( iv_type ).
    lv_name = to_upper( condense( val = iv_name del = ` ` ) ).
    IF lv_name IS INITIAL OR strlen( lv_name ) > 16 OR lv_name CS ` `.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'VIEW_NAME_INVALID'
                                              message = |view name must be a non-empty name of at most 16 characters without whitespace (got '{ lv_name }')| ) ).
      RETURN.
    ENDIF.
    lv_objname = lv_name.
    lv_tadir_object = 'VIEW'.
    lv_rs_dd_objtype = 'V'.

    SELECT SINGLE viewname FROM dd25l INTO @DATA(lv_existing_view)
      WHERE viewname = @lv_objname.
    lv_object_exists = boolc( sy-subrc = 0 ).
    SELECT SINGLE devclass FROM tadir INTO @lv_package
      WHERE pgmid = 'R3TR' AND object = @lv_tadir_object AND obj_name = @lv_objname.
    lv_tadir_exists = boolc( sy-subrc = 0 ).
    IF lv_object_exists = abap_false AND lv_tadir_exists = abap_false.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'DDIC_OBJECT_NOT_FOUND'
                                              message = |VIEW { lv_name } not found| ) ).
      RETURN.
    ENDIF.
    " Removing a repository object from a transport request cannot be recorded
    " from the ICF context (no CTS dialog), so transported views stay with SE11.
    IF lv_package IS NOT INITIAL AND lv_package <> '$TMP'.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'VIEW_DELETE_UNSUPPORTED'
                                              message = |view { lv_name } is in package { lv_package }; delete it in SE11 so the deletion is recorded in a transport request| ) ).
      RETURN.
    ENDIF.

    IF lv_object_exists = abap_true.
      " Make sure an inactive 'L' version is activated before the delete; an
      " already-active view just returns rc=8 (nothing to activate).
      CALL FUNCTION 'DDIF_VIEW_ACTIVATE'
        EXPORTING name = lv_objname
        IMPORTING rc   = lv_activation_rc
        EXCEPTIONS not_found   = 1
                   put_failure = 2
                   OTHERS      = 3.
      IF sy-subrc <> 0.
        ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                   error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'VIEW_DELETE_FAILED'
                                                message = |view { lv_name } has an inactive version that could not be activated (sy-subrc { sy-subrc }); activate it in SE11 and retry| ) ).
        RETURN.
      ENDIF.
      CALL FUNCTION 'RS_DD_DELETE_OBJ'
        EXPORTING no_ask  = 'X'
                  objtype = lv_rs_dd_objtype
                  objname = lv_objname
        EXCEPTIONS not_executed         = 1
                   object_not_found     = 2
                   object_not_specified = 3
                   permission_failure   = 4
                   dialog_needed        = 5
                   OTHERS               = 6.
      IF sy-subrc <> 0.
        DATA(lv_delete_subrc) = sy-subrc.
        DATA(lv_delete_msg) = last_message( ).
        IF lv_delete_msg IS INITIAL.
          lv_delete_msg = |RS_DD_DELETE_OBJ failed for { lv_name } (sy-subrc { lv_delete_subrc })|.
        ENDIF.
        DATA(lv_delete_code) = SWITCH string( lv_delete_subrc
          WHEN 2 THEN 'DDIC_OBJECT_NOT_FOUND'
          WHEN 4 THEN 'VIEW_NOT_AUTHORIZED'
          ELSE 'VIEW_DELETE_FAILED' ).
        ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                   error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = lv_delete_code
                                                message = lv_delete_msg ) ).
        RETURN.
      ENDIF.
    ELSE.
      " TADIR row without any DDIC object (a PUT that never landed): the delete
      " FM raises E2 341 in plugin mode, so drop the local TADIR row directly —
      " the same $TMP-only cleanup the TRAN delete path uses.
      DELETE FROM tadir WHERE pgmid = 'R3TR' AND object = @lv_tadir_object AND obj_name = @lv_objname.
    ENDIF.

    es_payload = VALUE zcl_abap_vibe_icf_types=>ty_ddic_delete( status = 'success'
                                       data = VALUE zcl_abap_vibe_icf_types=>ty_ddic_delete_data(
                                         name   = lv_name
                                         type   = lv_object_type
                                         action = 'deleted' ) ).
  ENDMETHOD.

  METHOD last_message.
    " Render the T100 message left by a failed classic FM call (the FM fills
    " sy-msgid / sy-msgno / sy-msgv1..4 before raising its EXCEPTION).
    CLEAR rv_message.
    IF sy-msgid IS INITIAL OR sy-msgno IS INITIAL.
      RETURN.
    ENDIF.
    MESSAGE ID sy-msgid TYPE 'S' NUMBER sy-msgno
      WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4 INTO rv_message.
  ENDMETHOD.

  METHOD language_code_from_key.
    " SAP one-character language key -> AFF two-letter ISO code. Unknown keys
    " fall back to 'en' so a pulled document always satisfies the schema.
    CASE to_upper( iv_key ).
      WHEN 'D'. rv_code = 'de'.
      WHEN 'E'. rv_code = 'en'.
      WHEN '1'. rv_code = 'zh'.
      WHEN 'F'. rv_code = 'fr'.
      WHEN 'S'. rv_code = 'es'.
      WHEN OTHERS. rv_code = 'en'.
    ENDCASE.
  ENDMETHOD.

  METHOD view_class_to_wire.
    CASE to_upper( iv_class ).
      WHEN 'D'. rv_class = 'databaseView'.
      WHEN 'C'. rv_class = 'maintenanceView'.
      WHEN 'H'. rv_class = 'helpView'.
      WHEN 'P'. rv_class = 'projectionView'.
      WHEN OTHERS. rv_class = iv_class.
    ENDCASE.
  ENDMETHOD.

  METHOD view_class_from_wire.
    CASE to_lower( iv_class ).
      WHEN 'databaseview'. rv_class = 'D'.
      WHEN 'maintenanceview'. rv_class = 'C'.
      WHEN 'helpview'. rv_class = 'H'.
      WHEN 'projectionview'. rv_class = 'P'.
      WHEN OTHERS.
        CASE to_upper( iv_class ).
          WHEN 'D'. rv_class = 'D'.
          WHEN 'C'. rv_class = 'C'.
          WHEN 'H'. rv_class = 'H'.
          WHEN 'P'. rv_class = 'P'.
        ENDCASE.
    ENDCASE.
  ENDMETHOD.

ENDCLASS.
