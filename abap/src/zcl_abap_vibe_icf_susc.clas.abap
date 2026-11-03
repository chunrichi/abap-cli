CLASS zcl_abap_vibe_icf_susc DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    " TOBC-OCLSS is CHAR 4.
    CONSTANTS gc_name_max_length TYPE i VALUE 4.

    CLASS-METHODS dispatch
      IMPORTING io_server TYPE REF TO if_http_server
                iv_path   TYPE string
                iv_method TYPE string
                iv_body   TYPE string.

  PRIVATE SECTION.
    " ----- authorization object class document (local <token>.susc.json) -----
    TYPES:
      BEGIN OF ty_header,
        description       TYPE string,
        original_language TYPE string,
      END OF ty_header,
      BEGIN OF ty_document,
        format_version TYPE string,
        header         TYPE ty_header,
      END OF ty_document,
      BEGIN OF ty_document_data,
        format_version TYPE string,
        header         TYPE ty_header,
        name           TYPE string,
        package        TYPE devclass,
      END OF ty_document_data,
      BEGIN OF ty_get_response,
        status TYPE string,
        data   TYPE ty_document_data,
      END OF ty_get_response.

    " ----- /auth/susc/<name> read -----
    CLASS-METHODS read_susc
      IMPORTING iv_name       TYPE string
      EXPORTING es_payload    TYPE ty_document_data
                ev_error_code TYPE string
                ev_error_msg  TYPE string.

    " ----- /auth/susc/<name> write (POST create, PUT update) -----
    CLASS-METHODS write_susc
      IMPORTING io_server TYPE REF TO if_http_server
                iv_name   TYPE string
                iv_method TYPE string
                iv_body   TYPE string.

    " ----- /auth/susc/<name> delete -----
    CLASS-METHODS delete_susc
      IMPORTING io_server TYPE REF TO if_http_server
                iv_name   TYPE string
                iv_query  TYPE string.

    " ----- helpers -----
    CLASS-METHODS name_valid
      IMPORTING iv_name      TYPE string
      RETURNING VALUE(rv_ok) TYPE abap_bool.
    CLASS-METHODS susc_exists
      IMPORTING iv_name        TYPE string
      RETURNING VALUE(rv_exists) TYPE abap_bool.
    CLASS-METHODS validate_document
      EXPORTING ev_code     TYPE string
                ev_msg      TYPE string
                ev_language TYPE sy-langu
      CHANGING  cs_doc      TYPE ty_document.
    CLASS-METHODS iso_to_sap_language
      IMPORTING iv_iso                 TYPE string
      RETURNING VALUE(rv_sap_language) TYPE sy-langu.
    CLASS-METHODS iso_from_sap_language
      IMPORTING iv_sap_language        TYPE sy-langu
      RETURNING VALUE(rv_iso_language) TYPE string.
    CLASS-METHODS respond_invalid
      IMPORTING io_server TYPE REF TO if_http_server
                iv_code   TYPE string
                iv_msg    TYPE string.
ENDCLASS.

