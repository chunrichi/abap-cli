CLASS zcl_abap_vibe_nrob_format DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    " PR5: the ICF dispatcher serialises this structure with
    " /ui2/cl_json=>serialize( pretty_name = camel_case ), so snake_case
    " component names below become the camelCase JSON keys the CLI reads
    " (formats/nrob/json.ts#wireToLocal). No JSON string building here.
    TYPES:
      BEGIN OF ty_header,
        description       TYPE string,
        original_language TYPE string,
      END OF ty_header,
      BEGIN OF ty_interval,
        number_length_domain TYPE string,
        percent_warning      TYPE string,
        sub_type             TYPE string,
        until_year           TYPE abap_bool,
        rolling              TYPE abap_bool,
        prefix               TYPE abap_bool,
      END OF ty_interval,
      BEGIN OF ty_configuration,
        transaction_id   TYPE string,
        buffering        TYPE string,
        buffered_numbers TYPE i,
      END OF ty_configuration,
      BEGIN OF ty_result,
        name          TYPE string,
        type          TYPE string,
        header        TYPE ty_header,
        interval      TYPE ty_interval,
        configuration TYPE ty_configuration,
        success       TYPE abap_bool,
        error_code    TYPE string,
        error_message TYPE string,
      END OF ty_result.

    CLASS-METHODS generate
      IMPORTING iv_name          TYPE nrobj
      RETURNING VALUE(rs_result) TYPE ty_result.

  PRIVATE SECTION.
    CLASS-METHODS read_nrob
      IMPORTING iv_name          TYPE nrobj
      EXPORTING ev_description   TYPE string
                es_interval      TYPE ty_interval
                es_configuration TYPE ty_configuration
                ev_ok            TYPE abap_bool
                ev_error_code    TYPE string
                ev_error_message TYPE string.
ENDCLASS.

CLASS zcl_abap_vibe_nrob_format IMPLEMENTATION.
  METHOD generate.
    DATA lv_ok TYPE abap_bool.
    DATA lv_error_code TYPE string.
    DATA lv_error_message TYPE string.

    rs_result-name = iv_name.
    rs_result-type = 'NROB'.
    rs_result-success = abap_false.

    read_nrob( EXPORTING iv_name          = iv_name
               IMPORTING es_interval      = rs_result-interval
                         es_configuration = rs_result-configuration
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

  METHOD read_nrob.
    " PR5: skeleton. The real implementation reads NRIV (plus the TNRO /
    " TNROT headers) and maps them onto the interval / configuration export
    " parameters. Until then the dispatcher surfaces NROB_NOT_IMPLEMENTED so
    " callers get a precise error instead of an empty success payload.
    CLEAR: es_interval, es_configuration, ev_description.
    ev_ok = abap_false.
    ev_error_code = 'NROB_NOT_IMPLEMENTED'.
    ev_error_message = |NROB read for { iv_name } is not implemented in the ICF handler yet|.
  ENDMETHOD.
ENDCLASS.
