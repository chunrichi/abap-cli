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
ENDCLASS.

CLASS zcl_abap_vibe_icf_ddic IMPLEMENTATION.
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
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body(
                                   code = 'DDIC_SETTINGS_WRITE_FAILED'
                                   message = |Could not apply technical settings to TABL { iv_name }| ) ).
    ENDIF.

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
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'DDIC_CREATE_FAILED'
                                                              message = lv_msg
                                                              details = lt_details ) ).
      RETURN.
    ENDIF.
      " TABT writeback. When payload carries logChanges/translation
      " buffering/dbSpecificSettings, deserialize into a dedicated settings
      " struct (avoids nesting all TABT keys under zcl_abap_vibe_icf_types=>ty_tabl_general_information
      " which only carries create-time fields) and forward to apply_ddic_table_settings.
      IF iv_payload CS '"logChanges"'
         OR iv_payload CS '"translation"'
         OR iv_payload CS '"buffering"'
         OR iv_payload CS '"dbSpecificSettings"'.
        DATA ls_settings TYPE zcl_abap_vibe_icf_types=>ty_ddic_table_settings.
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
ENDCLASS.