CLASS zcl_abap_vibe_icf_susc IMPLEMENTATION.
  METHOD dispatch.
    " Route /auth/susc/<name>: one TOBC row plus its TOBCT texts and TADIR
    " entry. The ICF service is the only channel (SUSC has no ADT resource);
    " TADIR and transport handling use the shared RS_CORR_INSERT path because
    " abapGit's SUSR_COMMEDITCHECK transport recorder is dialog-bound and would
    " abort in a background handler.
    DATA lv_match_name TYPE string.

    FIND REGEX '^/auth/susc/(.+)$' IN iv_path IGNORING CASE SUBMATCHES lv_match_name.
    IF sy-subrc <> 0 OR lv_match_name IS INITIAL.
      respond_invalid( io_server = io_server
                       iv_code   = 'SUSC_NAME_INVALID'
                       iv_msg    = 'authorization object class name is required' ).
      RETURN.
    ENDIF.

    DATA(lv_name) = to_upper( condense( val = cl_http_utility=>unescape_url( lv_match_name ) del = ` ` ) ).
    IF name_valid( lv_name ) = abap_false.
      respond_invalid( io_server = io_server
                       iv_code   = 'SUSC_NAME_INVALID'
                       iv_msg    = |authorization object class name must be 1-{ gc_name_max_length } characters A-Z, 0-9, _ or - (or the /XXX namespace form), without whitespace (got '{ lv_name }')| ).
      RETURN.
    ENDIF.

    CASE iv_method.
      WHEN 'GET'.
        DATA ls_payload TYPE ty_document_data.
        read_susc( EXPORTING iv_name       = lv_name
                   IMPORTING es_payload    = ls_payload
                             ev_error_code = DATA(lv_error_code)
                             ev_error_msg  = DATA(lv_error_msg) ).
        IF lv_error_code IS NOT INITIAL.
          zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                           iv_status = COND i( WHEN lv_error_code = 'SUSC_NOT_FOUND' THEN 404 ELSE 500 )
                           iv_code   = lv_error_code
                           iv_msg    = lv_error_msg ).
          RETURN.
        ENDIF.
        zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                      iv_status  = 200
                      iv_reason  = 'OK'
                      is_payload = VALUE ty_get_response( status = 'success'
                                                          data   = ls_payload ) ).
      WHEN 'POST' OR 'PUT'.
        write_susc( io_server = io_server
                    iv_name   = lv_name
                    iv_method = iv_method
                    iv_body   = iv_body ).
      WHEN 'DELETE'.
        delete_susc( io_server = io_server
                     iv_name   = lv_name
                     iv_query  = io_server->request->get_header_field( '~query_string' ) ).
      WHEN OTHERS.
        zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                       iv_status = 405
                       iv_code   = 'METHOD_NOT_ALLOWED'
                       iv_msg    = |{ iv_method } not supported on /auth/susc/<name>| ).
    ENDCASE.
  ENDMETHOD.

  METHOD read_susc.
    " TOBCT keeps one text row per language (39 for a standard class on the
    " reference system); the document carries the original-language text only.
    " Candidate order: TADIR master language, the session language, 'E', then
    " any existing text row.
    DATA: ls_tobc      TYPE tobc,
          lv_package   TYPE devclass,
          lv_masterlang TYPE sy-langu,
          lv_language  TYPE sy-langu,
          lv_text      TYPE string.

    CLEAR: es_payload, ev_error_code, ev_error_msg.

    SELECT SINGLE * FROM tobc INTO @ls_tobc WHERE oclss = @iv_name.
    IF sy-subrc <> 0.
      ev_error_code = 'SUSC_NOT_FOUND'.
      ev_error_msg = |authorization object class { iv_name } does not exist|.
      RETURN.
    ENDIF.

    lv_package = zcl_abap_vibe_icf_auth_common=>package_of( iv_tadir_object = 'SUSC'
                                                            iv_name         = iv_name ).
    IF lv_package IS NOT INITIAL.
      SELECT SINGLE masterlang FROM tadir INTO @lv_masterlang
        WHERE pgmid = 'R3TR' AND object = 'SUSC' AND obj_name = @iv_name.
    ENDIF.

    IF lv_masterlang IS NOT INITIAL.
      SELECT SINGLE ctext FROM tobct INTO @lv_text
        WHERE oclss = @iv_name AND langu = @lv_masterlang.
      IF sy-subrc = 0.
        lv_language = lv_masterlang.
      ENDIF.
    ENDIF.
    IF lv_language IS INITIAL AND sy-langu IS NOT INITIAL.
      SELECT SINGLE ctext FROM tobct INTO @lv_text
        WHERE oclss = @iv_name AND langu = @sy-langu.
      IF sy-subrc = 0.
        lv_language = sy-langu.
      ENDIF.
    ENDIF.
    IF lv_language IS INITIAL.
      SELECT SINGLE ctext FROM tobct INTO @lv_text
        WHERE oclss = @iv_name AND langu = 'E'.
      IF sy-subrc = 0.
        lv_language = 'E'.
      ENDIF.
    ENDIF.
    IF lv_language IS INITIAL.
      SELECT SINGLE langu, ctext FROM tobct INTO (@lv_language, @lv_text)
        WHERE oclss = @iv_name.
    ENDIF.

    es_payload-format_version = '1'.
    es_payload-header-original_language = iso_from_sap_language( lv_language ).
    es_payload-header-description = lv_text.
    es_payload-name = iv_name.
    es_payload-package = lv_package.
  ENDMETHOD.

  METHOD write_susc.
    " POST creates, PUT updates an existing class. Both record TADIR + transport
    " first (shared corr_insert with the document's master language), then write
    " TOBC and the TOBCT row of that language.
    DATA: lv_query     TYPE string,
          lv_package   TYPE devclass,
          lv_transport TYPE trkorr,
          lv_author    TYPE sy-uname,
          lv_http_code TYPE i,
          lv_code      TYPE string,
          lv_msg       TYPE string,
          lv_language  TYPE sy-langu,
          lv_verb      TYPE string,
          ls_doc       TYPE ty_document,
          ls_tobc      TYPE tobc,
          ls_tobct     TYPE tobct.

    lv_query = io_server->request->get_header_field( '~query_string' ).
    lv_package = zcl_abap_vibe_icf_auth_common=>query_package( lv_query ).
    lv_transport = zcl_abap_vibe_icf_auth_common=>query_transport( lv_query ).

    TRY.
        /ui2/cl_json=>deserialize( EXPORTING json        = iv_body
                                             pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                                   CHANGING  data        = ls_doc ).
      CATCH cx_root.
        respond_invalid( io_server = io_server
                         iv_code   = 'SUSC_INVALID_PAYLOAD'
                         iv_msg    = 'request body is not a valid authorization object class document (JSON object)' ).
        RETURN.
    ENDTRY.
    validate_document( IMPORTING ev_code     = lv_code
                                 ev_msg      = lv_msg
                                 ev_language = lv_language
                       CHANGING  cs_doc      = ls_doc ).
    IF lv_code IS NOT INITIAL.
      respond_invalid( io_server = io_server
                       iv_code   = lv_code
                       iv_msg    = lv_msg ).
      RETURN.
    ENDIF.

    IF iv_method = 'POST'.
      lv_verb = 'create'.
      IF lv_package IS INITIAL.
        respond_invalid( io_server = io_server
                         iv_code   = 'SUSC_INVALID_PAYLOAD'
                         iv_msg    = 'package query parameter is required to create an authorization object class' ).
        RETURN.
      ENDIF.
      IF susc_exists( iv_name ) = abap_true.
        zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                       iv_status = 409
                       iv_code   = 'SUSC_ALREADY_EXISTS'
                       iv_msg    = |authorization object class { iv_name } already exists; update it instead| ).
        RETURN.
      ENDIF.
      " A stale TADIR row without a TOBC row (interrupted delete) would block
      " RS_CORR_INSERT with a lock conflict; clear it before recording.
      IF zcl_abap_vibe_icf_auth_common=>package_of( iv_tadir_object = 'SUSC'
                                                    iv_name         = iv_name ) IS NOT INITIAL.
        zcl_abap_vibe_icf_auth_common=>tadir_delete( iv_tadir_object = 'SUSC'
                                                     iv_name         = iv_name
                                                     iv_package      = lv_package
                                                     iv_transport    = lv_transport ).
      ENDIF.
    ELSE.
      lv_verb = 'update'.
      IF susc_exists( iv_name ) = abap_false.
        zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                       iv_status = 404
                       iv_code   = 'SUSC_NOT_FOUND'
                       iv_msg    = |authorization object class { iv_name } does not exist; create it first| ).
        RETURN.
      ENDIF.
      IF lv_package IS INITIAL.
        lv_package = zcl_abap_vibe_icf_auth_common=>package_of( iv_tadir_object = 'SUSC'
                                                                iv_name         = iv_name ).
      ENDIF.
    ENDIF.

    zcl_abap_vibe_icf_auth_common=>transport_rule( EXPORTING iv_package   = lv_package
                                                             iv_transport = lv_transport
                                                             iv_verb      = lv_verb
                                                             iv_prefix    = 'SUSC'
                                                   IMPORTING ev_code      = lv_code
                                                             ev_msg       = lv_msg ).
    IF lv_code IS NOT INITIAL.
      respond_invalid( io_server = io_server
                       iv_code   = lv_code
                       iv_msg    = lv_msg ).
      RETURN.
    ENDIF.

    zcl_abap_vibe_icf_auth_common=>corr_insert( EXPORTING iv_tadir_object     = 'SUSC'
                                                          iv_name             = iv_name
                                                          iv_package          = lv_package
                                                          iv_transport        = lv_transport
                                                          iv_mode             = 'I'
                                                          iv_prefix           = 'SUSC'
                                                          iv_master_language  = lv_language
                                                IMPORTING ev_author           = lv_author
                                                          ev_http_code        = lv_http_code
                                                          ev_code             = lv_code
                                                          ev_msg              = lv_msg ).
    IF lv_code IS NOT INITIAL.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                                                     iv_status = lv_http_code
                                                     iv_code   = lv_code
                                                     iv_msg    = lv_msg ).
      RETURN.
    ENDIF.
    " RS_CORR_INSERT keeps the existing master language on re-record; align it
    " with the document so pull→push→pull is stable.
    UPDATE tadir SET masterlang = @lv_language
      WHERE pgmid = 'R3TR' AND object = 'SUSC' AND obj_name = @iv_name.

    " TOBC only carries the key, so a create inserts the row and an update has
    " nothing to change there.
    IF iv_method = 'POST'.
      ls_tobc-oclss = iv_name.
      INSERT tobc FROM ls_tobc.
      IF sy-subrc <> 0.
        zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                         iv_status = 500
                         iv_code   = 'SUSC_WRITE_FAILED'
                         iv_msg    = |authorization object class { iv_name } was not saved (TOBC sy-subrc { sy-subrc })| ).
        RETURN.
      ENDIF.
    ENDIF.
    ls_tobct-oclss = iv_name.
    ls_tobct-langu = lv_language.
    ls_tobct-ctext = ls_doc-header-description.
    MODIFY tobct FROM ls_tobct.
    IF sy-subrc <> 0.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                       iv_status = 500
                       iv_code   = 'SUSC_WRITE_FAILED'
                       iv_msg    = |authorization object class { iv_name } text was not saved (TOBCT sy-subrc { sy-subrc })| ).
      RETURN.
    ENDIF.
    COMMIT WORK.

    zcl_abap_vibe_icf_auth_common=>respond_write_ok( io_server  = io_server
                  iv_name    = iv_name
                  iv_type    = 'SUSC'
                  iv_action  = COND string( WHEN iv_method = 'POST' THEN 'created' ELSE 'updated' )
                  iv_package = lv_package ).
  ENDMETHOD.

  METHOD delete_susc.
    " Ported abapGit pre-checks: S_DEVELOP authority and TOBJ where-used before
    " any mutation, then TOBC/TOBCT and the TADIR entry.
    DATA: lv_package   TYPE devclass,
          lv_transport TYPE trkorr,
          lv_code      TYPE string,
          lv_msg       TYPE string,
          lv_used_by   TYPE tobj-objct.

    lv_transport = zcl_abap_vibe_icf_auth_common=>query_transport( iv_query ).

    IF susc_exists( iv_name ) = abap_false.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 404
                     iv_code   = 'SUSC_NOT_FOUND'
                     iv_msg    = |authorization object class { iv_name } does not exist| ).
      RETURN.
    ENDIF.

    DATA lv_objname TYPE tobc-oclss.
    lv_objname = iv_name.
    AUTHORITY-CHECK OBJECT 'S_DEVELOP'
      ID 'DEVCLASS' DUMMY
      ID 'OBJTYPE' FIELD 'SUSC'
      ID 'OBJNAME' FIELD lv_objname
      ID 'P_GROUP' DUMMY
      ID 'ACTVT' FIELD '06'.
    IF sy-subrc <> 0.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 403
                     iv_code   = 'SUSC_NOT_AUTHORIZED'
                     iv_msg    = |not authorized to delete authorization object class { iv_name }| ).
      RETURN.
    ENDIF.

    SELECT SINGLE objct FROM tobj INTO @lv_used_by WHERE oclss = @iv_name.
    IF sy-subrc = 0.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 409
                     iv_code   = 'SUSC_DELETE_REFUSED'
                     iv_msg    = |authorization object class { iv_name } is still used by authorization object { lv_used_by }; remove it from that object first| ).
      RETURN.
    ENDIF.

    lv_package = zcl_abap_vibe_icf_auth_common=>package_of( iv_tadir_object = 'SUSC'
                                                            iv_name         = iv_name ).
    IF lv_package IS NOT INITIAL.
      zcl_abap_vibe_icf_auth_common=>transport_rule( EXPORTING iv_package   = lv_package
                                                               iv_transport = lv_transport
                                                               iv_verb      = 'delete'
                                                               iv_prefix    = 'SUSC'
                                                     IMPORTING ev_code      = lv_code
                                                               ev_msg       = lv_msg ).
      IF lv_code IS NOT INITIAL.
        respond_invalid( io_server = io_server
                         iv_code   = lv_code
                         iv_msg    = lv_msg ).
        RETURN.
      ENDIF.
    ENDIF.

    DELETE FROM tobc WHERE oclss = @iv_name.
    IF sy-subrc <> 0.
      zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                     iv_status = 500
                     iv_code   = 'SUSC_DELETE_FAILED'
                     iv_msg    = |authorization object class { iv_name } could not be deleted (TOBC sy-subrc { sy-subrc })| ).
      RETURN.
    ENDIF.
    DELETE FROM tobct WHERE oclss = @iv_name.
    COMMIT WORK.

    IF lv_package IS NOT INITIAL.
      zcl_abap_vibe_icf_auth_common=>tadir_delete( iv_tadir_object = 'SUSC'
                                                   iv_name         = iv_name
                                                   iv_package      = lv_package
                                                   iv_transport    = lv_transport ).
    ENDIF.

    zcl_abap_vibe_icf_auth_common=>respond_write_ok( io_server  = io_server
                  iv_name    = iv_name
                  iv_type    = 'SUSC'
                  iv_action  = 'deleted'
                  iv_package = lv_package ).
  ENDMETHOD.

  METHOD name_valid.
    " TOBC-OCLSS names on the reference system: 2-4 chars, letters/digits/
    " underscore/hyphen (`CV`, `IS-B`, `6VPM`) or the 4-char namespace form
    " (`/AGG`).
    IF iv_name IS INITIAL OR strlen( iv_name ) > gc_name_max_length.
      rv_ok = abap_false.
      RETURN.
    ENDIF.
    IF substring( val = iv_name len = 1 ) = '/'.
      FIND REGEX '^/[A-Z0-9_-]{3}$' IN iv_name.
    ELSE.
      FIND REGEX '^[A-Z0-9][A-Z0-9_-]{0,3}$' IN iv_name.
    ENDIF.
    rv_ok = boolc( sy-subrc = 0 ).
  ENDMETHOD.

  METHOD susc_exists.
    SELECT SINGLE oclss FROM tobc INTO @DATA(lv_oclss)
      WHERE oclss = @iv_name.
    rv_exists = boolc( sy-subrc = 0 ).
  ENDMETHOD.

  METHOD validate_document.
    " Normalize + validate the editable document fields: the text respects the
    " TOBCT-CTEXT limit and the language resolves through T002.
    CLEAR: ev_code, ev_msg, ev_language.

    DATA(lv_iso) = to_upper( condense( val = cs_doc-header-original_language del = ` ` ) ).
    IF lv_iso IS INITIAL.
      ev_code = 'SUSC_INVALID_PAYLOAD'.
      ev_msg = 'header.originalLanguage is required'.
      RETURN.
    ENDIF.
    FIND REGEX '^[A-Z]{2}$' IN lv_iso.
    IF sy-subrc <> 0.
      ev_code = 'SUSC_INVALID_PAYLOAD'.
      ev_msg = |header.originalLanguage '{ lv_iso }' is not a two-letter ISO language code|.
      RETURN.
    ENDIF.
    ev_language = iso_to_sap_language( lv_iso ).
    IF ev_language IS INITIAL.
      ev_code = 'SUSC_INVALID_PAYLOAD'.
      ev_msg = |language code '{ lv_iso }' does not exist (T002)|.
      RETURN.
    ENDIF.

    DATA(lv_text) = cs_doc-header-description.
    SHIFT lv_text LEFT DELETING LEADING ' '.
    SHIFT lv_text RIGHT DELETING TRAILING ' '.
    IF strlen( lv_text ) > 60.
      ev_code = 'SUSC_INVALID_PAYLOAD'.
      ev_msg = |header.description is { strlen( lv_text ) } characters long; the TOBCT text limit is 60|.
      RETURN.
    ENDIF.
    cs_doc-header-description = lv_text.
    cs_doc-header-original_language = lv_iso.
  ENDMETHOD.

  METHOD iso_to_sap_language.
    " AFF header.originalLanguage is a 2-character ISO code; T002 maps it to
    " the internal 1-character language key. Empty result = unknown code.
    CLEAR rv_sap_language.
    DATA(lv_iso) = to_upper( condense( val = iv_iso del = ` ` ) ).
    IF lv_iso IS INITIAL.
      RETURN.
    ENDIF.
    SELECT SINGLE spras FROM t002 INTO @rv_sap_language WHERE laiso = @lv_iso.
    IF sy-subrc <> 0.
      CLEAR rv_sap_language.
    ENDIF.
  ENDMETHOD.

  METHOD iso_from_sap_language.
    rv_iso_language = 'en'.
    IF iv_sap_language IS INITIAL.
      RETURN.
    ENDIF.
    SELECT SINGLE laiso FROM t002 INTO @rv_iso_language WHERE spras = @iv_sap_language.
    IF sy-subrc <> 0 OR rv_iso_language IS INITIAL.
      rv_iso_language = 'en'.
      RETURN.
    ENDIF.
    " T002 stores the ISO code upper case; the AFF header convention is lower case.
    rv_iso_language = to_lower( rv_iso_language ).
  ENDMETHOD.

  METHOD respond_invalid.
    zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                                                   iv_status = 400
                                                   iv_code   = iv_code
                                                   iv_msg    = iv_msg ).
  ENDMETHOD.
ENDCLASS.
