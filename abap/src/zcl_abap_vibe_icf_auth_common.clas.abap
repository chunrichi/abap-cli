CLASS zcl_abap_vibe_icf_auth_common DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    " ----- write response envelope (shared by the auth family) -----
    TYPES:
      BEGIN OF ty_write_data,
        name      TYPE string,
        type      TYPE string,
        action    TYPE string,
        package   TYPE string,
        activated TYPE abap_bool,
      END OF ty_write_data,
      BEGIN OF ty_write,
        status TYPE string,
        data   TYPE ty_write_data,
      END OF ty_write.

    " ----- request parsing -----
    CLASS-METHODS parse_body
      IMPORTING iv_body TYPE string
      CHANGING  cs_doc  TYPE any
      RETURNING VALUE(rv_ok) TYPE abap_bool.

    CLASS-METHODS query_package
      IMPORTING iv_query TYPE string
      RETURNING VALUE(rv_package) TYPE devclass.

    CLASS-METHODS query_transport
      IMPORTING iv_query TYPE string
      RETURNING VALUE(rv_transport) TYPE trkorr.

    " ----- TADIR / package / transport -----
    CLASS-METHODS package_of
      IMPORTING iv_tadir_object TYPE trobjtype
                iv_name         TYPE string
      RETURNING VALUE(rv_package) TYPE devclass.

    CLASS-METHODS transport_rule
      IMPORTING iv_package   TYPE devclass
                iv_transport TYPE trkorr
                iv_verb      TYPE string
                iv_prefix    TYPE string
      EXPORTING ev_code      TYPE string
                ev_msg       TYPE string.

    CLASS-METHODS corr_insert
      IMPORTING iv_tadir_object TYPE trobjtype
                iv_name         TYPE string
                iv_package      TYPE devclass
                iv_transport    TYPE trkorr
                iv_mode         TYPE char1
                iv_prefix       TYPE string
      EXPORTING ev_author       TYPE sy-uname
                ev_http_code    TYPE i
                ev_code         TYPE string
                ev_msg          TYPE string.

    CLASS-METHODS tadir_delete
      IMPORTING iv_tadir_object TYPE trobjtype
                iv_name         TYPE string
                iv_package      TYPE devclass
                iv_transport    TYPE trkorr.

    CLASS-METHODS last_message
      RETURNING VALUE(rv_message) TYPE string.

    " ----- responses -----
    CLASS-METHODS respond_error
      IMPORTING io_server TYPE REF TO if_http_server
                iv_status TYPE i
                iv_code   TYPE string
                iv_msg    TYPE string.

    CLASS-METHODS respond_write_ok
      IMPORTING io_server TYPE REF TO if_http_server
                iv_name   TYPE string
                iv_type   TYPE string
                iv_action TYPE string
                iv_package TYPE devclass.
ENDCLASS.

