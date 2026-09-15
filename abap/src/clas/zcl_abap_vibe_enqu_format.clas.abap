CLASS zcl_abap_vibe_enqu_format DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    " PR5: the ICF dispatcher serialises this structure with
    " /ui2/cl_json=>serialize( pretty_name = camel_case ), so snake_case
    " component names below become the camelCase JSON keys the CLI reads
    " (formats/enqu/json.ts#wireToLocal). No JSON string building here.
    TYPES:
      BEGIN OF ty_header,
        description       TYPE string,
        original_language TYPE string,
      END OF ty_header,
      BEGIN OF ty_lock_table,
        name      TYPE string,
        lock_mode TYPE string,
      END OF ty_lock_table,
      BEGIN OF ty_lock_parameter,
        name   TYPE string,
        table  TYPE string,
        field  TYPE string,
        active TYPE abap_bool,
      END OF ty_lock_parameter,
      tt_lock_table     TYPE STANDARD TABLE OF ty_lock_table     WITH EMPTY KEY,
      tt_lock_parameter TYPE STANDARD TABLE OF ty_lock_parameter WITH EMPTY KEY,
      BEGIN OF ty_lock_modules,
        allow_rfc TYPE abap_bool,
      END OF ty_lock_modules,
      BEGIN OF ty_result,
        name             TYPE string,
        type             TYPE string,
        header           TYPE ty_header,
        primary_table    TYPE ty_lock_table,
        secondary_tables TYPE tt_lock_table,
        lock_parameters  TYPE tt_lock_parameter,
        lock_modules     TYPE ty_lock_modules,
        success          TYPE abap_bool,
        error_code       TYPE string,
        error_message    TYPE string,
      END OF ty_result.

    CLASS-METHODS generate
      IMPORTING iv_name          TYPE viewname
      RETURNING VALUE(rs_result) TYPE ty_result.

  PRIVATE SECTION.
    CLASS-METHODS read_enqu
      IMPORTING iv_name          TYPE viewname
      EXPORTING ev_description   TYPE string
                es_primary       TYPE ty_lock_table
                et_secondary     TYPE tt_lock_table
                et_parameters    TYPE tt_lock_parameter
                es_modules       TYPE ty_lock_modules
                ev_ok            TYPE abap_bool
                ev_error_code    TYPE string
                ev_error_message TYPE string.
ENDCLASS.

CLASS zcl_abap_vibe_enqu_format IMPLEMENTATION.
  METHOD generate.
    DATA lv_ok TYPE abap_bool.
    DATA lv_error_code TYPE string.
    DATA lv_error_message TYPE string.

    rs_result-name = iv_name.
    rs_result-type = 'ENQU'.
    rs_result-success = abap_false.

    read_enqu( EXPORTING iv_name          = iv_name
               IMPORTING es_primary       = rs_result-primary_table
                         et_secondary     = rs_result-secondary_tables
                         et_parameters    = rs_result-lock_parameters
                         es_modules       = rs_result-lock_modules
                         ev_description   = rs_result-header-description
                         ev_ok            = lv_ok
                         ev_error_code    = lv_error_code
                         ev_error_message = lv_error_message ).
    IF lv_ok = abap_false.
      rs_result-error_code = lv_error_code.
      rs_result-error_message = lv_error_message.
      RETURN.
    ENDIF.

    rs_result-header-original_language = sy-langu.
    rs_result-success = abap_true.
  ENDMETHOD.

  METHOD read_enqu.
    " PR5: skeleton. The real implementation calls DDIF_ENQU_GET, reads the
    " lock object's primary/secondary tables + parameters, and fills the
    " export parameters below. Until then the dispatcher surfaces
    " ENQU_NOT_IMPLEMENTED so callers get a precise error rather than an
    " empty success payload.
    CLEAR: ev_description, es_primary, et_secondary, et_parameters, es_modules.
    ev_ok = abap_false.
    ev_error_code = 'ENQU_NOT_IMPLEMENTED'.
    ev_error_message = |ENQU read for { iv_name } is not implemented in the ICF handler yet|.
  ENDMETHOD.
ENDCLASS.
