CLASS zcl_abap_vibe_icf_setup DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
  PROTECTED SECTION.
  PRIVATE SECTION.
    CONSTANTS:
      gc_icf_url TYPE string VALUE '/sap/zabap_vibe',
      gc_parent  TYPE string VALUE '/sap',
      gc_name    TYPE icfname VALUE 'zabap_vibe',
      gc_handler TYPE icf_hand VALUE 'ZCL_ABAP_VIBE_ICF',
      gc_vhost   TYPE icfhostnum VALUE 0. " default_host

    " 017: message types serialized via /ui2/cl_json (camelCase wire).
    TYPES:
      BEGIN OF ty_setup_error_body,
        code    TYPE string,
        message TYPE string,
      END OF ty_setup_error_body,
      BEGIN OF ty_setup_error,
        status TYPE string,
        error  TYPE ty_setup_error_body,
      END OF ty_setup_error,
      BEGIN OF ty_setup_node,
        vhost   TYPE string,
        url     TYPE string,
        handler TYPE string,
        active  TYPE abap_bool,
      END OF ty_setup_node,
      BEGIN OF ty_setup_success,
        status TYPE string,
        action TYPE string,
        node   TYPE ty_setup_node,
      END OF ty_setup_success.

    METHODS serialize_error
      IMPORTING iv_code    TYPE string
                iv_message TYPE string
      RETURNING VALUE(rv_json) TYPE string.
    METHODS serialize_success
      IMPORTING iv_action TYPE string
      RETURNING VALUE(rv_json) TYPE string.
ENDCLASS.

CLASS zcl_abap_vibe_icf_setup IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    DATA lv_guid       TYPE icfnodguid.
    DATA lv_parent     TYPE icfnodguid.
    DATA lv_action     TYPE string.
    DATA lv_transport  TYPE trkorr.
    DATA ls_docu       TYPE icfdocu.

    TRY.
        " Resolve the parent node (/sap) under which zabap_vibe is created.
        CALL METHOD cl_icf_tree=>if_icf_tree~service_from_url
          EXPORTING
            url        = gc_parent
            hostnumber = gc_vhost
          IMPORTING
            icfnodguid = lv_parent
          EXCEPTIONS
            wrong_url    = 4
            no_authority = 5
            OTHERS       = 99.
        IF sy-subrc <> 0.
          out->write( serialize_error(
            iv_code    = 'ICF_PARENT_NOT_FOUND'
            iv_message = |parent node { gc_parent } not found (subrc={ sy-subrc })| ) ).
          RETURN.
        ENDIF.

        " Create the node (idempotent: NODE_ALREADY_EXISTING → already created).
        CLEAR ls_docu.
        ls_docu-icf_name   = gc_name.
        ls_docu-icfparguid = lv_parent.
        ls_docu-icf_langu  = sy-langu.
        ls_docu-icf_docu   = 'ABAP Vibe - ICF Services'.
        CALL METHOD cl_icf_tree=>if_icf_tree~insert_node
          EXPORTING
            icf_name      = gc_name
            icfparguid    = lv_parent
            icfdocu       = ls_docu
            icfhandlst    = VALUE #( ( gc_handler ) )
            icfactive     = 'X'
            package       = '$TMP'
            application   = ''
          IMPORTING
            icfnodguid    = lv_guid
          CHANGING
            transport     = lv_transport
          EXCEPTIONS
            node_already_existing = 6
            no_authority          = 26
            OTHERS                = 99.
        DATA(lv_ins) = sy-subrc.
        CASE lv_ins.
          WHEN 0.
            lv_action = 'created'.
          WHEN 6.
            " Node already exists → keep the existing binding, just ensure active.
            lv_action = 'already_active'.
          WHEN 26.
            out->write( serialize_error(
              iv_code    = 'ICF_ADMIN_REQUIRED'
              iv_message = 'insufficient SICF authorization to create the service node' ) ).
            RETURN.
          WHEN OTHERS.
            out->write( serialize_error(
              iv_code    = 'ICF_SETUP_FAILED'
              iv_message = |insert_node subrc={ lv_ins }| ) ).
            RETURN.
        ENDCASE.

        " Ensure an existing node is active; new nodes requested X above.
        IF lv_ins = 6.
          CALL METHOD cl_icf_tree=>if_icf_tree~change_node
            EXPORTING
              icf_name   = gc_name
              icfparguid = lv_parent
              icfactive  = 'X'
              application = ''
            IMPORTING
              icfnodguid = lv_guid
            CHANGING
              transport  = lv_transport
            EXCEPTIONS
              OTHERS = 99.
          IF sy-subrc <> 0.
            out->write( serialize_error(
              iv_code    = 'ICF_SETUP_FAILED'
              iv_message = |change_node subrc={ sy-subrc }| ) ).
            RETURN.
          ENDIF.
        ENDIF.

        out->write( serialize_success( iv_action = lv_action ) ).
      CATCH cx_for_icf_tree INTO DATA(lx_icf).
        out->write( serialize_error(
          iv_code    = 'ICF_EXC_TREE'
          iv_message = lx_icf->get_text( ) ) ).
      CATCH cx_root INTO DATA(lx_root).
        out->write( serialize_error(
          iv_code    = 'ICF_EXC_ROOT'
          iv_message = lx_root->get_text( ) ) ).
    ENDTRY.
  ENDMETHOD.

  METHOD serialize_error.
    rv_json = /ui2/cl_json=>serialize(
      data = VALUE ty_setup_error( status = 'error'
                                   error = VALUE ty_setup_error_body( code = iv_code message = iv_message ) )
      pretty_name = /ui2/cl_json=>pretty_mode-camel_case ).
  ENDMETHOD.

  METHOD serialize_success.
    rv_json = /ui2/cl_json=>serialize(
      data = VALUE ty_setup_success(
        status = 'success'
        action = iv_action
        node = VALUE ty_setup_node( vhost = 'default_host' url = gc_icf_url handler = gc_handler active = abap_true ) )
      pretty_name = /ui2/cl_json=>pretty_mode-camel_case ).
  ENDMETHOD.
ENDCLASS.
