/**
 * BDEF (behavior definition) ADT wire helpers.
 *
 * BDEF is a blue-source object: the blueSource create body is not part of
 * `abap-adt-api`'s `CreatableTypeIds`, so the CLI posts it directly (same
 * approach as `create-object.ts` for CLAS / INTF / PROG / FUGR).
 *
 * Shape verified against S/4HANA: a minimal
 * `blue:blueSource` root with the `adtcore` header + `packageRef` is accepted
 * by `POST /sap/bc/adt/bo/behaviordefinitions` (HTTP 201). The `.bdef.abdl`
 * source is written afterwards through `source/main`.
 */

/** ADT media type of a blue-source object (BDEF). */
export const BDEF_MEDIA_TYPE = 'application/vnd.sap.adt.blues.v1+xml';

/** ADT collection for behavior definitions. */
export const BDEF_BASE_PATH = '/sap/bc/adt/bo/behaviordefinitions';

/** Per-object URL; namespaced names are percent-encoded (`/NS/X` → `%2fns%2fx`). */
export function bdefObjectUrl(name: string): string {
  return `${BDEF_BASE_PATH}/${encodeURIComponent(name.toLowerCase())}`;
}

export interface BdefCreateOptions {
  name: string;
  packageName: string;
  description: string;
  /** Original language of the object; falls back to the logon language. */
  originalLanguage?: string;
  /** Language used for the description attribute (SAP requires the logon language). */
  language?: string;
}

/** XML-attribute safe encoding. */
function encodeAttr(value: string | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build the minimal blueSource body accepted by the BDEF create endpoint. */
export function buildBdefCreateBody(options: BdefCreateOptions): string {
  const language = options.language ?? 'EN';
  const masterLanguage = options.originalLanguage ?? language;
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<blue:blueSource' +
    ' xmlns:blue="http://www.sap.com/wbobj/blue"' +
    ' xmlns:adtcore="http://www.sap.com/adt/core"' +
    ' xmlns:abapsource="http://www.sap.com/adt/abapsource"' +
    ` adtcore:name="${encodeAttr(options.name)}"` +
    ' adtcore:type="BDEF/BDO"' +
    ` adtcore:description="${encodeAttr(options.description)}"` +
    ` adtcore:language="${encodeAttr(language)}"` +
    ` adtcore:masterLanguage="${encodeAttr(masterLanguage)}">` +
    `<adtcore:packageRef adtcore:name="${encodeAttr(options.packageName)}"/>` +
    '</blue:blueSource>'
  );
}
