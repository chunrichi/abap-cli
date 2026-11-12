CLASS zcl_abap_vibe_icf_jobd DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    " The jobd-v1 name limit is 32 characters (STJR_JOBD_ROOT-NAME).
    CONSTANTS gc_name_max_length TYPE i VALUE 32.

    CLASS-METHODS dispatch_jobd
      IMPORTING io_server TYPE REF TO if_http_server
                iv_path   TYPE string
                iv_method TYPE string
                iv_body   TYPE string.

  PRIVATE SECTION.
    " ----- /jobd/<name> read -----
    CLASS-METHODS read_jobd
      IMPORTING iv_name       TYPE string
      EXPORTING es_payload    TYPE zcl_abap_vibe_icf_types=>ty_jobd_doc
                ev_error_code TYPE string
                ev_error_msg  TYPE string.

    " ----- /jobd/<name> write (POST create, PUT update) -----
    CLASS-METHODS write_jobd
      IMPORTING io_server TYPE REF TO if_http_server
                iv_name   TYPE string
                iv_method TYPE string
                iv_body   TYPE string.

    " ----- /jobd/<name> delete -----
    CLASS-METHODS delete_jobd
      IMPORTING io_server TYPE REF TO if_http_server
                iv_name   TYPE string
                iv_query  TYPE string.

    " ----- helpers -----
    CLASS-METHODS jobd_available
      RETURNING VALUE(rv_available) TYPE abap_bool.
    CLASS-METHODS job_exists
      IMPORTING iv_name          TYPE string
      RETURNING VALUE(rv_exists) TYPE abap_bool
      RAISING   cx_root.
    CLASS-METHODS find_package
      IMPORTING iv_name           TYPE string
      RETURNING VALUE(rv_package) TYPE devclass.
    CLASS-METHODS transport_rule
      IMPORTING iv_package    TYPE devclass
                iv_transport  TYPE trkorr
                iv_verb       TYPE string
      EXPORTING ev_code       TYPE string
                ev_msg        TYPE string.
    CLASS-METHODS corr_insert
      IMPORTING iv_name      TYPE string
                iv_package   TYPE devclass
                iv_transport TYPE trkorr
                iv_mode      TYPE char1
      EXPORTING ev_author    TYPE sy-uname
                ev_http_code TYPE i
                ev_code      TYPE string
                ev_msg       TYPE string.
    CLASS-METHODS apply_doc
      IMPORTING is_doc  TYPE zcl_abap_vibe_icf_types=>ty_jobd_doc
      CHANGING  cs_attr TYPE any.
    CLASS-METHODS set_attr
      IMPORTING iv_component TYPE string
                iv_value     TYPE any
      CHANGING  cs_attr      TYPE any.
    CLASS-METHODS patch_persisted_row
      IMPORTING iv_name    TYPE string
                iv_package TYPE devclass
                iv_author  TYPE sy-uname.
    CLASS-METHODS tadir_delete
      IMPORTING iv_name      TYPE string
                iv_package   TYPE devclass
                iv_transport TYPE trkorr.
    CLASS-METHODS last_message
      RETURNING VALUE(rv_message) TYPE string.
    CLASS-METHODS respond_error
      IMPORTING io_server TYPE REF TO if_http_server
                iv_status TYPE i
                iv_code   TYPE string
                iv_msg    TYPE string.
ENDCLASS.

