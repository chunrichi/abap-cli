CLASS zcl_abap_vibe_ttyp_format DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES:
      BEGIN OF ty_warning,
        code    TYPE string,
        message TYPE string,
      END OF ty_warning,
      tt_warning TYPE STANDARD TABLE OF ty_warning WITH EMPTY KEY,
      BEGIN OF ty_field_out,
        field_name TYPE string,
        rollname   TYPE string,
        data_type  TYPE string,
        length     TYPE i,
        decimals   TYPE i,
        key_flag   TYPE abap_bool,
        not_null   TYPE abap_bool,
        ddtext     TYPE string,
        ref_table  TYPE string,
        ref_field  TYPE string,
        check_table TYPE string,
      END OF ty_field_out,
      tt_field_out TYPE STANDARD TABLE OF ty_field_out WITH EMPTY KEY,
      BEGIN OF ty_result,
        name             TYPE string,
        type             TYPE string,
        description      TYPE string,
        delivery_class   TYPE string,
        data_class       TYPE string,
        size_category    TYPE string,
        client_dependent TYPE abap_bool,
        fields           TYPE tt_field_out,
        main_json        TYPE string,
        ddic_source      TYPE string,
        settings_json    TYPE string,
        has_settings     TYPE abap_bool,
        warnings         TYPE tt_warning,
        success          TYPE abap_bool,
        error_code       TYPE string,
        error_message    TYPE string,
      END OF ty_result.

    CLASS-METHODS generate
      IMPORTING iv_name        TYPE tabname
                iv_object_type TYPE string
      RETURNING VALUE(rs_result) TYPE ty_result.

  PRIVATE SECTION.
    TYPES:
      BEGIN OF ty_field,
        fieldname  TYPE dd03p-fieldname,
        rollname   TYPE dd03p-rollname,
        datatype   TYPE dd03p-datatype,
        leng       TYPE dd03p-leng,
        decimals   TYPE dd03p-decimals,
        keyflag    TYPE dd03p-keyflag,
        notnull    TYPE dd03p-notnull,
        reftable   TYPE dd03p-reftable,
        reffield   TYPE dd03p-reffield,
        checktable TYPE dd03p-checktable,
        precfield  TYPE dd03p-precfield,
        ddtext     TYPE string,
      END OF ty_field,
      tt_field TYPE STANDARD TABLE OF ty_field WITH EMPTY KEY,
      BEGIN OF ty_foreign_key,
        fieldname  TYPE dd08l-fieldname,
        checktable TYPE dd08l-checktable,
        frkart     TYPE dd08l-frkart,
        cardleft   TYPE dd08l-cardleft,
        card       TYPE dd08l-card,
        ddtext     TYPE string,
      END OF ty_foreign_key,
      tt_foreign_key TYPE STANDARD TABLE OF ty_foreign_key WITH EMPTY KEY,
      BEGIN OF ty_foreign_key_eq,
        fieldname   TYPE dd05q-fieldname,
        fortable    TYPE dd05q-fortable,
        forkey      TYPE dd05q-forkey,
        checkfield  TYPE dd05q-checkfield,
      END OF ty_foreign_key_eq,
      tt_foreign_key_eq TYPE STANDARD TABLE OF ty_foreign_key_eq WITH EMPTY KEY.

    CLASS-METHODS read_metadata
      IMPORTING iv_name              TYPE tabname
                iv_object_type       TYPE string
      EXPORTING es_header            TYPE dd02v
                es_technical         TYPE dd09l
                et_fields            TYPE tt_field
                et_foreign_keys      TYPE tt_foreign_key
                et_foreign_key_eq    TYPE tt_foreign_key_eq
                ev_ok                TYPE abap_bool
                ev_error_code        TYPE string
                ev_error_message     TYPE string.

    CLASS-METHODS build_ddl
      IMPORTING is_header         TYPE dd02v
                iv_object_type    TYPE string
                it_fields         TYPE tt_field
                it_foreign_keys   TYPE tt_foreign_key
                it_foreign_key_eq TYPE tt_foreign_key_eq
      EXPORTING ev_source         TYPE string
                ev_ok             TYPE abap_bool
                et_warnings       TYPE tt_warning.

    CLASS-METHODS build_main_json
      IMPORTING is_header TYPE dd02v
      RETURNING VALUE(rv_json) TYPE string.

    CLASS-METHODS build_settings_json
      IMPORTING is_header    TYPE dd02v
                is_technical TYPE dd09l
                it_fields    TYPE tt_field
      RETURNING VALUE(rv_json) TYPE string.

    CLASS-METHODS field_type
      IMPORTING is_field TYPE ty_field
      RETURNING VALUE(rv_type) TYPE string.

    CLASS-METHODS enhancement_category
      IMPORTING iv_value TYPE dd02v-exclass
      RETURNING VALUE(rv_value) TYPE string.

    CLASS-METHODS table_category
      IMPORTING iv_value TYPE dd02v-tabclass
      RETURNING VALUE(rv_value) TYPE string.

    CLASS-METHODS data_maintenance
      IMPORTING iv_value TYPE dd02v-mainflag
      RETURNING VALUE(rv_value) TYPE string.

    CLASS-METHODS original_language
      RETURNING VALUE(rv_value) TYPE string.

    CLASS-METHODS json_escape
      IMPORTING iv_value TYPE string
      RETURNING VALUE(rv_value) TYPE string.

    CLASS-METHODS ddl_escape
      IMPORTING iv_value TYPE string
      RETURNING VALUE(rv_value) TYPE string.

    CLASS-METHODS component_text
      IMPORTING is_data      TYPE any
                iv_component TYPE string
      RETURNING VALUE(rv_value) TYPE string.

    CLASS-METHODS add_warning
      IMPORTING iv_code    TYPE string
                iv_message TYPE string
      CHANGING  ct_warnings TYPE tt_warning.
