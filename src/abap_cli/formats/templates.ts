/** Named skeleton registry for `abap create --template`. */
export interface CreateTemplate {
  name: string;
  description: string;
  skeleton: (name: string) => string;
}

/** Join generated ABAP source lines, keeping the trailing newline every skeleton ends with. */
const abapLines = (lines: string[]): string => lines.join('\n') + '\n';

// Shared building blocks for the two `report-alv*` templates. They differ only
// in the selection screen and the extra restrict form, so the demo data and the
// ALV display form live here once to keep both skeletons consistent.
const ALV_TYPES: string[] = [
  '*&-----------------------------------------------------------------',
  '*&                    Types',
  '*&-----------------------------------------------------------------',
  'TYPES: BEGIN OF ts_item,',
  '         matnr TYPE matnr,',
  '         maktx TYPE maktx,',
  '         menge TYPE menge_d,',
  '       END OF ts_item,',
  '       tt_item TYPE STANDARD TABLE OF ts_item WITH EMPTY KEY.',
];

const ALV_RETRIEVE_FORM: string[] = [
  '*&-----------------------------------------------------------------',
  '*& Form retrieve',
  '*&-----------------------------------------------------------------',
  '*   <-- ct_items   Demo rows for the ALV list',
  '*&-----------------------------------------------------------------',
  'FORM retrieve CHANGING ct_items TYPE tt_item.',
  '',
  '* Build a small demo data set; replace this with a SELECT on a real table.',
  '  ct_items = VALUE #(',
  "    ( matnr = '000000000000000001' maktx = 'Demo material 1' menge = 10 )",
  "    ( matnr = '000000000000000002' maktx = 'Demo material 2' menge = 20 )",
  "    ( matnr = '000000000000000003' maktx = 'Demo material 3' menge = 30 ) ).",
  'ENDFORM.',
];

const ALV_DISPLAY_FORM: string[] = [
  '*&-----------------------------------------------------------------',
  '*& Form display',
  '*&-----------------------------------------------------------------',
  '*   --> it_items   Rows to render in the ALV list',
  '*&-----------------------------------------------------------------',
  'FORM display USING it_items TYPE tt_item.',
  '',
  '  DATA: lt_items TYPE tt_item,',
  '        lt_fcat  TYPE lvc_t_fcat,',
  '        lr_salv  TYPE REF TO cl_salv_table,',
  '        lx_salv  TYPE REF TO cx_salv_msg,',
  '        lv_text  TYPE string.',
  '',
  '* The ALV grid needs a writable table, so display works on a local copy.',
  '  lt_items = it_items.',
  '',
  '* Explicit field catalog keeps the column order and headers under control.',
  '  lt_fcat = VALUE #(',
  "    ( fieldname = 'MATNR' coltext = 'Material' )",
  "    ( fieldname = 'MAKTX' coltext = 'Description' )",
  "    ( fieldname = 'MENGE' coltext = 'Quantity' ) ).",
  '',
  '  TRY.',
  '      cl_salv_table=>factory(',
  '        IMPORTING',
  '          r_salv_table = lr_salv',
  '        CHANGING',
  '          t_table      = lt_items ).',
  '',
  '      lr_salv->set_table_for_first_display(',
  '        CHANGING',
  '          it_outtab       = lt_items',
  '          it_fieldcatalog = lt_fcat ).',
  '',
  '      lr_salv->display( ).',
  '    CATCH cx_salv_msg INTO lx_salv.',
  '      lv_text = lx_salv->get_text( ).',
  "      MESSAGE lv_text TYPE 'I'.",
  '  ENDTRY.',
  'ENDFORM.',
];

