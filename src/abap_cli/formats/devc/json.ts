/**
 * DEVC (package) local-file ↔ ADT wire mapping.
 *
 * Local file: `<name>.devc.json` — upstream `devc-v1.json`
 * (`formatVersion / header / generalInformation / useAccesses`).
 *
 * Wire: `GET /sap/bc/adt/packages/<name>` with
 * `Accept: application/vnd.sap.adt.packages.v2+xml`. Field provenance was
 * captured against a real S/4HANA system; see the comments on
 * {@link wireToLocal} for each attribute.
 *
 * Write side: only the create request body is modelled. Updating a package
 * via ADT is not possible (`PUT /sap/bc/adt/packages/<name>` answers
 * "Resource controller does not support method PUT"), so there is no
 * `localToWire` round-trip.
 */

/** AFF `devc-v1.json` shape (only the fields this CLI emits). */
export interface DevcLocal {
  formatVersion: '1';
  header: {
    description: string;
    originalLanguage: string;
  };
  generalInformation?: {
    type: 'development' | 'main' | 'structure';
    superPackage?: string;
    switch?: string;
    applicationComponent?: string;
    softwareComponent?: string;
    transportLayer?: string;
    supportsRecordChanges?: boolean;
    isAddingObjectsNotAllowed?: boolean;
    isEncapsulated?: boolean;
    defaultAbapLanguageVersion?: 'standard' | 'keyUser' | 'cloudDevelopment';
  };
  useAccesses?: Array<{
    packageInterface?: string;
    severity?: 'none' | 'information' | 'warning' | 'error' | 'obsolete';
  }>;
}

/** Inputs for the `POST /sap/bc/adt/packages` create body. */
export interface DevcCreateWireOptions {
  name: string;
  description: string;
  /** Super package (ADR `packagename` on the validation endpoint). */
  parentName: string;
  /** Software component (`pak:softwareComponent`), e.g. LOCAL / HOME / ZLOCAL. */
  softwareComponent: string;
  /** Transport layer; empty for local packages. */
  transportLayer: string;
  packageType: 'development' | 'main' | 'structure';
  /** Creating user (ADT `adtcore:responsible`). */
  responsible: string;
  language?: string;
  masterLanguage?: string;
}

type PackageType = 'development' | 'main' | 'structure';
type LanguageVersion = 'standard' | 'keyUser' | 'cloudDevelopment';
type Severity = 'none' | 'information' | 'warning' | 'error' | 'obsolete';

const PACKAGE_TYPES = new Set(['development', 'main', 'structure']);
const SEVERITIES = new Set(['none', 'information', 'warning', 'error', 'obsolete']);

/**
 * `pak:attributes/@pak:languageVersion` → AFF `defaultAbapLanguageVersion`.
 *
 * Value help `/sap/bc/adt/repository/informationsystem/abaplanguageversions`
 * maps the raw keys: `0` = Standard ABAP, `2` = ABAP for Key Users,
 * `5` = ABAP for Cloud Development. The empty string means "not set"
 * (AFF default `standard`), so it is omitted.
 */
const LANGUAGE_VERSION_MAP: Record<string, LanguageVersion> = {
  '0': 'standard',
  '2': 'keyUser',
  '5': 'cloudDevelopment',
};

/** Decode the XML entities SAP puts into attribute values. `&amp;` last. */
function decodeXmlText(value: string | undefined): string {
  if (!value) return '';
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

/** Read an attribute value from a tag's attribute fragment. */
function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`${name}="([^"]*)"`).exec(attrs);
  return m ? decodeXmlText(m[1]) : undefined;
}

