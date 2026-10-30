CLASS zcl_abap_vibe_icf_http DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS dispatch_http
      IMPORTING io_server   TYPE REF TO if_http_server
                iv_path     TYPE string
                iv_method   TYPE string
                iv_body     TYPE string.
  PRIVATE SECTION.
    " Reflect the ABAP language version of a handler class. Returns 'cloudDevelopment'
    " or 'standard'; falls back to 'standard' when the class cannot be introspected
    " (e.g. not yet activated, no RTTI access, or handler is empty).
    CLASS-METHODS resolve_handler_lang_version
      IMPORTING iv_class_name TYPE string
      RETURNING VALUE(rv_version) TYPE string.
ENDCLASS.

CLASS zcl_abap_vibe_icf_http IMPLEMENTATION.
  METHOD dispatch_http.
    DATA lv_match_name   TYPE string.
    DATA lv_url          TYPE string.
    DATA lv_parent_url   TYPE string.
    DATA lv_node_name_raw TYPE string.
    DATA lv_node_name    TYPE icfname.
    DATA lv_transport    TYPE trkorr.
    DATA lv_transport_raw TYPE string.
    DATA lv_guid         TYPE icfnodguid.
    DATA lv_parent_guid  TYPE icfparguid.
    DATA lv_service_name TYPE icfservice-icf_name.
    DATA lv_info_url     TYPE string.
    DATA ls_http         TYPE zcl_abap_vibe_icf_types=>ty_http_service_data.
    DATA ls_docu         TYPE icfdocu.
    DATA ls_insert_docu  TYPE icfdocu.
    DATA ls_icfserdesc   TYPE icfserdesc.
    DATA ls_existing_service TYPE icfservice.
    DATA ls_current_service TYPE icfservice.
    DATA lt_serv_info    TYPE icfservtbl.
    DATA ls_serv_info    LIKE LINE OF lt_serv_info.
    DATA ls_handler      TYPE icfhandler.
    DATA lt_existing     TYPE TABLE OF icfhandler.
    DATA lt_icfhndlist   TYPE icfhndlist.
    DATA lv_original_language TYPE string.
    DATA lv_alt_name      TYPE icfservice-icfaltnme.
    DATA lv_icf_message   TYPE string.
    DATA lv_change_subrc  TYPE sy-subrc.

    " Resolve the endpoint key to an SICF URL; a bare name means /sap/<name>.
    FIND REGEX '^/http/(.+)$' IN iv_path IGNORING CASE SUBMATCHES lv_match_name.
    IF sy-subrc <> 0 OR lv_match_name IS INITIAL.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code = 'HTTP_SERVICE_INVALID'
                     iv_msg = 'HTTP Service name is required' ).
      RETURN.
    ENDIF.

    IF iv_method = 'GET'.
      IF lv_match_name CP '/*'.
        lv_url = lv_match_name.
      ELSE.
        lv_url = |/sap/{ to_lower( lv_match_name ) }|.
      ENDIF.

      " Locate the node and read its canonical URL, documentation and handlers.
      CALL METHOD cl_icf_tree=>if_icf_tree~service_from_url
        EXPORTING
          url        = lv_url
          hostnumber = 0
        IMPORTING
          icfnodguid = lv_guid
        EXCEPTIONS
          wrong_url    = 4
          no_authority = 5
          OTHERS       = 99.
      IF sy-subrc <> 0.
        zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                       iv_status = 404
                       iv_reason = 'Not Found'
                       iv_code = 'HTTP_SERVICE_NOT_FOUND'
                       iv_msg = |SICF service not found: { lv_url }| ).
        RETURN.
      ENDIF.

      SELECT SINGLE *
        FROM icfservice
        WHERE icfnodguid = @lv_guid
        INTO @ls_existing_service.
      IF sy-subrc <> 0.
        zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                       iv_status = 404
                       iv_reason = 'Not Found'
                       iv_code = 'HTTP_SERVICE_NOT_FOUND'
                       iv_msg = |SICF service metadata not found: { lv_url }| ).
        RETURN.
      ENDIF.
      lv_service_name = ls_existing_service-icf_name.
      lv_parent_guid = ls_existing_service-icfparguid.

      CALL METHOD cl_icf_tree=>if_icf_tree~get_info_from_serv
        EXPORTING
          icf_name   = lv_service_name
          icfparguid = lv_parent_guid
          icf_langu  = sy-langu
        IMPORTING
          serv_info = lt_serv_info
          icfdocu   = ls_docu
          url       = lv_info_url
        EXCEPTIONS
          wrong_name        = 1
          wrong_parguid     = 2
          incorrect_service = 3
          no_authority      = 4
          OTHERS            = 5.
      IF sy-subrc <> 0 OR lt_serv_info IS INITIAL.
        zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                       iv_status = 500
                       iv_reason = 'Internal Server Error'
                       iv_code = 'HTTP_SERVICE_READ_FAILED'
                       iv_msg = |Could not read SICF service: { lv_url }| ).
        RETURN.
      ENDIF.

      READ TABLE lt_serv_info INDEX 1 INTO ls_serv_info.
      READ TABLE ls_serv_info-handlertbl INDEX 1 INTO ls_handler.
      CASE sy-langu.
        WHEN '1'. lv_original_language = 'ZH'.
        WHEN '2'. lv_original_language = 'KO'.
        WHEN 'D'. lv_original_language = 'DE'.
        WHEN 'E'. lv_original_language = 'EN'.
        WHEN 'F'. lv_original_language = 'FR'.
        WHEN 'I'. lv_original_language = 'IT'.
        WHEN 'J'. lv_original_language = 'JA'.
        WHEN 'N'. lv_original_language = 'NL'.
        WHEN 'P'. lv_original_language = 'PT'.
        WHEN 'R'. lv_original_language = 'RU'.
        WHEN 'S'. lv_original_language = 'ES'.
        WHEN OTHERS. lv_original_language = 'EN'.
      ENDCASE.

      " 037 US2 (S06): Read all language rows from ICFDOCU for descriptionByLang[].
      " ICFDOCU stores one row per (node, parentGuid, language); sy-langu row
      " is already in ls_docu — we add the remaining languages to the response.
      DATA lt_docu_all TYPE TABLE OF icfdocu.
      SELECT * FROM icfdocu
        WHERE icf_name = @lv_service_name
          AND icfparguid = @lv_parent_guid
        INTO TABLE @lt_docu_all.
      DATA lt_description_by_lang TYPE zcl_abap_vibe_icf_types=>tt_http_header_lang.
      LOOP AT lt_docu_all INTO DATA(ls_docu_all).
        " SWITCH maps sy-langu 1-char → ISO 639-1; no END/ENDCASE needed
        " (CASE inside DATA(lv_x) = ... is rejected by the compiler here).
        DATA(lv_lang) = SWITCH string( ls_docu_all-icf_langu
          WHEN '1' THEN 'ZH' WHEN '2' THEN 'KO' WHEN 'D' THEN 'DE'
          WHEN 'E' THEN 'EN' WHEN 'F' THEN 'FR' WHEN 'I' THEN 'IT'
          WHEN 'J' THEN 'JA' WHEN 'N' THEN 'NL' WHEN 'P' THEN 'PT'
          WHEN 'R' THEN 'RU' WHEN 'S' THEN 'ES'
          ELSE ls_docu_all-icf_langu ).
        APPEND VALUE zcl_abap_vibe_icf_types=>ty_http_header_lang(
          language    = lv_lang
          description = CONV string( ls_docu_all-icf_docu ) ) TO lt_description_by_lang.
      ENDLOOP.

      ls_http = VALUE #( format_version = '1'
                         header = VALUE #( description = COND #( WHEN ls_docu-icf_docu IS INITIAL
                                                                 THEN CONV string( lv_service_name )
                                                                 ELSE CONV string( ls_docu-icf_docu ) )
                                                                 original_language = lv_original_language
                                                                 abap_language_version = resolve_handler_lang_version( CONV string( ls_handler-icfhandler ) )
                                                                 description_by_lang = lt_description_by_lang )
                         general_information = VALUE #( handler_class = COND #( WHEN sy-subrc = 0
                                                                                 THEN CONV string( ls_handler-icfhandler )
                                                                                 ELSE `` )
                                                        url = COND #( WHEN lv_info_url IS INITIAL
                                                                       THEN lv_url
                                                                       ELSE lv_info_url )
                                                        service_id = lv_url ) ).
      zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                    iv_status = 200
                    iv_reason = 'OK'
                    is_payload = VALUE zcl_abap_vibe_icf_types=>ty_http_service( status = 'success' data = ls_http ) ).
      RETURN.
    ENDIF.

    IF iv_method <> 'POST'.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 405
                     iv_reason = 'Method Not Allowed'
                     iv_code = 'METHOD_NOT_ALLOWED'
                     iv_msg = |GET and POST only on /http/{ lv_match_name }| ).
      RETURN.
    ENDIF.

    " Deserialize the official HTTP Service JSON and extract transport separately.
    TRY.
        /ui2/cl_json=>deserialize( EXPORTING json = iv_body
                                                   pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                                          CHANGING data = ls_http ).
      CATCH cx_root INTO DATA(lx_json).
        zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                       iv_status = 400
                       iv_reason = 'Bad Request'
                       iv_code = 'HTTP_SERVICE_INVALID'
                       iv_msg = lx_json->get_text( ) ).
        RETURN.
    ENDTRY.

    FIND FIRST OCCURRENCE OF REGEX '"transportRequest"\s*:\s*"([^"]*)"'
      IN iv_body IGNORING CASE SUBMATCHES lv_transport_raw.
    IF sy-subrc = 0.
      lv_transport = lv_transport_raw.
    ENDIF.

    lv_url = ls_http-general_information-url.
    IF ls_http-format_version <> '1' OR ls_http-header-description IS INITIAL OR lv_url IS INITIAL.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code = 'HTTP_SERVICE_INVALID'
                     iv_msg = 'formatVersion, header.description and generalInformation.url are required' ).
      RETURN.
    ENDIF.

    WHILE strlen( lv_url ) > 1 AND substring( val = lv_url off = strlen( lv_url ) - 1 len = 1 ) = '/'.
      lv_url = substring( val = lv_url off = 0 len = strlen( lv_url ) - 1 ).
    ENDWHILE.

    FIND REGEX '^(.+)/([^/]+)$' IN lv_url SUBMATCHES lv_parent_url lv_node_name_raw.
    IF sy-subrc <> 0 OR lv_node_name_raw IS INITIAL OR strlen( lv_node_name_raw ) > 15.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code = 'HTTP_SERVICE_INVALID'
                     iv_msg = 'generalInformation.url must contain a SICF node name of at most 15 characters' ).
      RETURN.
    ENDIF.
    lv_node_name = to_lower( lv_node_name_raw ).
    IF lv_parent_url IS INITIAL.
      lv_parent_url = '/'.
    ENDIF.

    ls_docu-icf_langu = sy-langu.
    ls_docu-icf_docu = ls_http-header-description.
    ls_insert_docu = ls_docu-icf_docu.
    IF ls_http-general_information-handler_class IS NOT INITIAL.
      APPEND CONV icf_hand( ls_http-general_information-handler_class ) TO lt_icfhndlist.
    ENDIF.

    " Existing URLs are changed in place; new URLs create and activate a node.
    CALL METHOD cl_icf_tree=>if_icf_tree~service_from_url
      EXPORTING
        url        = lv_url
        hostnumber = 0
      IMPORTING
        icfnodguid = lv_guid
      EXCEPTIONS
        wrong_url    = 4
        no_authority = 5
        OTHERS       = 99.
    IF sy-subrc = 0.
      SELECT SINGLE *
        FROM icfservice
        WHERE icfnodguid = @lv_guid
        INTO @ls_existing_service.
      IF sy-subrc = 0 AND to_lower( ls_existing_service-icf_name ) = lv_node_name.
      lv_service_name = ls_existing_service-icf_name.
      lv_parent_guid = ls_existing_service-icfparguid.
      CALL METHOD cl_icf_tree=>if_icf_tree~get_info_from_serv
        EXPORTING
          icf_name   = lv_service_name
          icfparguid = lv_parent_guid
          icf_langu  = sy-langu
        IMPORTING
          serv_info = lt_serv_info
        EXCEPTIONS
          wrong_name        = 1
          wrong_parguid     = 2
          incorrect_service = 3
          no_authority      = 4
          OTHERS            = 5.
      IF sy-subrc <> 0 OR lt_serv_info IS INITIAL.
        zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                       iv_status = 500
                       iv_reason = 'Internal Server Error'
                       iv_code = 'HTTP_SERVICE_READ_FAILED'
                       iv_msg = |Could not read SICF service metadata: { lv_url }| ).
        RETURN.
      ENDIF.
      READ TABLE lt_serv_info INDEX 1 INTO ls_serv_info.
      lv_alt_name = ls_serv_info-service-icfaltnme.
      IF ls_serv_info-service-icfaltnme <> ls_serv_info-service-icfaltnme_orig.
        lv_alt_name = ls_serv_info-service-icfaltnme_orig.
      ENDIF.

      " CL_ICF_TREE rejects handlers that are already assigned to the node.
      SELECT * FROM icfhandler
        WHERE icf_name = @lv_service_name
          AND icfparguid = @lv_parent_guid
        INTO TABLE @lt_existing.
      LOOP AT lt_existing ASSIGNING FIELD-SYMBOL(<ls_existing>).
        DELETE TABLE lt_icfhndlist FROM <ls_existing>-icfhandler.
      ENDLOOP.

      MOVE-CORRESPONDING ls_serv_info-service TO ls_icfserdesc.
      CALL METHOD cl_icf_tree=>if_icf_tree~change_node
        EXPORTING
          icf_name   = ls_serv_info-service-orig_name
          icfaltnme  = lv_alt_name
          icfparguid = lv_parent_guid
          icfdocu    = ls_docu
          doculang   = sy-langu
          icfhandlst = lt_icfhndlist
          icfactive  = 'X'
          package    = '$TMP'
          application = ''
          icfserdesc = ls_icfserdesc
        EXCEPTIONS
          empty_icf_name            = 1
          no_new_virtual_host       = 2
          special_service_error     = 3
          parent_not_existing       = 4
          enqueue_error             = 5
          node_already_existing     = 6
          empty_docu                = 7
          doculang_not_installed    = 8
          security_info_error       = 9
          user_password_error       = 10
          password_encryption_error = 11
          invalid_url               = 12
          invalid_otr_concept       = 13
          formflg401_error          = 14
          handler_error             = 15
          transport_error           = 16
          tadir_error               = 17
          package_not_found         = 18
          wrong_application         = 19
          not_allow_application     = 20
          no_application            = 21
          invalid_icfparguid        = 22
          alt_name_invalid          = 23
          alternate_name_exist     = 24
          wrong_icf_name            = 25
          no_authority              = 26
          OTHERS                    = 27.
      lv_change_subrc = sy-subrc.
      IF sy-subrc <> 0.
        MESSAGE ID sy-msgid TYPE 'S' NUMBER sy-msgno
          WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4 INTO lv_icf_message.
        zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                       iv_status = 500
                       iv_reason = 'Internal Server Error'
                       iv_code = 'HTTP_SERVICE_WRITE_FAILED'
                       iv_msg = |SICF service update failed (subrc={ lv_change_subrc }, { sy-msgid } { sy-msgno }): { lv_icf_message }|
                         && |; name={ ls_existing_service-orig_name }, parent={ lv_parent_guid },|
                         && | alt={ lv_alt_name }, handlers={ lines( lt_icfhndlist ) }| ).
        RETURN.
      ENDIF.

      zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                    iv_status = 200
                    iv_reason = 'OK'
                    is_payload = VALUE zcl_abap_vibe_icf_types=>ty_http_write(
                      status = 'success'
                      data = VALUE #( name = lv_service_name type = 'HTTP' action = 'updated' ) ) ).
      RETURN.
    ENDIF.
    ENDIF.

    CALL METHOD cl_icf_tree=>if_icf_tree~service_from_url
      EXPORTING
        url        = lv_parent_url
        hostnumber = 0
      IMPORTING
        icfnodguid = lv_parent_guid
      EXCEPTIONS
        wrong_url    = 4
        no_authority = 5
        OTHERS       = 99.
    IF sy-subrc <> 0.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 404
                     iv_reason = 'Not Found'
                     iv_code = 'HTTP_SERVICE_PARENT_NOT_FOUND'
                     iv_msg = |SICF parent node not found: { lv_parent_url }| ).
      RETURN.
    ENDIF.

    lv_alt_name = lv_node_name.
    CALL METHOD cl_icf_tree=>if_icf_tree~insert_node
      EXPORTING
        icf_name   = lv_node_name
        icfparguid = lv_parent_guid
        icfdocu    = ls_insert_docu
        icfhandlst = lt_icfhndlist
        icfactive  = 'X'
        package    = '$TMP'
        application = ''
        doculang   = sy-langu
      IMPORTING
        icfnodguid = lv_guid
      EXCEPTIONS
          empty_icf_name            = 1
          no_new_virtual_host       = 2
          special_service_error     = 3
          parent_not_existing       = 4
          enqueue_error             = 5
          node_already_existing     = 6
          empty_docu                = 7
          doculang_not_installed    = 8
          security_info_error       = 9
          user_password_error       = 10
          password_encryption_error = 11
          invalid_url               = 12
          invalid_otr_concept       = 13
          formflg401_error          = 14
          handler_error             = 15
          transport_error           = 16
          tadir_error               = 17
          package_not_found         = 18
          wrong_application         = 19
          not_allow_application     = 20
          no_application            = 21
          invalid_icfparguid        = 22
          alt_name_invalid          = 23
          alternate_name_exist     = 24
          wrong_icf_name            = 25
          no_authority              = 26
          OTHERS                    = 27.
    IF sy-subrc <> 0.
        MESSAGE ID sy-msgid TYPE 'S' NUMBER sy-msgno
          WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4 INTO lv_icf_message.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 500
                     iv_reason = 'Internal Server Error'
                     iv_code = 'HTTP_SERVICE_WRITE_FAILED'
                       iv_msg = |SICF service creation failed (subrc={ sy-subrc }, { sy-msgid } { sy-msgno }): { lv_icf_message }| ).
      RETURN.
    ENDIF.

    zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                  iv_status = 200
                  iv_reason = 'OK'
                  is_payload = VALUE zcl_abap_vibe_icf_types=>ty_http_write(
                    status = 'success'
                    data = VALUE #( name = lv_node_name type = 'HTTP' action = 'created' ) ) ).
  ENDMETHOD.
  METHOD resolve_handler_lang_version.
    " Map the handler class's ABAP language version to the abap-file-format
    " header value ('standard' | 'cloudDevelopment'). 'standard' is the default
    " and the only outcome on on-prem; a genuine SAP Cloud Platform object
    " version (id '5') maps to 'cloudDevelopment'. Any introspection failure
    " (missing class, unsupported type, no authority) falls back to 'standard'
    " so the GET response stays usable.
    rv_version = 'standard'.
    IF iv_class_name IS INITIAL.
      RETURN.
    ENDIF.
    TRY.
        DATA(lo_lang_version) = cl_abap_language_version=>get_instance( ).
        DATA(ls_object_version) = lo_lang_version->get_version_of_object(
          iv_object_type  = 'CLAS'
          iv_object_name  = CONV if_abap_language_version=>ty_object_name( iv_class_name )
          iv_object_state = if_abap_language_version=>gc_object_state-active ).
        IF ls_object_version-id = if_abap_language_version=>gc_version-sap_cloud_platform.
          rv_version = 'cloudDevelopment'.
        ENDIF.
      CATCH cx_root.
        " Silent fallback: introspection failures must not break the response.
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
