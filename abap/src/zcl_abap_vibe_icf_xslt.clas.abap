CLASS zcl_abap_vibe_icf_xslt DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CONSTANTS gc_name_max_length TYPE i VALUE 30.
    CONSTANTS gc_description_max_length TYPE i VALUE 60.
    " O2PAGELINE-LINE is CHAR 255: longer source lines would be truncated by
    " the O2 API, so the handler rejects them with a clear error instead.
    CONSTANTS gc_source_line_max_length TYPE i VALUE 255.

    CLASS-METHODS dispatch_xslt
      IMPORTING io_server TYPE REF TO if_http_server
                iv_path   TYPE string
                iv_method TYPE string
                iv_body   TYPE string.

  PRIVATE SECTION.
    " ----- /xslt/<name> read -----
    CLASS-METHODS read_xslt
      IMPORTING iv_name        TYPE string
      EXPORTING es_payload     TYPE zcl_abap_vibe_icf_types=>ty_xslt_data
                ev_error_code  TYPE string
                ev_error_msg   TYPE string.
    " ----- /xslt/<name> write / delete -----
    CLASS-METHODS write_xslt
      IMPORTING io_server TYPE REF TO if_http_server
                iv_name   TYPE string
                iv_body   TYPE string.
    CLASS-METHODS delete_xslt
      IMPORTING io_server TYPE REF TO if_http_server
                iv_name   TYPE string
                iv_body   TYPE string.
    " ----- helpers -----
    CLASS-METHODS load_xslt
      IMPORTING iv_name        TYPE string
      EXPORTING ev_subrc       TYPE i
                ev_message     TYPE string
      RETURNING VALUE(ro_xslt) TYPE REF TO cl_o2_api_xsltdesc.
    CLASS-METHODS recreate_xslt
      IMPORTING iv_name        TYPE string
                iv_source      TYPE string
                iv_description TYPE string
                iv_language    TYPE sy-langu
                iv_package     TYPE devclass
                iv_transport   TYPE trkorr
      EXPORTING ev_subrc       TYPE i
                ev_error_code  TYPE string
                ev_error_msg   TYPE string
                ev_details     TYPE string_table.
    CLASS-METHODS iso_to_sap_language
      IMPORTING iv_iso                 TYPE string
      RETURNING VALUE(rv_sap_language) TYPE sy-langu.
    CLASS-METHODS iso_from_sap_language
      IMPORTING iv_sap_language        TYPE sy-langu
      RETURNING VALUE(rv_iso_language) TYPE string.
    CLASS-METHODS source_to_lines
      IMPORTING iv_source        TYPE string
      EXPORTING et_lines         TYPE o2pageline_table
                ev_subrc         TYPE i
                ev_long_line     TYPE i.
    CLASS-METHODS activation_errors
      IMPORTING it_errors        TYPE o2xslterrt
      RETURNING VALUE(rt_details) TYPE string_table.
    CLASS-METHODS respond_write_error
      IMPORTING io_server TYPE REF TO if_http_server
                iv_status TYPE i
                iv_code   TYPE string
                iv_msg    TYPE string
                iv_details TYPE string_table OPTIONAL.
    CLASS-METHODS last_message
      RETURNING VALUE(rv_message) TYPE string.
ENDCLASS.

