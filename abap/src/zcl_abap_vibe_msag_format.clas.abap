CLASS zcl_abap_vibe_msag_format DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES:
      BEGIN OF ty_warning,
        code    TYPE string,
        message TYPE string,
      END OF ty_warning,
      tt_warning TYPE STANDARD TABLE OF ty_warning WITH EMPTY KEY,
      BEGIN OF ty_message_out,
        number TYPE string,
        text   TYPE string,
      END OF ty_message_out,
      tt_message_out TYPE STANDARD TABLE OF ty_message_out WITH EMPTY KEY,
      BEGIN OF ty_result,
        name          TYPE string,
        type          TYPE string,
        description   TYPE string,
        messages      TYPE tt_message_out,
        main_json     TYPE string,
        warnings      TYPE tt_warning,
        success       TYPE abap_bool,
        error_code    TYPE string,
        error_message TYPE string,
      END OF ty_result.

    CLASS-METHODS generate
      IMPORTING iv_name          TYPE arbgb
      RETURNING VALUE(rs_result) TYPE ty_result.

  PRIVATE SECTION.
    TYPES:
      BEGIN OF ty_message,
        msgnr TYPE t100-msgnr,
        text  TYPE t100-text,
      END OF ty_message,
      tt_message TYPE STANDARD TABLE OF ty_message WITH EMPTY KEY.

    CLASS-METHODS read_metadata
      IMPORTING iv_name          TYPE arbgb
      EXPORTING ev_description   TYPE string
                et_messages      TYPE tt_message
                ev_ok            TYPE abap_bool
                ev_error_code    TYPE string
                ev_error_message TYPE string.

    CLASS-METHODS build_main_json
      IMPORTING iv_description TYPE string
                it_messages    TYPE tt_message
      RETURNING VALUE(rv_json) TYPE string.

    CLASS-METHODS original_language
      RETURNING VALUE(rv_value) TYPE string.

    CLASS-METHODS json_escape
      IMPORTING iv_value        TYPE string
      RETURNING VALUE(rv_value) TYPE string.
ENDCLASS.

CLASS zcl_abap_vibe_msag_format IMPLEMENTATION.
  METHOD generate.
    DATA lv_description TYPE string.
    DATA lt_messages TYPE tt_message.
    DATA lv_ok TYPE abap_bool.
    DATA lv_error_code TYPE string.
    DATA lv_error_message TYPE string.

    rs_result-name = iv_name.
    rs_result-type = 'MSAG'.
    rs_result-success = abap_false.

    read_metadata( EXPORTING iv_name          = iv_name
                   IMPORTING ev_description   = lv_description
                             et_messages      = lt_messages
                             ev_ok            = lv_ok
                             ev_error_code    = lv_error_code
                             ev_error_message = lv_error_message ).
    IF lv_ok = abap_false.
      rs_result-error_code = lv_error_code.
      rs_result-error_message = lv_error_message.
      RETURN.
    ENDIF.

    rs_result-description = lv_description.
    LOOP AT lt_messages INTO DATA(ls_message).
      APPEND VALUE ty_message_out( number = ls_message-msgnr
                                   text   = ls_message-text ) TO rs_result-messages.
    ENDLOOP.

    rs_result-main_json = build_main_json( iv_description = lv_description
                                           it_messages    = lt_messages ).
    rs_result-success = abap_true.
  ENDMETHOD.

  METHOD read_metadata.
    " T100A holds the message class header; T100 the numbered texts. Neither
    " has a DDIF_ read module, so we read them directly.
    SELECT SINGLE stext FROM t100a
      WHERE arbgb = @iv_name
      INTO @DATA(lv_stext).
    IF sy-subrc <> 0.
      ev_error_code = 'DDIC_OBJECT_NOT_FOUND'.
      ev_error_message = |MSAG { iv_name } not found|.
      RETURN.
    ENDIF.
    ev_description = lv_stext.

    SELECT msgnr, text FROM t100
      WHERE arbgb = @iv_name
        AND sprsl = @sy-langu
      ORDER BY msgnr
      INTO TABLE @DATA(lt_t100).
    IF lines( lt_t100 ) = 0.
      " Fall back to English when the login language carries no translation.
      SELECT msgnr, text FROM t100
        WHERE arbgb = @iv_name
          AND sprsl = 'E'
        ORDER BY msgnr
        INTO TABLE @lt_t100.
    ENDIF.

    LOOP AT lt_t100 INTO DATA(ls_t100).
      APPEND VALUE ty_message( msgnr = ls_t100-msgnr
                               text  = ls_t100-text ) TO et_messages.
    ENDLOOP.

    ev_ok = abap_true.
  ENDMETHOD.

  METHOD build_main_json.
    DATA lv_messages TYPE string.

    LOOP AT it_messages INTO DATA(ls_message).
      IF lv_messages IS NOT INITIAL.
        lv_messages = |{ lv_messages },|.
      ENDIF.
      lv_messages = |{ lv_messages }\n    \{ "number": "{ ls_message-msgnr }", |
                 && |"text": "{ json_escape( CONV string( ls_message-text ) ) }" \}|.
    ENDLOOP.

    rv_json = |\{\n|
           && |  "formatVersion": "1",\n|
           && |  "header": \{\n|
           && |    "description": "{ json_escape( iv_description ) }",\n|
           && |    "originalLanguage": "{ original_language( ) }"\n|
           && |  \},\n|.
    IF lv_messages IS INITIAL.
      rv_json = |{ rv_json }  "messages": []\n\}\n|.
    ELSE.
      rv_json = |{ rv_json }  "messages": [{ lv_messages }\n  ]\n\}\n|.
    ENDIF.
  ENDMETHOD.

  METHOD original_language.
    rv_value = SWITCH string( sy-langu
      WHEN 'D' THEN 'de'
      WHEN 'E' THEN 'en'
      WHEN '1' THEN 'zh'
      WHEN 'F' THEN 'fr'
      WHEN 'S' THEN 'es'
      ELSE 'en' ).
  ENDMETHOD.

  METHOD json_escape.
    rv_value = iv_value.
    REPLACE ALL OCCURRENCES OF '\' IN rv_value WITH '\\'.
    REPLACE ALL OCCURRENCES OF '"' IN rv_value WITH '\"'.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>cr_lf IN rv_value WITH '\r\n'.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>newline IN rv_value WITH '\n'.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>horizontal_tab IN rv_value WITH '\t'.
  ENDMETHOD.
ENDCLASS.
