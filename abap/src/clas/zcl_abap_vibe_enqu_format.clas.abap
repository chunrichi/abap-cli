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
                ev_master_language TYPE string
                es_primary       TYPE ty_lock_table
                et_secondary     TYPE tt_lock_table
                et_parameters    TYPE tt_lock_parameter
                es_modules       TYPE ty_lock_modules
                ev_ok            TYPE abap_bool
                ev_error_code    TYPE string
                ev_error_message TYPE string.

    " Domain ENQMODE (fixed values + English texts read from DD07L/DD07T on
    " vhcala4hci) maps 1:1 onto the AFF `lockMode` enum, in this order:
    "   E Write Lock                                        -> exclusive
    "   S Shared Lock                                       -> shared
    "   X Exclusive, not cumulative                         -> exclusiveNotCumulative
    "   O Set Optimistic Lock                               -> setOptimistic
    "   R Promote optimistic lock; transform from '0' to 'E' -> promoteOptimistic
    "   U Only conflict check extended exclusive lock, as with 'X'
    "                                                       -> conflictCheckExtendedExcl
    "   V Only conflict check exclusive lock, as with 'E'   -> conflictCheckExclusive
    "   W Conflict check for shared lock only, as with 'S'  -> conflictCheckShared
    "   C Only promotion check optimized lock, as with 'R'  -> promotionCheckOptimized
    "   T Reserved                                          -> reserved1
    "   + Reserved                                          -> reserved2
    "   (initial)                                           -> initial
    CLASS-METHODS lock_mode_from_enqmode
      IMPORTING iv_enqmode           TYPE dd27p-enqmode
      RETURNING VALUE(rv_lock_mode)  TYPE string.

    " sy-langu -> AFF two-letter code, mirroring the mapping the other DDIC
    " format helpers use (zcl_abap_vibe_tabl_format#original_language). SAP
    " language keys are single characters — '1' is Chinese, not an ISO code —
    " so the raw key must not be emitted as `originalLanguage`.
    CLASS-METHODS language_code
      IMPORTING iv_language    TYPE string
      RETURNING VALUE(rv_code) TYPE string.
ENDCLASS.