CLASS zcl_abap_vibe_icf_auth_common IMPLEMENTATION.
  METHOD parse_body.
    " The bundled ICF service serializes camelCase; the same pretty name reads
    " the request body back into the handler's own document structure.
    CLEAR cs_doc.
    TRY.
        /ui2/cl_json=>deserialize( EXPORTING json        = iv_body
                                             pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                                   CHANGING  data        = cs_doc ).
        rv_ok = abap_true.
      CATCH cx_root.
        rv_ok = abap_false.
    ENDTRY.
  ENDMETHOD.

  METHOD query_package.
    rv_package = to_upper( zcl_abap_vibe_icf_response=>query_param( iv_query = iv_query iv_name = 'package' ) ).
  ENDMETHOD.

  METHOD query_transport.
    rv_transport = to_upper( zcl_abap_vibe_icf_response=>query_param( iv_query = iv_query iv_name = 'transportRequest' ) ).
    IF rv_transport IS INITIAL.
      rv_transport = to_upper( zcl_abap_vibe_icf_response=>query_param( iv_query = iv_query iv_name = 'tr' ) ).
    ENDIF.
  ENDMETHOD.

  METHOD package_of.
    SELECT SINGLE devclass FROM tadir INTO @rv_package
      WHERE pgmid = 'R3TR' AND object = @iv_tadir_object AND obj_name = @iv_name.
  ENDMETHOD.

  METHOD transport_rule.
    " Local ('$') packages are transport-free: a stray request must not reach the
    " TADIR call. Everything else needs an explicit, syntactically valid request.
    IF zcl_abap_vibe_icf_types=>is_local_package( iv_package ) = abap_true.
      RETURN.
    ENDIF.

    IF iv_transport IS INITIAL.
      ev_code = |{ iv_prefix }_TRANSPORT_REQUIRED|.
      ev_msg = |{ iv_verb } requires transportRequest for package { iv_package }|.
      RETURN.
    ENDIF.

    DATA(lv_request) = condense( val = iv_transport ).
    IF strlen( lv_request ) > 20 OR lv_request CN 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.
      ev_code = |{ iv_prefix }_TRANSPORT_INVALID|.
      ev_msg = |transportRequest '{ lv_request }' is not a valid request number|.
    ENDIF.
  ENDMETHOD.

  METHOD corr_insert.
    " RS_CORR_INSERT with an explicit request is the dialog-free TADIR/package
    " path used by the DDIC ICF writes (mode I + suppress_dialog).
    DATA: lv_korrnum TYPE trkorr,
          lv_use_req TYPE trpari-s_checked.

    lv_korrnum = iv_transport.
    IF lv_korrnum IS NOT INITIAL.
      lv_use_req = abap_true.
    ENDIF.

    CALL FUNCTION 'RS_CORR_INSERT'
      EXPORTING
        object                   = iv_name
        object_class             = iv_tadir_object
        devclass                 = iv_package
        master_language          = sy-langu
        korrnum                  = lv_korrnum
        mode                     = iv_mode
        global_lock              = abap_true
        suppress_dialog          = abap_true
        use_korrnum_immediatedly = lv_use_req
      IMPORTING
        author                   = ev_author
      EXCEPTIONS
        cancelled                = 1
        permission_failure       = 2
        unknown_objectclass      = 3
        OTHERS                   = 4.

    IF sy-subrc = 0.
      IF ev_author IS INITIAL.
        ev_author = sy-uname.
      ENDIF.
      RETURN.
    ENDIF.

    CASE sy-subrc.
      WHEN 1.
        ev_http_code = 400.
        ev_code = |{ iv_prefix }_TRANSPORT_REQUIRED|.
        ev_msg = last_message( ).
        IF ev_msg IS INITIAL.
          ev_msg = |package { iv_package } is not a local package but no usable transport request was supplied|.
        ENDIF.
      WHEN 2.
        ev_http_code = 403.
        ev_code = |{ iv_prefix }_NOT_AUTHORIZED|.
        ev_msg = last_message( ).
        IF ev_msg IS INITIAL.
          ev_msg = |not authorized to record { iv_name } in package { iv_package }|.
        ENDIF.
      WHEN OTHERS.
        ev_http_code = 500.
        ev_code = |{ iv_prefix }_PACKAGE_ERROR|.
        ev_msg = last_message( ).
        IF ev_msg IS INITIAL.
          ev_msg = |cannot record { iv_name } in package { iv_package } (sy-subrc { sy-subrc })|.
        ENDIF.
    ENDCASE.
    IF ev_author IS INITIAL.
      ev_author = sy-uname.
    ENDIF.
  ENDMETHOD.

  METHOD tadir_delete.
    " TR_TADIR_INTERFACE is the background-safe TADIR path; the direct fallback
    " keeps the directory consistent when the interface declines (TR/692).
    DATA: ls_tadir  TYPE tadir,
          lv_delete TYPE trpari-s_checked,
          lv_modus  TYPE trpari-s_checked,
          lv_korr   TYPE tadir-korrnum,
          lv_name   TYPE tadir-obj_name.

    lv_name = iv_name.
    lv_delete = abap_true.
    lv_modus = abap_false.
    lv_korr = iv_transport.

    CALL FUNCTION 'TR_TADIR_INTERFACE'
      EXPORTING
        wi_delete_tadir_entry = lv_delete
        wi_test_modus         = lv_modus
        wi_tadir_pgmid        = 'R3TR'
        wi_tadir_object       = iv_tadir_object
        wi_tadir_obj_name     = lv_name
        wi_tadir_korrnum      = lv_korr
        wi_tadir_devclass     = iv_package
        wi_tadir_author       = sy-uname
        wi_tadir_masterlang   = sy-langu
      EXCEPTIONS
        OTHERS                = 1.

    SELECT SINGLE * FROM tadir INTO @ls_tadir
      WHERE pgmid = 'R3TR' AND object = @iv_tadir_object AND obj_name = @iv_name.
    IF sy-subrc = 0.
      DELETE FROM tadir
        WHERE pgmid = 'R3TR' AND object = @iv_tadir_object AND obj_name = @iv_name.
    ENDIF.
    COMMIT WORK.
  ENDMETHOD.

  METHOD last_message.
    CLEAR rv_message.
    IF sy-msgid IS INITIAL OR sy-msgno IS INITIAL.
      RETURN.
    ENDIF.
    MESSAGE ID sy-msgid TYPE 'S' NUMBER sy-msgno
      WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4 INTO rv_message.
  ENDMETHOD.

  METHOD respond_error.
    zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                   iv_status = iv_status
                   iv_reason = SWITCH string( iv_status
                                               WHEN 400 THEN 'Bad Request'
                                               WHEN 403 THEN 'Forbidden'
                                               WHEN 404 THEN 'Not Found'
                                               WHEN 405 THEN 'Method Not Allowed'
                                               WHEN 409 THEN 'Conflict'
                                               WHEN 501 THEN 'Not Implemented'
                                               ELSE 'Internal Server Error' )
                   iv_code   = iv_code
                   iv_msg    = iv_msg ).
  ENDMETHOD.

  METHOD respond_write_ok.
    zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                  iv_status = 200
                  iv_reason = 'OK'
                  is_payload = VALUE ty_write( status = 'success'
                                               data = VALUE ty_write_data( name      = iv_name
                                                                           type      = iv_type
                                                                           action    = iv_action
                                                                           package   = iv_package
                                                                           activated = abap_false ) ) ).
  ENDMETHOD.
ENDCLASS.