CLASS zcl_abap_vibe_icf_jobd IMPLEMENTATION.
  METHOD dispatch_jobd.
    " /jobd/<name> — read/write application job definitions (SM36 job
    " definitions, TADIR object JOBD). The object has no ADT resource on the
    " supported releases, so it is served through the ICF service instead,
    " mirroring the abapGit JOBD recipe: CL_JR_JOB_DEFINITION serializes
    " STJR_JOBD_ROOT + STJR_JOBD_TREP, the class persists the rows, and the
    " TADIR/transport entry is recorded here (the class' own transport path is
    " dialog-bound and cannot run in the plugin context).
    DATA lv_match_name TYPE string.

    FIND REGEX '^/jobd/(.+)$' IN iv_path IGNORING CASE SUBMATCHES lv_match_name.
    IF sy-subrc <> 0 OR lv_match_name IS INITIAL.
      respond_error( io_server = io_server
                     iv_status = 400
                     iv_code   = 'JOBD_SERVICE_INVALID'
                     iv_msg    = 'job definition name is required' ).
      RETURN.
    ENDIF.

    DATA(lv_name) = to_upper( condense( val = lv_match_name del = ` ` ) ).
    IF strlen( lv_name ) > gc_name_max_length OR lv_name CS ` ` OR lv_name CN 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_/'.
      respond_error( io_server = io_server
                     iv_status = 400
                     iv_code   = 'JOBD_NAME_INVALID'
                     iv_msg    = |job definition name must be at most { gc_name_max_length } characters of A-Z, 0-9, _ or / without whitespace (got '{ lv_name }')| ).
      RETURN.
    ENDIF.

    IF jobd_available( ) = abap_false.
      respond_error( io_server = io_server
                     iv_status = 501
                     iv_code   = 'JOBD_UNSUPPORTED'
                     iv_msg    = 'this SAP release does not provide CL_JR_JOB_DEFINITION, so job definitions cannot be managed here' ).
      RETURN.
    ENDIF.

    IF iv_method = 'GET'.
      DATA ls_payload TYPE zcl_abap_vibe_icf_types=>ty_jobd_doc.
      DATA lv_error_code TYPE string.
      DATA lv_error_msg TYPE string.
      read_jobd( EXPORTING iv_name       = lv_name
                 IMPORTING es_payload    = ls_payload
                           ev_error_code = lv_error_code
                           ev_error_msg  = lv_error_msg ).
      IF lv_error_code IS NOT INITIAL.
        respond_error( io_server = io_server
                       iv_status = COND i( WHEN lv_error_code = 'JOBD_NOT_FOUND' THEN 404 ELSE 500 )
                       iv_code   = lv_error_code
                       iv_msg    = lv_error_msg ).
        RETURN.
      ENDIF.
      zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                    iv_status = 200
                    iv_reason = 'OK'
                    is_payload = VALUE zcl_abap_vibe_icf_types=>ty_jobd_get( status = 'success'
                                                                              data   = ls_payload ) ).
      RETURN.
    ENDIF.

    IF iv_method = 'POST' OR iv_method = 'PUT'.
      write_jobd( io_server = io_server
                  iv_name   = lv_name
                  iv_method = iv_method
                  iv_body   = iv_body ).
      RETURN.
    ENDIF.

    IF iv_method = 'DELETE'.
      delete_jobd( io_server = io_server
                   iv_name   = lv_name
                   iv_query  = io_server->request->get_header_field( '~query_string' ) ).
      RETURN.
    ENDIF.

    respond_error( io_server = io_server
                   iv_status = 405
                   iv_code   = 'METHOD_NOT_ALLOWED'
                   iv_msg    = |{ iv_method } not supported on /jobd/<name>| ).
  ENDMETHOD.

  METHOD read_jobd.
    DATA lo_jd TYPE REF TO object.
    DATA lr_attr TYPE REF TO data.
    DATA lv_jd_name TYPE c LENGTH 32.
    FIELD-SYMBOLS <ls_attr> TYPE any.

    lv_jd_name = iv_name.

    TRY.
        IF job_exists( iv_name ) = abap_false.
          ev_error_code = 'JOBD_NOT_FOUND'.
          ev_error_msg = |job definition { iv_name } does not exist|.
          RETURN.
        ENDIF.

        CREATE OBJECT lo_jd TYPE ('CL_JR_JOB_DEFINITION')
          EXPORTING
            im_jd_name = lv_jd_name.

        CREATE DATA lr_attr TYPE ('CL_JR_JOB_DEFINITION=>TY_JOB_DEFINITION').
        ASSIGN lr_attr->* TO <ls_attr>.
        CALL METHOD lo_jd->('GET_JD_ATTRIBUTES')
          IMPORTING
            ex_jd_attributes = <ls_attr>.

        MOVE-CORRESPONDING <ls_attr> TO es_payload.
        es_payload-format_version = '1'.
        es_payload-name           = iv_name.
        es_payload-package        = find_package( iv_name ).
      CATCH cx_root INTO DATA(lx_read).
        ev_error_code = 'JOBD_READ_FAILED'.
        ev_error_msg = lx_read->get_text( ).
    ENDTRY.
  ENDMETHOD.

  METHOD write_jobd.
    DATA: lv_query     TYPE string,
          lv_package   TYPE devclass,
          lv_transport TYPE trkorr,
          lv_author    TYPE sy-uname,
          ls_doc       TYPE zcl_abap_vibe_icf_types=>ty_jobd_doc,
          lo_jd        TYPE REF TO object,
          lr_attr      TYPE REF TO data,
          lv_locked    TYPE abap_bool,
          lv_rule_code TYPE string,
          lv_rule_msg  TYPE string.
    FIELD-SYMBOLS <ls_attr> TYPE any.

    lv_query = io_server->request->get_header_field( '~query_string' ).
    lv_package = to_upper( zcl_abap_vibe_icf_response=>query_param( iv_query = lv_query iv_name = 'package' ) ).
    lv_transport = to_upper( zcl_abap_vibe_icf_response=>query_param( iv_query = lv_query iv_name = 'transportRequest' ) ).
    IF lv_transport IS INITIAL.
      lv_transport = to_upper( zcl_abap_vibe_icf_response=>query_param( iv_query = lv_query iv_name = 'tr' ) ).
    ENDIF.

    TRY.
        /ui2/cl_json=>deserialize( EXPORTING json        = iv_body
                                             pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                                   CHANGING  data        = ls_doc ).
      CATCH cx_root.
        respond_error( io_server = io_server
                       iv_status = 400
                       iv_code   = 'JOBD_INVALID_PAYLOAD'
                       iv_msg    = 'request body is not a valid job definition document (JSON object)' ).
        RETURN.
    ENDTRY.
    ls_doc-name = iv_name.

    IF iv_method = 'POST'.
      IF lv_package IS INITIAL.
        lv_package = to_upper( ls_doc-package ).
      ENDIF.
      IF lv_package IS INITIAL.
        respond_error( io_server = io_server
                       iv_status = 400
                       iv_code   = 'JOBD_PACKAGE_REQUIRED'
                       iv_msg    = 'package is required to create a job definition' ).
        RETURN.
      ENDIF.
      TRY.
          IF job_exists( iv_name ) = abap_true.
            respond_error( io_server = io_server
                           iv_status = 409
                           iv_code   = 'JOBD_ALREADY_EXISTS'
                           iv_msg    = |job definition { iv_name } already exists; update it instead| ).
            RETURN.
          ENDIF.
        CATCH cx_root.
      ENDTRY.
      " A stale TADIR row without STJR data (e.g. an orphan left by an
      " interrupted delete) blocks RS_CORR_INSERT with a lock conflict; clear it
      " before recording the new object.
      IF find_package( iv_name ) IS NOT INITIAL.
        tadir_delete( EXPORTING iv_name      = iv_name
                                iv_package   = lv_package
                                iv_transport = lv_transport ).
      ENDIF.
      transport_rule( EXPORTING iv_package   = lv_package
                                iv_transport = lv_transport
                                iv_verb      = 'create'
                      IMPORTING ev_code      = lv_rule_code
                                ev_msg       = lv_rule_msg ).
      IF lv_rule_code IS NOT INITIAL.
        respond_error( io_server = io_server
                       iv_status = 400
                       iv_code   = lv_rule_code
                       iv_msg    = lv_rule_msg ).
        RETURN.
      ENDIF.
    ELSE.
      TRY.
          IF job_exists( iv_name ) = abap_false.
            respond_error( io_server = io_server
                           iv_status = 404
                           iv_code   = 'JOBD_NOT_FOUND'
                           iv_msg    = |job definition { iv_name } does not exist; create it first| ).
            RETURN.
          ENDIF.
        CATCH cx_root.
      ENDTRY.
      IF lv_package IS INITIAL.
        lv_package = find_package( iv_name ).
      ENDIF.
      transport_rule( EXPORTING iv_package   = lv_package
                                iv_transport = lv_transport
                                iv_verb      = 'update'
                      IMPORTING ev_code      = lv_rule_code
                                ev_msg       = lv_rule_msg ).
      IF lv_rule_code IS NOT INITIAL.
        respond_error( io_server = io_server
                       iv_status = 400
                       iv_code   = lv_rule_code
                       iv_msg    = lv_rule_msg ).
        RETURN.
      ENDIF.
    ENDIF.

    " TADIR + transport entry: the class' own transport path opens a request
    " dialog, which a plugin call cannot serve.
    corr_insert( EXPORTING iv_name      = iv_name
                           iv_package   = lv_package
                           iv_transport = lv_transport
                           iv_mode      = 'I'
                 IMPORTING ev_author    = lv_author
                           ev_http_code = DATA(lv_corr_http)
                           ev_code      = DATA(lv_corr_code)
                           ev_msg       = DATA(lv_corr_msg) ).
    IF lv_corr_code IS NOT INITIAL.
      respond_error( io_server = io_server
                     iv_status = lv_corr_http
                     iv_code   = lv_corr_code
                     iv_msg    = lv_corr_msg ).
      RETURN.
    ENDIF.

    TRY.
        DATA(lv_jd_name) = CONV char32( iv_name ).
        CREATE OBJECT lo_jd TYPE ('CL_JR_JOB_DEFINITION')
          EXPORTING
            im_jd_name = lv_jd_name.
        CALL METHOD lo_jd->('LOCK').
        lv_locked = abap_true.
      CATCH cx_root INTO DATA(lx_lock).
        respond_error( io_server = io_server
                       iv_status = 409
                       iv_code   = 'JOBD_LOCKED'
                       iv_msg    = |job definition { iv_name } is locked by another session: { lx_lock->get_text( ) }| ).
        RETURN.
      ENDTRY.

    TRY.
        CREATE DATA lr_attr TYPE ('CL_JR_JOB_DEFINITION=>TY_JOB_DEFINITION').
        ASSIGN lr_attr->* TO <ls_attr>.

        IF iv_method = 'POST'.
          " Create the inactive version, then activate it: the CLI contract
          " writes the document in one step (no --no-activate for JOBD).
          CALL METHOD apply_doc
            EXPORTING
              is_doc = ls_doc
            CHANGING
              cs_attr = <ls_attr>.
          CALL METHOD set_attr
            EXPORTING
              iv_component = 'NAME'
              iv_value     = iv_name
            CHANGING
              cs_attr      = <ls_attr>.
          CALL METHOD set_attr
            EXPORTING
              iv_component = 'JDPACKAGE'
              iv_value     = '$TMP'
            CHANGING
              cs_attr      = <ls_attr>.
          CALL METHOD set_attr
            EXPORTING
              iv_component = 'OWNER'
              iv_value     = lv_author
            CHANGING
              cs_attr      = <ls_attr>.
          CALL METHOD set_attr
            EXPORTING
              iv_component = 'IS_ACTIVE'
              iv_value     = abap_false
            CHANGING
              cs_attr      = <ls_attr>.
          CALL METHOD lo_jd->('CREATE_JD')
            EXPORTING
              im_jd_attributes = <ls_attr>.
          CALL METHOD lo_jd->('GET_JD_ATTRIBUTES')
            EXPORTING
              im_is_active     = abap_false
            IMPORTING
              ex_jd_attributes = <ls_attr>.
          CALL METHOD lo_jd->('MODIFY_JD')
            EXPORTING
              im_jd_attributes = <ls_attr>
              im_to_active     = abap_true.
        ELSE.
          " Keep the server-managed fields (owner, created*, btcjobUser) from
          " the active row and overwrite only the editable document fields.
          CALL METHOD lo_jd->('GET_JD_ATTRIBUTES')
            IMPORTING
              ex_jd_attributes = <ls_attr>.
          CALL METHOD apply_doc
            EXPORTING
              is_doc = ls_doc
            CHANGING
              cs_attr = <ls_attr>.
          CALL METHOD set_attr
            EXPORTING
              iv_component = 'NAME'
              iv_value     = iv_name
            CHANGING
              cs_attr      = <ls_attr>.
          CALL METHOD set_attr
            EXPORTING
              iv_component = 'JDPACKAGE'
              iv_value     = '$TMP'
            CHANGING
              cs_attr      = <ls_attr>.
          CALL METHOD lo_jd->('MODIFY_JD')
            EXPORTING
              im_jd_attributes = <ls_attr>
              im_to_active     = abap_true.
        ENDIF.

        " The class persisted the row with the transport-free '$TMP' package
        " (see above); restore the real package and owner before committing.
        patch_persisted_row( iv_name    = iv_name
                             iv_package = lv_package
                             iv_author  = lv_author ).
        COMMIT WORK.

        CALL METHOD lo_jd->('UNLOCK').
        lv_locked = abap_false.
      CATCH cx_root INTO DATA(lx_write).
        IF lv_locked = abap_true.
          TRY.
              CALL METHOD lo_jd->('UNLOCK').
            CATCH cx_root.
          ENDTRY.
        ENDIF.
        respond_error( io_server = io_server
                       iv_status = 500
                       iv_code   = 'JOBD_WRITE_FAILED'
                       iv_msg    = |job definition { iv_name } was not saved: { lx_write->get_text( ) }| ).
        RETURN.
    ENDTRY.

    zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                  iv_status = 200
                  iv_reason = 'OK'
                  is_payload = VALUE zcl_abap_vibe_icf_types=>ty_jobd_write(
                                     status = 'success'
                                     data = VALUE zcl_abap_vibe_icf_types=>ty_jobd_write_data(
                                              name      = iv_name
                                              type      = 'JOBD'
                                              action    = COND string( WHEN iv_method = 'POST' THEN 'created' ELSE 'updated' )
                                              package   = lv_package
                                              activated = abap_true ) ) ).
  ENDMETHOD.

  METHOD delete_jobd.
    DATA: lv_query     TYPE string,
          lv_package   TYPE devclass,
          lv_transport TYPE trkorr,
          lv_author    TYPE sy-uname,
          lv_rule_code TYPE string,
          lv_rule_msg  TYPE string.

    lv_query = io_server->request->get_header_field( '~query_string' ).
    lv_transport = to_upper( zcl_abap_vibe_icf_response=>query_param( iv_query = lv_query iv_name = 'transportRequest' ) ).
    IF lv_transport IS INITIAL.
      lv_transport = to_upper( zcl_abap_vibe_icf_response=>query_param( iv_query = lv_query iv_name = 'tr' ) ).
    ENDIF.

    TRY.
        IF job_exists( iv_name ) = abap_false.
          respond_error( io_server = io_server
                         iv_status = 404
                         iv_code   = 'JOBD_NOT_FOUND'
                         iv_msg    = |job definition { iv_name } does not exist| ).
          RETURN.
        ENDIF.
      CATCH cx_root.
    ENDTRY.

    lv_package = find_package( iv_name ).
    transport_rule( EXPORTING iv_package   = lv_package
                              iv_transport = lv_transport
                              iv_verb      = 'delete'
                    IMPORTING ev_code      = lv_rule_code
                              ev_msg       = lv_rule_msg ).
    IF lv_rule_code IS NOT INITIAL.
      respond_error( io_server = io_server
                     iv_status = 400
                     iv_code   = lv_rule_code
                     iv_msg    = lv_rule_msg ).
      RETURN.
    ENDIF.

    " CL_JR_JOB_DEFINITION=>DELETE_JD re-reads the row and runs its own
    " dialog-bound transport path, so the two tables are cleared here (same
    " statements as the class' DELETE_JD body). The TADIR entry is removed
    " afterwards: TR_TADIR_INTERFACE refuses to delete it while the repository
    " object still exists. The tables are addressed dynamically so the merged
    " handler also activates on releases without STJR.
    DATA lv_root_table TYPE tabname VALUE 'STJR_JOBD_ROOT'.
    DATA lv_trep_table TYPE tabname VALUE 'STJR_JOBD_TREP'.
    DELETE FROM (lv_root_table) WHERE name = @iv_name.
    DELETE FROM (lv_trep_table) WHERE name = @iv_name.
    COMMIT WORK.

    tadir_delete( EXPORTING iv_name      = iv_name
                            iv_package   = lv_package
                            iv_transport = lv_transport ).

    zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                  iv_status = 200
                  iv_reason = 'OK'
                  is_payload = VALUE zcl_abap_vibe_icf_types=>ty_jobd_write(
                                     status = 'success'
                                     data = VALUE zcl_abap_vibe_icf_types=>ty_jobd_write_data(
                                              name      = iv_name
                                              type      = 'JOBD'
                                              action    = 'deleted'
                                              package   = lv_package
                                              activated = abap_false ) ) ).
  ENDMETHOD.

  METHOD transport_rule.
    " Local ('$') packages are transport-free and a stray request must not
    " reach the TADIR call; everything else needs an explicit request.
    IF zcl_abap_vibe_icf_types=>is_local_package( iv_package ) = abap_true.
      RETURN.
    ENDIF.

    IF iv_transport IS INITIAL.
      ev_code = 'JOBD_TRANSPORT_REQUIRED'.
      ev_msg = |{ iv_verb } of a job definition requires transportRequest for package { iv_package }|.
      RETURN.
    ENDIF.

    DATA(lv_request) = condense( val = iv_transport ).
    IF lv_request IS INITIAL
       OR strlen( lv_request ) > 20
       OR lv_request CN 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.
      ev_code = 'JOBD_TRANSPORT_INVALID'.
      ev_msg = |transportRequest '{ lv_request }' is not a valid request number|.
    ENDIF.
  ENDMETHOD.

  METHOD corr_insert.
    " RS_CORR_INSERT with an explicit request is the same dialog-free
    " TADIR/transport path the DDIC ICF writes use (mode I/D + suppress_dialog).
    DATA: lv_korrnum TYPE trkorr,
          lv_mode    TYPE char1,
          lv_use_req TYPE trpari-s_checked.

    lv_korrnum = iv_transport.
    lv_mode = iv_mode.
    IF lv_korrnum IS NOT INITIAL.
      lv_use_req = abap_true.
    ELSE.
      lv_use_req = abap_false.
    ENDIF.

    CALL FUNCTION 'RS_CORR_INSERT'
      EXPORTING
        object                   = iv_name
        object_class             = 'JOBD'
        devclass                 = iv_package
        master_language          = sy-langu
        korrnum                  = lv_korrnum
        mode                     = lv_mode
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
        ev_code = 'JOBD_TRANSPORT_REQUIRED'.
        ev_msg = last_message( ).
        IF ev_msg IS INITIAL.
          ev_msg = |package { iv_package } is not a local package but no usable transport request was supplied (subject to transport recording)|.
        ENDIF.
      WHEN 2.
        ev_http_code = 403.
        ev_code = 'JOBD_NOT_AUTHORIZED'.
        ev_msg = last_message( ).
        IF ev_msg IS INITIAL.
          ev_msg = |not authorized to record job definition { iv_name } in package { iv_package }|.
        ENDIF.
      WHEN OTHERS.
        ev_http_code = 500.
        ev_code = 'JOBD_PACKAGE_ERROR'.
        ev_msg = last_message( ).
        IF ev_msg IS INITIAL.
          ev_msg = |cannot record job definition { iv_name } in package { iv_package } (sy-subrc { sy-subrc })|.
        ENDIF.
    ENDCASE.
    IF ev_author IS INITIAL.
      ev_author = sy-uname.
    ENDIF.
  ENDMETHOD.

  METHOD apply_doc.
    " Overwrite the editable document fields on the class' flat structure.
    " MOVE-CORRESPONDING needs identical component names: the wire document
    " mirrors STJR_JOBD_ROOT / STJR_JOBD_TREP one-to-one.
    MOVE-CORRESPONDING is_doc TO cs_attr.
  ENDMETHOD.

  METHOD tadir_delete.
    " TR_TADIR_INTERFACE is the background-safe TADIR path; its delete mode
    " only accepts a TADIR entry once the object data is gone. The
    " direct fallback keeps the directory consistent even when the interface
    " declines (e.g. a leftover orphan row from an earlier write).
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
        wi_tadir_object       = 'JOBD'
        wi_tadir_obj_name     = lv_name
        wi_tadir_korrnum      = lv_korr
        wi_tadir_devclass     = iv_package
        wi_tadir_author       = sy-uname
        wi_tadir_masterlang   = sy-langu
      EXCEPTIONS
        OTHERS                = 1.

    SELECT SINGLE * FROM tadir INTO @ls_tadir
      WHERE pgmid = 'R3TR' AND object = 'JOBD' AND obj_name = @iv_name.
    IF sy-subrc = 0.
      DELETE FROM tadir
        WHERE pgmid = 'R3TR' AND object = 'JOBD' AND obj_name = @iv_name.
    ENDIF.
    COMMIT WORK.
  ENDMETHOD.

  METHOD set_attr.
    " The class structure is created dynamically (release-dependent), so its
    " components can only be addressed through ASSIGN COMPONENT.
    FIELD-SYMBOLS <lv_field> TYPE any.
    ASSIGN COMPONENT iv_component OF STRUCTURE cs_attr TO <lv_field>.
    IF sy-subrc = 0.
      <lv_field> = iv_value.
    ENDIF.
  ENDMETHOD.

  METHOD patch_persisted_row.
    " STJR is a job-repository table that releases without JOBD support do not
    " ship. Address it through a dynamic name and a dynamic row so this class
    " still compiles and activates there (the route answers JOBD_UNSUPPORTED
    " before any table access).
    DATA lv_table TYPE tabname VALUE 'STJR_JOBD_ROOT'.
    DATA lr_row TYPE REF TO data.
    FIELD-SYMBOLS:
      <ls_row>   TYPE any,
      <lv_field> TYPE any.

    CREATE DATA lr_row TYPE ('STJR_JOBD_ROOT').
    ASSIGN lr_row->* TO <ls_row>.
    SELECT SINGLE * FROM (lv_table) INTO <ls_row>
      WHERE name = @iv_name AND is_active = @abap_true.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.

    ASSIGN COMPONENT 'JDPACKAGE' OF STRUCTURE <ls_row> TO <lv_field>.
    IF sy-subrc = 0.
      <lv_field> = iv_package.
    ENDIF.
    ASSIGN COMPONENT 'OWNER' OF STRUCTURE <ls_row> TO <lv_field>.
    IF sy-subrc = 0.
      IF <lv_field> IS INITIAL.
        <lv_field> = iv_author.
      ENDIF.
    ENDIF.
    MODIFY (lv_table) FROM <ls_row>.
  ENDMETHOD.

  METHOD jobd_available.
    DATA lr_probe TYPE REF TO data.
    TRY.
        CREATE DATA lr_probe TYPE ('CL_JR_JOB_DEFINITION=>TY_JOB_DEFINITION').
        rv_available = abap_true.
      CATCH cx_root.
        rv_available = abap_false.
    ENDTRY.
  ENDMETHOD.

  METHOD job_exists.
    DATA lv_jd_name TYPE c LENGTH 32.
    lv_jd_name = iv_name.
    CALL METHOD ('CL_JR_JD_MANAGER')=>('CHECK_JD_EXISTENCE')
      EXPORTING
        im_jd_name     = lv_jd_name
      IMPORTING
        ex_is_existing = rv_exists.
  ENDMETHOD.

  METHOD find_package.
    SELECT SINGLE devclass FROM tadir INTO @rv_package
      WHERE pgmid = 'R3TR' AND object = 'JOBD' AND obj_name = @iv_name.
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
                   iv_status  = iv_status
                   iv_reason  = SWITCH string( iv_status
                                               WHEN 400 THEN 'Bad Request'
                                               WHEN 403 THEN 'Forbidden'
                                               WHEN 404 THEN 'Not Found'
                                               WHEN 405 THEN 'Method Not Allowed'
                                               WHEN 409 THEN 'Conflict'
                                               WHEN 501 THEN 'Not Implemented'
                                               ELSE 'Internal Server Error' )
                   iv_code    = iv_code
                   iv_msg     = iv_msg ).
  ENDMETHOD.
ENDCLASS.
