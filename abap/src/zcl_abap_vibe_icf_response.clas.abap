CLASS zcl_abap_vibe_icf_response DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CONSTANTS gc_service TYPE string VALUE 'abap_cli'.
    CONSTANTS gc_version TYPE string VALUE '1.1.0'.

    CLASS-METHODS handle_root
      IMPORTING io_server TYPE REF TO if_http_server
                iv_method TYPE string.

    CLASS-METHODS handle_class_check
      IMPORTING io_server TYPE REF TO if_http_server.

    " ----- routing + helpers -----
    CLASS-METHODS respond_json
      IMPORTING io_server  TYPE REF TO if_http_server
                iv_status  TYPE i
                iv_reason  TYPE string
                is_payload TYPE any.
    CLASS-METHODS respond_error
      IMPORTING io_server  TYPE REF TO if_http_server
                iv_status  TYPE i
                iv_reason  TYPE string
                iv_code    TYPE string
                iv_msg     TYPE string
                iv_details TYPE any OPTIONAL.
    CLASS-METHODS escape_probe_needed
      RETURNING VALUE(rv_needed) TYPE abap_bool.
    CLASS-METHODS escape_json_string
      IMPORTING iv_value TYPE string
      RETURNING VALUE(rv_value) TYPE string.
    CLASS-METHODS escape_json_strings
      CHANGING cv_data TYPE any.
    CLASS-METHODS query_param
      IMPORTING iv_query TYPE string
                iv_name  TYPE string
      RETURNING VALUE(rv_value) TYPE string.
  PRIVATE SECTION.
    " vhcala4hci deploys an old /UI2/CL_JSON that does NOT escape JSON
    " string values — probe once and escape ourselves when needed.
    CLASS-DATA gv_escape_needed TYPE abap_bool.
    " Single JSON generation entries (build success/error responses via these).
    CLASS-METHODS serialize_response
      IMPORTING is_payload TYPE any
      RETURNING VALUE(rv_json) TYPE string.
    CLASS-METHODS serialize_error
      IMPORTING iv_code    TYPE string
                iv_message TYPE string
                iv_details TYPE any OPTIONAL
      RETURNING VALUE(rv_json) TYPE string.
ENDCLASS.