CLASS zcl_abap_vibe_icf_xslt IMPLEMENTATION.
  METHOD dispatch_xslt.
    " /xslt/<name>  —  Read/write XSLT transformation programs as
    " abap-file-format xslt-v1 (.xslt.json metadata + .xslt.xml source).
    "
    "   GET    → active source + header metadata
    "   POST   → upsert (create, or update by delete + recreate)
    "   PUT    → same as POST
    "   DELETE → delete the transformation
    "
    " The source is stored/read through CL_O2_API_XSLTDESC; the API adds one
    " trailing line break to the read-back source (get_source_string joins the
    " line table with CRLF), so the CLI normalizes line endings on both sides.
    DATA lv_match_name TYPE string.

    FIND REGEX '^/xslt/(.+)$' IN iv_path IGNORING CASE SUBMATCHES lv_match_name.
    IF sy-subrc <> 0 OR lv_match_name IS INITIAL.
      respond_write_error( io_server = io_server
                           iv_status = 400
                           iv_code   = 'XSLT_SERVICE_INVALID'
                           iv_msg    = 'Transformation name is required' ).
      RETURN.
    ENDIF.

    DATA(lv_name) = to_upper( condense( val = lv_match_name del = ` ` ) ).
    IF strlen( lv_name ) > gc_name_max_length OR lv_name CS ` `.
      respond_write_error( io_server = io_server
                           iv_status = 400
                           iv_code   = 'XSLT_NAME_INVALID'
                           iv_msg    = |transformation name must be at most { gc_name_max_length } characters without whitespace (got '{ lv_name }')| ).
      RETURN.
    ENDIF.

    IF iv_method = 'GET'.
      DATA ls_payload TYPE zcl_abap_vibe_icf_types=>ty_xslt_data.
      DATA lv_error_code TYPE string.
      DATA lv_error_msg TYPE string.
      read_xslt( EXPORTING iv_name       = lv_name
                 IMPORTING es_payload    = ls_payload
                           ev_error_code = lv_error_code
                           ev_error_msg  = lv_error_msg ).
      IF lv_error_code IS NOT INITIAL.
        respond_write_error( io_server = io_server
                             iv_status = COND i( WHEN lv_error_code = 'XSLT_OBJECT_NOT_FOUND' THEN 404 ELSE 500 )
                             iv_code   = lv_error_code
                             iv_msg    = lv_error_msg ).
        RETURN.
      ENDIF.
      zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                    iv_status = 200
                    iv_reason = 'OK'
                    is_payload = VALUE zcl_abap_vibe_icf_types=>ty_xslt_get( status = 'success'
                                                                              data   = ls_payload ) ).
      RETURN.
    ENDIF.

    IF iv_method = 'POST' OR iv_method = 'PUT'.
      write_xslt( io_server = io_server
                  iv_name   = lv_name
                  iv_body   = iv_body ).
      RETURN.
    ENDIF.

    IF iv_method = 'DELETE'.
      delete_xslt( io_server = io_server
                   iv_name   = lv_name
                   iv_body   = iv_body ).
      RETURN.
    ENDIF.

    respond_write_error( io_server = io_server
                         iv_status = 405
                         iv_code   = 'METHOD_NOT_ALLOWED'
                         iv_msg    = |{ iv_method } not supported on /xslt/{ lv_name }| ).
  ENDMETHOD.

  METHOD read_xslt.
    CLEAR: es_payload, ev_error_code, ev_error_msg.
    DATA lv_subrc TYPE i.
    DATA lv_message TYPE string.
    DATA(lo_xslt) = load_xslt( EXPORTING iv_name    = iv_name
                               IMPORTING ev_subrc  = lv_subrc
                                         ev_message = lv_message ).
    IF lo_xslt IS NOT BOUND OR lv_subrc <> 0.
      IF lv_subrc = 2.
        ev_error_code = 'XSLT_OBJECT_NOT_FOUND'.
        ev_error_msg  = |Transformation { iv_name } not found|.
      ELSE.
        ev_error_code = 'XSLT_LOAD_FAILED'.
        ev_error_msg  = |Cannot load transformation { iv_name }: { lv_message }|.
      ENDIF.
      RETURN.
    ENDIF.

    DATA ls_attr TYPE o2xsltattr.
    CALL METHOD lo_xslt->get_attributes
      RECEIVING p_attributes     = ls_attr
      EXCEPTIONS object_invalid  = 1
                 xsltdesc_deleted = 2
                 OTHERS           = 3.
    IF sy-subrc <> 0.
      ev_error_code = 'XSLT_LOAD_FAILED'.
      ev_error_msg  = |Cannot read attributes of transformation { iv_name } (rc { sy-subrc })|.
      RETURN.
    ENDIF.

    es_payload-name              = to_upper( condense( val = ls_attr-xsltdesc del = ` ` ) ).
    es_payload-description       = condense( val = ls_attr-descript ).
    es_payload-original_language = iso_from_sap_language( ls_attr-langu ).
    es_payload-source            = lo_xslt->get_source_string( ).
    es_payload-package           = to_upper( condense( val = ls_attr-devclass del = ` ` ) ).
  ENDMETHOD.

  METHOD write_xslt.
    DATA ls_request TYPE zcl_abap_vibe_icf_types=>ty_xslt_write_request.
    DATA lv_action TYPE string.

    IF iv_body IS INITIAL.
      respond_write_error( io_server = io_server
                           iv_status = 400
                           iv_code   = 'XSLT_INVALID_PAYLOAD'
                           iv_msg    = 'request body is empty' ).
      RETURN.
    ENDIF.
    TRY.
        /ui2/cl_json=>deserialize( EXPORTING json        = iv_body
                                             pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                                   CHANGING  data        = ls_request ).
      CATCH cx_root INTO DATA(lx_parse).
        respond_write_error( io_server = io_server
                             iv_status = 400
                             iv_code   = 'XSLT_INVALID_PAYLOAD'
                             iv_msg    = |invalid JSON payload: { lx_parse->get_text( ) }| ).
        RETURN.
    ENDTRY.

    IF ls_request-name IS NOT INITIAL AND to_upper( condense( val = ls_request-name del = ` ` ) ) <> iv_name.
      respond_write_error( io_server = io_server
                           iv_status = 400
                           iv_code   = 'XSLT_NAME_MISMATCH'
                           iv_msg    = |payload name { ls_request-name } does not match URL transformation { iv_name }| ).
      RETURN.
    ENDIF.

    DATA(lv_description) = condense( val = ls_request-header-description ).
    IF lv_description IS INITIAL.
      respond_write_error( io_server = io_server
                           iv_status = 400
                           iv_code   = 'XSLT_DESCRIPTION_REQUIRED'
                           iv_msg    = 'header.description is required' ).
      RETURN.
    ENDIF.
    IF strlen( lv_description ) > gc_description_max_length.
      respond_write_error( io_server = io_server
                           iv_status = 400
                           iv_code   = 'XSLT_DESCRIPTION_TOO_LONG'
                           iv_msg    = |description must not exceed { gc_description_max_length } characters (got { strlen( lv_description ) })| ).
      RETURN.
    ENDIF.

    IF ls_request-source IS INITIAL.
      respond_write_error( io_server = io_server
                           iv_status = 400
                           iv_code   = 'XSLT_SOURCE_REQUIRED'
                           iv_msg    = 'source is required (the .xslt.xml companion content)' ).
      RETURN.
    ENDIF.

    DATA(lv_language_iso) = to_upper( condense( val = ls_request-header-original_language del = ` ` ) ).
    DATA lv_language TYPE sy-langu.
    DATA lv_package TYPE devclass.
    DATA lv_transport TYPE trkorr.
    lv_package = to_upper( condense( val = ls_request-package del = ` ` ) ).
    lv_transport = to_upper( condense( val = ls_request-transport_request del = ` ` ) ).

    DATA lo_existing TYPE REF TO cl_o2_api_xsltdesc.
    DATA ls_attr TYPE o2xsltattr.
    DATA lv_subrc TYPE i.
    DATA lv_message TYPE string.
    DATA lv_exists TYPE char1.
    lv_exists = cl_o2_api_xsltdesc=>exists( CONV cxsltdesc( iv_name ) ).
    IF lv_exists = '1'.
      lv_action = 'updated'.
      " The API class is designed around create/delete/recreate (the same
      " sequence abapGit uses); an existing transformation is replaced with
      " the payload attributes and source.
      lo_existing = load_xslt( EXPORTING iv_name    = iv_name
                               IMPORTING ev_subrc  = lv_subrc
                                         ev_message = lv_message ).
      IF lo_existing IS NOT BOUND OR lv_subrc <> 0.
        respond_write_error( io_server = io_server
                             iv_status = 500
                             iv_code   = 'XSLT_LOAD_FAILED'
                             iv_msg    = |Cannot load existing transformation { iv_name }: { lv_message }| ).
        RETURN.
      ENDIF.
      CALL METHOD lo_existing->get_attributes
        RECEIVING p_attributes     = ls_attr
        EXCEPTIONS object_invalid  = 1
                   xsltdesc_deleted = 2
                   OTHERS           = 3.
      IF sy-subrc <> 0.
        respond_write_error( io_server = io_server
                             iv_status = 500
                             iv_code   = 'XSLT_LOAD_FAILED'
                             iv_msg    = |Cannot read attributes of transformation { iv_name } (rc { sy-subrc })| ).
        RETURN.
      ENDIF.
      IF lv_package IS INITIAL.
        lv_package = to_upper( condense( val = ls_attr-devclass del = ` ` ) ).
      ENDIF.
      IF lv_language_iso IS INITIAL AND ls_attr-langu IS NOT INITIAL.
        lv_language = ls_attr-langu.
      ENDIF.
    ELSE.
      lv_action = 'created'.
    ENDIF.

    " Empty / unknown ISO language falls back to the current SAP language for
    " new objects, and to the existing attribute for updates (set above).
    IF lv_language IS INITIAL.
      lv_language = iso_to_sap_language( lv_language_iso ).
    ENDIF.

    IF lv_package IS INITIAL.
      lv_package = '$TMP'.
    ENDIF.
    IF lv_package = '$TMP'.
      CLEAR lv_transport.
    ELSEIF lv_transport IS INITIAL.
      respond_write_error( io_server = io_server
                           iv_status = 400
                           iv_code   = 'XSLT_TRANSPORT_REQUIRED'
                           iv_msg    = |package { lv_package } is transportable; transportRequest is required| ).
      RETURN.
    ENDIF.

    DATA lv_error_code TYPE string.
    DATA lv_error_msg TYPE string.
    DATA lt_details TYPE string_table.
    DATA lt_errors TYPE o2xslterrt.
    DATA lt_source TYPE o2pageline_table.
    DATA lv_line_subrc TYPE i.
    DATA lv_long_line TYPE i.
    source_to_lines( EXPORTING iv_source    = ls_request-source
                     IMPORTING et_lines     = lt_source
                               ev_subrc     = lv_line_subrc
                               ev_long_line = lv_long_line ).
    IF lv_line_subrc <> 0.
      respond_write_error( io_server = io_server
                           iv_status = 400
                           iv_code   = 'XSLT_SOURCE_LINE_TOO_LONG'
                           iv_msg    = |source line exceeds { gc_source_line_max_length } characters ({ lv_long_line }); split the line before pushing| ).
      RETURN.
    ENDIF.

    IF lv_action = 'updated'.
      " In-place update through the O2 API: lock the object, replace source and
      " attributes, save, activate, unlock. The API class also offers
      " create/delete, but recreating the same name in one LUW left objects
      " whose source cluster was not readable back (verified on S/4HANA).
      CALL METHOD lo_existing->set_changeable
        EXPORTING p_changeable = abap_true
        EXCEPTIONS OTHERS      = 1.
      IF sy-subrc <> 0.
        respond_write_error( io_server = io_server
                             iv_status = 500
                             iv_code   = 'XSLT_WRITE_CANCELLED'
                             iv_msg    = |Cannot lock transformation { iv_name } for update (rc { sy-subrc })| ).
        RETURN.
      ENDIF.

      IF condense( val = ls_attr-descript ) <> lv_description.
        ls_attr-descript = lv_description.
        CALL METHOD lo_existing->set_attributes
          EXPORTING p_attributes = ls_attr
          EXCEPTIONS object_deleted       = 1
                     object_invalid       = 2
                     object_not_changeable = 3
                     OTHERS               = 4.
        IF sy-subrc <> 0.
          CALL METHOD lo_existing->set_changeable EXPORTING p_changeable = abap_false EXCEPTIONS OTHERS = 1.
          respond_write_error( io_server = io_server
                               iv_status = 500
                               iv_code   = 'XSLT_WRITE_CANCELLED'
                               iv_msg    = |Cannot update description of transformation { iv_name } (rc { sy-subrc })| ).
          RETURN.
        ENDIF.
      ENDIF.

      CALL METHOD lo_existing->set_source
        EXPORTING p_source = lt_source
        EXCEPTIONS object_deleted        = 1
                   object_invalid        = 2
                   object_not_changeable = 3
                   OTHERS                = 4.
      IF sy-subrc <> 0.
        CALL METHOD lo_existing->set_changeable EXPORTING p_changeable = abap_false EXCEPTIONS OTHERS = 1.
        respond_write_error( io_server = io_server
                             iv_status = 500
                             iv_code   = 'XSLT_WRITE_CANCELLED'
                             iv_msg    = |Cannot replace source of transformation { iv_name } (rc { sy-subrc })| ).
        RETURN.
      ENDIF.

      CALL METHOD lo_existing->save
        EXPORTING i_suppress_dialog = abap_true
        CHANGING  p_transport_request = lv_transport
        EXCEPTIONS action_cancelled      = 1
                   error_occured         = 2
                   object_invalid        = 3
                   object_not_changeable = 4
                   permission_failure    = 5
                   OTHERS                = 6.
      IF sy-subrc <> 0.
        CALL METHOD lo_existing->set_changeable EXPORTING p_changeable = abap_false EXCEPTIONS OTHERS = 1.
        respond_write_error( io_server = io_server
                             iv_status = 500
                             iv_code   = 'XSLT_WRITE_CANCELLED'
                             iv_msg    = |Cannot save transformation { iv_name } (rc { sy-subrc })| ).
        RETURN.
      ENDIF.
      " Source export must be committed before activate reloads it (see the
      " create path comment).
      COMMIT WORK AND WAIT.

      CALL METHOD lo_existing->activate
        IMPORTING e_error_list = lt_errors
        CHANGING  i_transport_request = lv_transport
        EXCEPTIONS generate_error    = 1
                   storage_error     = 2
                   syntax_errors     = 3
                   xtc_not_available = 4
                   OTHERS            = 5.
      DATA(lv_activate_rc) = sy-subrc.
      CALL METHOD lo_existing->set_changeable EXPORTING p_changeable = abap_false EXCEPTIONS OTHERS = 1.
      IF lv_activate_rc <> 0.
        COMMIT WORK AND WAIT.
        respond_write_error( io_server = io_server
                             iv_status = 500
                             iv_code   = 'XSLT_ACTIVATION_FAILED'
                             iv_msg    = |activation failed (rc { lv_activate_rc })|
                             iv_details = activation_errors( lt_errors ) ).
        RETURN.
      ENDIF.
      COMMIT WORK AND WAIT.
    ELSE.
      recreate_xslt( EXPORTING iv_name        = iv_name
                               iv_source      = ls_request-source
                               iv_description = lv_description
                               iv_language    = lv_language
                               iv_package     = lv_package
                               iv_transport   = lv_transport
                     IMPORTING ev_subrc      = lv_subrc
                               ev_error_code = lv_error_code
                               ev_error_msg  = lv_error_msg
                               ev_details    = lt_details ).
      IF lv_subrc <> 0.
        respond_write_error( io_server = io_server
                             iv_status = 500
                             iv_code   = lv_error_code
                             iv_msg    = lv_error_msg
                             iv_details = lt_details ).
        RETURN.
      ENDIF.
    ENDIF.

    zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                  iv_status = 200
                  iv_reason = 'OK'
                  is_payload = VALUE zcl_abap_vibe_icf_types=>ty_xslt_write(
                                     status = 'success'
                                     data   = VALUE zcl_abap_vibe_icf_types=>ty_xslt_write_data(
                                                      name   = iv_name
                                                      action = lv_action ) ) ).
  ENDMETHOD.

  METHOD delete_xslt.
    DATA lv_subrc TYPE i.
    DATA lv_message TYPE string.
    DATA(lo_xslt) = load_xslt( EXPORTING iv_name    = iv_name
                               IMPORTING ev_subrc  = lv_subrc
                                         ev_message = lv_message ).
    IF lo_xslt IS NOT BOUND OR lv_subrc <> 0.
      IF lv_subrc = 2.
        respond_write_error( io_server = io_server
                             iv_status = 404
                             iv_code   = 'XSLT_OBJECT_NOT_FOUND'
                             iv_msg    = |Transformation { iv_name } not found| ).
      ELSE.
        respond_write_error( io_server = io_server
                             iv_status = 500
                             iv_code   = 'XSLT_LOAD_FAILED'
                             iv_msg    = |Cannot load transformation { iv_name }: { lv_message }| ).
      ENDIF.
      RETURN.
    ENDIF.

    DATA ls_request TYPE zcl_abap_vibe_icf_types=>ty_xslt_write_request.
    IF iv_body IS NOT INITIAL.
      TRY.
          /ui2/cl_json=>deserialize( EXPORTING json        = iv_body
                                               pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                                     CHANGING  data        = ls_request ).
        CATCH cx_root.
          " A malformed delete body is irrelevant — deletion only needs the
          " transport, which stays empty and SAP treats $TMP objects locally.
      ENDTRY.
    ENDIF.
    DATA lv_transport TYPE trkorr.
    lv_transport = to_upper( condense( val = ls_request-transport_request del = ` ` ) ).

    CALL METHOD lo_xslt->set_changeable
      EXPORTING p_changeable = abap_true
      EXCEPTIONS OTHERS      = 1.
    IF sy-subrc <> 0.
      respond_write_error( io_server = io_server
                           iv_status = 500
                           iv_code   = 'XSLT_DELETE_FAILED'
                           iv_msg    = |Cannot lock transformation { iv_name } for deletion (rc { sy-subrc })| ).
      RETURN.
    ENDIF.
    CALL METHOD lo_xslt->delete
      EXCEPTIONS object_invalid        = 1
                 object_not_changeable = 2
                 OTHERS                = 3.
    IF sy-subrc <> 0.
      CALL METHOD lo_xslt->set_changeable EXPORTING p_changeable = abap_false EXCEPTIONS OTHERS = 1.
      respond_write_error( io_server = io_server
                           iv_status = 500
                           iv_code   = 'XSLT_DELETE_FAILED'
                           iv_msg    = |Cannot delete transformation { iv_name } (rc { sy-subrc })| ).
      RETURN.
    ENDIF.
    " delete() only marks the object; save() persists the removal.
    CALL METHOD lo_xslt->save
      EXPORTING i_suppress_dialog = abap_true
      CHANGING  p_transport_request = lv_transport
      EXCEPTIONS action_cancelled      = 1
                 error_occured         = 2
                 object_invalid        = 3
                 object_not_changeable = 4
                 permission_failure    = 5
                 OTHERS                = 6.
    IF sy-subrc <> 0.
      CALL METHOD lo_xslt->set_changeable EXPORTING p_changeable = abap_false EXCEPTIONS OTHERS = 1.
      respond_write_error( io_server = io_server
                           iv_status = 500
                           iv_code   = 'XSLT_DELETE_FAILED'
                           iv_msg    = |Cannot save deletion of transformation { iv_name } (rc { sy-subrc })| ).
      RETURN.
    ENDIF.
    CALL METHOD lo_xslt->set_changeable EXPORTING p_changeable = abap_false EXCEPTIONS OTHERS = 1.

    COMMIT WORK AND WAIT.

    zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                  iv_status = 200
                  iv_reason = 'OK'
                  is_payload = VALUE zcl_abap_vibe_icf_types=>ty_xslt_write(
                                     status = 'success'
                                     data   = VALUE zcl_abap_vibe_icf_types=>ty_xslt_write_data(
                                                      name   = iv_name
                                                      action = 'deleted' ) ) ).
  ENDMETHOD.

  METHOD load_xslt.
    " Load a transformation. EV_SUBRC is the raw CL_O2_API_XSLTDESC=>load
    " subrc (2 = not_existing) so callers can distinguish 404 from 5xx.
    "
    " Read the ACTIVE version explicitly: with no desired state the class API
    " may resolve the inactive version and raise not_existing once activation
    " has removed it. Fall back to the default resolution for objects that only
    " have an inactive version (still readable / deletable by the CLI).
    CLEAR: ro_xslt, ev_subrc, ev_message.
    DATA lv_active TYPE r3state.
    lv_active = 'A'.
    CALL METHOD cl_o2_api_xsltdesc=>load
      EXPORTING p_xslt_desc     = CONV cxsltdesc( iv_name )
                p_desired_state = lv_active
      IMPORTING p_obj           = ro_xslt
      EXCEPTIONS error_occured      = 1
                 not_existing       = 2
                 permission_failure = 3
                 version_not_found  = 4
                 OTHERS             = 5.
    ev_subrc = sy-subrc.
    IF ev_subrc = 2 OR ev_subrc = 4.
      CLEAR ro_xslt.
      CALL METHOD cl_o2_api_xsltdesc=>load
        EXPORTING p_xslt_desc = CONV cxsltdesc( iv_name )
        IMPORTING p_obj       = ro_xslt
        EXCEPTIONS error_occured      = 1
                   not_existing       = 2
                   permission_failure = 3
                   version_not_found  = 4
                   OTHERS             = 5.
      ev_subrc = sy-subrc.
    ENDIF.
    IF sy-subrc <> 0.
      ev_message = last_message( ).
      IF ev_message IS INITIAL.
        ev_message = |CL_O2_API_XSLTDESC=>load rc { sy-subrc }|.
      ENDIF.
    ENDIF.
  ENDMETHOD.

  METHOD recreate_xslt.
    " Create a transformation from a flat source string, then save + activate.
    CLEAR: ev_subrc, ev_error_code, ev_error_msg, ev_details.
    DATA lo_xslt TYPE REF TO cl_o2_api_xsltdesc.
    DATA ls_attr TYPE o2xsltattr.
    DATA lt_errors TYPE o2xslterrt.
    DATA lv_transport TYPE trkorr.
    lv_transport = iv_transport.

    ls_attr-xsltdesc = CONV cxsltdesc( iv_name ).
    ls_attr-devclass = iv_package.
    ls_attr-langu    = iv_language.
    ls_attr-descript = iv_description.

    " Create from a line table: create_new_from_string() derives its line table
    " through CL_O2_API_XSLTDESC->derive_transformation_source, which collapses
    " a CRLF-less source string into one >255-char line and truncates it.
    DATA lt_source TYPE o2pageline_table.
    DATA lv_line_subrc TYPE i.
    DATA lv_long_line TYPE i.
    source_to_lines( EXPORTING iv_source    = iv_source
                     IMPORTING et_lines     = lt_source
                               ev_subrc     = lv_line_subrc
                               ev_long_line = lv_long_line ).
    IF lv_line_subrc <> 0.
      ev_subrc = lv_line_subrc.
      ev_error_code = 'XSLT_SOURCE_LINE_TOO_LONG'.
      ev_error_msg = |source line exceeds { gc_source_line_max_length } characters ({ lv_long_line }); split the line before pushing|.
      RETURN.
    ENDIF.

    CALL METHOD cl_o2_api_xsltdesc=>create_new
      EXPORTING p_source = lt_source
                p_attr   = ls_attr
      IMPORTING p_obj    = lo_xslt
      EXCEPTIONS action_cancelled            = 1
                 error_occured               = 2
                 not_authorized              = 3
                 object_already_existing     = 4
                 undefined_name              = 5
                 language_version_inadmissible = 6
                 OTHERS                      = 7.
    IF sy-subrc <> 0.
      ev_subrc = sy-subrc.
      ev_error_code = SWITCH string( sy-subrc
        WHEN 1 THEN 'XSLT_WRITE_CANCELLED'
        WHEN 2 THEN 'XSLT_CREATE_FAILED'
        WHEN 3 THEN 'XSLT_NOT_AUTHORIZED'
        WHEN 4 THEN 'XSLT_OBJECT_EXISTS'
        WHEN 5 THEN 'XSLT_NAME_INVALID'
        ELSE 'XSLT_CREATE_FAILED' ).
      ev_error_msg = last_message( ).
      IF ev_error_msg IS INITIAL.
        ev_error_msg = |CL_O2_API_XSLTDESC=>create_new failed (rc { sy-subrc })|.
      ENDIF.
      RETURN.
    ENDIF.

    CALL METHOD lo_xslt->save
      EXPORTING i_suppress_dialog = abap_true
      CHANGING  p_transport_request = lv_transport
      EXCEPTIONS action_cancelled      = 1
                 error_occured         = 2
                 object_invalid        = 3
                 object_not_changeable = 4
                 permission_failure    = 5
                 OTHERS                = 6.
    IF sy-subrc <> 0.
      ev_subrc = sy-subrc.
      ev_error_code = 'XSLT_WRITE_CANCELLED'.
      ev_error_msg = last_message( ).
      IF ev_error_msg IS INITIAL.
        ev_error_msg = |CL_O2_API_XSLTDESC->save failed (rc { sy-subrc })|.
      ENDIF.
      CALL METHOD lo_xslt->set_changeable EXPORTING p_changeable = abap_false EXCEPTIONS OTHERS = 1.
      RETURN.
    ENDIF.

    " The O2 API stores the source through EXPORT TO DATABASE, which is only
    " visible to IMPORT after a commit. Activate internally reloads the
    " inactive version, so without an explicit commit here it can export an
    " empty active version (observed on S/4HANA: row exists, source unreadable).
    COMMIT WORK AND WAIT.

    CALL METHOD lo_xslt->activate
      IMPORTING e_error_list = lt_errors
      CHANGING  i_transport_request = lv_transport
      EXCEPTIONS generate_error    = 1
                 storage_error     = 2
                 syntax_errors     = 3
                 xtc_not_available = 4
                 OTHERS            = 5.
    DATA(lv_activate_rc) = sy-subrc.
    CALL METHOD lo_xslt->set_changeable EXPORTING p_changeable = abap_false EXCEPTIONS OTHERS = 1.
    IF lv_activate_rc <> 0.
      ev_subrc = lv_activate_rc.
      ev_error_code = 'XSLT_ACTIVATION_FAILED'.
      ev_error_msg = |activation failed (rc { lv_activate_rc })|.
      ev_details = activation_errors( lt_errors ).
      RETURN.
    ENDIF.
  ENDMETHOD.

  METHOD iso_to_sap_language.
    " AFF header.originalLanguage is a 2-character ISO code; T002 maps it to
    " the internal 1-character language key. Empty/unknown -> current language.
    rv_sap_language = sy-langu.
    DATA(lv_iso) = to_upper( condense( val = iv_iso del = ` ` ) ).
    IF lv_iso IS INITIAL.
      RETURN.
    ENDIF.
    SELECT SINGLE spras FROM t002 WHERE laiso = @lv_iso INTO @rv_sap_language.
    IF sy-subrc <> 0 OR rv_sap_language IS INITIAL.
      rv_sap_language = sy-langu.
    ENDIF.
  ENDMETHOD.

  METHOD iso_from_sap_language.
    rv_iso_language = 'EN'.
    IF iv_sap_language IS INITIAL.
      RETURN.
    ENDIF.
    SELECT SINGLE laiso FROM t002 WHERE spras = @iv_sap_language INTO @rv_iso_language.
    IF sy-subrc <> 0 OR rv_iso_language IS INITIAL.
      rv_iso_language = 'EN'.
    ENDIF.
  ENDMETHOD.

  METHOD source_to_lines.
    " Split the flat source string into the O2PAGELINE_TABLE the O2 API
    " expects. CRLF is normalised to LF first; a line longer than
    " O2PAGELINE-LINE (CHAR 255) is rejected instead of silently truncated.
    CLEAR: et_lines, ev_subrc, ev_long_line.
    DATA lv_source TYPE string.
    lv_source = iv_source.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>cr_lf IN lv_source
      WITH cl_abap_char_utilities=>newline.
    DATA lt_lines TYPE STANDARD TABLE OF string WITH EMPTY KEY.
    SPLIT lv_source AT cl_abap_char_utilities=>newline INTO TABLE lt_lines.
    DATA ls_line TYPE o2pageline.
    LOOP AT lt_lines INTO DATA(lv_line).
      IF strlen( lv_line ) > gc_source_line_max_length.
        ev_subrc = 4.
        ev_long_line = strlen( lv_line ).
        RETURN.
      ENDIF.
      CLEAR ls_line.
      ls_line-line = lv_line.
      APPEND ls_line TO et_lines.
    ENDLOOP.
  ENDMETHOD.

  METHOD activation_errors.
    CLEAR rt_details.
    LOOP AT it_errors INTO DATA(ls_err).
      DATA(lv_line) = COND string( WHEN ls_err-src_line > 0 THEN |line { ls_err-src_line }: | ELSE '' ).
      APPEND |{ lv_line }{ ls_err-text }| TO rt_details.
      IF lines( rt_details ) >= 20.
        EXIT.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD respond_write_error.
    IF iv_details IS SUPPLIED.
      zcl_abap_vibe_icf_response=>respond_error( io_server  = io_server
                     iv_status  = iv_status
                     iv_reason  = SWITCH string( iv_status WHEN 200 THEN 'OK' WHEN 404 THEN 'Not Found' WHEN 405 THEN 'Method Not Allowed' ELSE 'Bad Request' )
                     iv_code    = iv_code
                     iv_msg     = iv_msg
                     iv_details = iv_details ).
    ELSE.
      zcl_abap_vibe_icf_response=>respond_error( io_server  = io_server
                     iv_status  = iv_status
                     iv_reason  = SWITCH string( iv_status WHEN 200 THEN 'OK' WHEN 404 THEN 'Not Found' WHEN 405 THEN 'Method Not Allowed' ELSE 'Bad Request' )
                     iv_code    = iv_code
                     iv_msg     = iv_msg ).
    ENDIF.
  ENDMETHOD.

  METHOD last_message.
    CLEAR rv_message.
    IF sy-msgid IS INITIAL OR sy-msgno IS INITIAL.
      RETURN.
    ENDIF.
    MESSAGE ID sy-msgid TYPE 'S' NUMBER sy-msgno
      WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4 INTO rv_message.
  ENDMETHOD.
ENDCLASS.
