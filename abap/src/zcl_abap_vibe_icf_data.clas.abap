CLASS zcl_abap_vibe_icf_data DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.

    " Constants for the query engine.
    CONSTANTS:
      gc_query_limit_max  TYPE i VALUE 10000,
      gc_query_offset_max TYPE i VALUE 100000,
      gc_query_limit_def  TYPE i VALUE 100.

    " Large-object datatype set — STRG/RSTR/LCHR/LRAW are excluded from output when
    " --fields is not specified, and rejected explicitly when it is.
    CONSTANTS:
      gc_large_object_types TYPE string VALUE 'STRG|RSTR|LCHR|LRAW'.

    CLASS-METHODS dispatch_data
      IMPORTING io_server TYPE REF TO if_http_server
                iv_path   TYPE string
                iv_method TYPE string
                iv_body   TYPE string.
  PRIVATE SECTION.

    CLASS-METHODS parse_data_query
      IMPORTING iv_body       TYPE string
      EXPORTING VALUE(es_req) TYPE zcl_abap_vibe_icf_types=>ty_query_request
                VALUE(ev_ok)  TYPE abap_bool
                VALUE(ev_err_code) TYPE string
                VALUE(ev_err_msg)  TYPE string
                VALUE(ev_err_details) TYPE string.

    CLASS-METHODS read_table_metadata
      IMPORTING iv_name       TYPE clike
      EXPORTING VALUE(es_meta) TYPE zcl_abap_vibe_icf_types=>ty_query_metadata
                VALUE(ev_ok)   TYPE abap_bool
                VALUE(ev_err_code) TYPE string
                VALUE(ev_err_msg)  TYPE string
                VALUE(ev_err_details) TYPE string
                VALUE(ev_err_http)  TYPE i.

    CLASS-METHODS parse_where_clause
      IMPORTING iv_where      TYPE string
                it_fields     TYPE zcl_abap_vibe_icf_types=>tt_query_field
      EXPORTING VALUE(et_conditions) TYPE zcl_abap_vibe_icf_types=>tt_where_condition
                VALUE(ev_ok)   TYPE abap_bool
                VALUE(ev_err_code) TYPE string
                VALUE(ev_err_msg)  TYPE string
                VALUE(ev_err_offset) TYPE i.
    CLASS-METHODS execute_select
      IMPORTING is_meta      TYPE zcl_abap_vibe_icf_types=>ty_query_metadata
                iv_fields_csv TYPE string
                it_where      TYPE zcl_abap_vibe_icf_types=>tt_where_condition
                it_orderby    TYPE zcl_abap_vibe_icf_types=>tt_query_orderby
                iv_limit      TYPE i
                iv_offset     TYPE i
      EXPORTING es_payload   TYPE zcl_abap_vibe_icf_types=>ty_select_result
                ev_error     TYPE zcl_abap_vibe_icf_types=>ty_error.

    CLASS-METHODS execute_count
      IMPORTING is_meta      TYPE zcl_abap_vibe_icf_types=>ty_query_metadata
                it_where      TYPE zcl_abap_vibe_icf_types=>tt_where_condition
      EXPORTING es_payload   TYPE zcl_abap_vibe_icf_types=>ty_select_count
                ev_error     TYPE zcl_abap_vibe_icf_types=>ty_error.

    " F-12: SELECT <field>, COUNT(*) ... GROUP BY <field> ORDER BY COUNT(*) DESC.
    CLASS-METHODS execute_group_by
      IMPORTING is_meta      TYPE zcl_abap_vibe_icf_types=>ty_query_metadata
                iv_group_by  TYPE string
                it_where     TYPE zcl_abap_vibe_icf_types=>tt_where_condition
                iv_limit     TYPE i
      EXPORTING es_payload   TYPE zcl_abap_vibe_icf_types=>ty_select_group
                ev_error     TYPE zcl_abap_vibe_icf_types=>ty_error.
ENDCLASS.