CLASS zcl_abap_vibe_enqu_format IMPLEMENTATION.
  METHOD generate.
    DATA lv_ok TYPE abap_bool.
    DATA lv_error_code TYPE string.
    DATA lv_error_message TYPE string.
    DATA lv_master_language TYPE string.

    rs_result-name = iv_name.
    rs_result-type = 'ENQU'.
    rs_result-success = abap_false.

    read_enqu( EXPORTING iv_name          = iv_name
               IMPORTING es_primary       = rs_result-primary_table
                         et_secondary     = rs_result-secondary_tables
                         et_parameters    = rs_result-lock_parameters
                         es_modules       = rs_result-lock_modules
                         ev_description   = rs_result-header-description
                         ev_master_language = lv_master_language
                         ev_ok            = lv_ok
                         ev_error_code    = lv_error_code
                         ev_error_message = lv_error_message ).
    IF lv_ok = abap_false.
      rs_result-error_code = lv_error_code.
      rs_result-error_message = lv_error_message.
      RETURN.
    ENDIF.

    " Prefer the lock object's own master language; fall back to the session
    " language (mapped to a two-letter code) when SAP leaves it empty.
    IF lv_master_language IS INITIAL.
      lv_master_language = sy-langu.
    ENDIF.
    rs_result-header-original_language = language_code( lv_master_language ).
    rs_result-success = abap_true.
  ENDMETHOD.

  METHOD read_enqu.
    DATA ls_dd25v    TYPE dd25v.
    DATA lt_dd26e    TYPE STANDARD TABLE OF dd26e WITH EMPTY KEY.
    DATA lt_dd27p    TYPE STANDARD TABLE OF dd27p WITH EMPTY KEY.
    DATA lt_ddena    TYPE STANDARD TABLE OF ddena WITH EMPTY KEY.
    DATA lv_gotstate TYPE ddgotstate.
    DATA ls_mode     TYPE dd26e.
    DATA ls_param    TYPE dd27p.
    DATA lv_table    TYPE tabname.
    DATA lv_index    TYPE i.
    DATA lv_mode     TYPE string.
    DATA lt_tables   TYPE STANDARD TABLE OF tabname WITH EMPTY KEY.

    CLEAR: ev_description, ev_master_language, es_primary, et_secondary, et_parameters, es_modules.
    ev_ok = abap_false.
    es_modules-allow_rfc = abap_false.

    CALL FUNCTION 'DDIF_ENQU_GET'
      EXPORTING
        name          = iv_name
        state         = 'A'
        langu         = sy-langu
      IMPORTING
        gotstate      = lv_gotstate
        dd25v_wa      = ls_dd25v
      TABLES
        dd26e_tab     = lt_dd26e
        dd27p_tab     = lt_dd27p
        ddena_tab     = lt_ddena
      EXCEPTIONS
        illegal_input = 1
        OTHERS        = 2.
    IF sy-subrc <> 0 OR lv_gotstate <> 'A'.
      ev_error_code = 'ENQU_NOT_FOUND'.
      ev_error_message = |lock object { iv_name } does not exist (state { lv_gotstate })|.
      RETURN.
    ENDIF.

    ev_description = ls_dd25v-ddtext.
    ev_master_language = ls_dd25v-masterlang.

    " Table order: the root table first (DD25V-ROOTTAB), then every further
    " table in the order its fields appear in DD27P. DD26E holds exactly one
    " lock mode per participating table, positionally aligned with that list
    " (verified on CATA: 3 tables -> 3 DD26E rows).
    es_primary-name = to_upper( COND tabname( WHEN ls_dd25v-roottab IS NOT INITIAL
                                              THEN ls_dd25v-roottab
                                              ELSE iv_name ) ).
    IF es_primary-name IS NOT INITIAL.
      APPEND es_primary-name TO lt_tables.
    ENDIF.

    LOOP AT lt_dd27p INTO ls_param.
      lv_table = to_upper( ls_param-tabname ).
      IF lv_table IS INITIAL.
        CONTINUE.
      ENDIF.
      READ TABLE lt_tables TRANSPORTING NO FIELDS WITH KEY table_line = lv_table.
      IF sy-subrc <> 0.
        APPEND lv_table TO lt_tables.
      ENDIF.
    ENDLOOP.

    lv_index = 0.
    LOOP AT lt_tables INTO lv_table.
      lv_index = lv_index + 1.
      CLEAR ls_mode.
      READ TABLE lt_dd26e INTO ls_mode INDEX lv_index.
      lv_mode = lock_mode_from_enqmode( ls_mode-enqmode ).
      IF lv_index = 1.
        es_primary-lock_mode = lv_mode.
      ELSE.
        APPEND VALUE ty_lock_table( name = lv_table lock_mode = lv_mode ) TO et_secondary.
      ENDIF.
    ENDLOOP.

    " Lock parameters in DD27P order (one row per selected field).
    LOOP AT lt_dd27p INTO ls_param.
      APPEND VALUE ty_lock_parameter(
        name   = to_upper( COND #( WHEN ls_param-viewfield IS NOT INITIAL
                                   THEN ls_param-viewfield
                                   ELSE ls_param-fieldname ) )
        table  = to_upper( ls_param-tabname )
        field  = to_upper( ls_param-fieldname )
        active = abap_true ) TO et_parameters.
    ENDLOOP.

    " allowRfc stays false: the SAP attribute behind the AFF `lockModules.allowRfc`
    " flag has not been identified yet (DD25V carries no obviously matching flag
    " for the lock objects checked). AFF treats the field as optional and the CLI
    " defaults it to false, so pulling is still structurally valid — but a
    " round-trip through pull -> push will not preserve a set "allow RFC".
    ev_ok = abap_true.
  ENDMETHOD.

  METHOD lock_mode_from_enqmode.
    CASE iv_enqmode.
      WHEN 'E'. rv_lock_mode = 'exclusive'.
      WHEN 'S'. rv_lock_mode = 'shared'.
      WHEN 'X'. rv_lock_mode = 'exclusiveNotCumulative'.
      WHEN 'O'. rv_lock_mode = 'setOptimistic'.
      WHEN 'R'. rv_lock_mode = 'promoteOptimistic'.
      WHEN 'U'. rv_lock_mode = 'conflictCheckExtendedExcl'.
      WHEN 'V'. rv_lock_mode = 'conflictCheckExclusive'.
      WHEN 'W'. rv_lock_mode = 'conflictCheckShared'.
      WHEN 'C'. rv_lock_mode = 'promotionCheckOptimized'.
      WHEN 'T'. rv_lock_mode = 'reserved1'.
      WHEN '+'. rv_lock_mode = 'reserved2'.
      WHEN OTHERS. rv_lock_mode = 'initial'.
    ENDCASE.
  ENDMETHOD.

  METHOD language_code.
    rv_code = SWITCH string( iv_language
      WHEN 'D' THEN 'de'
      WHEN 'E' THEN 'en'
      WHEN '1' THEN 'zh'
      WHEN 'F' THEN 'fr'
      WHEN 'S' THEN 'es'
      ELSE 'en' ).
  ENDMETHOD.
ENDCLASS.