ENDCLASS.

CLASS zcl_abap_vibe_ttyp_format IMPLEMENTATION.
  METHOD generate.
    DATA ls_header TYPE dd02v.
    DATA ls_technical TYPE dd09l.
    DATA lt_fields TYPE tt_field.
    DATA lt_foreign_keys TYPE tt_foreign_key.
    DATA lt_foreign_key_eq TYPE tt_foreign_key_eq.
    DATA lv_ok TYPE abap_bool.
    DATA lv_error_code TYPE string.
    DATA lv_error_message TYPE string.

    rs_result-name = iv_name.
    rs_result-type = iv_object_type.
    rs_result-success = abap_false.

    read_metadata( EXPORTING iv_name           = iv_name
                 iv_object_type    = iv_object_type
                   IMPORTING es_header         = ls_header
                             es_technical      = ls_technical
                             et_fields         = lt_fields
                             et_foreign_keys   = lt_foreign_keys
                             et_foreign_key_eq = lt_foreign_key_eq
                             ev_ok             = lv_ok
                             ev_error_code     = lv_error_code
                             ev_error_message  = lv_error_message ).
    IF lv_ok = abap_false.
      rs_result-error_code = lv_error_code.
      rs_result-error_message = lv_error_message.
      RETURN.
    ENDIF.

    rs_result-name = ls_header-tabname.
    rs_result-description = ls_header-ddtext.
    rs_result-delivery_class = ls_header-contflag.
    rs_result-data_class = ls_technical-tabart.
    rs_result-size_category = ls_technical-tabkat.
    IF iv_object_type = 'TABL'.
      rs_result-client_dependent = COND abap_bool( WHEN line_exists( lt_fields[ fieldname = 'MANDT' ] )
                                                   THEN abap_true ELSE abap_false ).
    ENDIF.

    LOOP AT lt_fields INTO DATA(ls_field).
      APPEND VALUE ty_field_out(
        field_name  = ls_field-fieldname
        rollname    = ls_field-rollname
        data_type   = ls_field-datatype
        length      = ls_field-leng
        decimals    = ls_field-decimals
        key_flag    = COND abap_bool( WHEN ls_field-keyflag = 'X' THEN abap_true ELSE abap_false )
        not_null    = COND abap_bool( WHEN ls_field-notnull = 'X' THEN abap_true ELSE abap_false )
        ddtext      = ls_field-ddtext
        ref_table   = ls_field-reftable
        ref_field   = ls_field-reffield
        check_table = ls_field-checktable ) TO rs_result-fields.
    ENDLOOP.

    build_ddl( EXPORTING is_header         = ls_header
               iv_object_type    = iv_object_type
                         it_fields         = lt_fields
                         it_foreign_keys   = lt_foreign_keys
                         it_foreign_key_eq = lt_foreign_key_eq
               IMPORTING ev_source         = rs_result-ddic_source
                         ev_ok             = rs_result-success
                         et_warnings       = rs_result-warnings ).
    IF rs_result-success = abap_false.
      rs_result-error_code = 'DDIC_TABL_FORMAT_UNSUPPORTED'.
      rs_result-error_message = |TABL { iv_name } contains a field type that cannot be represented in ABAP file format|.
      RETURN.
    ENDIF.

    rs_result-main_json = build_main_json( is_header = ls_header ).
    IF iv_object_type = 'TABL'.
      rs_result-settings_json = build_settings_json( is_header    = ls_header
                                                      is_technical = ls_technical
                                                      it_fields    = lt_fields ).
      rs_result-has_settings = abap_true.
    ENDIF.
  ENDMETHOD.

  METHOD read_metadata.
    DATA lt_dd03p TYPE STANDARD TABLE OF dd03p WITH EMPTY KEY.

    CALL FUNCTION 'DDIF_TABL_GET'
      EXPORTING
        name     = iv_name
        state    = 'A'
        langu    = sy-langu
      IMPORTING
        dd02v_wa = es_header
        dd09l_wa = es_technical
      TABLES
        dd03p_tab = lt_dd03p
      EXCEPTIONS
        illegal_input = 1
        OTHERS = 2.
    IF sy-subrc <> 0 OR es_header-tabname IS INITIAL.
      ev_error_code = 'DDIC_OBJECT_NOT_FOUND'.
      ev_error_message = |TABL { iv_name } not found|.
      RETURN.
    ENDIF.

    IF iv_object_type = 'STRU' AND es_header-tabclass <> 'INTTAB'.
      ev_error_code = 'DDIC_TABL_FORMAT_UNSUPPORTED'.
      ev_error_message = |STRU { iv_name } has unsupported table class { es_header-tabclass }|.
      RETURN.
    ENDIF.
    IF iv_object_type = 'TABL' AND es_header-tabclass <> 'TRANSP'.
      ev_error_code = 'DDIC_TABL_FORMAT_UNSUPPORTED'.
      ev_error_message = |TABL { iv_name } has unsupported table class { es_header-tabclass }|.
      RETURN.
    ENDIF.

    SELECT tabname, fieldname, ddlanguage, ddtext
      FROM dd03t
      WHERE tabname = @iv_name
        AND as4local = 'A'
        AND ddlanguage IN ( '1', 'E' )
      INTO TABLE @DATA(lt_field_texts).
    SORT lt_field_texts BY fieldname ddlanguage.
    DELETE ADJACENT DUPLICATES FROM lt_field_texts COMPARING fieldname.

    LOOP AT lt_dd03p INTO DATA(ls_dd03p) WHERE adminfield = '0' AND depth = '00'.
      APPEND VALUE ty_field(
        fieldname  = ls_dd03p-fieldname
        rollname   = ls_dd03p-rollname
        datatype   = ls_dd03p-datatype
        leng       = ls_dd03p-leng
        decimals   = ls_dd03p-decimals
        keyflag    = ls_dd03p-keyflag
        notnull    = ls_dd03p-notnull
        reftable   = ls_dd03p-reftable
        reffield   = ls_dd03p-reffield
        checktable = ls_dd03p-checktable
        precfield  = ls_dd03p-precfield ) TO et_fields.
      READ TABLE lt_field_texts INTO DATA(ls_field_text)
        WITH KEY fieldname = ls_dd03p-fieldname BINARY SEARCH.
      IF sy-subrc = 0.
        et_fields[ lines( et_fields ) ]-ddtext = ls_field_text-ddtext.
      ENDIF.
    ENDLOOP.

    SELECT dd08l~fieldname, dd08l~checktable,
           dd08l~frkart, dd08l~cardleft, dd08l~card, dd08t~ddtext
      FROM dd08l
      LEFT OUTER JOIN dd08t
        ON dd08t~tabname = dd08l~tabname
       AND dd08t~fieldname = dd08l~fieldname
       AND dd08t~as4local = dd08l~as4local
       AND dd08t~as4vers = dd08l~as4vers
       AND dd08t~ddlanguage IN ( '1', 'E' )
      WHERE dd08l~tabname = @iv_name
      INTO TABLE @et_foreign_keys.

    SELECT fieldname, fortable, forkey, checkfield
      FROM dd05q
      WHERE tabname = @iv_name
      INTO TABLE @et_foreign_key_eq.

    ev_ok = abap_true.
  ENDMETHOD.

  METHOD build_ddl.
    DATA lt_lines TYPE STANDARD TABLE OF string WITH EMPTY KEY.
    DATA lv_name_width TYPE i.
    DATA lv_field_name TYPE string.
    DATA lv_field_type TYPE string.
    DATA lv_relation TYPE string.
    DATA lv_card TYPE string.
    DATA lv_card_left TYPE string.
    DATA lv_is_structure TYPE abap_bool.

    lv_is_structure = COND abap_bool( WHEN iv_object_type = 'STRU' THEN abap_true ELSE abap_false ).
    ev_ok = abap_true.
    APPEND |@EndUserText.label : '{ ddl_escape( CONV string( is_header-ddtext ) ) }'| TO lt_lines.
    IF lv_is_structure = abap_false.
      APPEND |@AbapCatalog.enhancement.category : { enhancement_category( is_header-exclass ) }| TO lt_lines.
      APPEND |@AbapCatalog.tableCategory : { table_category( is_header-tabclass ) }| TO lt_lines.
      APPEND |@AbapCatalog.deliveryClass : #{ COND string( WHEN is_header-contflag IS INITIAL THEN 'A' ELSE is_header-contflag ) }| TO lt_lines.
      APPEND |@AbapCatalog.dataMaintenance : { data_maintenance( is_header-mainflag ) }| TO lt_lines.
      IF is_header-viewref IS NOT INITIAL.
        APPEND |@AbapCatalog.replacementObject : '{ ddl_escape( CONV string( is_header-viewref ) ) }'| TO lt_lines.
      ENDIF.
    ENDIF.
    IF lv_is_structure = abap_true.
      APPEND |define structure { to_lower( is_header-tabname ) } \{| TO lt_lines.
    ELSE.
      APPEND |define table { to_lower( is_header-tabname ) } \{| TO lt_lines.
    ENDIF.
    APPEND '' TO lt_lines.

    LOOP AT it_fields INTO DATA(ls_field).
      IF ls_field-fieldname = '.INCLU--AP'.
        add_warning( EXPORTING iv_code = 'TABL_APPEND_OMITTED'
                               iv_message = |Append component { ls_field-precfield } is not represented in canonical TABL DDL|
                     CHANGING ct_warnings = et_warnings ).
        CONTINUE.
      ENDIF.
      IF ls_field-fieldname = '.INCLUDE'.
        IF ls_field-precfield IS INITIAL.
          add_warning( EXPORTING iv_code = 'TABL_INCLUDE_OMITTED'
                                 iv_message = 'Unnamed include component was omitted from canonical TABL DDL'
                       CHANGING ct_warnings = et_warnings ).
        ELSE.
          APPEND |  include { to_lower( ls_field-precfield ) };| TO lt_lines.
        ENDIF.
        CONTINUE.
      ENDIF.
      lv_field_name = to_lower( ls_field-fieldname ).
      IF lv_is_structure = abap_false AND ls_field-keyflag = 'X'.
        lv_field_name = |key { lv_field_name }|.
      ENDIF.
      IF strlen( lv_field_name ) > lv_name_width.
        lv_name_width = strlen( lv_field_name ).
      ENDIF.
    ENDLOOP.

    LOOP AT it_fields INTO ls_field.
      IF ls_field-fieldname = '.INCLUDE' OR ls_field-fieldname = '.INCLU--AP'.
        CONTINUE.
      ENDIF.
      lv_field_type = field_type( is_field = ls_field ).
      IF lv_field_type IS INITIAL.
        ev_ok = abap_false.
        add_warning( EXPORTING iv_code = 'TABL_FIELD_TYPE_UNSUPPORTED'
                               iv_message = |Field { ls_field-fieldname } uses unsupported built-in type { ls_field-datatype }|
                     CHANGING ct_warnings = et_warnings ).
        CONTINUE.
      ENDIF.

      IF lv_is_structure = abap_false AND ls_field-ddtext IS NOT INITIAL.
        APPEND |  @EndUserText.label : '{ ddl_escape( ls_field-ddtext ) }'| TO lt_lines.
      ENDIF.
      IF lv_is_structure = abap_false AND ls_field-datatype = 'CURR' AND ls_field-reftable IS NOT INITIAL AND ls_field-reffield IS NOT INITIAL.
        APPEND |  @Semantics.amount.currencyCode : '{ to_lower( ls_field-reftable ) }.{ to_lower( ls_field-reffield ) }'| TO lt_lines.
      ELSEIF lv_is_structure = abap_false AND ls_field-datatype = 'QUAN' AND ls_field-reftable IS NOT INITIAL AND ls_field-reffield IS NOT INITIAL.
        APPEND |  @Semantics.quantity.unitOfMeasure : '{ to_lower( ls_field-reftable ) }.{ to_lower( ls_field-reffield ) }'| TO lt_lines.
      ELSEIF lv_is_structure = abap_false AND ls_field-datatype = 'LANG'.
        APPEND '  @AbapCatalog.textLanguage' TO lt_lines.
      ENDIF.

      lv_field_name = to_lower( ls_field-fieldname ).
      IF lv_is_structure = abap_false AND ls_field-keyflag = 'X'.
        lv_field_name = |key { lv_field_name }|.
      ENDIF.
      lv_relation = |  { lv_field_name WIDTH = lv_name_width ALIGN = LEFT } : { lv_field_type }|.
      IF lv_is_structure = abap_false AND ls_field-notnull = 'X'.
        lv_relation = lv_relation && ' not null'.
      ENDIF.

      IF lv_is_structure = abap_true.
        APPEND lv_relation && ';' TO lt_lines.
        CONTINUE.
      ENDIF.

      READ TABLE it_foreign_keys INTO DATA(ls_foreign_key)
        WITH KEY fieldname = ls_field-fieldname.
      IF sy-subrc <> 0 OR ls_foreign_key-checktable IS INITIAL.
        APPEND lv_relation && ';' TO lt_lines.
        CONTINUE.
      ENDIF.

      lv_card = COND string( WHEN ls_foreign_key-card = '1' THEN '1'
                             WHEN ls_foreign_key-card = 'C' THEN '0..1'
                             ELSE '0..*' ).
      lv_card_left = COND string( WHEN ls_foreign_key-cardleft = '1' THEN '1' ELSE '0..1' ).
      IF ls_foreign_key-card IS INITIAL AND ls_foreign_key-cardleft IS INITIAL.
        APPEND lv_relation TO lt_lines.
        APPEND |    with foreign key { to_lower( ls_foreign_key-checktable ) }| TO lt_lines.
      ELSE.
        APPEND lv_relation TO lt_lines.
        APPEND |    with foreign key [{ lv_card },{ lv_card_left }] { to_lower( ls_foreign_key-checktable ) }| TO lt_lines.
      ENDIF.

      DATA lv_where_lines TYPE i.
      LOOP AT it_foreign_key_eq INTO DATA(ls_eq) WHERE fieldname = ls_field-fieldname.
        DATA(lv_rhs) = COND string( WHEN ls_eq-forkey IS INITIAL
                                    THEN to_lower( ls_eq-fortable )
                                    ELSE |{ to_lower( ls_eq-fortable ) }.{ to_lower( ls_eq-forkey ) }| ).
        IF lv_where_lines = 0.
          APPEND |      where { to_lower( ls_eq-checkfield ) } = { lv_rhs }| TO lt_lines.
        ELSE.
          APPEND |        and { to_lower( ls_eq-checkfield ) } = { lv_rhs }| TO lt_lines.
        ENDIF.
        lv_where_lines = lv_where_lines + 1.
      ENDLOOP.
      IF lv_where_lines = 0.
        lt_lines[ lines( lt_lines ) ] = lt_lines[ lines( lt_lines ) ] && ';'.
      ELSE.
        lt_lines[ lines( lt_lines ) ] = lt_lines[ lines( lt_lines ) ] && ';'.
      ENDIF.
    ENDLOOP.

    APPEND '}' TO lt_lines.
    CONCATENATE LINES OF lt_lines INTO ev_source SEPARATED BY cl_abap_char_utilities=>newline.
    ev_source = ev_source && cl_abap_char_utilities=>newline.
  ENDMETHOD.

  METHOD build_main_json.
    DATA lt_lines TYPE STANDARD TABLE OF string WITH EMPTY KEY.
    APPEND '{' TO lt_lines.
    APPEND '  "formatVersion": "1",' TO lt_lines.
    APPEND '  "header": {' TO lt_lines.
    APPEND |    "description": "{ json_escape( CONV string( is_header-ddtext ) ) }",| TO lt_lines.
    APPEND |    "originalLanguage": "{ original_language( ) }"| TO lt_lines.
    APPEND '  }' TO lt_lines.
    APPEND '}' TO lt_lines.
    CONCATENATE LINES OF lt_lines INTO rv_json SEPARATED BY cl_abap_char_utilities=>newline.
    rv_json = rv_json && cl_abap_char_utilities=>newline.
  ENDMETHOD.

  METHOD build_settings_json.
    DATA lt_lines TYPE STANDARD TABLE OF string WITH EMPTY KEY.
    DATA lv_translation TYPE string VALUE 'noLanguageKey'.
    IF line_exists( it_fields[ datatype = 'LANG' ] ).
      lv_translation = 'standard'.
    ENDIF.
    APPEND '{' TO lt_lines.
    APPEND '  "formatVersion": "1",' TO lt_lines.
    APPEND '  "generalInformation": {' TO lt_lines.
    APPEND |    "dataClassCategory": "{ json_escape( CONV string( is_technical-tabart ) ) }",| TO lt_lines.
    APPEND |    "sizeCategory": "{ json_escape( CONV string( is_technical-tabkat ) ) }",| TO lt_lines.
    APPEND '    "logChanges": false,' TO lt_lines.
    APPEND '    "writableByAmdp": false,' TO lt_lines.
    APPEND |    "translation": "{ lv_translation }"| TO lt_lines.
    APPEND '  }' TO lt_lines.
    APPEND '}' TO lt_lines.
    CONCATENATE LINES OF lt_lines INTO rv_json SEPARATED BY cl_abap_char_utilities=>newline.
    rv_json = rv_json && cl_abap_char_utilities=>newline.
  ENDMETHOD.

  METHOD field_type.
    IF is_field-rollname IS NOT INITIAL.
      rv_type = to_lower( is_field-rollname ).
      RETURN.
    ENDIF.
    CASE is_field-datatype.
      WHEN 'ACCP'. rv_type = 'abap.accp'.
      WHEN 'CHAR'. rv_type = |abap.char({ is_field-leng })|.
      WHEN 'CLNT'. rv_type = 'abap.clnt'.
      WHEN 'CUKY'. rv_type = 'abap.cuky'.
      WHEN 'DATS'. rv_type = 'abap.dats'.
      WHEN 'CURR'. rv_type = |abap.curr({ is_field-leng },{ is_field-decimals })|.
      WHEN 'D16D'. rv_type = |abap.df16_dec({ is_field-leng },{ is_field-decimals })|.
      WHEN 'D16N'. rv_type = 'abap.decfloat16'.
      WHEN 'D16R'. rv_type = 'abap.df16_raw'.
      WHEN 'D16S'. rv_type = 'abap.df16_scl'.
      WHEN 'D34D'. rv_type = |abap.df34_dec({ is_field-leng },{ is_field-decimals })|.
      WHEN 'D34N'. rv_type = 'abap.decfloat34'.
      WHEN 'D34R'. rv_type = 'abap.df34_raw'.
      WHEN 'D34S'. rv_type = 'abap.df34_scl'.
      WHEN 'DATN'. rv_type = 'abap.datn'.
      WHEN 'FLTP'. rv_type = 'abap.fltp'.
      WHEN 'GGM1'. rv_type = 'abap.geom_ewkb'.
      WHEN 'INT1'. rv_type = 'abap.int1'.
      WHEN 'INT2'. rv_type = 'abap.int2'.
      WHEN 'INT4'. rv_type = 'abap.int4'.
      WHEN 'INT8'. rv_type = 'abap.int8'.
      WHEN 'LANG'. rv_type = 'abap.lang'.
      WHEN 'LCHR'. rv_type = 'abap.string'.
      WHEN 'LRAW'. rv_type = |abap.lraw({ is_field-leng })|.
      WHEN 'NUMC'. rv_type = |abap.numc({ is_field-leng })|.
      WHEN 'PREC'. rv_type = 'abap.prec'.
      WHEN 'QUAN'. rv_type = |abap.quan({ is_field-leng },{ is_field-decimals })|.
      WHEN 'RAW'.  rv_type = |abap.raw({ is_field-leng })|.
      WHEN 'RSTR'. rv_type = |abap.rawstring({ is_field-leng })|.
      WHEN 'SSTR'. rv_type = |abap.sstring({ is_field-leng })|.
      WHEN 'STRG'. rv_type = |abap.string({ is_field-leng })|.
      WHEN 'TIMN'. rv_type = 'abap.timn'.
      WHEN 'TIMS'. rv_type = 'abap.tims'.
      WHEN 'UNIT'. rv_type = |abap.unit({ is_field-leng })|.
      WHEN 'UTCL'. rv_type = 'abap.utclong'.
      WHEN 'VARC'. rv_type = |abap.varc({ is_field-leng })|.
      WHEN OTHERS. CLEAR rv_type.
    ENDCASE.
  ENDMETHOD.

  METHOD enhancement_category.
    rv_value = SWITCH string( iv_value
      WHEN '0' THEN '#NOT_CLASSIFIED'
      WHEN '1' THEN '#NOT_EXTENSIBLE'
      WHEN '2' THEN '#EXTENSIBLE_CHARACTER'
      WHEN '3' THEN '#EXTENSIBLE_CHARACTER_NUMERIC'
      WHEN '4' THEN '#EXTENSIBLE_ANY'
      ELSE '#NOT_CLASSIFIED' ).
  ENDMETHOD.

  METHOD table_category.
    IF iv_value = 'TRANSP'.
      rv_value = '#TRANSPARENT'.
    ELSE.
      rv_value = '#TRANSPARENT'.
    ENDIF.
  ENDMETHOD.

  METHOD data_maintenance.
    rv_value = SWITCH string( iv_value
      WHEN 'D' THEN '#LIMITED'
      WHEN 'N' THEN '#NOT_ALLOWED'
      WHEN 'X' THEN '#ALLOWED'
      ELSE '#RESTRICTED' ).
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

  METHOD ddl_escape.
    rv_value = iv_value.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>cr_lf IN rv_value WITH ` `.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>newline IN rv_value WITH ` `.
    REPLACE ALL OCCURRENCES OF '''' IN rv_value WITH `''`.
  ENDMETHOD.

  METHOD component_text.
    FIELD-SYMBOLS <component> TYPE any.
    ASSIGN COMPONENT iv_component OF STRUCTURE is_data TO <component>.
    IF sy-subrc = 0.
      rv_value = CONV string( <component> ).
    ENDIF.
  ENDMETHOD.

  METHOD add_warning.
    APPEND VALUE ty_warning( code = iv_code message = iv_message ) TO ct_warnings.
  ENDMETHOD.
ENDCLASS.