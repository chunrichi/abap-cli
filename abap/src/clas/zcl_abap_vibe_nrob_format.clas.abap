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

    " sy-langu -> AFF two-letter code, mirroring the mapping the other DDIC
    " format helpers use (zcl_abap_vibe_tabl_format#original_language, zcl_abap_
    " vibe_enqu_format#language_code). SAP language keys are single characters
    " — '1' is Chinese, not an ISO code — so the raw key must not be emitted
    " as `originalLanguage`.
    CLASS-METHODS language_code
      IMPORTING iv_language    TYPE string
      RETURNING VALUE(rv_code) TYPE string.
ENDCLASS.

CLASS zcl_abap_vibe_nrob_format IMPLEMENTATION.
  METHOD generate.
    DATA lv_ok TYPE abap_bool.
    DATA lv_error_code TYPE string.
    DATA lv_error_message TYPE string.
    DATA lv_master_language TYPE string.

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

    lv_master_language = sy-langu.
    rs_result-header-original_language = language_code( lv_master_language ).
    rs_result-success = abap_true.
  ENDMETHOD.

  METHOD read_nrob.
    " PR5: NROB (number range object) read. There is no DDIF_NROB_GET in NW 7.93
    " (NROB is custom, not in the DDIF range), so the read goes via plain
    " SELECT on TNRO + TNROT. NRIV carries the actual interval data which the
    " AFF `nrob-v1.json` schema does NOT expose, so this method does not
    " surface NRIV rows — the CLI side treats interval configuration as a
    " declaration of the number range object, with the actual intervals
    " maintained via SAP GUI (SNRO). Future work: extend the AFF document
    " shape to carry NRIV rows and have this method emit them too.
    "
    " TNRO → AFF mapping is the inverse of create_ddic_nrob (see the comment
    " block in zcl_abap_vibe_icf.clas.implementations.abap for the column-by-
    " column rationale). Two minor twists:
    "   - TNROT-txtshort is dropped (AFF only carries a single `description`
    "     field capped at 60 chars; we use the long txt).
    "   - `rolling` and `nonrswap` are inverted: TNRO.nonrswap=X means
    "     "do not roll over", so we set rolling=false in that case (see
    "     create_ddic_nrob where the same flip happens the other way).
    DATA ls_tnro       TYPE tnro.
    DATA ls_tnrot      TYPE tnrot.
    DATA lv_langu      TYPE sy-langu.
    DATA lv_found_tnro TYPE abap_bool.
    DATA lv_found_text TYPE abap_bool.

    CLEAR: es_interval, es_configuration, ev_description.
    ev_ok = abap_false.

    " Read the TNRO row first. Without it we have nothing to surface.
    SELECT SINGLE * FROM tnro
      WHERE object = @iv_name
      INTO @ls_tnro.
    IF sy-subrc <> 0.
      ev_error_code = 'NROB_NOT_FOUND'.
      ev_error_message = |number range object { iv_name } does not exist|.
      RETURN.
    ENDIF.
    lv_found_tnro = abap_true.

    " TNROT holds the language-keyed description. The master language is the
    " language the description was originally created in; if it differs from
    " the session language we re-read to keep the round-trip precise. We
    " don't have an explicit master-language column on TNRO (the FM source
    " uses SY-LANGU at write time), so fall back to whatever language row
    " exists when the master is unavailable.
    lv_langu = sy-langu.
    SELECT SINGLE * FROM tnrot
      WHERE object = @iv_name AND langu = @lv_langu
      INTO @ls_tnrot.
    IF sy-subrc = 0.
      lv_found_text = abap_true.
    ELSE.
      " Try any language row for this object so pull still returns SOMETHING.
      SELECT SINGLE * FROM tnrot
        WHERE object = @iv_name
        INTO @ls_tnrot.
      IF sy-subrc = 0.
        lv_found_text = abap_true.
      ENDIF.
    ENDIF.

    " TNRO → AFF interval. The percentage value comes back from a DEC(3,1)
    " domain (NRPERC), so write it as a numeric string the CLI can parse.
    es_interval-number_length_domain = ls_tnro-domlen.
    es_interval-percent_warning      = |{ ls_tnro-percentage DECIMALS = 1 }|.
    es_interval-sub_type             = ls_tnro-dtelsobj.
    es_interval-until_year           = COND abap_bool( WHEN ls_tnro-yearind = 'X' THEN abap_true ELSE abap_false ).
    es_interval-rolling              = COND abap_bool( WHEN ls_tnro-nonrswap = 'X' THEN abap_false ELSE abap_true ).
    es_interval-prefix               = abap_false. " no obvious TNRO column; see create_ddic_nrob comment.

    " TNRO → AFF configuration. NRBUFFERTYPE values (probed via ADT domain
    " source): X=main memory, P=parallel, space=no buffering.
    CASE ls_tnro-buffer.
      WHEN 'P'.         es_configuration-buffering = 'parallel'.
      WHEN ' '.         es_configuration-buffering = 'none'.
      WHEN OTHERS.      es_configuration-buffering = 'mainBuffer'.
    ENDCASE.
    es_configuration-buffered_numbers = ls_tnro-noivbuffer.
    IF ls_tnro-rfcdest IS NOT INITIAL.
      es_configuration-transaction_id = ls_tnro-rfcdest.
    ENDIF.

    " TNROT → AFF header. Description comes from TNROT-txt (long form); the
    " AFF schema caps it at 60 chars (matches TNROT-txt's NROBJTXT domain).
    IF lv_found_text = abap_true.
      ev_description = ls_tnrot-txt.
    ENDIF.

    ev_ok = abap_true.
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
