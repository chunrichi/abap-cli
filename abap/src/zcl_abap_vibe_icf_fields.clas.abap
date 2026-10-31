CLASS zcl_abap_vibe_icf_fields DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.

    TYPES:
      BEGIN OF ty_find_request,
        " Field names to search for (uppercased server-side).
        fields        TYPE string_table,
        " Require ALL fields to be present in the table (default: true).
        " When false, returns every table that has ANY of the requested fields.
        requireAll    TYPE abap_bool,
        " Filter to a specific table class (TRANSP / VIEW / INTTAB / ...). Optional.
        tabclass      TYPE string,
        " Filter to a specific AS4LOCAL (A = active). Default 'A'.
        as4local      TYPE string,
        " Maximum number of matching tables to return. Default 200, hard cap 5000.
        limit         TYPE i,
        " when true, the SAP-side handler joins DD03T (table field text)
        " and DD04T (data element text) so each match field carries the
        " short description. Adds ~2 left-joins per result set; default false.
        includeText   TYPE abap_bool,
      END OF ty_find_request,
      BEGIN OF ty_find_match_field,
        name        TYPE string,
        rollname    TYPE string,
        position    TYPE i,
        " DDIC short text from DD03T (per table field) or DD04T
        " (per data element). One of these is typically populated; the
        " data element wins when both exist. Empty when includeText=false
        " or no master/maintenance language text is available.
        fieldText   TYPE string,
        elementText TYPE string,
      END OF ty_find_match_field,
      tt_find_match_field TYPE STANDARD TABLE OF ty_find_match_field WITH EMPTY KEY,
      BEGIN OF ty_find_match_table,
        table    TYPE string,
        tabclass TYPE string,
        fields   TYPE tt_find_match_field,
        hitCount TYPE i,
      END OF ty_find_match_table,
      tt_find_match_table TYPE STANDARD TABLE OF ty_find_match_table WITH EMPTY KEY,
      BEGIN OF ty_find_data,
        total      TYPE i,
        truncated  TYPE abap_bool,
        matches    TYPE tt_find_match_table,
        mode       TYPE string,   " 'all' | 'any'
      END OF ty_find_data,
      BEGIN OF ty_find_response,
        status TYPE string,
        data   TYPE ty_find_data,
      END OF ty_find_response.

    CLASS-METHODS dispatch_find_tables
      IMPORTING io_server TYPE REF TO if_http_server
                iv_path   TYPE string
                iv_method TYPE string
                iv_body   TYPE string.

    CLASS-METHODS execute_find_tables
      IMPORTING is_req     TYPE ty_find_request
      EXPORTING es_payload TYPE ty_find_response
                ev_error   TYPE zcl_abap_vibe_icf_types=>ty_error_body.

    CLASS-METHODS parse_find_request
      IMPORTING iv_body     TYPE string
      EXPORTING es_req      TYPE ty_find_request
                ev_ok       TYPE abap_bool
                ev_err_code TYPE string
                ev_err_msg  TYPE string.
ENDCLASS.

