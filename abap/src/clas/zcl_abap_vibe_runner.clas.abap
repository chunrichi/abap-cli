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

    METHODS serialize_result
      IMPORTING iv_value TYPE string
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
      out->write( |\{ "status": "ok", "exitCode": 0, "message": "classrun heartbeat", "version": "{ gc_version }" \}| ).
      RETURN.
    ENDIF.

    " A --method was requested but the endpoint injected no method name —
    " the target system's ADT classrun does not support parameter injection.
    IF lv_target_class IS INITIAL.
      out->write( |\{ "status": "error", "code": "WRAPPER_INPUT_UNAVAILABLE", "message": "classrun parameter injection is not supported on this system; use a direct classrun (no --method) or run via abap deploy" \}| ).
      RETURN.
    ENDIF.

    " Local classes cannot be invoked — reject early.
    IF lv_target_class CS '~'.
      out->write( |\{ "status": "error", "code": "LOCAL_CLASS_NOT_RUNNABLE", "class": "{ lv_target_class }", "message": "class name contains ~ (local class)" \}| ).
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
          out->write( |\{ "status": "error", "code": "TIMEOUT", "message": "exceeded { lv_timeout_ms }ms", "durationMs": { lv_elapsed_ms } \}| ).
          RETURN.
        ENDIF.

        out->write( |\{ "status": "ok", "method": "{ lv_method_name }", "exitCode": 0, "result": \{ serialize_result( lv_result ) \} \}| ).
      CATCH cx_sy_dyn_call_error INTO DATA(lx_dyn).
        out->write( |\{ "status": "error", "code": "METHOD_FAILED", "class": "{ lv_target_class }", "method": "{ lv_method_name }", "message": "{ CONDENSE( lx_dyn->get_text( ) ) }" \}| ).
      CATCH cx_root INTO DATA(lx_root).
        out->write( |\{ "status": "error", "code": "METHOD_FAILED", "class": "{ lv_target_class }", "method": "{ lv_method_name }", "message": "{ CONDENSE( lx_root->get_text( ) ) }" \}| ).
    ENDTRY.
  ENDMETHOD.

  METHOD serialize_result.
    TRY.
        rv_json = /ui2/cl_json=>serialize( iv_value ).
      CATCH cx_root.
        rv_json = '"<unserialisable>"'.
    ENDTRY.
  ENDMETHOD.

ENDCLASS.