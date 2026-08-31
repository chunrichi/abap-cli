CLASS zcl_abap_vibe_runner DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.

    "! Inputs injected by the ADT classrun endpoint from the JSON request body.
    "! SAP's classrun endpoint injects request parameters as INSTANCE
    "! attributes on the classrun object before invoking main. When the
    "! endpoint does not support parameter injection (older systems), the
    "! attributes stay empty and the wrapper reports WRAPPER_INPUT_UNAVAILABLE.
    DATA:
      iv_target_class TYPE string,
      iv_method_name  TYPE string,
      iv_args_json    TYPE string,
      iv_timeout_ms   TYPE string.

  PRIVATE SECTION.
    CONSTANTS gc_version TYPE string VALUE '0.7.0'.

    " Message types serialized via /ui2/cl_json (camelCase wire).
    TYPES:
      BEGIN OF ty_heartbeat,
        status    TYPE string,
        exit_code TYPE i,
        message   TYPE string,
        version   TYPE string,
      END OF ty_heartbeat,
      BEGIN OF ty_runner_error,
        status      TYPE string,
        code        TYPE string,
        class       TYPE string,
        method      TYPE string,
        duration_ms TYPE i,
        message     TYPE string,
      END OF ty_runner_error,
      BEGIN OF ty_runner_success,
        status    TYPE string,
        method    TYPE string,
        exit_code TYPE i,
        result    TYPE /ui2/cl_json=>json,
      END OF ty_runner_success.

    METHODS serialize_result
      IMPORTING iv_value TYPE string
      RETURNING VALUE(rv_json) TYPE string.
    METHODS serialize_heartbeat
      RETURNING VALUE(rv_json) TYPE string.
    METHODS serialize_error
      IMPORTING iv_code        TYPE string
                iv_message     TYPE string
                iv_class       TYPE string OPTIONAL
                iv_method      TYPE string OPTIONAL
                iv_duration_ms TYPE i OPTIONAL
      RETURNING VALUE(rv_json) TYPE string.
    METHODS serialize_success
      IMPORTING iv_method TYPE string
                iv_result TYPE string
      RETURNING VALUE(rv_json) TYPE string.
ENDCLASS.

CLASS zcl_abap_vibe_runner IMPLEMENTATION.

  METHOD if_oo_adt_classrun~main.
    DATA: lv_target_class TYPE string,
          lv_method_name  TYPE string,
          lv_timeout_ms   TYPE i,
          lv_start_us     TYPE i,
          lv_now_us       TYPE i,
          lv_elapsed_ms   TYPE i.

    lv_target_class = to_upper( iv_target_class ).
    lv_method_name  = iv_method_name.
    lv_timeout_ms   = COND #(
      WHEN iv_timeout_ms IS INITIAL
      THEN 30000
      ELSE CONV i( iv_timeout_ms )
    ).

    " Heartbeat branch (no --method): direct classrun echo.
    IF lv_method_name IS INITIAL.
      out->write( serialize_heartbeat( ) ).
      RETURN.
    ENDIF.

    " A --method was requested but the endpoint injected no method name —
    " the target system's ADT classrun does not support parameter injection.
    IF lv_target_class IS INITIAL.
      out->write( serialize_error(
        iv_code    = 'WRAPPER_INPUT_UNAVAILABLE'
        iv_message = 'classrun parameter injection is not supported on this system; use a direct classrun (no --method) or run via abap deploy' ) ).
      RETURN.
    ENDIF.

    " Local classes cannot be invoked — reject early.
    IF lv_target_class CS '~'.
      out->write( serialize_error(
        iv_code    = 'LOCAL_CLASS_NOT_RUNNABLE'
        iv_class   = lv_target_class
        iv_message = 'class name contains ~ (local class)' ) ).
      RETURN.
    ENDIF.

    GET RUN TIME FIELD lv_start_us.

    TRY.
        " Dynamic invocation of a PUBLIC STATIC method. v1 omits the RTTS
        " pre-signature check across system versions; an unsupported
        " signature surfaces at CALL time and maps to METHOD_FAILED.
        DATA lv_result TYPE string.
        CALL METHOD (lv_target_class)=>(lv_method_name)
          RECEIVING result = lv_result.

        " Timeout check after call.
        GET RUN TIME FIELD lv_now_us.
        lv_elapsed_ms = ( lv_now_us - lv_start_us ) / 1000.
        IF lv_elapsed_ms > lv_timeout_ms.
          out->write( serialize_error(
            iv_code        = 'TIMEOUT'
            iv_message     = |exceeded { lv_timeout_ms }ms|
            iv_duration_ms = lv_elapsed_ms ) ).
          RETURN.
        ENDIF.

        out->write( serialize_success(
          iv_method = lv_method_name
          iv_result = serialize_result( lv_result ) ) ).
      CATCH cx_sy_dyn_call_error INTO DATA(lx_dyn).
        out->write( serialize_error(
          iv_code    = 'METHOD_FAILED'
          iv_class   = lv_target_class
          iv_method  = lv_method_name
          iv_message = CONDENSE( lx_dyn->get_text( ) ) ) ).
      CATCH cx_root INTO DATA(lx_root).
        out->write( serialize_error(
          iv_code    = 'METHOD_FAILED'
          iv_class   = lv_target_class
          iv_method  = lv_method_name
          iv_message = CONDENSE( lx_root->get_text( ) ) ) ).
    ENDTRY.
  ENDMETHOD.

  METHOD serialize_heartbeat.
    rv_json = /ui2/cl_json=>serialize(
      data = VALUE ty_heartbeat( status = 'ok' exit_code = 0 message = 'classrun heartbeat' version = gc_version )
      pretty_name = /ui2/cl_json=>pretty_mode-camel_case ).
  ENDMETHOD.

  METHOD serialize_error.
    rv_json = /ui2/cl_json=>serialize(
      data = VALUE ty_runner_error(
        status      = 'error'
        code        = iv_code
        class       = iv_class
        method      = iv_method
        duration_ms = iv_duration_ms
        message     = iv_message )
      pretty_name = /ui2/cl_json=>pretty_mode-camel_case
      compress    = abap_true ).
  ENDMETHOD.

  METHOD serialize_success.
    rv_json = /ui2/cl_json=>serialize(
      data = VALUE ty_runner_success(
        status    = 'ok'
        method    = iv_method
        exit_code = 0
        result    = iv_result )
      pretty_name = /ui2/cl_json=>pretty_mode-camel_case ).
  ENDMETHOD.

  METHOD serialize_result.
    TRY.
        rv_json = /ui2/cl_json=>serialize( iv_value ).
      CATCH cx_root.
        rv_json = '"<unserialisable>"'.
    ENDTRY.
  ENDMETHOD.

ENDCLASS.