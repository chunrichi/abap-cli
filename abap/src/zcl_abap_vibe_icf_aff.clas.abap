CLASS zcl_abap_vibe_icf_aff DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    " TADIR-OBJ_NAME is CHAR 40; AFF object names may exceed the generic
    " 30-character CLI limit (enhancement implementations, for example).
    CONSTANTS gc_name_max_length TYPE i VALUE 40.
    " Object types routed to SAP's AFF object handlers. Deliberately an
    " allowlist: the handler factory knows many more repository types, but
    " exposing all of them would widen the ICF write surface far beyond what
    " the CLI supports.
    CONSTANTS gc_supported_types TYPE string VALUE 'APLO,CHDO,EVTB,SMBC,ENHO,ENHS'.

    CLASS-METHODS dispatch_aff
      IMPORTING io_server TYPE REF TO if_http_server
                iv_path   TYPE string
                iv_method TYPE string
                iv_body   TYPE string.

  PRIVATE SECTION.
    " ----- GET /aff/<type>/<name>: serialize an existing object -----
    CLASS-METHODS read_aff
      IMPORTING iv_type       TYPE string
                iv_name       TYPE string
      EXPORTING es_data       TYPE zcl_abap_vibe_icf_types=>ty_aff_data
                ev_http_code  TYPE i
                ev_error_code TYPE string
                ev_error_msg  TYPE string
                ev_details    TYPE string_table.

    " ----- helpers: type/name resolution -----
    CLASS-METHODS type_supported
      IMPORTING iv_type             TYPE string
      RETURNING VALUE(rv_supported) TYPE abap_bool.
    CLASS-METHODS validate_name
      IMPORTING iv_name         TYPE string
      RETURNING VALUE(rv_valid) TYPE abap_bool.
    CLASS-METHODS aff_available
      RETURNING VALUE(rv_available) TYPE abap_bool.
    CLASS-METHODS object_handler_available
      IMPORTING iv_type             TYPE string
      RETURNING VALUE(rv_available) TYPE abap_bool.
    CLASS-METHODS read_tadir
      IMPORTING iv_type            TYPE string
                iv_name            TYPE string
      EXPORTING ev_package         TYPE devclass
                ev_master_language TYPE sy-langu
                ev_found           TYPE abap_bool.

    " ----- helpers: dynamic AFF framework access -----
    CLASS-METHODS create_interface_ref
      IMPORTING iv_interface_name TYPE string
      RETURNING VALUE(ro_ref)     TYPE REF TO data
      RAISING   cx_root.
    CLASS-METHODS create_data_object
      IMPORTING iv_type_name  TYPE string
      RETURNING VALUE(ro_ref) TYPE REF TO data
      RAISING   cx_root.
    CLASS-METHODS cast_to_object
      IMPORTING io_interface_ref TYPE any
      RETURNING VALUE(ro_object) TYPE REF TO object
      RAISING   cx_root.
    CLASS-METHODS create_log
      RETURNING VALUE(ro_log) TYPE REF TO object
      RAISING   cx_root.
    CLASS-METHODS log_text
      IMPORTING io_log         TYPE REF TO object
      RETURNING VALUE(rv_text) TYPE string.
    CLASS-METHODS xstring_to_string
      IMPORTING iv_xstring       TYPE xstring
      RETURNING VALUE(rv_string) TYPE string.

    " ----- helpers: responses -----
    CLASS-METHODS respond_error
      IMPORTING io_server  TYPE REF TO if_http_server
                iv_status  TYPE i
                iv_code    TYPE string
                iv_msg     TYPE string
                iv_details TYPE string_table OPTIONAL.
ENDCLASS.