const TEMPLATES: Record<string, CreateTemplate[]> = {
  CLAS: [
    {
      name: 'minimal',
      description: 'Empty public class',
      skeleton: (n) => `CLASS ${n} DEFINITION PUBLIC.\n  PUBLIC SECTION.\nENDCLASS.\nCLASS ${n} IMPLEMENTATION.\nENDCLASS.\n`,
    },
    {
      name: 'public-method',
      description: 'Class with a public method',
      skeleton: (n) =>
        `CLASS ${n} DEFINITION PUBLIC.\n  PUBLIC SECTION.\n    METHODS hello.\nENDCLASS.\n` +
        `CLASS ${n} IMPLEMENTATION.\n  METHOD hello.\n  ENDMETHOD.\nENDCLASS.\n`,
    },
  ],
  INTF: [
    {
      name: 'minimal',
      description: 'Empty public interface',
      skeleton: (n) => `INTERFACE ${n} PUBLIC.\nENDINTERFACE.\n`,
    },
  ],
  PROG: [
    {
      name: 'report',
      description: 'Simple report',
      skeleton: (n) => `REPORT ${n}.\nWRITE: / 'Hello'.\n`,
    },
    {
      name: 'selection-screen',
      description: 'Report with a selection screen',
      skeleton: (n) => `REPORT ${n}.\nPARAMETERS: p_name TYPE string.\nSTART-OF-SELECTION.\n  WRITE: / p_name.\n`,
    },
    {
      name: 'report-alv',
      description: 'ALV list report with an explicit field catalog (cl_salv_table)',
      skeleton: (n) =>
        abapLines([
          `REPORT ${n}.`,
          '',
          ...ALV_TYPES,
          '',
          '*&-----------------------------------------------------------------',
          '*&                    Variables',
          '*&-----------------------------------------------------------------',
          'DATA gt_items TYPE tt_item.',
          '',
          '*&-----------------------------------------------------------------',
          '*&                    Start Of Selection',
          '*&-----------------------------------------------------------------',
          'START-OF-SELECTION.',
          '  PERFORM retrieve CHANGING gt_items.',
          '  PERFORM display USING gt_items.',
          '',
          ...ALV_RETRIEVE_FORM,
          '',
          ...ALV_DISPLAY_FORM,
        ]),
    },
    {
      name: 'report-alv-selection',
      description: 'ALV list report with a SELECT-OPTIONS / PARAMETERS selection screen',
      skeleton: (n) =>
        abapLines([
          `REPORT ${n}.`,
          '',
          ...ALV_TYPES,
          '',
          '*&-----------------------------------------------------------------',
          '*&                    Variables',
          '*&-----------------------------------------------------------------',
          'DATA gt_items TYPE tt_item.',
          '',
          '*&-----------------------------------------------------------------',
          '*&                    Select Screen',
          '*&-----------------------------------------------------------------',
          '* A bare frame is used because a TITLE needs a maintained text element',
          '* (SE38 -> Goto -> Text elements); add TITLE text-001 there if wanted.',
          'SELECTION-SCREEN BEGIN OF BLOCK b1 WITH FRAME.',
          'SELECT-OPTIONS: s_matnr FOR gt_items-matnr,',
          '                s_maktx FOR gt_items-maktx.',
          'PARAMETERS:     p_max TYPE i DEFAULT 100.',
          'SELECTION-SCREEN END OF BLOCK b1.',
          '',
          '*&-----------------------------------------------------------------',
          '*&                    Start Of Selection',
          '*&-----------------------------------------------------------------',
          'START-OF-SELECTION.',
          '  PERFORM retrieve CHANGING gt_items.',
          '  PERFORM restrict CHANGING gt_items.',
          '  PERFORM display USING gt_items.',
          '',
          ...ALV_RETRIEVE_FORM,
          '',
          '*&-----------------------------------------------------------------',
          '*& Form restrict',
          '*&-----------------------------------------------------------------',
          '*   <-- ct_items   Rows left after the selection screen restrictions',
          '*&-----------------------------------------------------------------',
          'FORM restrict CHANGING ct_items TYPE tt_item.',
          '',
          '* Apply the selection screen restrictions to the demo rows.',
          '  DELETE ct_items WHERE matnr NOT IN s_matnr',
          '                     OR maktx NOT IN s_maktx.',
          '',
          '* A limit of 0 keeps every row.',
          '  IF p_max > 0.',
          '    DELETE ct_items FROM p_max + 1.',
          '  ENDIF.',
          'ENDFORM.',
          '',
          ...ALV_DISPLAY_FORM,
        ]),
    },
  ],
  FUGR: [
    {
      name: 'minimal',
      description: 'Empty function pool',
      skeleton: (n) => `FUNCTION-POOL ${n}.\n`,
    },
  ],
};

/** Default skeleton (no --template) — matches the pre-existing per-type skeleton. */
export function defaultSkeleton(type: string, name: string): string {
  const list = TEMPLATES[type.toUpperCase()] ?? [];
  const minimal = list.find((t) => t.name === 'minimal');
  if (minimal) return minimal.skeleton(name);
  // Fallbacks for types without a registry entry.
  if (type.toUpperCase() === 'INTF') return `INTERFACE ${name} PUBLIC.\nENDINTERFACE.\n`;
  return `REPORT ${name}.\n`;
}

export function getTemplate(type: string, name: string): CreateTemplate | undefined {
  const list = TEMPLATES[type.toUpperCase()] ?? [];
  return list.find((t) => t.name === name);
}

export function listTemplates(type: string): CreateTemplate[] {
  return TEMPLATES[type.toUpperCase()] ?? [];
}
