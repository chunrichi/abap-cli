/**
 * DDLS (CDS view) local ↔ wire mapping.
 *
 * Local shape (AFF nested):
 *   { formatVersion, header, sourceOrigin, sourceType, parentName? }
 *
 * Companion file `<name>.ddls.acds` carries the raw DDL source string (the
 * `source/main` resource). The acds parser in `acds.ts` recognises 5 top-level
 * forms (viewEntity / projectionView / tableFunction / viewEntityExtend /
 * viewExtend).
 *
 * Wire body: the ADT metadata document at `/sap/bc/adt/ddic/ddl/sources/<name>`
 * — a `ddl:ddlSource` root whose header lives in attributes (shape verified
 * against a live S/4HANA system):
 *
 *   <ddl:ddlSource xmlns:ddl="http://www.sap.com/adt/ddic/ddlsources"
 *                  ddl:source_origin="0" ddl:source_type="view entity"
 *                  adtcore:name="ZMY_DDLS" adtcore:type="DDLS/DF"
 *                  adtcore:description="…" adtcore:masterLanguage="EN">
 *     <adtcore:packageRef adtcore:name="$TMP"/>
 *   </ddl:ddlSource>
 *
 * The source itself is fetched separately from `source/main`; create is
 * therefore "create header" + "write source" (see `clients/adt-client.ts`).
 */
import { defineJsonArtifact } from '../artifact.js';
import { detectSourceTypeFromDdl } from './acds.js';

export interface DdlsLocal {
  formatVersion: '1';
  header: { description: string; originalLanguage: string; abapLanguageVersion?: string };
  sourceOrigin?: string;
  sourceType: 'viewEntity' | 'viewEntityExtend' | 'projectionView' | 'tableFunction' | 'viewExtend' | 'ddicBasedView' | 'tableEntity' | 'abstractEntity' | 'customEntity' | 'hierarchy' | 'externalEntity' | 'unknown';
  parentName?: string;
  /** Path to the companion `.ddls.acds` file (caller-supplied; not serialised). */
  acds?: string;
}

/**
 * Canonical DDLS source-type set (per abap-file-format). 11 enum values
 * + the `'unknown'` fallback. Used by {@link enumOrDefault} to normalise
 * values returned from the wire (real SAP) and from local fixtures
 * before the AFF schema validator sees them.
 */
export const DDLS_SOURCE_TYPES: ReadonlySet<string> = new Set([
  'ddicBasedView',
  'viewEntity',
  'viewExtend',
  'viewEntityExtend',
  'tableFunction',
  'tableEntity',
  'abstractEntity',
  'customEntity',
  'hierarchy',
  'projectionView',
  'externalEntity',
  'unknown',
]);

/**
 * Canonical DDLS source-origin set (per abap-file-format). 10 enum values
 * defined by SAP, plus the `'abapDevelopmentTools'` default. Used by
 * {@link enumOrDefault} to fill missing or unrecognised values.
 */
export const DDLS_SOURCE_ORIGINS: ReadonlySet<string> = new Set([
  'abapDevelopmentTools',
  'customCdsViews',
  'customAnalyticalQueries',
  'customBusinessObject',
  'customCodeList',
  'customCdsViewsVariantConfg',
  'customFields',
  'extensionsForDataSources',
  'customSearchModeler',
  'serviceConsumptionModel',
]);

/**
 * Normalise an enum value against an allowed set, falling back to
 * `fallback` when the value is missing or unrecognised. Used by
 * {@link normaliseDdlsMetadata} so the `.ddls.json` always carries a
 * value the AFF schema validator accepts.
 */
export function enumOrDefault(
  value: string | undefined,
  allowed: ReadonlySet<string>,
  fallback: string,
): string {
  return value && allowed.has(value) ? value : fallback;
}

/** DDLS AFF artifact: file/schema plumbing only — the wire mapping is
 *  asymmetric (the source lives in the sibling `.acds` file). */
export const ddlsArtifact = defineJsonArtifact<DdlsLocal>({ type: 'DDLS' });

/** Read one attribute from the `ddl:ddlSource` root element. */
function rootAttribute(xml: string, name: string): string | undefined {
  return new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(xml)?.[1];
}

/** Camel-case an ADT human label: "view entity" → "viewEntity". */
function camelCaseLabel(label: string): string {
  const words = label.trim().toLowerCase().split(/[\s_-]+/).filter(Boolean);
  return words.map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))).join('');
}

/** Pull the DDL source out of the wire body and return both pieces.
 *
 *  `source` is the separate `source/main` body (the metadata document no longer
 *  inlines it); when omitted, the source type falls back to `ddl:source_type`
 *  and then to `'unknown'`.
 */
export function wireToLocal(xml: string, source?: string): { doc: DdlsLocal; source: string } {
  const description = rootAttribute(xml, 'adtcore:description') ?? '';
  const originalLanguage = (
    rootAttribute(xml, 'adtcore:masterLanguage') ??
    rootAttribute(xml, 'adtcore:language') ??
    'EN'
  ).toUpperCase();
  const originLabel = rootAttribute(xml, 'ddl:source_origin_description') ?? '';
  const sourceOrigin = enumOrDefault(camelCaseLabel(originLabel), DDLS_SOURCE_ORIGINS, 'abapDevelopmentTools');
  const typeLabel = rootAttribute(xml, 'ddl:source_type') ?? '';
  const declaredSourceType = enumOrDefault(camelCaseLabel(typeLabel), DDLS_SOURCE_TYPES, 'unknown');
  const sourceType = source ? detectSourceTypeFromDdl(source) : declaredSourceType;
  return {
    doc: normaliseDdlsMetadata({
      formatVersion: '1',
      header: { description, originalLanguage },
      sourceOrigin,
      sourceType: sourceType as DdlsLocal['sourceType'],
    }),
    source: source ?? '',
  };
}

/**
 * Normalise a {@link DdlsLocal} in place: sourceOrigin defaults to
 * `'abapDevelopmentTools'` and sourceType to `'unknown'` when the
 * value is missing or not in the canonical set. closes the gap
 * between real-SAP wire responses (which always carry a value) and
 * locally-edited fixtures (which may carry a typo or future enum).
 */
export function normaliseDdlsMetadata(doc: DdlsLocal): DdlsLocal {
  return {
    ...doc,
    sourceOrigin: enumOrDefault(doc.sourceOrigin, DDLS_SOURCE_ORIGINS, 'abapDevelopmentTools'),
    sourceType: enumOrDefault(doc.sourceType, DDLS_SOURCE_TYPES, 'unknown') as DdlsLocal['sourceType'],
  };
}