/** Parse a `true`/`false` attribute; undefined when absent. */
function boolAttr(attrs: string, name: string): boolean | undefined {
  const raw = attr(attrs, name);
  if (raw === undefined) return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

/** Non-empty string or undefined. */
function text(value: string | undefined): string | undefined {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Map the ADT `pak:package` XML to the AFF `devc-v1.json` document.
 *
 * Attribute provenance (verified on S/4HANA 8.134):
 *   - `header.description`           ← root `adtcore:description`
 *   - `header.originalLanguage`      ← root `adtcore:masterLanguage` (lowercased)
 *   - `generalInformation.type`      ← `pak:attributes/@pak:packageType`
 *   - `generalInformation.superPackage` ← `pak:superPackage/@adtcore:name`
 *   - `generalInformation.switch`   ← `pak:switch/@adtcore:name`
 *   - `generalInformation.applicationComponent` ← `pak:applicationComponent/@pak:name`
 *   - `generalInformation.softwareComponent`    ← `pak:transport/pak:softwareComponent/@pak:name`
 *   - `generalInformation.transportLayer`       ← `pak:transport/pak:transportLayer/@pak:name`
 *   - `generalInformation.supportsRecordChanges` ← `pak:attributes/@pak:recordChanges`
 *   - `generalInformation.isAddingObjectsNotAllowed` ← inverse of `pak:attributes/@pak:isAddingObjectsAllowed`
 *   - `generalInformation.isEncapsulated`      ← `pak:attributes/@pak:isEncapsulated`
 *   - `generalInformation.defaultAbapLanguageVersion` ← `pak:attributes/@pak:languageVersion`
 *   - `useAccesses[]`                ← `pak:useAccesses/pak:useAccess` +
 *                                      `pak:packageInterfaceRef/@adtcore:name`
 */
export function wireToLocal(xml: string): DevcLocal {
  const rootMatch = /<pak:package\b([^>]*)>/.exec(xml);
  if (!rootMatch) {
    throw new Error('Not an ADT package response (missing <pak:package>)');
  }
  const rootAttrs = rootMatch[1] ?? '';

  const attributesMatch = /<pak:attributes\b([^>]*?)\/?>/.exec(xml);
  const attributesAttrs = attributesMatch?.[1] ?? '';

  const packageTypeRaw = (attr(attributesAttrs, 'pak:packageType') ?? 'development').toLowerCase();
  const packageType: PackageType = PACKAGE_TYPES.has(packageTypeRaw)
    ? (packageTypeRaw as PackageType)
    : 'development';

  const generalInformation: NonNullable<DevcLocal['generalInformation']> = { type: packageType };

  const superPackage = text(attr(/<pak:superPackage\b([^>]*?)\/?>/.exec(xml)?.[1] ?? '', 'adtcore:name'));
  if (superPackage) generalInformation.superPackage = superPackage;

  const switchName = text(attr(/<pak:switch\b([^>]*?)\/?>/.exec(xml)?.[1] ?? '', 'adtcore:name'));
  if (switchName) generalInformation.switch = switchName;

  const applicationComponent = text(
    attr(/<pak:applicationComponent\b([^>]*?)\/?>/.exec(xml)?.[1] ?? '', 'pak:name'),
  );
  if (applicationComponent) generalInformation.applicationComponent = applicationComponent;

  const transportMatch = /<pak:transport>([\s\S]*?)<\/pak:transport>/.exec(xml);
  const transportXml = transportMatch?.[1] ?? '';
  const softwareComponent = text(
    attr(/<pak:softwareComponent\b([^>]*?)\/?>/.exec(transportXml)?.[1] ?? '', 'pak:name'),
  );
  if (softwareComponent) generalInformation.softwareComponent = softwareComponent;
  const transportLayer = text(
    attr(/<pak:transportLayer\b([^>]*?)\/?>/.exec(transportXml)?.[1] ?? '', 'pak:name'),
  );
  if (transportLayer) generalInformation.transportLayer = transportLayer;

  const recordChanges = boolAttr(attributesAttrs, 'pak:recordChanges');
  if (recordChanges !== undefined) generalInformation.supportsRecordChanges = recordChanges;

  const addingAllowed = boolAttr(attributesAttrs, 'pak:isAddingObjectsAllowed');
  if (addingAllowed !== undefined) generalInformation.isAddingObjectsNotAllowed = !addingAllowed;

  const encapsulated = boolAttr(attributesAttrs, 'pak:isEncapsulated');
  if (encapsulated !== undefined) generalInformation.isEncapsulated = encapsulated;

  const languageVersion = LANGUAGE_VERSION_MAP[attributesAttrs ? attr(attributesAttrs, 'pak:languageVersion') ?? '' : ''];
  if (languageVersion) generalInformation.defaultAbapLanguageVersion = languageVersion;

  const doc: DevcLocal = {
    formatVersion: '1',
    header: {
      description: attr(rootAttrs, 'adtcore:description') ?? '',
      originalLanguage: (text(attr(rootAttrs, 'adtcore:masterLanguage')) ?? 'en').toLowerCase(),
    },
  };
  if (Object.keys(generalInformation).length > 0) doc.generalInformation = generalInformation;

  const useAccesses: NonNullable<DevcLocal['useAccesses']> = [];
  for (const match of xml.matchAll(/<pak:useAccess\b([^>]*)>([\s\S]*?)<\/pak:useAccess>/g)) {
    const useAccessAttrs = match[1] ?? '';
    const block = match[2] ?? '';
    const packageInterface = text(
      attr(/<pak:packageInterfaceRef\b([^>]*?)\/?>/.exec(block)?.[1] ?? '', 'adtcore:name'),
    );
    const severityRaw = (attr(useAccessAttrs, 'pak:severity') ?? '').toLowerCase();
    const severity = SEVERITIES.has(severityRaw) ? (severityRaw as Severity) : undefined;
    const entry: NonNullable<DevcLocal['useAccesses']>[number] = {};
    if (packageInterface) entry.packageInterface = packageInterface;
    if (severity) entry.severity = severity;
    if (Object.keys(entry).length > 0) useAccesses.push(entry);
  }
  if (useAccesses.length > 0) doc.useAccesses = useAccesses;

  return doc;
}

/** XML-attribute safe encoding (mirrors the client-side create helpers). */
function encodeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build the `POST /sap/bc/adt/packages` request body.
 *
 * Shape verified against a real S/4HANA system (201 Created) — the
 * `adtcore:packageRef` / `pak:superPackage` elements name the super package,
 * and `pak:transport` carries the software component + transport layer.
 */
export function buildCreateWire(opts: DevcCreateWireOptions): string {
  const language = opts.language ?? 'EN';
  const masterLanguage = opts.masterLanguage ?? language;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<pak:package xmlns:pak="http://www.sap.com/adt/packages"`,
    `             xmlns:adtcore="http://www.sap.com/adt/core"`,
    `             adtcore:description="${encodeAttr(opts.description)}"`,
    `             adtcore:name="${encodeAttr(opts.name)}"`,
    `             adtcore:type="DEVC/K"`,
    `             adtcore:version="active"`,
    `             adtcore:responsible="${encodeAttr(opts.responsible)}">`,
    `  <adtcore:packageRef adtcore:name="${encodeAttr(opts.parentName)}"/>`,
    `  <pak:attributes pak:packageType="${opts.packageType}"/>`,
    `  <pak:superPackage adtcore:name="${encodeAttr(opts.parentName)}"/>`,
    '  <pak:applicationComponent/>',
    '  <pak:transport>',
    `    <pak:softwareComponent pak:name="${encodeAttr(opts.softwareComponent)}"/>`,
    `    <pak:transportLayer pak:name="${encodeAttr(opts.transportLayer)}"/>`,
    '  </pak:transport>',
    '  <pak:translation/>',
    '  <pak:useAccesses/>',
    '  <pak:packageInterfaces/>',
    '  <pak:subPackages/>',
    '</pak:package>',
  ].join('\n');
}

/** True when a software component marks the package as local (never transported). */
export function isLocalSoftwareComponent(softwareComponent: string): boolean {
  return softwareComponent.trim().toUpperCase() === 'LOCAL';
}

/**
 * SAP requires LOCAL packages to start with `$` or `TEST`:
 * "Names of LOCAL packages must start with '$' or 'TEST'" — verified on the
 * `packages/validation` endpoint. Local pre-check so `create` fails before a
 * round-trip and the message matches SAP's wording.
 */
export function validateLocalPackageName(name: string): string | undefined {
  const upper = name.toUpperCase();
  if (upper.startsWith('$') || upper.startsWith('TEST')) return undefined;
  return "Names of LOCAL packages must start with '$' or 'TEST'";
}