CLASS zcl_abap_vibe_icf_fields IMPLEMENTATION.

  METHOD dispatch_find_tables.
    " POST /data/find-tables-by-fields
    " Body: { fields: ["CHANGED_BY","CHANGED_ON"], requireAll: true, tabclass: "TRANSP", limit: 200 }
    " Returns one entry per table that contains ALL (or ANY) of the requested
    " fields. Used by `abap fields --find`. The scan reads DD03L directly
    " rather than per-table, so the cost is O(matching DD03L rows), not
    " O(tables × fields) — important for systems where DD03L has ~100k rows.
    IF iv_path <> '/data/find-tables-by-fields'.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 404
                     iv_reason = 'Not Found'
                     iv_code   = 'NOT_FOUND'
                     iv_msg    = |unsupported path: /sap/abap_cli{ iv_path }| ).
      RETURN.
    ENDIF.
    IF iv_method <> 'POST'.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 405
                     iv_reason = 'Method Not Allowed'
                     iv_code   = 'METHOD_NOT_ALLOWED'
                     iv_msg    = 'POST only on /data/find-tables-by-fields' ).
      RETURN.
    ENDIF.

    " Parse + execute.
    DATA(ls_req) = VALUE ty_find_request( ).
    DATA(lv_parse_ok) = abap_false.
    DATA(lv_err_code) = VALUE string( ).
    DATA(lv_err_msg)  = VALUE string( ).
    parse_find_request( EXPORTING iv_body = iv_body
                        IMPORTING es_req = ls_req
                                  ev_ok = lv_parse_ok
                                  ev_err_code = lv_err_code
                                  ev_err_msg  = lv_err_msg ).
    IF lv_parse_ok = abap_false.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = lv_err_code
                     iv_msg    = lv_err_msg ).
      RETURN.
    ENDIF.

    DATA(ls_resp) = VALUE ty_find_response( ).
    DATA(ls_err)  = VALUE zcl_abap_vibe_icf_types=>ty_error_body( ).
    execute_find_tables( EXPORTING is_req     = ls_req
                         IMPORTING es_payload = ls_resp
                                   ev_error   = ls_err ).
    IF ls_err-code IS NOT INITIAL.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = COND i( WHEN ls_err-code = 'INVALID_ARGUMENT' THEN 400
                                         ELSE 500 )
                     iv_reason = COND string( WHEN ls_err-code = 'INVALID_ARGUMENT' THEN 'Bad Request'
                                              ELSE 'Internal Server Error' )
                     iv_code   = ls_err-code
                     iv_msg    = ls_err-message ).
      RETURN.
    ENDIF.

    zcl_abap_vibe_icf_response=>respond_json( io_server = io_server
                                             iv_status = 200
                                             iv_reason = 'OK'
                                             is_payload = ls_resp ).
  ENDMETHOD.

  METHOD parse_find_request.
    CLEAR es_req.
    ev_ok = abap_true.

    IF iv_body IS INITIAL.
      ev_ok = abap_false.
      ev_err_code = 'INVALID_ARGUMENT'.
      ev_err_msg = 'Request body is empty; expected { fields: [...] }'.
      RETURN.
    ENDIF.

    " Use the same JSON parser the query endpoint uses (/ui2/cl_json with
    " camel_case pretty mode). We unmarshal into a flat structure to keep
    " the type table local.
    DATA: BEGIN OF ls_raw,
            fields      TYPE string_table,
            requireall  TYPE abap_bool,
            tabclass    TYPE string,
            as4local    TYPE string,
            limit       TYPE i,
            includetext TYPE abap_bool,
          END OF ls_raw.

    /ui2/cl_json=>deserialize(
      EXPORTING json = iv_body
                pretty_name = /ui2/cl_json=>pretty_mode-camel_case
      CHANGING data  = ls_raw ).

    " requireall / requireAll — accept both casings (camelCase and lowercase).
    IF ls_raw-requireall = abap_true.
      es_req-requireall = abap_true.
    ELSE.
      es_req-requireall = abap_true.  " default
    ENDIF.

    es_req-tabclass = COND string( WHEN ls_raw-tabclass IS NOT INITIAL THEN ls_raw-tabclass ELSE '' ).
    es_req-as4local = COND string( WHEN ls_raw-as4local IS NOT INITIAL THEN ls_raw-as4local ELSE 'A' ).
    es_req-limit    = COND i( WHEN ls_raw-limit > 0 THEN ls_raw-limit ELSE 200 ).
    IF es_req-limit > 5000.
      es_req-limit = 5000.
    ENDIF.
    es_req-includetext = ls_raw-includetext. " default false

    " Normalize fields: uppercase, strip blanks.
    LOOP AT ls_raw-fields INTO DATA(lv_fname).
      DATA(lv_clean) = lv_fname.
      TRANSLATE lv_clean TO UPPER CASE.
      CONDENSE lv_clean NO-GAPS.
      IF lv_clean IS NOT INITIAL.
        APPEND lv_clean TO es_req-fields.
      ENDIF.
    ENDLOOP.

    IF es_req-fields IS INITIAL.
      ev_ok = abap_false.
      ev_err_code = 'INVALID_ARGUMENT'.
      ev_err_msg  = '`fields` must contain at least one field name'.
      RETURN.
    ENDIF.
    IF lines( es_req-fields ) > 20.
      ev_ok = abap_false.
      ev_err_code = 'INVALID_ARGUMENT'.
      ev_err_msg  = 'At most 20 fields per request (server-side cap)'.
      RETURN.
    ENDIF.
  ENDMETHOD.

  METHOD execute_find_tables.
    CLEAR es_payload.
    CLEAR ev_error.

    " Step 1: pull the matching DD03L rows. One openSQL pass on the WHERE
    " FIELDNAME IN (...) clause is dramatically cheaper than per-table
    " DD03L walks (verified against vhcala4hci A4H with ~100k DD03L rows).
    DATA: BEGIN OF ls_row,
            tabname  TYPE dd03l-tabname,
            fieldname TYPE dd03l-fieldname,
            position TYPE dd03l-position,
            rollname TYPE dd03l-rollname,
            as4local TYPE dd03l-as4local,
            tabclass TYPE dd02l-tabclass,
          END OF ls_row.
    DATA lt_rows LIKE TABLE OF ls_row.

    " Build the IN-list. To keep the wire simple, we use RANGE on a local
    " structure rather than dynamic SQL — the field-name set is bounded
    " by the caller (max 20 entries enforced above).
    DATA lt_field_range TYPE RANGE OF dd03l-fieldname.
    LOOP AT is_req-fields INTO DATA(lv_fname).
      APPEND VALUE #( sign = 'I' option = 'EQ' low = lv_fname ) TO lt_field_range.
    ENDLOOP.

    " Host variables in the WHERE clause must be DDIC-typed: `string`
    " components (LOB) are not allowed in Open SQL comparisons.
    DATA(lv_as4local) = CONV dd03l-as4local( is_req-as4local ).
    DATA(lv_tabclass) = CONV dd02l-tabclass( is_req-tabclass ).

    " Single SELECT joining DD03L + DD02L (TABCLASS) via FOR ALL ENTRIES.
    " DD02L is small (one row per table) so the cost stays predictable.
    SELECT d~tabname, d~fieldname, d~position, d~rollname, d~as4local, t~tabclass
      FROM dd03l AS d
      INNER JOIN dd02l AS t ON t~tabname = d~tabname
                             AND t~as4local = d~as4local
      WHERE d~fieldname IN @lt_field_range
        AND d~as4local  = @lv_as4local
        AND ( @lv_tabclass IS INITIAL OR t~tabclass = @lv_tabclass )
      INTO TABLE @lt_rows.

    IF sy-subrc <> 0 AND lt_rows IS INITIAL.
      " No matches.
      es_payload-status = 'success'.
      es_payload-data = VALUE #(
        total     = 0
        truncated = abap_false
        mode      = COND string( WHEN is_req-requireall = abap_true THEN 'all' ELSE 'any' )
      ).
      RETURN.
    ENDIF.

    " Step 1.5: when `includeText` is set, fetch DDIC short text
    " from DD03T (per (TABNAME, FIELDNAME, AS4LOCAL, DDLANGUAGE)) and
    " DD04T (per (ROLLNAME, DDLANGUAGE)). Session language is used as
    " the preferred DDLANGUAGE; an empty DDLANGUAGE row in DD03T/DD04T
    " acts as the fallback (some customers ship only an empty-language
    " row). One SELECT per text table is bounded by the unique rows in
    " `lt_rows`, so the cost stays O(matches) and is cheap.
    TYPES: BEGIN OF ty_text_entry,
             key   TYPE string,
             value TYPE string,
           END OF ty_text_entry.
    DATA lt_field_texts TYPE HASHED TABLE OF ty_text_entry WITH UNIQUE KEY key.
    DATA lt_elem_texts  TYPE HASHED TABLE OF ty_text_entry WITH UNIQUE KEY key.
    IF is_req-includetext = abap_true AND lt_rows IS NOT INITIAL.
      " DD03T — per-table field text. The unique key is (TABNAME, FIELDNAME,
      " AS4LOCAL, DDLANGUAGE). We pick the session language; if that misses
      " we leave the entry unset so the data-element text can take over.
      DATA: BEGIN OF ls_dt,
              tabname   TYPE dd03t-tabname,
              fieldname TYPE dd03t-fieldname,
              as4local  TYPE dd03t-as4local,
              ddlanguage TYPE dd03t-ddlanguage,
              ddtext    TYPE dd03t-ddtext,
            END OF ls_dt.
      DATA lt_dt LIKE TABLE OF ls_dt.
      SELECT tabname, fieldname, as4local, ddlanguage, ddtext
        FROM dd03t
        FOR ALL ENTRIES IN @lt_rows
        WHERE tabname    = @lt_rows-tabname
          AND fieldname  = @lt_rows-fieldname
          AND as4local   = @lt_rows-as4local
          AND ddlanguage = @sy-langu
        INTO TABLE @lt_dt.
      LOOP AT lt_dt INTO DATA(ls_dt2).
        DATA(lv_dt_key) = |{ ls_dt2-tabname WIDTH = 30 }~{ ls_dt2-fieldname WIDTH = 30 }|.
        INSERT VALUE #( key = lv_dt_key value = ls_dt2-ddtext ) INTO TABLE lt_field_texts.
        " If duplicate key (rare; FOR ALL ENTRIES on a hashed table), the
        " first wins — the data is the same regardless.
      ENDLOOP.

      " DD04T — per-data-element text. The unique key is (ROLLNAME,
      " DDLANGUAGE). Only data elements that actually appear in DD03L
      " are relevant, so we collect them first into a deduped list.
      DATA lt_rolls TYPE HASHED TABLE OF rollname WITH UNIQUE KEY table_line.
      LOOP AT lt_rows INTO DATA(ls_row_r).
        IF ls_row_r-rollname IS NOT INITIAL.
          INSERT ls_row_r-rollname INTO TABLE lt_rolls.
        ENDIF.
      ENDLOOP.
      DATA: BEGIN OF ls_et,
              rollname  TYPE dd04t-rollname,
              ddlanguage TYPE dd04t-ddlanguage,
              ddtext    TYPE dd04t-ddtext,
            END OF ls_et.
      DATA lt_et LIKE TABLE OF ls_et.
      SELECT rollname, ddlanguage, ddtext
        FROM dd04t
        FOR ALL ENTRIES IN @lt_rolls
        WHERE rollname   = @lt_rolls-table_line
          AND ddlanguage = @sy-langu
        INTO TABLE @lt_et.
      LOOP AT lt_et INTO DATA(ls_et2).
        INSERT VALUE #( key = ls_et2-rollname value = ls_et2-ddtext ) INTO TABLE lt_elem_texts.
      ENDLOOP.
    ENDIF.

    " Step 2: group by TABNAME and count hits per table.
    DATA lt_groups TYPE STANDARD TABLE OF ty_find_match_table WITH EMPTY KEY.
    DATA lt_per_table_hits TYPE HASHED TABLE OF i WITH UNIQUE KEY table_line.
    " Use a hash on the row's identity to dedupe (a table + field combo).
    DATA lt_seen TYPE HASHED TABLE OF string WITH UNIQUE KEY table_line.

    LOOP AT lt_rows INTO DATA(ls_row2).
      DATA(lv_key) = |{ ls_row2-tabname WIDTH = 30 }~{ ls_row2-fieldname WIDTH = 30 }|.
      IF line_exists( lt_seen[ table_line = lv_key ] ).
        CONTINUE.
      ENDIF.
      INSERT lv_key INTO TABLE lt_seen.

      " Resolve DDIC short text when includeText is requested.
      " fieldText wins over elementText when both exist: DD03T is the
      " per-table field override (e.g. short label "Changed By" might
      " differ from the data element's "User Name"), so a non-empty
      " fieldText suppresses the data-element fallback.
      DATA(lv_field_text) = VALUE string( ).
      DATA(lv_elem_text)  = VALUE string( ).
      IF is_req-includetext = abap_true.
        READ TABLE lt_field_texts INTO DATA(ls_ft) WITH KEY key = lv_key.
        IF sy-subrc = 0.
          lv_field_text = ls_ft-value.
        ENDIF.
        READ TABLE lt_elem_texts INTO DATA(ls_elem_text) WITH KEY key = ls_row2-rollname.
        IF sy-subrc = 0.
          lv_elem_text = ls_elem_text-value.
        ENDIF.
      ENDIF.

      DATA(lv_table_idx) = line_index( lt_groups[ table = ls_row2-tabname ] ).
      IF lv_table_idx > 0.
        DATA(lt_fields) = lt_groups[ lv_table_idx ]-fields.
        INSERT VALUE #( name        = ls_row2-fieldname
                        rollname    = ls_row2-rollname
                        position    = ls_row2-position
                        fieldtext   = lv_field_text
                        elementtext = lv_elem_text ) INTO lt_fields INDEX 1.
        MODIFY lt_groups INDEX lv_table_idx
          FROM VALUE #(
            table    = ls_row2-tabname
            tabclass = ls_row2-tabclass
            hitCount = lt_groups[ lv_table_idx ]-hitcount + 1
            fields   = lt_fields ).
      ELSE.
        APPEND VALUE #(
          table    = ls_row2-tabname
          tabclass = ls_row2-tabclass
          hitCount = 1
          fields   = VALUE #( ( name        = ls_row2-fieldname
                                rollname    = ls_row2-rollname
                                position    = ls_row2-position
                                fieldtext   = lv_field_text
                                elementtext = lv_elem_text ) )
        ) TO lt_groups.
      ENDIF.
    ENDLOOP.

    " Step 3: keep only tables whose hitCount matches the mode (ALL or ANY).
    DATA lt_filtered TYPE STANDARD TABLE OF ty_find_match_table WITH EMPTY KEY.
    DATA(lv_required) = lines( is_req-fields ).
    LOOP AT lt_groups INTO DATA(ls_g).
      IF is_req-requireall = abap_true AND ls_g-hitcount < lv_required.
        CONTINUE.
      ENDIF.
      APPEND ls_g TO lt_filtered.
    ENDLOOP.

    " Step 4: sort by hitCount DESC then table ASC; truncate to limit.
    SORT lt_filtered BY hitCount DESCENDING table ASCENDING.
    DATA(lv_truncated) = abap_false.
    IF lines( lt_filtered ) > is_req-limit.
      DATA(lv_drop_from) = is_req-limit + 1.
      DELETE lt_filtered FROM lv_drop_from.
      lv_truncated = abap_true.
    ENDIF.

    es_payload-status = 'success'.
    es_payload-data = VALUE #(
      total     = lines( lt_filtered )
      truncated = lv_truncated
      mode      = COND string( WHEN is_req-requireall = abap_true THEN 'all' ELSE 'any' )
      matches   = lt_filtered ).
  ENDMETHOD.

ENDCLASS.