CLASS zcl_abap_vibe_icf_response IMPLEMENTATION.
  METHOD handle_root.
    IF iv_method = 'GET'.
      DATA(ls_root) = VALUE zcl_abap_vibe_icf_types=>ty_root( status = 'success'
                                     data = VALUE zcl_abap_vibe_icf_types=>ty_root_data( service = gc_service version = gc_version ) ).
      respond_json( io_server = io_server
                    iv_status = 200
                    iv_reason = 'OK'
                    is_payload = ls_root ).
    ELSE.
      respond_error( io_server = io_server
                     iv_status = 405
                     iv_reason = 'Method Not Allowed'
                     iv_code = 'METHOD_NOT_ALLOWED'
                     iv_msg = |GET only on /sap/abap_cli/| ).
    ENDIF.
  ENDMETHOD.
  METHOD handle_class_check.
    " ops endpoint: probe the runtime class load version + last source
    " change timestamp. Useful to confirm whether the ICF runtime picked up
    " a freshly-deployed main include (SM12/SICF deactivate+activate resets
    " the in-memory class load handle).
    DATA ls_class_info TYPE zcl_abap_vibe_icf_types=>ty_root_data.
    ls_class_info-service = gc_service.
    ls_class_info-version = gc_version.
    respond_json( io_server = io_server
                  iv_status = 200
                  iv_reason = 'OK'
                  is_payload = VALUE zcl_abap_vibe_icf_types=>ty_root( status = 'success' data = ls_class_info ) ).
  ENDMETHOD.
  METHOD respond_json.
    DATA(lv_json) = serialize_response( is_payload ).
    io_server->response->set_status( code = iv_status reason = iv_reason ).
    io_server->response->set_content_type( content_type = 'application/json' ).
    io_server->response->set_cdata( data = lv_json ).
  ENDMETHOD.
  METHOD respond_error.
    DATA lv_json TYPE string.
    " forward iv_details to serialize_error only when the caller actually
    " supplied it (most call sites pass no details; their initial data ref
    " would otherwise leak as an empty `details: null` in the response).
    IF iv_details IS SUPPLIED.
      lv_json = serialize_error( iv_code    = iv_code
                                iv_message = iv_msg
                                iv_details = iv_details ).
    ELSE.
      lv_json = serialize_error( iv_code    = iv_code
                                iv_message = iv_msg ).
    ENDIF.
    io_server->response->set_status( code = iv_status reason = iv_reason ).
    io_server->response->set_content_type( content_type = 'application/json' ).
    io_server->response->set_cdata( data = lv_json ).
  ENDMETHOD.
  METHOD serialize_response.
    " Single success-envelope generation entry (camelCase wire).
    " Copy to a modifiable heap object so old /UI2/CL_JSON escaping can apply.
    DATA lr_payload TYPE REF TO data.
    CREATE DATA lr_payload LIKE is_payload.
    ASSIGN lr_payload->* TO FIELD-SYMBOL(<lv_payload>).
    <lv_payload> = is_payload.
    IF escape_probe_needed( ) = abap_true.
      escape_json_strings( CHANGING cv_data = <lv_payload> ).
    ENDIF.
    TRY.
        rv_json = /ui2/cl_json=>serialize( data        = <lv_payload>
                                           pretty_name = /ui2/cl_json=>pretty_mode-camel_case ).
      CATCH cx_root.
        rv_json = serialize_error( iv_code    = 'SERIALIZE_FAILED'
                                   iv_message = 'response serialization failed' ).
    ENDTRY.
  ENDMETHOD.
  METHOD serialize_error.
    " Single error-envelope generation entry (compress skips unbound details).
    DATA lv_msg TYPE string.
    lv_msg = iv_message.
    IF escape_probe_needed( ) = abap_true.
      lv_msg = escape_json_string( iv_message ).
    ENDIF.
    DATA(ls_error) = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                     error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code    = iv_code
                                                                  message = lv_msg ) ).
    IF iv_details IS SUPPLIED.
      ls_error-error-details = iv_details.
    ENDIF.
    TRY.
        rv_json = /ui2/cl_json=>serialize( data        = ls_error
                                           pretty_name = /ui2/cl_json=>pretty_mode-camel_case
                                           compress    = abap_true ).
      CATCH cx_root.
        " Static last-resort envelope (no dynamic content, cannot fail again).
        rv_json = `{"status":"error","error":{"code":"SERIALIZE_FAILED","message":"internal serialization failure"}}`.
    ENDTRY.
  ENDMETHOD.
  METHOD escape_probe_needed.
    " Probe once: does /ui2/cl_json escape a double quote inside a string?
    " Old /UI2/CL_JSON (vhcala4hci) returns it unescaped — then we escape.
    DATA lv_probe TYPE string.
    IF gv_escape_needed IS INITIAL.
      lv_probe = /ui2/cl_json=>serialize( 'x"' ).
      IF lv_probe CS '\"'.
        gv_escape_needed = abap_false.
      ELSE.
        gv_escape_needed = abap_true.
      ENDIF.
    ENDIF.
    rv_needed = gv_escape_needed.
  ENDMETHOD.
  METHOD escape_json_string.
    " Escape backslash and double quote (order matters), then control chars.
    rv_value = iv_value.
    REPLACE ALL OCCURRENCES OF '\' IN rv_value WITH '\\'.
    REPLACE ALL OCCURRENCES OF '"' IN rv_value WITH '\"'.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>cr_lf IN rv_value WITH '\r\n'.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>newline IN rv_value WITH '\n'.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>horizontal_tab IN rv_value WITH '\t'.
  ENDMETHOD.
  METHOD escape_json_strings.
    " Recursively escape char-like elements of a structure/table.
    " Fields typed /ui2/cl_json=>json (partial JSON pieces) are already escaped
    " at their source and are skipped by absolute_name.
    DATA lo_descr      TYPE REF TO cl_abap_typedescr.
    DATA lo_elem       TYPE REF TO cl_abap_elemdescr.
    DATA lo_struct     TYPE REF TO cl_abap_structdescr.
    DATA lt_components TYPE abap_component_tab.
    FIELD-SYMBOLS:
      <lt_tab>  TYPE ANY TABLE,
      <ls_line> TYPE any,
      <lv_comp> TYPE any.
    lo_descr = cl_abap_typedescr=>describe_by_data( cv_data ).
    CASE lo_descr->kind.
      WHEN cl_abap_typedescr=>kind_elem.
        lo_elem ?= lo_descr.
        IF lo_elem->absolute_name CS '/UI2/CL_JSON=>JSON'.
          RETURN.
        ENDIF.
        IF lo_elem->type_kind CA 'cgndt'.
          cv_data = escape_json_string( CONV string( cv_data ) ).
        ENDIF.
      WHEN cl_abap_typedescr=>kind_struct.
        lo_struct ?= lo_descr.
        lt_components = lo_struct->get_components( ).
        LOOP AT lt_components INTO DATA(ls_comp).
          ASSIGN COMPONENT ls_comp-name OF STRUCTURE cv_data TO <lv_comp>.
          IF sy-subrc = 0.
            escape_json_strings( CHANGING cv_data = <lv_comp> ).
          ENDIF.
        ENDLOOP.
      WHEN cl_abap_typedescr=>kind_table.
        ASSIGN cv_data TO <lt_tab>.
        LOOP AT <lt_tab> ASSIGNING <ls_line>.
          escape_json_strings( CHANGING cv_data = <ls_line> ).
        ENDLOOP.
    ENDCASE.
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
ENDCLASS.