CLASS zcl_abap_vibe_icf_aff IMPLEMENTATION.
  METHOD dispatch_aff.
    " /aff/<type>/<name> — one wire document carries the complete AFF file
    " set of one repository object. File contents come from SAP's own AFF
    " object handlers (CL_AFF_FACTORY / CL_AFF_OBJECT_HANDLER_FACTORY), so
    " the endpoint is format-agnostic: a new object type only needs a
    " supported-types entry here and in the CLI registry.
    DATA lv_type TYPE string.
    DATA lv_name TYPE string.
    DATA lv_http_code TYPE i.
    DATA lv_error_code TYPE string.
    DATA lv_error_msg TYPE string.
    DATA lt_details TYPE string_table.

    FIND REGEX '^/aff/([^/]+)/(.+)$' IN iv_path IGNORING CASE SUBMATCHES lv_type lv_name.
    IF sy-subrc <> 0 OR lv_type IS INITIAL OR lv_name IS INITIAL.
      respond_error( io_server = io_server
                     iv_status = 400
                     iv_code   = 'AFF_SERVICE_INVALID'
                     iv_msg    = 'object type and name are required: /aff/<type>/<name>' ).
      RETURN.
    ENDIF.

    lv_type = to_upper( condense( val = lv_type del = ` ` ) ).
    lv_name = to_upper( condense( val = lv_name del = ` ` ) ).

    IF type_supported( lv_type ) = abap_false.
      respond_error( io_server = io_server
                     iv_status = 400
                     iv_code   = 'AFF_TYPE_INVALID'
                     iv_msg    = |{ lv_type } is not an AFF object type served by this service ({ gc_supported_types })| ).
      RETURN.
    ENDIF.
    IF validate_name( lv_name ) = abap_false.
      respond_error( io_server = io_server
                     iv_status = 400
                     iv_code   = 'AFF_NAME_INVALID'
                     iv_msg    = |object name must be at most { gc_name_max_length } characters of A-Z, 0-9, _ or / without whitespace (got '{ lv_name }')| ).
      RETURN.
    ENDIF.
    IF aff_available( ) = abap_false.
      respond_error( io_server = io_server
                     iv_status = 501
                     iv_code   = 'AFF_UNSUPPORTED'
                     iv_msg    = 'this SAP release does not provide the ABAP file format framework (CL_AFF_*), so AFF objects cannot be managed here' ).
      RETURN.
    ENDIF.
    IF object_handler_available( lv_type ) = abap_false.
      respond_error( io_server = io_server
                     iv_status = 501
                     iv_code   = 'AFF_UNSUPPORTED'
                     iv_msg    = |this SAP release has no AFF object handler for { lv_type }| ).
      RETURN.
    ENDIF.

    IF iv_method = 'GET'.
      DATA ls_data TYPE zcl_abap_vibe_icf_types=>ty_aff_data.
      read_aff( EXPORTING iv_type       = lv_type
                          iv_name       = lv_name
                IMPORTING es_data       = ls_data
                          ev_http_code  = lv_http_code
                          ev_error_code = lv_error_code
                          ev_error_msg  = lv_error_msg
                          ev_details    = lt_details ).
      IF lv_error_code IS NOT INITIAL.
        respond_error( io_server  = io_server
                       iv_status  = COND i( WHEN lv_http_code > 0 THEN lv_http_code ELSE 500 )
                       iv_code    = lv_error_code
                       iv_msg     = lv_error_msg
                       iv_details = lt_details ).
        RETURN.
      ENDIF.
      zcl_abap_vibe_icf_response=>respond_json( io_server  = io_server
                                                iv_status  = 200
                                                iv_reason  = 'OK'
                                                is_payload = VALUE zcl_abap_vibe_icf_types=>ty_aff_get( status = 'success'
                                                                                                       data   = ls_data ) ).
      RETURN.
    ENDIF.

    IF iv_method = 'POST' OR iv_method = 'PUT'.
      respond_error( io_server = io_server
                     iv_status = 501
                     iv_code   = 'AFF_WRITE_UNSUPPORTED'
                     iv_msg    = |AFF write is not supported by this ICF route for { lv_type }: the SAP AFF framework does not persist this object type| ).
      RETURN.
    ENDIF.

    IF iv_method = 'DELETE'.
      respond_error( io_server = io_server
                     iv_status = 501
                     iv_code   = 'AFF_DELETE_UNSUPPORTED'
                     iv_msg    = |AFF delete is not supported by this ICF route for { lv_type }: the SAP AFF framework does not delete this object type| ).
      RETURN.
    ENDIF.

    respond_error( io_server = io_server
                   iv_status = 405
                   iv_code   = 'METHOD_NOT_ALLOWED'
                   iv_msg    = |{ iv_method } not supported on /aff/<type>/<name>| ).
  ENDMETHOD.

  METHOD read_aff.
    DATA lv_package TYPE devclass.
    DATA lv_master_language TYPE sy-langu.
    DATA lv_found TYPE abap_bool.
    DATA lv_log_text TYPE string.
    DATA lv_file_name TYPE string.
    DATA lv_xstring TYPE xstring.
    FIELD-SYMBOLS:
      <lo_handler_ref> TYPE any,
      <lo_log_ref>     TYPE any,
      <lt_objects>     TYPE STANDARD TABLE,
      <ls_object>      TYPE any,
      <ls_result>      TYPE any,
      <lt_files>       TYPE HASHED TABLE,
      <ls_file>        TYPE any,
      <lv_field>       TYPE any.

    read_tadir( EXPORTING iv_type            = iv_type
                          iv_name            = iv_name
                IMPORTING ev_package         = lv_package
                          ev_master_language = lv_master_language
                          ev_found           = lv_found ).
    IF lv_found = abap_false.
      ev_http_code = 404.
      ev_error_code = 'AFF_NOT_FOUND'.
      ev_error_msg = |{ iv_type } { iv_name } does not exist|.
      RETURN.
    ENDIF.

    TRY.
        " File handler instance. The interface reference is created
        " dynamically so this class still compiles on releases without the
        " AFF framework; the route answers AFF_UNSUPPORTED there.
        DATA(lr_handler_ref) = create_interface_ref( 'IF_AFF_OBJECT_FILE_HANDLER' ).
        ASSIGN lr_handler_ref->* TO <lo_handler_ref>.
        CALL METHOD ('CL_AFF_FACTORY')=>('GET_OBJECT_FILE_HANDLER')
          RECEIVING result = <lo_handler_ref>.
        DATA(lo_handler) = cast_to_object( <lo_handler_ref> ).

        " One row of IF_AFF_OBJECT_FILE_HANDLER=>TT_OBJECTS.
        DATA(lr_objects) = create_data_object( 'IF_AFF_OBJECT_FILE_HANDLER=>TT_OBJECTS' ).
        ASSIGN lr_objects->* TO <lt_objects>.
        APPEND INITIAL LINE TO <lt_objects> ASSIGNING <ls_object>.
        ASSIGN COMPONENT 'DEVCLASS' OF STRUCTURE <ls_object> TO <lv_field>.
        <lv_field> = lv_package.
        ASSIGN COMPONENT 'OBJ_TYPE' OF STRUCTURE <ls_object> TO <lv_field>.
        <lv_field> = iv_type.
        ASSIGN COMPONENT 'OBJ_NAME' OF STRUCTURE <ls_object> TO <lv_field>.
        <lv_field> = iv_name.
        ASSIGN COMPONENT 'SUB_TYPE' OF STRUCTURE <ls_object> TO <lv_field>.
        <lv_field> = ``.
        ASSIGN COMPONENT 'SUB_NAME' OF STRUCTURE <ls_object> TO <lv_field>.
        <lv_field> = ``.
        ASSIGN COMPONENT 'LANGUAGE' OF STRUCTURE <ls_object> TO <lv_field>.
        <lv_field> = ``.

        DATA(lr_log_ref) = create_interface_ref( 'IF_AFF_LOG' ).
        ASSIGN lr_log_ref->* TO <lo_log_ref>.
        CALL METHOD ('CL_AFF_FACTORY')=>('CREATE_LOG')
          RECEIVING result = <lo_log_ref>.
        DATA(lo_log) = cast_to_object( <lo_log_ref> ).

        DATA(lr_result) = create_data_object( 'IF_AFF_OBJECT_FILE_HANDLER=>TY_OBJECT_FILES' ).
        ASSIGN lr_result->* TO <ls_result>.
        CALL METHOD lo_handler->('IF_AFF_OBJECT_FILE_HANDLER~SERIALIZE_OBJECTS')
          EXPORTING objects = <lt_objects>
                    log     = <lo_log_ref>
          RECEIVING result  = <ls_result>.

        lv_log_text = log_text( lo_log ).
        ASSIGN COMPONENT 'FILES' OF STRUCTURE <ls_result> TO <lt_files>.
        IF <lt_files> IS INITIAL.
          ev_http_code = 500.
          ev_error_code = 'AFF_READ_FAILED'.
          ev_error_msg = COND string( WHEN lv_log_text IS INITIAL
                                      THEN |the AFF handler returned no files for { iv_type } { iv_name }|
                                      ELSE lv_log_text ).
          RETURN.
        ENDIF.

        es_data-type = iv_type.
        es_data-name = iv_name.
        es_data-package = lv_package.
        es_data-master_language = lv_master_language.
        LOOP AT <lt_files> ASSIGNING <ls_file>.
          ASSIGN COMPONENT 'FILE_NAME' OF STRUCTURE <ls_file> TO <lv_field>.
          lv_file_name = <lv_field>.
          ASSIGN COMPONENT 'CONTENT' OF STRUCTURE <ls_file> TO <lv_field>.
          lv_xstring = <lv_field>.
          APPEND VALUE zcl_abap_vibe_icf_types=>ty_aff_file(
                     name    = lv_file_name
                     content = xstring_to_string( lv_xstring ) ) TO es_data-files.
        ENDLOOP.
        IF es_data-files IS INITIAL.
          ev_http_code = 500.
          ev_error_code = 'AFF_READ_FAILED'.
          ev_error_msg = |the AFF handler returned no serializable files for { iv_type } { iv_name }|.
          RETURN.
        ENDIF.

        " Warnings are returned as details, so the CLI can surface them.
        IF lv_log_text IS NOT INITIAL.
          APPEND lv_log_text TO ev_details.
        ENDIF.
        ev_http_code = 200.
      CATCH cx_root INTO DATA(lx).
        ev_http_code = 500.
        ev_error_code = 'AFF_READ_FAILED'.
        ev_error_msg = |{ iv_type } { iv_name } could not be serialized: { lx->get_text( ) }|.
    ENDTRY.
  ENDMETHOD.

  METHOD type_supported.
    SPLIT gc_supported_types AT ',' INTO TABLE DATA(lt_types).
    LOOP AT lt_types INTO DATA(lv_type).
      IF to_upper( iv_type ) = to_upper( condense( lv_type ) ).
        rv_supported = abap_true.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD validate_name.
    IF iv_name IS INITIAL OR strlen( iv_name ) > gc_name_max_length.
      RETURN.
    ENDIF.
    IF iv_name CS ` ` OR iv_name CN 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_/'.
      RETURN.
    ENDIF.
    rv_valid = abap_true.
  ENDMETHOD.

  METHOD aff_available.
    DATA lr_ref TYPE REF TO data.
    TRY.
        lr_ref = create_interface_ref( 'IF_AFF_LOG' ).
        rv_available = abap_true.
      CATCH cx_root.
        rv_available = abap_false.
    ENDTRY.
  ENDMETHOD.

  METHOD object_handler_available.
    FIELD-SYMBOLS <lo_handler_ref> TYPE any.
    DATA lv_object_type TYPE trobjtype.
    lv_object_type = iv_type.
    TRY.
        DATA(lr_handler_ref) = create_interface_ref( 'IF_AFF_OBJECT_HANDLER' ).
        ASSIGN lr_handler_ref->* TO <lo_handler_ref>.
        CALL METHOD ('CL_AFF_OBJECT_HANDLER_FACTORY')=>('GET_OBJECT_HANDLER')
          EXPORTING object_type = lv_object_type
          RECEIVING result      = <lo_handler_ref>.
        DATA(lo_handler) = cast_to_object( <lo_handler_ref> ).
        rv_available = boolc( lo_handler IS NOT INITIAL ).
      CATCH cx_root.
        rv_available = abap_false.
    ENDTRY.
  ENDMETHOD.

  METHOD read_tadir.
    SELECT SINGLE devclass, masterlang FROM tadir
      WHERE pgmid = 'R3TR' AND object = @iv_type AND obj_name = @iv_name
      INTO (@ev_package, @ev_master_language).
    ev_found = boolc( sy-subrc = 0 ).
  ENDMETHOD.

  METHOD create_interface_ref.
    CREATE DATA ro_ref TYPE REF TO (iv_interface_name).
  ENDMETHOD.

  METHOD create_data_object.
    CREATE DATA ro_ref TYPE (iv_type_name).
  ENDMETHOD.

  METHOD cast_to_object.
    ro_object ?= io_interface_ref.
  ENDMETHOD.

  METHOD create_log.
    FIELD-SYMBOLS <lo_log_ref> TYPE any.
    DATA(lr_log_ref) = create_interface_ref( 'IF_AFF_LOG' ).
    ASSIGN lr_log_ref->* TO <lo_log_ref>.
    CALL METHOD ('CL_AFF_FACTORY')=>('CREATE_LOG')
      RECEIVING result = <lo_log_ref>.
    ro_log = cast_to_object( <lo_log_ref> ).
  ENDMETHOD.

  METHOD log_text.
    DATA lv_message TYPE string.
    DATA lv_severity TYPE symsgty.
    FIELD-SYMBOLS:
      <lt_messages> TYPE STANDARD TABLE,
      <ls_message>  TYPE any,
      <lv_field>    TYPE any.
    TRY.
        DATA(lr_messages) = create_data_object( 'IF_AFF_LOG=>TT_LOG_OUT' ).
        ASSIGN lr_messages->* TO <lt_messages>.
        CALL METHOD io_log->('IF_AFF_LOG~GET_MESSAGES')
          RECEIVING messages = <lt_messages>.
        LOOP AT <lt_messages> ASSIGNING <ls_message>.
          ASSIGN COMPONENT 'TYPE' OF STRUCTURE <ls_message> TO <lv_field>.
          IF sy-subrc = 0.
            lv_severity = <lv_field>.
          ENDIF.
          ASSIGN COMPONENT 'TEXT' OF STRUCTURE <ls_message> TO <lv_field>.
          IF sy-subrc = 0.
            lv_message = <lv_field>.
          ENDIF.
          IF lv_message IS INITIAL.
            CONTINUE.
          ENDIF.
          IF lv_severity = 'E' OR rv_text IS NOT INITIAL.
            rv_text = COND string( WHEN rv_text IS INITIAL
                                   THEN lv_message
                                   ELSE |{ rv_text }; { lv_message }| ).
          ENDIF.
        ENDLOOP.
      CATCH cx_root.
        rv_text = ``.
    ENDTRY.
  ENDMETHOD.

  METHOD xstring_to_string.
    IF iv_xstring IS INITIAL.
      RETURN.
    ENDIF.
    rv_string = cl_abap_codepage=>convert_from( source = iv_xstring codepage = 'UTF-8' ).
  ENDMETHOD.

  METHOD respond_error.
    zcl_abap_vibe_icf_response=>respond_error( io_server  = io_server
                                               iv_status  = iv_status
                                               iv_reason  = COND string( WHEN iv_status = 400 THEN 'Bad Request'
                                                                         WHEN iv_status = 404 THEN 'Not Found'
                                                                         WHEN iv_status = 409 THEN 'Conflict'
                                                                         WHEN iv_status = 501 THEN 'Not Implemented'
                                                                         ELSE 'Internal Server Error' )
                                               iv_code    = iv_code
                                               iv_msg     = iv_msg
                                               iv_details = iv_details ).
  ENDMETHOD.
ENDCLASS.