CLASS zcl_abap_vibe_icf_data IMPLEMENTATION.
  METHOD dispatch_data.
    " Route /data/<sub> → sub-handlers. Two endpoints today:
    "   /data/query                   — F-10/F-26 SE16N-style field query
    "   /data/find-tables-by-fields   — S-2 reverse field lookup
    IF iv_path = '/data/find-tables-by-fields'.
      " Delegate to zcl_abap_vibe_icf_fields. Keeping the dispatch here (not in the main
      " handler) means the `/data/*` try/catch in zcl_abap_vibe_icf wraps
      " both routes consistently and reports QUERY_FAILED on a runtime
      " error — the existing /data/* family contract.
      zcl_abap_vibe_icf_fields=>dispatch_find_tables( io_server = io_server
                                        iv_path   = iv_path
                                        iv_method = iv_method
                                        iv_body   = iv_body ).
      RETURN.
    ENDIF.
    IF iv_path <> '/data/query'.
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
                     iv_msg    = 'POST only on /data/query' ).
      RETURN.
    ENDIF.

    " 1. Parse the wire payload.
    DATA(ls_req) = VALUE zcl_abap_vibe_icf_types=>ty_query_request( ).
    DATA(lv_ok) = abap_false.
    DATA(lv_err_code) = VALUE string( ).
    DATA(lv_err_msg) = VALUE string( ).
    DATA(lv_err_details) = VALUE string( ).
    parse_data_query( EXPORTING iv_body = iv_body
                      IMPORTING es_req = ls_req
                                ev_ok = lv_ok
                                ev_err_code = lv_err_code
                                ev_err_msg = lv_err_msg
                                ev_err_details = lv_err_details ).
    IF lv_ok = abap_false.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = lv_err_code
                     iv_msg    = lv_err_msg ).
      RETURN.
    ENDIF.

    " 2. Validate table + read metadata.
    DATA(ls_meta) = VALUE zcl_abap_vibe_icf_types=>ty_query_metadata( ).
    read_table_metadata( EXPORTING iv_name = ls_req-table
                         IMPORTING es_meta = ls_meta
                                   ev_ok = lv_ok
                                   ev_err_code = lv_err_code
                                   ev_err_msg = lv_err_msg
                                   ev_err_details = lv_err_details
                                   ev_err_http = DATA(lv_http) ).
    IF lv_ok = abap_false.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = lv_http
                     iv_reason = COND string( WHEN lv_http = 404 THEN 'Not Found' ELSE 'Bad Request' )
                     iv_code   = lv_err_code
                     iv_msg    = lv_err_msg ).
      RETURN.
    ENDIF.

    " 3. Validate fields projection.
    DATA(lt_requested_fields) = VALUE string_table( ).
    DATA(lt_excluded) = VALUE string_table( ).
    IF ls_req-fields IS NOT INITIAL.
      LOOP AT ls_req-fields INTO DATA(lv_fname).
        DATA(lv_match) = abap_false.
        LOOP AT ls_meta-fields INTO DATA(ls_field) WHERE name = lv_fname.
          lv_match = abap_true.
          IF ls_field-dataType CP gc_large_object_types.
            " Explicit projection of a large-object field is rejected.
            zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                           iv_status = 400
                           iv_reason = 'Bad Request'
                           iv_code   = 'INVALID_FIELD'
                           iv_msg    = |field { lv_fname } is a large-object field ({ ls_field-dataType }) and is not supported for projection in v1| ).
            RETURN.
          ENDIF.
        ENDLOOP.
        IF lv_match = abap_false.
          DATA(lv_valid_fields) = VALUE string( ).
          LOOP AT ls_meta-fields INTO DATA(ls_vf).
            IF sy-tabix > 1. lv_valid_fields = lv_valid_fields && ','. ENDIF.
            lv_valid_fields = lv_valid_fields && ls_vf-name.
          ENDLOOP.
          zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                         iv_status = 400
                         iv_reason = 'Bad Request'
                         iv_code   = 'INVALID_FIELD'
                         iv_msg    = |field { lv_fname } is not in table { ls_meta-name }| ).
          RETURN.
        ENDIF.
        APPEND lv_fname TO lt_requested_fields.
      ENDLOOP.
    ELSE.
      " Default projection = all fields minus large-object types.
      LOOP AT ls_meta-fields INTO DATA(ls_df).
        IF ls_df-dataType CP gc_large_object_types.
          APPEND ls_df-name TO lt_excluded.
        ELSE.
          APPEND ls_df-name TO lt_requested_fields.
        ENDIF.
      ENDLOOP.
    ENDIF.

    " 4. Build a CSV of output fields for the dynamic SELECT.
    DATA(lv_fields_csv) = VALUE string( ).
    LOOP AT lt_requested_fields INTO DATA(lv_out).
      IF sy-tabix > 1. lv_fields_csv = lv_fields_csv && ','. ENDIF.
      lv_fields_csv = lv_fields_csv && lv_out.
    ENDLOOP.

    " 5. Server-side limit / offset re-validation.
    IF ls_req-limit < 1 OR ls_req-limit > gc_query_limit_max.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = 'LIMIT_EXCEEDED'
                     iv_msg    = |limit must be an integer in [1, { gc_query_limit_max }] (got { ls_req-limit })| ).
      RETURN.
    ENDIF.
    IF ls_req-offset < 0 OR ls_req-offset > gc_query_offset_max.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 400
                     iv_reason = 'Bad Request'
                     iv_code   = 'OFFSET_EXCEEDED'
                     iv_msg    = |offset must be an integer in [0, { gc_query_offset_max }] (got { ls_req-offset })| ).
      RETURN.
    ENDIF.

    " 6. Validate order-by (direction + field).
    " Parse directly from the raw body JSON — /ui2/cl_json's string representation
    " of the orderby array elements is ambiguous across versions.
    DATA(lt_orderby) = VALUE zcl_abap_vibe_icf_types=>tt_query_orderby( ).
    FIND REGEX '"orderBy"\s*:\s*\[' IN iv_body.
    IF sy-subrc = 0.
      DATA(lv_ob_rest) = substring( val = iv_body off = sy-fdpos + 1 ).
      DO 20 TIMES.
        FIND REGEX '"field"\s*:\s*"([A-Za-z_][A-Za-z0-9_]*)"' IN lv_ob_rest SUBMATCHES DATA(lv_ob_field).
        IF sy-subrc <> 0. EXIT. ENDIF.
        FIND REGEX '"direction"\s*:\s*"(ASC|DESC)"' IN lv_ob_rest SUBMATCHES DATA(lv_ob_dir).
        IF sy-subrc <> 0. lv_ob_dir = 'ASC'. ENDIF.
        READ TABLE ls_meta-fields TRANSPORTING NO FIELDS WITH KEY name = lv_ob_field.
        IF sy-subrc <> 0.
          zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                         iv_status = 400
                         iv_reason = 'Bad Request'
                         iv_code   = 'INVALID_FIELD'
                         iv_msg    = |orderBy field { lv_ob_field } is not in table { ls_meta-name }| ).
          RETURN.
        ENDIF.
        APPEND VALUE zcl_abap_vibe_icf_types=>ty_query_orderby( field = lv_ob_field direction = lv_ob_dir ) TO lt_orderby.
        DATA(lv_ob_fp) = find( val = lv_ob_rest sub = '"field"' ).
        IF lv_ob_fp < 0. EXIT. ENDIF.
        lv_ob_rest = substring( val = lv_ob_rest off = lv_ob_fp + 1 ).
      ENDDO.
    ENDIF.

    " Default ORDER BY when none was supplied — SAP requires ORDER BY when OFFSET is used.
    " Note: zcl_abap_vibe_icf_types=>ty_query_field has no keyFlag attribute, so we cannot pick a default
    " key column. Instead, fall back to MANDT (always present in client-dependent
    " tables) — pagination with offset on no-order-by is therefore non-deterministic
    " for non-client tables; the caller should pass --order-by for reliable paging.
    IF lt_orderby IS INITIAL AND ls_req-offset > 0.
      LOOP AT ls_meta-fields INTO DATA(ls_dflt_f) WHERE name = 'MANDT'.
        APPEND VALUE zcl_abap_vibe_icf_types=>ty_query_orderby( field = 'MANDT' direction = 'ASCENDING' ) TO lt_orderby.
        EXIT.
      ENDLOOP.
    ENDIF.

    " 7. Parse where clause (US3 grammar: field op value [AND ...]).
    DATA(lt_where) = VALUE zcl_abap_vibe_icf_types=>tt_where_condition( ).
    IF ls_req-where IS NOT INITIAL.
      DATA(lv_where_ok) = abap_false.
      DATA(lv_where_err_code) = VALUE string( ).
      DATA(lv_where_err_msg) = VALUE string( ).
      DATA(lv_where_err_offset) = VALUE i( ).
      parse_where_clause( EXPORTING iv_where = ls_req-where
                                   it_fields = ls_meta-fields
                         IMPORTING et_conditions = lt_where
                                   ev_ok = lv_where_ok
                                   ev_err_code = lv_where_err_code
                                   ev_err_msg = lv_where_err_msg
                                   ev_err_offset = lv_where_err_offset ).
      IF lv_where_ok = abap_false.
        zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                       iv_status = 400
                       iv_reason = 'Bad Request'
                       iv_code   = lv_where_err_code
                       iv_msg    = |{ lv_where_err_msg } (offset { lv_where_err_offset })| ).
        RETURN.
      ENDIF.
    ENDIF.

    " 7b. Group-by aggregation path (F-12). Strictly additive: it is only taken
    " when the request carries a groupBy field, so the plain select / count paths
    " below are untouched.
    IF ls_req-groupby IS NOT INITIAL.
      DATA ls_grp     TYPE zcl_abap_vibe_icf_types=>ty_select_group.
      DATA ls_grp_err TYPE zcl_abap_vibe_icf_types=>ty_error.
      execute_group_by( EXPORTING is_meta     = ls_meta
                                  iv_group_by = ls_req-groupby
                                  it_where    = lt_where
                                  iv_limit    = ls_req-limit
                        IMPORTING es_payload  = ls_grp
                                  ev_error    = ls_grp_err ).
      IF ls_grp_err IS NOT INITIAL.
        zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                       iv_status = 200
                       iv_reason = 'OK'
                       iv_code   = ls_grp_err-error-code
                       iv_msg    = ls_grp_err-error-message ).
      ELSE.
        zcl_abap_vibe_icf_response=>respond_json( io_server = io_server iv_status = 200 iv_reason = 'OK' is_payload = ls_grp ).
      ENDIF.
      RETURN.
    ENDIF.

    " 8. Count-only path.
    IF ls_req-countonly = abap_true.
      DATA ls_count     TYPE zcl_abap_vibe_icf_types=>ty_select_count.
      DATA ls_count_err TYPE zcl_abap_vibe_icf_types=>ty_error.
      execute_count( EXPORTING is_meta = ls_meta
                               it_where = lt_where
                     IMPORTING es_payload = ls_count
                               ev_error   = ls_count_err ).
      IF ls_count_err IS NOT INITIAL.
        " execute_count failures are single-message (cx_root text, not a BAPI
        " table); no details to surface, so iv_details is omitted on purpose.
        zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                       iv_status = 200
                       iv_reason = 'OK'
                       iv_code   = ls_count_err-error-code
                       iv_msg    = ls_count_err-error-message ).
      ELSE.
        zcl_abap_vibe_icf_response=>respond_json( io_server = io_server iv_status = 200 iv_reason = 'OK' is_payload = ls_count ).
      ENDIF.
      RETURN.
    ENDIF.

    " 9. Run the data query.
    DATA ls_sel     TYPE zcl_abap_vibe_icf_types=>ty_select_result.
    DATA ls_sel_err TYPE zcl_abap_vibe_icf_types=>ty_error.
    TRY.
        execute_select( EXPORTING is_meta = ls_meta
                                  iv_fields_csv = lv_fields_csv
                                  it_where = lt_where
                                  it_orderby = lt_orderby
                                  iv_limit = ls_req-limit
                                  iv_offset = ls_req-offset
                        IMPORTING es_payload = ls_sel
                                  ev_error   = ls_sel_err ).
      CATCH cx_root INTO DATA(lx_dispatch_err).
        zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                       iv_status = 500
                       iv_reason = 'Internal Server Error'
                       iv_code = 'QUERY_FAILED'
                       iv_msg  = |execute_select runtime error: { lx_dispatch_err->get_text( ) }| ).
        RETURN.
    ENDTRY.
    IF ls_sel_err IS NOT INITIAL.
      " execute_select failures are single-message (cx_root text, not a BAPI
      " table); no details to surface, so iv_details is omitted on purpose.
      zcl_abap_vibe_icf_response=>respond_error( io_server = io_server
                     iv_status = 200
                     iv_reason = 'OK'
                     iv_code   = ls_sel_err-error-code
                     iv_msg    = ls_sel_err-error-message ).
    ELSE.
      zcl_abap_vibe_icf_response=>respond_json( io_server = io_server iv_status = 200 iv_reason = 'OK' is_payload = ls_sel ).
    ENDIF.
  ENDMETHOD.
  METHOD parse_data_query.
    " Deserialize the wire payload (camelCase). Generate default values for
    " missing fields so the consumer always sees a valid request.
    CLEAR: es_req, ev_ok, ev_err_code, ev_err_msg, ev_err_details.
    ev_ok = abap_false.
    DATA(lv_part) = iv_body.
    IF lv_part IS INITIAL.
      ev_ok = abap_true.
      es_req-limit = gc_query_limit_def.
      es_req-offset = 0.
      RETURN.
    ENDIF.
    " Use /ui2/cl_json to deserialize the entire payload into a JSON-friendly shape.
    " We then copy into the typed struct with defaults.
    DATA: BEGIN OF ls_raw,
            table    TYPE string,
            fields   TYPE string_table,
            where    TYPE string,
            limit    TYPE i,
            offset   TYPE i,
            orderby  TYPE string_table,
            countonly TYPE abap_bool,
            groupby  TYPE string,
          END OF ls_raw.
    TRY.
        /ui2/cl_json=>deserialize( EXPORTING json = lv_part
                                   CHANGING data = ls_raw ).
      CATCH cx_root INTO DATA(lx_parse).
        ev_err_code = 'INVALID_ARGUMENT'.
        ev_err_msg  = |invalid JSON payload: { lx_parse->get_text( ) }|.
        RETURN.
    ENDTRY.
    IF ls_raw-table IS INITIAL.
      ev_err_code = 'INVALID_ARGUMENT'.
      ev_err_msg  = 'table is required'.
      RETURN.
    ENDIF.
    es_req-table    = to_upper( ls_raw-table ).
    es_req-fields   = ls_raw-fields.
    es_req-where    = ls_raw-where.
    es_req-limit    = COND i( WHEN ls_raw-limit IS INITIAL THEN gc_query_limit_def ELSE ls_raw-limit ).
    es_req-offset   = COND i( WHEN ls_raw-offset IS INITIAL THEN 0 ELSE ls_raw-offset ).
    es_req-orderby  = ls_raw-orderby.
    es_req-countonly = ls_raw-countonly.
    es_req-groupby   = to_upper( condense( val = ls_raw-groupby del = ` ` ) ).
    ev_ok = abap_true.
  ENDMETHOD.
  METHOD read_table_metadata.
    " Read DD02L (table header) + DD03L (field list) for the requested table.
    CLEAR: es_meta, ev_ok, ev_err_code, ev_err_msg, ev_err_details, ev_err_http.
    ev_ok = abap_false.
    DATA(lv_name) = to_upper( condense( val = iv_name del = ` ` ) ).
    IF strlen( lv_name ) = 0.
      ev_err_code = 'INVALID_ARGUMENT'.
      ev_err_msg  = 'table is required'.
      ev_err_http = 400.
      RETURN.
    ENDIF.

    " DD02L — table header.
    DATA(ls_dd02l) = VALUE dd02l( ).
    SELECT SINGLE tabname, tabclass FROM dd02l
      INTO CORRESPONDING FIELDS OF @ls_dd02l
      WHERE tabname = @lv_name AND as4local = 'A'.
    IF sy-subrc <> 0 OR ls_dd02l-tabname IS INITIAL.
      ev_err_code = 'TABLE_NOT_FOUND'.
      ev_err_msg  = |table { lv_name } does not exist|.
      ev_err_http = 404.
      RETURN.
    ENDIF.

    " Only TRANSP (transparent table) and VIEW (DDIC view) are queryable.
    IF ls_dd02l-tabclass <> 'TRANSP' AND ls_dd02l-tabclass <> 'VIEW'.
      ev_err_code = 'TABLE_TYPE_NOT_SUPPORTED'.
      ev_err_msg  = |table { lv_name } is of type { ls_dd02l-tabclass }; only TRANSP and VIEW are queryable|.
      ev_err_details = |\{ "objectType": "{ ls_dd02l-tabclass }" \}|.
      ev_err_http = 400.
      RETURN.
    ENDIF.

    " DD03L — field list (ordered via POSITION).
    " Note: INTO CORRESPONDING FIELDS OF is required — a positional INTO TABLE
    " would map fieldname→TABNAME, datatype→FIELDNAME, ... (vhcala4hci quirk).
    DATA lt_dd03l TYPE TABLE OF dd03l.
    SELECT fieldname, datatype, leng, decimals FROM dd03l
      INTO CORRESPONDING FIELDS OF TABLE @lt_dd03l
      WHERE tabname = @lv_name AND as4local = 'A'
      ORDER BY position.
    IF sy-subrc <> 0.
      " Empty field list — should not happen for TRANSP/VIEW, but handle gracefully.
    ENDIF.

    es_meta-name = ls_dd02l-tabname.
    es_meta-tabclass = ls_dd02l-tabclass.
    es_meta-clientDependent = abap_false.
    LOOP AT lt_dd03l INTO DATA(ls_dd03l).
      APPEND VALUE #( name = ls_dd03l-fieldname
                       dataType = ls_dd03l-datatype
                       length = ls_dd03l-leng
                       decimals = ls_dd03l-decimals ) TO es_meta-fields.
      IF ls_dd03l-fieldname = 'MANDT'.
        es_meta-clientDependent = abap_true.
      ENDIF.
    ENDLOOP.
    ev_ok = abap_true.
  ENDMETHOD.
  METHOD parse_where_clause.
    " AND-only where grammar per research R8.
    "   where := condition { "AND" condition }
    "   condition := field op value
    "   op := "=" | "<>" | ">" | ">=" | "<" | "<=" | "LIKE"
    "   field := [A-Za-z_][A-Za-z0-9_]*
    "   value := "'" <chars, '' escape> "'" | [+-]?[0-9]+(\.[0-9]+)?
    CLEAR: et_conditions, ev_ok, ev_err_code, ev_err_msg, ev_err_offset.
    ev_ok = abap_false.
    IF iv_where IS INITIAL.
      ev_ok = abap_true.
      RETURN.
    ENDIF.

    " Tokenize by top-level AND (whitespace tolerant, case-insensitive).
    DATA(lv_rest) = iv_where.
    DATA(lv_pos) = 0.
    DATA(lv_bind_idx) = 0.

    " Build a quick lookup of valid field names for faster checks.
    DATA(lt_field_names) = VALUE string_table( ).
    LOOP AT it_fields INTO DATA(ls_fld).
      APPEND ls_fld-name TO lt_field_names.
    ENDLOOP.

    WHILE lv_rest IS NOT INITIAL.
      lv_pos = strlen( iv_where ) - strlen( lv_rest ).
      DATA(lv_and_ix) = find( val = lv_rest sub = 'AND' case = abap_false ).
      IF lv_and_ix > 0.
        " Check that AND is a standalone keyword (whitespace around it).
        DATA(lv_char_before) = COND string( WHEN lv_and_ix = 0 THEN ' '
          ELSE substring( val = lv_rest off = lv_and_ix - 1 len = 1 ) ).
        DATA(lv_char_after)  = COND string( WHEN lv_and_ix + 3 = strlen( lv_rest ) THEN ' '
          ELSE substring( val = lv_rest off = lv_and_ix + 3 len = 1 ) ).
        IF lv_char_before CA ' ' AND lv_char_after CA ' '.
          " OK — proper AND separator.
        ELSE.
          " Probably an 'AND' inside a value or field name; treat as not-an-AND.
          lv_and_ix = -1.
        ENDIF.
      ENDIF.

      DATA(lv_chunk) = VALUE string( ).
      IF lv_and_ix < 0.
        lv_chunk = condense( lv_rest ).
        lv_rest = ''.
      ELSE.
        lv_chunk = condense( substring( val = lv_rest off = 0 len = lv_and_ix ) ).
        lv_rest = substring( val = lv_rest off = lv_and_ix + 3 ).
      ENDIF.

      IF lv_chunk IS INITIAL.
        ev_err_code = 'INVALID_WHERE'.
        ev_err_msg  = 'empty condition'.
        ev_err_offset = lv_pos.
        RETURN.
      ENDIF.

      " Parse one condition: field op value.
      DATA(lv_op_ix) = -1.
      DATA(lv_op_len) = 0.
      DATA(lv_op) = VALUE string( ).
      " LIKE is a KEYWORD operator, not a symbol. Scan for it as a standalone,
      " whitespace-delimited word. The symbol scan below can never match it —
      " which is why the error text advertised LIKE while every LIKE condition
      " was rejected with "missing or invalid operator" (feedback F-11).
      " Finding it first also lets an earlier symbol operator win, e.g.
      " "F = 'LIKE'" keeps '='.
      DATA(lv_like_ix) = find( val = lv_chunk sub = 'LIKE' case = abap_false ).
      IF lv_like_ix >= 0.
        DATA(lv_like_before) = COND string( WHEN lv_like_ix = 0 THEN ' '
          ELSE substring( val = lv_chunk off = lv_like_ix - 1 len = 1 ) ).
        DATA(lv_like_after) = COND string( WHEN lv_like_ix + 4 = strlen( lv_chunk ) THEN ' '
          ELSE substring( val = lv_chunk off = lv_like_ix + 4 len = 1 ) ).
        IF lv_like_before CA ' ' AND lv_like_after CA ' '.
          lv_op_ix = lv_like_ix.
          lv_op_len = 4.
          lv_op = 'LIKE'.
        ENDIF.
      ENDIF.

      " Find the first operator in the chunk (longest-match order, manual loop
      " because inline struct construction is rejected by the SAP parser).
      DATA(lt_ops_op) = VALUE string_table( ).
      APPEND '>=' TO lt_ops_op.
      APPEND '<=' TO lt_ops_op.
      APPEND '<>' TO lt_ops_op.
      APPEND '>'  TO lt_ops_op.
      APPEND '<'  TO lt_ops_op.
      APPEND '='  TO lt_ops_op.
      " Populate lt_ops_len via INSERT INTO rather than VALUE (the parser
      " mis-tokenizes "VALUE STANDARD TABLE OF i( )" in nested contexts).
      DATA lt_ops_len TYPE STANDARD TABLE OF i.
      DO 6 TIMES.
        CASE sy-index.
          WHEN 1. APPEND 2 TO lt_ops_len.
          WHEN 2. APPEND 2 TO lt_ops_len.
          WHEN 3. APPEND 2 TO lt_ops_len.
          WHEN 4. APPEND 1 TO lt_ops_len.
          WHEN 5. APPEND 1 TO lt_ops_len.
          WHEN 6. APPEND 1 TO lt_ops_len.
        ENDCASE.
      ENDDO.
      DO 6 TIMES.
        DATA(lv_k) = sy-index.
        DATA lv_op_candidate TYPE string.
        lv_op_candidate = ''.
        READ TABLE lt_ops_op INTO lv_op_candidate INDEX lv_k.
        DATA(lv_len_candidate) = 0.
        READ TABLE lt_ops_len INTO lv_len_candidate INDEX lv_k.
        DATA(lv_ix) = find( val = lv_chunk sub = lv_op_candidate case = abap_false ).
        IF lv_ix >= 0 AND ( lv_op_ix < 0 OR lv_ix < lv_op_ix ).
          lv_op_ix = lv_ix.
          lv_op_len = lv_len_candidate.
          lv_op = lv_op_candidate.
        ENDIF.
      ENDDO.
      IF lv_op_ix <= 0.
        ev_err_code = 'INVALID_WHERE'.
        ev_err_msg  = |condition '{ lv_chunk }' missing or invalid operator (use =, <>, >, >=, <, <=, LIKE)|.
        ev_err_offset = lv_pos.
        RETURN.
      ENDIF.

      DATA(lv_field) = condense( lv_chunk+0(lv_op_ix) ).
      DATA(lv_value) = condense( substring( val = lv_chunk off = lv_op_ix + lv_op_len ) ).

      " Field validation: regex + uppercase + lookup.
      IF lv_field NA `ABCDEFGHIJKLMNOPQRSTUVWXYZ_` AND lv_field NA `abcdefghijklmnopqrstuvwxyz_`.
        ev_err_code = 'INVALID_WHERE'.
        ev_err_msg  = |field '{ lv_field }' is invalid|.
        ev_err_offset = lv_pos.
        RETURN.
      ENDIF.
      lv_field = to_upper( lv_field ).
      IF lv_field = 'MANDT'.
        ev_err_code = 'INVALID_WHERE'.
        ev_err_msg  = 'MANDT filter rejected (implicit session client only)'.
        ev_err_offset = lv_pos.
        RETURN.
      ENDIF.
      READ TABLE lt_field_names TRANSPORTING NO FIELDS WITH KEY table_line = lv_field.
      IF sy-subrc <> 0.
        ev_err_code = 'INVALID_WHERE'.
        ev_err_msg  = |field '{ lv_field }' is not in table|.
        ev_err_offset = lv_pos.
        RETURN.
      ENDIF.

      " Read field type for type adaptation.
      DATA(ls_field_meta) = VALUE zcl_abap_vibe_icf_types=>ty_query_field( ).
      READ TABLE it_fields INTO ls_field_meta WITH KEY name = lv_field.
      IF sy-subrc <> 0.
        ev_err_code = 'INVALID_WHERE'.
        ev_err_msg  = |field '{ lv_field }' lookup failed|.
        ev_err_offset = lv_pos.
        RETURN.
      ENDIF.

      " Value extraction.
      DATA(lv_value_kind) = VALUE string( ).
      DATA(lv_value_str) = VALUE string( ).
      IF strlen( lv_value ) > 0 AND substring( val = lv_value off = 0 len = 1 ) = `'`.
        " String literal — find the matching closing ' (allowing '' escape),
        " then reject any residual tokens after the closing quote (e.g.
        " "OR ..." after a value).
        DATA(lv_len) = strlen( lv_value ).
        DATA(lv_str_ix) = 1.
        WHILE lv_str_ix < lv_len.
          IF substring( val = lv_value off = lv_str_ix len = 1 ) = `'`.
            IF lv_str_ix + 1 < lv_len AND substring( val = lv_value off = lv_str_ix + 1 len = 1 ) = `'`.
              lv_str_ix = lv_str_ix + 2.
              CONTINUE.
            ENDIF.
            EXIT.  " closing quote found
          ENDIF.
          lv_str_ix = lv_str_ix + 1.
        ENDWHILE.
        IF lv_str_ix >= lv_len OR substring( val = lv_value off = lv_str_ix len = 1 ) <> `'`.
          ev_err_code = 'INVALID_WHERE'.
          ev_err_msg  = |unterminated string literal in condition '{ lv_chunk }'|.
          ev_err_offset = lv_pos.
          RETURN.
        ENDIF.
        " Check for residual tokens after the closing quote.
        DATA(lv_residual) = substring( val = lv_value off = lv_str_ix + 1 ).
        " Use NOT IS INITIAL with a length check (parser flagged IS NOT INITIAL
        " as "Unexpected operator IS" when the operand includes substring()).
        IF strlen( condense( lv_residual ) ) > 0.
          ev_err_code = 'INVALID_WHERE'.
          ev_err_msg  = |unexpected tokens after value in condition '{ lv_chunk }' (use AND to chain conditions)|.
          ev_err_offset = lv_pos.
          RETURN.
        ENDIF.
        lv_value_str = substring( val = lv_value off = 1 len = lv_str_ix - 1 ).
        " Replace '' with ' (SQL escape).
        REPLACE ALL OCCURRENCES OF `''` IN lv_value_str WITH `'`.
        lv_value_kind = 'string'.
      ELSEIF lv_value CO '0123456789.-+'.
        IF lv_value IS INITIAL OR lv_value = '-' OR lv_value = '+'.
          ev_err_code = 'INVALID_WHERE'.
          ev_err_msg  = |invalid numeric literal '{ lv_value }' in condition '{ lv_chunk }'|.
          ev_err_offset = lv_pos.
          RETURN.
        ENDIF.
        lv_value_str = lv_value.
        lv_value_kind = 'number'.
      ELSEIF lv_value IS NOT INITIAL.
        " Bare token — treat as string literal without quotes.
        lv_value_str = lv_value.
        lv_value_kind = 'string'.
      ELSE.
        ev_err_code = 'INVALID_WHERE'.
        ev_err_msg  = |missing value in condition '{ lv_chunk }'|.
        ev_err_offset = lv_pos.
        RETURN.
      ENDIF.

      " Type adaptation.
      IF lv_op = 'LIKE'.
        " LIKE allowed only on CHAR / NUMC / DATS / TIMS fields.
        IF NOT ( ls_field_meta-dataType = 'CHAR' OR ls_field_meta-dataType = 'NUMC'
              OR ls_field_meta-dataType = 'DATS' OR ls_field_meta-dataType = 'TIMS' ).
          ev_err_code = 'INVALID_WHERE'.
          ev_err_msg  = |LIKE not supported on field { lv_field } (type { ls_field_meta-dataType })|.
          ev_err_offset = lv_pos.
          RETURN.
        ENDIF.
      ENDIF.
      IF lv_value_kind = 'number'.
        " Numeric values only on numeric fields.
        IF NOT ( ls_field_meta-dataType = 'INT1' OR ls_field_meta-dataType = 'INT2'
              OR ls_field_meta-dataType = 'INT4' OR ls_field_meta-dataType = 'INT8'
              OR ls_field_meta-dataType = 'DEC' OR ls_field_meta-dataType = 'QUAN'
              OR ls_field_meta-dataType = 'CURR' OR ls_field_meta-dataType = 'FLTP' ).
          ev_err_code = 'INVALID_WHERE'.
          ev_err_msg  = |numeric value '{ lv_value_str }' not allowed on field { lv_field } (type { ls_field_meta-dataType })|.
          ev_err_offset = lv_pos.
          RETURN.
        ENDIF.
      ENDIF.

      lv_bind_idx = lv_bind_idx + 1.
      APPEND VALUE #( field = lv_field
                       operator = lv_op
                       value = lv_value_str
                       valueKind = lv_value_kind
                       bindVar = |LV_WHERE_V{ lv_bind_idx }| ) TO et_conditions.
    ENDWHILE.

    ev_ok = abap_true.
  ENDMETHOD.
  METHOD execute_select.
    " Dynamic Open SQL with host-variable binding (research R1).
    " Build the dynamic row type from DD03L metadata, then SELECT with a
    " generated WHERE clause whose values are bound as host variables.
    " Take limit+1 to detect truncation.
    " Note: lt_rows is created via CREATE DATA lr_rows TYPE HANDLE lo_table_type
    " (see below) and assigned to <lt_rows>; no standalone DATA declaration.
    " The whole body is wrapped in TRY so any runtime error (RTTI, dynamic SQL,
    " conversion) is surfaced as a structured QUERY_FAILED instead of a 500.
    TRY.
    DATA(lv_meta) = is_meta.

    " Build dynamic row type from the FULL field list (lv_meta-fields).
    " We SELECT * into this full row type and filter columns at serialization
    " time by iv_fields_csv — this keeps ORDER BY valid for any field and avoids
    " the projection-vs-ORDER-BY conflict on this SAP version.
    " IMPORTANT: do NOT use cl_abap_elemdescr=>describe_by_name( 'NUMC' | 'CLNT' ... )
    " — on vhcala4hci this raises a non-catchable short dump for built-in types.
    " Use the explicit type-factory methods instead (get_c/get_n/get_d/get_p).
    " Preferred: use the table's OWN DDIC row type. A hand-rolled component map
    " cannot reproduce every DDIC type exactly, and ABAP SQL rejects a structure
    " whose component type does not match the column (INT4 for an INT2 column,
    " CHAR for a numeric one) with "not Unicode convertible" — which made whole
    " tables unreadable, including DD03L itself (feedback F-10 / F-26).
    " `lv_meta-name` is validated against DD02L above, so this is a real DDIC
    " object and not one of the built-in type names that dump in describe_by_name.
    DATA lo_row_type TYPE REF TO cl_abap_structdescr.
    TRY.
        DATA(lo_desc) = cl_abap_typedescr=>describe_by_name( lv_meta-name ).
        CASE lo_desc->kind.
          WHEN cl_abap_typedescr=>kind_table.
            DATA(lo_td) = CAST cl_abap_tabledescr( lo_desc ).
            lo_row_type ?= lo_td->get_table_line_type( ).
          WHEN cl_abap_typedescr=>kind_struct.
            DATA(lo_sd) = CAST cl_abap_structdescr( lo_desc ).
            lo_row_type ?= lo_sd.
          WHEN OTHERS.
            CLEAR lo_row_type.
        ENDCASE.
      CATCH cx_root.
        CLEAR lo_row_type.
    ENDTRY.

    IF lo_row_type IS NOT BOUND.
      " Fallback: rebuild the row type from DD03L metadata.
      DATA(lt_components) = VALUE abap_component_tab( ).
      LOOP AT lv_meta-fields INTO DATA(ls_dd03l).
      DATA lo_elem TYPE REF TO cl_abap_elemdescr.
      DATA(lv_len) = ls_dd03l-length.
      IF lv_len <= 0. lv_len = 100. ENDIF.
      CASE ls_dd03l-dataType.
        WHEN 'CLNT' OR 'CHAR' OR 'CUKY' OR 'UNIT' OR 'LANG' OR 'VARC'.
          lo_elem = cl_abap_elemdescr=>get_c( lv_len ).
        WHEN 'NUMC'.
          lo_elem = cl_abap_elemdescr=>get_n( lv_len ).
        WHEN 'DATS' OR 'DATN'.
          lo_elem = cl_abap_elemdescr=>get_d( ).
        WHEN 'TIMS' OR 'TIMN' OR 'UTCLONG'.
          lo_elem = cl_abap_elemdescr=>get_t( ).
        WHEN 'DEC' OR 'QUAN' OR 'CURR' OR 'PREC' OR 'ACCP'.
          lo_elem = cl_abap_elemdescr=>get_p( p_length = lv_len p_decimals = ls_dd03l-decimals ).
        WHEN 'INT1' OR 'INT2' OR 'INT4' OR 'INT8'.
          " Numeric columns MUST be typed as numbers. Mapping them to CHAR made
          " the dynamic SELECT fail with "the type of the database table and
          " work area (or internal table) "<LT_ROWS>" are not Unicode
          " convertible" for every table containing an INT or RAW column — DD03L
          " (SRS_ID), VRSD (VERSTABLEN), TSTC (CINFO) — which is why field
          " inventory was unreachable (feedback F-10 / F-26).
          lo_elem = cl_abap_elemdescr=>get_i( ).
        WHEN 'FLTP'.
          lo_elem = cl_abap_elemdescr=>get_f( ).
        WHEN 'RAW' OR 'LRAW'.
          lo_elem = cl_abap_elemdescr=>get_x( lv_len ).
        WHEN 'STRG' OR 'SSTR' OR 'LCHR'.
          lo_elem = cl_abap_elemdescr=>get_string( ).
        WHEN 'RSTR'.
          lo_elem = cl_abap_elemdescr=>get_xstring( ).
        WHEN 'DF16_DEC' OR 'DF16_RAW' OR 'DF16_SCL' OR 'DECFLOAT16'
          OR 'DF34_DEC' OR 'DF34_RAW' OR 'DF34_SCL' OR 'DECFLOAT34' OR 'GEOM_EWKB'.
          " No dedicated factory for the decfloat family; read as text. These
          " columns are re-serialized as strings anyway.
          lo_elem = cl_abap_elemdescr=>get_string( ).
        WHEN OTHERS.
          " Genuinely unknown type — CHAR is the last resort.
          lo_elem = cl_abap_elemdescr=>get_c( lv_len ).
      ENDCASE.
      IF lo_elem IS BOUND.
        APPEND VALUE #( name = ls_dd03l-name
                         type = CAST cl_abap_datadescr( lo_elem ) ) TO lt_components.
      ENDIF.
    ENDLOOP.
      lo_row_type = cl_abap_structdescr=>create( lt_components ).
    ENDIF.

    DATA(lo_table_type) = cl_abap_tabledescr=>create( lo_row_type ).
    DATA lr_rows TYPE REF TO data.
    CREATE DATA lr_rows TYPE HANDLE lo_table_type.
    FIELD-SYMBOLS <lt_rows> TYPE ANY TABLE.
    ASSIGN lr_rows->* TO <lt_rows>.

    " Pre-declare host vars (ABAP forbids re-`DATA` inside CASE branches).
    DATA: lv_where_v1     TYPE string,
          lv_where_v1_kind TYPE string,
          lv_where_v2     TYPE string,
          lv_where_v2_kind TYPE string,
          lv_where_v3     TYPE string,
          lv_where_v3_kind TYPE string,
          lv_where_v4     TYPE string,
          lv_where_v4_kind TYPE string,
          lv_where_v5     TYPE string,
          lv_where_v5_kind TYPE string,
          lv_where_v_max  TYPE string.

    " WHERE clause: build a string-table of `field = @lv_var` expressions.
    " The host variables are declared in the current scope (one per condition)
    " so the WHERE clause can reference them.
    DATA(lt_where_tab) = VALUE string_table( ).
    DATA(lv_cond_idx) = 0.
    LOOP AT it_where INTO DATA(ls_where).
      lv_cond_idx = lv_cond_idx + 1.
      CASE lv_cond_idx.
        WHEN 1.
          lv_where_v1 = ls_where-value.
          lv_where_v1_kind = ls_where-valueKind.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_where_v1| TO lt_where_tab.
        WHEN 2.
          lv_where_v2 = ls_where-value.
          lv_where_v2_kind = ls_where-valueKind.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_where_v2| TO lt_where_tab.
        WHEN 3.
          lv_where_v3 = ls_where-value.
          lv_where_v3_kind = ls_where-valueKind.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_where_v3| TO lt_where_tab.
        WHEN 4.
          lv_where_v4 = ls_where-value.
          lv_where_v4_kind = ls_where-valueKind.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_where_v4| TO lt_where_tab.
        WHEN 5.
          lv_where_v5 = ls_where-value.
          lv_where_v5_kind = ls_where-valueKind.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_where_v5| TO lt_where_tab.
        WHEN OTHERS.
          " Beyond 5 conditions — build a fixed stack of host variables.
          " Most ad-hoc queries are well under this; v1 limit is 5.
          lv_where_v_max = ls_where-value.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_where_v_max| TO lt_where_tab.
      ENDCASE.
    ENDLOOP.

    " ORDER BY (dynamic).
    DATA(lt_ob_tab) = VALUE string_table( ).
    LOOP AT it_orderby INTO DATA(ls_ob).
      " This SAP version's dynamic ORDER BY rejects the ASC/DESC abbreviation —
      " use the full ASCENDING / DESCENDING keywords.
      DATA(lv_dir_full) = COND string( WHEN ls_ob-direction = 'DESC' OR ls_ob-direction = 'DESCENDING' THEN 'DESCENDING' ELSE 'ASCENDING' ).
      APPEND |{ ls_ob-field } { lv_dir_full }| TO lt_ob_tab.
    ENDLOOP.

    " UP TO @lv_limit (limit+1) and OFFSET.
    DATA(lv_limit) = iv_limit + 1.
    DATA(lv_offset) = iv_offset.

    " Execute the SELECT. SAP NetWeaver constraint: OFFSET requires ORDER BY,
    " and dynamic Open SQL requires UP TO / OFFSET AFTER INTO TABLE.
    " dispatch_data adds a MANDT order-by when offset > 0 and no order-by was
    " given, so lt_ob_tab is non-empty whenever we need OFFSET.
    TRY.
        IF iv_offset = 0 AND lt_where_tab IS INITIAL AND lt_ob_tab IS INITIAL.
          SELECT * FROM (lv_meta-name)
            INTO TABLE @<lt_rows>
            UP TO @lv_limit ROWS.
        ELSEIF iv_offset = 0 AND lt_where_tab IS INITIAL.
          SELECT * FROM (lv_meta-name)
            ORDER BY (lt_ob_tab)
            INTO TABLE @<lt_rows>
            UP TO @lv_limit ROWS.
        ELSEIF iv_offset = 0 AND lt_ob_tab IS INITIAL.
          SELECT * FROM (lv_meta-name)
            WHERE (lt_where_tab)
            INTO TABLE @<lt_rows>
            UP TO @lv_limit ROWS.
        ELSEIF iv_offset = 0.
          SELECT * FROM (lv_meta-name)
            WHERE (lt_where_tab)
            ORDER BY (lt_ob_tab)
            INTO TABLE @<lt_rows>
            UP TO @lv_limit ROWS.
        ELSEIF lt_where_tab IS INITIAL.
          " offset > 0 — order-by guaranteed by dispatch_data fallback.
          SELECT * FROM (lv_meta-name)
            ORDER BY (lt_ob_tab)
            INTO TABLE @<lt_rows>
            UP TO @lv_limit ROWS OFFSET @iv_offset.
        ELSE.
          SELECT * FROM (lv_meta-name)
            WHERE (lt_where_tab)
            ORDER BY (lt_ob_tab)
            INTO TABLE @<lt_rows>
            UP TO @lv_limit ROWS OFFSET @iv_offset.
        ENDIF.
      CATCH cx_root INTO DATA(lx_query).
        ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                   error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'QUERY_FAILED'
                                                                message = lx_query->get_text( ) ) ).
        RETURN.
    ENDTRY.

    " Truncation detection: probe has limit+1 rows.
    " Note: <lt_rows> is a fully generic table (data references), so DELETE
    " with index arithmetic is rejected. Use sy-dbcnt (set by SELECT INTO TABLE)
    " plus the per-row LOOP counter — both cheap and side-effect-free.
    DATA(lv_truncated) = abap_false.
    DATA(lv_row_count) = sy-dbcnt.
    " sy-dbcnt may be 0 if the SELECT path failed silently; fall back to counting.
    IF lv_row_count = 0.
      LOOP AT <lt_rows> ASSIGNING FIELD-SYMBOL(<ls_cnt>).
        lv_row_count = lv_row_count + 1.
      ENDLOOP.
    ENDIF.
    IF lv_row_count > iv_limit.
      lv_truncated = abap_true.
      lv_row_count = iv_limit.
    ENDIF.

    " Build the projected row set (only iv_fields_csv columns, in CSV order).
    " The projected type reuses the full row type's component descriptors, so
    " value serialization is native (/ui2/cl_json pretty_mode-none: uppercase
    " field names, typed values — Q1 B).
    DATA(lt_out_fields) = VALUE string_table( ).
    SPLIT iv_fields_csv AT ',' INTO TABLE lt_out_fields.

    DATA(lt_full_components) = lo_row_type->get_components( ).
    DATA(lt_proj_components) = VALUE abap_component_tab( ).
    DATA lv_fname TYPE string.
    LOOP AT lt_out_fields INTO lv_fname.
      READ TABLE lt_full_components INTO DATA(ls_comp) WITH KEY name = lv_fname.
      IF sy-subrc = 0. APPEND ls_comp TO lt_proj_components. ENDIF.
    ENDLOOP.
    DATA(lo_proj_type) = cl_abap_structdescr=>create( lt_proj_components ).
    DATA(lo_proj_table) = cl_abap_tabledescr=>create( lo_proj_type ).
    DATA lr_proj TYPE REF TO data.
    CREATE DATA lr_proj TYPE HANDLE lo_proj_table.
    FIELD-SYMBOLS <lt_proj> TYPE ANY TABLE.
    ASSIGN lr_proj->* TO <lt_proj>.

    DATA(lv_row_idx) = 0.
    FIELD-SYMBOLS:
      <ls_src>      TYPE any,
      <ls_dst>      TYPE any,
      <lv_src_cell> TYPE any,
      <lv_dst_cell> TYPE any.
    LOOP AT <lt_rows> ASSIGNING <ls_src>.
      lv_row_idx = lv_row_idx + 1.
      IF lv_row_idx > iv_limit. EXIT. ENDIF.  " drop the limit+1 probe row
      INSERT INITIAL LINE INTO TABLE <lt_proj> ASSIGNING <ls_dst>.
      LOOP AT lt_out_fields INTO lv_fname.
        ASSIGN COMPONENT lv_fname OF STRUCTURE <ls_src> TO <lv_src_cell>.
        IF sy-subrc <> 0. CONTINUE. ENDIF.
        ASSIGN COMPONENT lv_fname OF STRUCTURE <ls_dst> TO <lv_dst_cell>.
        IF sy-subrc <> 0. CONTINUE. ENDIF.
        <lv_dst_cell> = <lv_src_cell>.
      ENDLOOP.
    ENDLOOP.

    " Old /UI2/CL_JSON (vhcala4hci) does not escape — escape char-like cells.
    IF zcl_abap_vibe_icf_response=>escape_probe_needed( ) = abap_true.
      zcl_abap_vibe_icf_response=>escape_json_strings( CHANGING cv_data = <lt_proj> ).
    ENDIF.

    " Serialize rows independently: pretty_mode-none keeps DDIC-uppercase field
    " names with native typed values; embedded as a partial JSON piece below.
    DATA(lv_rows_json) = /ui2/cl_json=>serialize( data        = <lt_proj>
                                                  pretty_name = /ui2/cl_json=>pretty_mode-none ).

    " Envelope — camelCase naming via serialize_response at the dispatcher.
    DATA lv_object_type TYPE string.
    IF lv_meta-tabclass = 'VIEW'.
      lv_object_type = 'VIEW'.
    ELSE.
      lv_object_type = 'TABL'.
    ENDIF.
    es_payload = VALUE zcl_abap_vibe_icf_types=>ty_select_result(
      status = 'success'
      data = VALUE zcl_abap_vibe_icf_types=>ty_select_result_data(
        table           = lv_meta-name
        object_type     = lv_object_type
        fields          = lt_out_fields
        rows            = lv_rows_json
        row_count       = lv_row_count
        truncated       = lv_truncated
        excluded_fields = is_meta-excludedFields
        duration_ms     = 1 ) ).
    CATCH cx_root INTO DATA(lx_exec_top).
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'QUERY_FAILED'
                                                              message = |execute_select: { lx_exec_top->get_text( ) }| ) ).
      RETURN.
    ENDTRY.
  ENDMETHOD.
  METHOD execute_count.
    " SELECT COUNT(*) FROM (table) WHERE (cond) — same parameter binding.
    DATA(lv_meta) = is_meta.

    " Pre-declare host vars (ABAP forbids re-`DATA` inside CASE branches).
    DATA: lv_where_v1  TYPE string,
          lv_where_v2  TYPE string,
          lv_where_v3  TYPE string,
          lv_where_v4  TYPE string,
          lv_where_v5  TYPE string,
          lv_where_v_max TYPE string.

    " WHERE clause (host vars).
    DATA(lt_where_tab) = VALUE string_table( ).
    DATA(lv_cond_idx) = 0.
    LOOP AT it_where INTO DATA(ls_where).
      lv_cond_idx = lv_cond_idx + 1.
      CASE lv_cond_idx.
        WHEN 1.
          lv_where_v1 = ls_where-value.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_where_v1| TO lt_where_tab.
        WHEN 2.
          lv_where_v2 = ls_where-value.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_where_v2| TO lt_where_tab.
        WHEN 3.
          lv_where_v3 = ls_where-value.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_where_v3| TO lt_where_tab.
        WHEN 4.
          lv_where_v4 = ls_where-value.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_where_v4| TO lt_where_tab.
        WHEN 5.
          lv_where_v5 = ls_where-value.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_where_v5| TO lt_where_tab.
        WHEN OTHERS.
          lv_where_v_max = ls_where-value.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_where_v_max| TO lt_where_tab.
      ENDCASE.
    ENDLOOP.

    DATA(lv_count) = 0.
    TRY.
        IF lt_where_tab IS INITIAL.
          SELECT COUNT(*) FROM (lv_meta-name) INTO @lv_count.
        ELSE.
          SELECT COUNT(*) FROM (lv_meta-name) WHERE (lt_where_tab) INTO @lv_count.
        ENDIF.
      CATCH cx_root INTO DATA(lx_q).
        ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                   error = VALUE zcl_abap_vibe_icf_types=>ty_error_body( code = 'QUERY_FAILED'
                                                                message = lx_q->get_text( ) ) ).
        RETURN.
    ENDTRY.

    es_payload = VALUE zcl_abap_vibe_icf_types=>ty_select_count(
      status = 'success'
      data = VALUE zcl_abap_vibe_icf_types=>ty_select_count_data(
        table       = lv_meta-name
        count       = lv_count
        duration_ms = 1 ) ).
  ENDMETHOD.

  METHOD execute_group_by.
    " F-12: SELECT <field>, COUNT(*) FROM (table) [WHERE ...]
    "         GROUP BY <field> ORDER BY COUNT(*) DESCENDING
    "         INTO TABLE @<lt_rows> UP TO @limit ROWS.
    " Values stay bound as host variables (same injection-safety contract as
    " execute_select / execute_count): only validated identifiers are dynamic.
    DATA(lv_meta) = is_meta.
    DATA(lv_group) = to_upper( condense( val = iv_group_by del = ` ` ) ).

    " The grouped column must exist and must be groupable.
    DATA(ls_group_meta) = VALUE zcl_abap_vibe_icf_types=>ty_query_field( ).
    READ TABLE lv_meta-fields INTO ls_group_meta WITH KEY name = lv_group.
    IF sy-subrc <> 0.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body(
                                   code    = 'INVALID_FIELD'
                                   message = |field { lv_group } is not in table { lv_meta-name }| ) ).
      RETURN.
    ENDIF.
    IF ls_group_meta-dataType CP gc_large_object_types.
      ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                 error = VALUE zcl_abap_vibe_icf_types=>ty_error_body(
                                   code    = 'INVALID_FIELD'
                                   message = |GROUP BY is not supported on large-object field { lv_group } ({ ls_group_meta-dataType })| ) ).
      RETURN.
    ENDIF.

    " Host-variable WHERE table — same shape as execute_select.
    DATA lt_where_tab TYPE string_table.
    DATA: lv_g_v1    TYPE string,
          lv_g_v2    TYPE string,
          lv_g_v3    TYPE string,
          lv_g_v4    TYPE string,
          lv_g_v5    TYPE string,
          lv_g_v_max TYPE string.
    LOOP AT it_where INTO DATA(ls_where).
      CASE sy-tabix.
        WHEN 1.
          lv_g_v1 = ls_where-value.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_g_v1| TO lt_where_tab.
        WHEN 2.
          lv_g_v2 = ls_where-value.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_g_v2| TO lt_where_tab.
        WHEN 3.
          lv_g_v3 = ls_where-value.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_g_v3| TO lt_where_tab.
        WHEN 4.
          lv_g_v4 = ls_where-value.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_g_v4| TO lt_where_tab.
        WHEN 5.
          lv_g_v5 = ls_where-value.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_g_v5| TO lt_where_tab.
        WHEN OTHERS.
          lv_g_v_max = ls_where-value.
          APPEND |{ ls_where-field } { ls_where-operator } @lv_g_v_max| TO lt_where_tab.
      ENDCASE.
    ENDLOOP.

    " Result type: the grouped column with its EXACT DDIC type plus an INT4
    " count. The exact type matters — a CHAR stand-in for a numeric column makes
    " the dynamic SELECT fail with "not Unicode convertible" (F-10 / F-26).
    DATA lt_components TYPE abap_component_tab.
    DATA lo_elem TYPE REF TO cl_abap_elemdescr.
    DATA(lv_len) = COND i( WHEN ls_group_meta-length > 0 THEN ls_group_meta-length ELSE 100 ).
    CASE ls_group_meta-dataType.
      WHEN 'NUMC'.
        lo_elem = cl_abap_elemdescr=>get_n( lv_len ).
      WHEN 'DATS'.
        lo_elem = cl_abap_elemdescr=>get_d( ).
      WHEN 'TIMS'.
        lo_elem = cl_abap_elemdescr=>get_t( ).
      WHEN 'INT1' OR 'INT2' OR 'INT4' OR 'INT8'.
        lo_elem = cl_abap_elemdescr=>get_i( ).
      WHEN 'DEC' OR 'QUAN' OR 'CURR'.
        lo_elem = cl_abap_elemdescr=>get_p( p_length = lv_len p_decimals = ls_group_meta-decimals ).
      WHEN OTHERS.
        lo_elem = cl_abap_elemdescr=>get_c( lv_len ).
    ENDCASE.
    IF lo_elem IS NOT BOUND.
      lo_elem = cl_abap_elemdescr=>get_c( lv_len ).
    ENDIF.
    APPEND VALUE #( name = lv_group type = CAST cl_abap_datadescr( lo_elem ) ) TO lt_components.
    APPEND VALUE #( name = 'CNT' type = CAST cl_abap_datadescr( cl_abap_elemdescr=>get_i( ) ) ) TO lt_components.
    DATA(lo_row_type) = cl_abap_structdescr=>create( lt_components ).
    DATA(lo_table_type) = cl_abap_tabledescr=>create( lo_row_type ).
    DATA lr_rows TYPE REF TO data.
    CREATE DATA lr_rows TYPE HANDLE lo_table_type.
    FIELD-SYMBOLS <lt_rows> TYPE ANY TABLE.
    ASSIGN lr_rows->* TO <lt_rows>.

    " Dynamic column list: the grouped column plus the aggregate.
    DATA(lv_cols) = |{ lv_group }, COUNT(*) AS CNT|.
    DATA(lv_limit) = COND i( WHEN iv_limit > 0 THEN iv_limit ELSE gc_query_limit_def ).

    " SAP NetWeaver constraint (same as execute_select): with dynamic Open SQL
    " the UP TO clause must follow INTO TABLE; ORDER BY uses the full keyword.
    TRY.
        IF lt_where_tab IS INITIAL.
          SELECT (lv_cols) FROM (lv_meta-name)
            GROUP BY (lv_group)
            ORDER BY COUNT(*) DESCENDING
            INTO TABLE @<lt_rows>
            UP TO @lv_limit ROWS.
        ELSE.
          SELECT (lv_cols) FROM (lv_meta-name)
            WHERE (lt_where_tab)
            GROUP BY (lv_group)
            ORDER BY COUNT(*) DESCENDING
            INTO TABLE @<lt_rows>
            UP TO @lv_limit ROWS.
        ENDIF.
      CATCH cx_root INTO DATA(lx_grp).
        ev_error = VALUE zcl_abap_vibe_icf_types=>ty_error( status = 'error'
                                   error = VALUE zcl_abap_vibe_icf_types=>ty_error_body(
                                     code    = 'QUERY_FAILED'
                                     message = |execute_group_by: { lx_grp->get_text( ) }| ) ).
        RETURN.
    ENDTRY.

    DATA(lv_groups_json) = VALUE string( ).
    IF lines( <lt_rows> ) > 0.
      IF zcl_abap_vibe_icf_response=>escape_probe_needed( ) = abap_true.
        zcl_abap_vibe_icf_response=>escape_json_strings( CHANGING cv_data = <lt_rows> ).
      ENDIF.
      lv_groups_json = /ui2/cl_json=>serialize( data        = <lt_rows>
                                                pretty_name = /ui2/cl_json=>pretty_mode-none ).
    ELSE.
      lv_groups_json = '[]'.
    ENDIF.

    DATA(lv_g_object_type) = COND string( WHEN lv_meta-tabclass = 'VIEW' THEN 'VIEW' ELSE 'TABL' ).
    es_payload = VALUE zcl_abap_vibe_icf_types=>ty_select_group(
      status = 'success'
      data = VALUE zcl_abap_vibe_icf_types=>ty_select_group_data(
        table       = lv_meta-name
        object_type = lv_g_object_type
        field       = lv_group
        groups      = lv_groups_json
        group_count = lines( <lt_rows> )
        duration_ms = 1 ) ).
  ENDMETHOD.
ENDCLASS.
