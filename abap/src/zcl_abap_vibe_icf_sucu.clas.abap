CLASS zcl_abap_vibe_icf_sucu DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS dispatch
      IMPORTING io_server TYPE REF TO if_http_server
                iv_path   TYPE string
                iv_method TYPE string
                iv_body   TYPE string.
ENDCLASS.

CLASS zcl_abap_vibe_icf_sucu IMPLEMENTATION.
  METHOD dispatch.
    " Route /auth/sucu/<name>: the family skeleton. The per-type read/write
    " logic is added here; until then the route answers 501 instead of 404 so a
    " deployed service reports the missing implementation explicitly.
    zcl_abap_vibe_icf_auth_common=>respond_error( io_server = io_server
                                                  iv_status = 501
                                                  iv_code   = 'SUCU_NOT_IMPLEMENTED'
                                                  iv_msg    = |/auth/sucu is not implemented yet| ).
  ENDMETHOD.
ENDCLASS.
