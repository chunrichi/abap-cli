/**
 * SUSO (authorization object, transaction SU21) — authorization-family document.
 *
 * One local JSON document maps the authorization object spread over `TOBJ`
 * (10 authorization fields, object class, FBLOCK/CONVERSION), `TOBJT` (short
 * text), `TACTZ` (permitted activities), `TOBJVORFLG` (SAP_NEW / SU22 trace /
 * criticality / CDS classification flags), `TOBJVOR` + `TOBJVORDAT` (per-release
 * SAP_NEW proposal data), `TOBJ_ATTR` (ABAP language version) and the DOKU
 * long text (id `UO`, object = authorization object name).
 *
 * Upstream SAP abap-file-formats has a `suso-v1.json`, but it cannot represent
 * the DOKU long text, the per-release SAP_NEW data (`TOBJVOR`/`TOBJVORDAT`),
 * `TOBJ-FBLOCK`/`CONVERSION`, and it requires cloud-only
 * `permittedActivities[].accessCategory` while lacking the third (unset)
 * criticality state of on-premise systems. The local `suso-v1.json` extension
 * therefore keeps the AFF section/enum names where they map exactly and adds
 * the missing data; the field mapping is documented in
 * `tmp/auth-family/designs/suso.md`.
 *
 * The name is the file token (`<token>.suso.json`, AFF `(ns)name` layout for
 * namespaced objects); the document carries neither name nor package — both are
 * read-side wire metadata that a pull strips.
 *
 * Wire: the bundled ICF service `GET/POST/PUT/DELETE /auth/suso/<name>`;
 * package, transport request and the SUSO-only `regenerateProfiles=true`
 * opt-in travel as query parameters and are owned by the generic family flows.
 */
import { defineWireArtifact } from '../artifact.js';
import { validateAff } from '../../aff/schema-validator.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { affObjectNameFromToken, affObjectToken } from '../file-resolver.js';
import type { AuthTypeSpec } from './spec.js';

/** XUOBJECT is CHAR 10 (plain `Z...` names and `/NS/NAME` namespaces). */
export const SUSO_NAME_MAX_LENGTH = 10;

/** XUOBJECT name: plain name or one `/NAMESPACE/NAME` pair, no interior spaces. */
const SUSO_NAME_PATTERN = /^(?:[A-Z0-9_]+|\/[A-Z0-9_]+\/[A-Z0-9_]+)$/;

/** AFF header language convention: two-letter ISO code (written lower case). */
const LANGUAGE_PATTERN = /^[A-Za-z]{2}$/;

/** TOBJT-TTEXT is CHAR 60. */
const DESCRIPTION_MAX_LENGTH = 60;

/** TOBJ-FBLOCK is CHAR 8. */
const FIELD_BLOCK_MAX_LENGTH = 8;

/** XUFIELD is CHAR 10. */
const FIELD_NAME_MAX_LENGTH = 10;

/** ACTIV_AUTH is CHAR 2. */
const ACTIVITY_LENGTH = 2;

/** DOCU lines are stored as DOKTL-DOKTEXT CHAR 72. */
const LONG_TEXT_LINE_MAX_LENGTH = 72;

export type SusoAbapLanguageVersion = 'standard' | 'keyUser' | 'cloudDevelopment';
export type SusoCriticality = 'critical' | 'notCritical' | 'notSpecified';
export type SusoCopyToDefaultData =
  | 'withoutRestriction'
  | 'ifInSameApplComponent'
  | 'ifInSameSoftwareComponent'
  | 'ifInSameSoftwarePackage'
  | 'notCopiedFromTraceData';
export type SusoOwnAuthContext = 'notSpecified' | 'notAllowed' | 'allowed' | 'inSameSoftwareComponent';
export type SusoPrivilegedBdefMode = 'notSpecified' | 'notAllowed' | 'allowed';

/** One TOBJ-FIELn entry (AUTHX-FIELDNAME). */
export interface SusoField {
  authorizationField: string;
}

/** One TACTZ activity (ACTIV_AUTH). */
export interface SusoActivity {
  activity: string;
}

/** One TOBJVORDAT line: per-release SAP_NEW proposal value. */
export interface SusoNewValue {
  /** SYSAPRL, e.g. "757". */
  release: string;
  /** LFDNR (CHAR 3, zero-padded on write). */
  lineNumber?: string;
  /** XUFIELD. */
  field?: string;
  /** XUVAL CHAR 40. */
  low?: string;
  /** XUVAL CHAR 40. */
  high?: string;
}

export interface SusoHeader {
  description: string;
  originalLanguage: string;
  abapLanguageVersion?: SusoAbapLanguageVersion;
}

export interface SusoGeneralInformation {
  objectClass: string;
  fieldBlock?: string;
  conversion?: boolean;
}

export interface SusoObjectAttributes {
  criticality?: SusoCriticality;
  classCopyToDefaultData?: SusoCopyToDefaultData;
}

export interface SusoSapNewRelevance {
  isRelevantToSapNew?: boolean;
  values?: SusoNewValue[];
}

export interface SusoClassificationForCdsBdef {
  usageInOwnAuthContext?: SusoOwnAuthContext;
  usageInPrivilegedBdefMode?: SusoPrivilegedBdefMode;
}

/** Local `<token>.suso.json` document. */
export interface SusoLocal {
  formatVersion: '1';
  header: SusoHeader;
  generalInformation: SusoGeneralInformation;
  authorizationFields: SusoField[];
  permittedActivities?: SusoActivity[];
  objectAttributes?: SusoObjectAttributes;
  sapNewRelevance?: SusoSapNewRelevance;
  classificationForCdsBdef?: SusoClassificationForCdsBdef;
  longText?: string;
}

/** GET response document: the local document plus read-side metadata. */
export interface SusoWire extends SusoLocal {
  name?: string;
  package?: string;
}

/** One SAP_NEW value as emitted by the ICF service (loose wire shape). */
interface SusoWireNewValue {
  release?: string;
  lineNumber?: string;
  field?: string;
  low?: string;
  high?: string;
}

/** Loose wire shape as emitted by the ICF service (`/ui2/cl_json` camelCase). */
interface SusoWireShape {
  formatVersion?: string;
  header?: {
    description?: string;
    originalLanguage?: string;
    abapLanguageVersion?: string;
  } | null;
  generalInformation?: {
    objectClass?: string;
    fieldBlock?: string;
    conversion?: boolean | string;
  } | null;
  authorizationFields?: Array<{ authorizationField?: string }> | null;
  permittedActivities?: Array<{ activity?: string }> | null;
  objectAttributes?: {
    criticality?: string;
    classCopyToDefaultData?: string;
  } | null;
  sapNewRelevance?: {
    isRelevantToSapNew?: boolean | string;
    values?: Array<{
      release?: string;
      lineNumber?: string;
      field?: string;
      low?: string;
      high?: string;
    }> | null;
  } | null;
  classificationForCdsBdef?: {
    usageInOwnAuthContext?: string;
    usageInPrivilegedBdefMode?: string;
  } | null;
  longText?: string;
  name?: string;
  package?: string;
}

const ABAP_LANGUAGE_VERSIONS: ReadonlyArray<SusoAbapLanguageVersion> = ['standard', 'keyUser', 'cloudDevelopment'];
const CRITICALITIES: ReadonlyArray<SusoCriticality> = ['critical', 'notCritical', 'notSpecified'];
const COPY_TO_DEFAULT_DATA: ReadonlyArray<SusoCopyToDefaultData> = [
  'withoutRestriction',
  'ifInSameApplComponent',
  'ifInSameSoftwareComponent',
  'ifInSameSoftwarePackage',
  'notCopiedFromTraceData',
];
const OWN_AUTH_CONTEXTS: ReadonlyArray<SusoOwnAuthContext> = ['notSpecified', 'notAllowed', 'allowed', 'inSameSoftwareComponent'];
const PRIVILEGED_BDEF_MODES: ReadonlyArray<SusoPrivilegedBdefMode> = ['notSpecified', 'notAllowed', 'allowed'];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asUpperText(value: unknown): string {
  return asText(value).toUpperCase();
}

/** `/ui2/cl_json` emits abap_bool as boolean; be tolerant to legacy "X" values. */
function asBool(value: unknown): boolean {
  return value === true || value === 'X' || value === 'x';
}

function pickEnum<T extends string>(value: unknown, allowed: ReadonlyArray<T>, fallback: T): T {
  const text = asText(value);
  return (allowed as ReadonlyArray<string>).includes(text) ? (text as T) : fallback;
}

/** DOKU long text lines joined with "\n" (each line ≤ 72 chars). */
function normalizeLongText(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value;
}

/**
 * GET wire → local document. Strips the read-side `name` / `package`, drops
 * empty/default optional sections (so pull → push → pull is stable) and
 * normalizes the camelCase wire text.
 */
export function susoFromWire(wire: SusoWireShape | undefined): SusoLocal {
  const header = asRecord(wire?.header) ?? {};
  const general = asRecord(wire?.generalInformation) ?? {};
  const attributes = asRecord(wire?.objectAttributes) ?? {};
  const sapNew = asRecord(wire?.sapNewRelevance) ?? {};
  const classification = asRecord(wire?.classificationForCdsBdef) ?? {};

  const local: SusoLocal = {
    formatVersion: '1',
    header: {
      description: asText(header.description),
      originalLanguage: asText(header.originalLanguage).toLowerCase() || 'en',
    },
    generalInformation: {
      objectClass: asUpperText(general.objectClass),
    },
    authorizationFields: (wire?.authorizationFields ?? []).map((entry) => ({
      authorizationField: asUpperText(entry?.authorizationField),
    })),
  };

  const abapLanguageVersion = pickEnum(header.abapLanguageVersion, ABAP_LANGUAGE_VERSIONS, 'standard');
  if (abapLanguageVersion !== 'standard') local.header.abapLanguageVersion = abapLanguageVersion;

  const fieldBlock = asUpperText(general.fieldBlock);
  if (fieldBlock) local.generalInformation.fieldBlock = fieldBlock;
  if (asBool(general.conversion)) local.generalInformation.conversion = true;

  const activities = (wire?.permittedActivities ?? [])
    .map((entry) => asUpperText(entry?.activity))
    .filter((activity) => activity.length > 0)
    .map((activity) => ({ activity }));
  if (activities.length > 0) local.permittedActivities = activities;

  const criticality = pickEnum(attributes.criticality, CRITICALITIES, 'notSpecified');
  const copyToDefaultData = pickEnum(attributes.classCopyToDefaultData, COPY_TO_DEFAULT_DATA, 'withoutRestriction');
  if (criticality !== 'notSpecified' || copyToDefaultData !== 'withoutRestriction') {
    local.objectAttributes = { criticality, classCopyToDefaultData: copyToDefaultData };
  }

  const sapNewValues = asArray<SusoWireNewValue>(sapNew.values).map((value) => {
    const entry: SusoNewValue = { release: asText(value?.release) };
    const lineNumber = asText(value?.lineNumber);
    const field = asUpperText(value?.field);
    const low = asText(value?.low);
    const high = asText(value?.high);
    if (lineNumber) entry.lineNumber = lineNumber;
    if (field) entry.field = field;
    if (low) entry.low = low;
    if (high) entry.high = high;
    return entry;
  });
  const isRelevantToSapNew = asBool(sapNew.isRelevantToSapNew);
  if (isRelevantToSapNew || sapNewValues.length > 0) {
    local.sapNewRelevance = { isRelevantToSapNew };
    if (sapNewValues.length > 0) local.sapNewRelevance.values = sapNewValues;
  }

  const ownAuthContext = pickEnum(classification.usageInOwnAuthContext, OWN_AUTH_CONTEXTS, 'notSpecified');
  const privilegedBdefMode = pickEnum(classification.usageInPrivilegedBdefMode, PRIVILEGED_BDEF_MODES, 'notSpecified');
  if (ownAuthContext !== 'notSpecified' || privilegedBdefMode !== 'notSpecified') {
    local.classificationForCdsBdef = { usageInOwnAuthContext: ownAuthContext, usageInPrivilegedBdefMode: privilegedBdefMode };
  }

  const longText = normalizeLongText(wire?.longText);
  if (longText !== undefined) {
    local.longText = longText;
  }

  return local;
}

/**
 * Local document → POST/PUT body. Emits every section with its default so the
 * SAP handler replaces the complete object state (PUT is a full-document
 * update; an absent/empty longText removes the documentation).
 */
export function susoToWire(local: SusoLocal): SusoWire {
  const header = local.header ?? ({} as SusoHeader);
  const general = local.generalInformation ?? ({} as SusoGeneralInformation);
  const attributes = local.objectAttributes ?? {};
  const sapNew = local.sapNewRelevance ?? {};
  const classification = local.classificationForCdsBdef ?? {};
  return {
    formatVersion: '1',
    header: {
      description: asText(header.description),
      originalLanguage: asText(header.originalLanguage).toLowerCase() || 'en',
      abapLanguageVersion: header.abapLanguageVersion ?? 'standard',
    },
    generalInformation: {
      objectClass: asUpperText(general.objectClass),
      fieldBlock: asUpperText(general.fieldBlock),
      conversion: general.conversion === true,
    },
    authorizationFields: (local.authorizationFields ?? []).map((entry) => ({
      authorizationField: asUpperText(entry?.authorizationField),
    })),
    permittedActivities: (local.permittedActivities ?? []).map((entry) => ({
      activity: asUpperText(entry?.activity),
    })),
    objectAttributes: {
      criticality: attributes.criticality ?? 'notSpecified',
      classCopyToDefaultData: attributes.classCopyToDefaultData ?? 'withoutRestriction',
    },
    sapNewRelevance: {
      isRelevantToSapNew: sapNew.isRelevantToSapNew === true,
      values: (sapNew.values ?? []).map((value) => ({
        release: asText(value?.release),
        lineNumber: asText(value?.lineNumber),
        field: asUpperText(value?.field),
        low: asText(value?.low),
        high: asText(value?.high),
      })),
    },
    classificationForCdsBdef: {
      usageInOwnAuthContext: classification.usageInOwnAuthContext ?? 'notSpecified',
      usageInPrivilegedBdefMode: classification.usageInPrivilegedBdefMode ?? 'notSpecified',
    },
    longText: typeof local.longText === 'string' ? local.longText : '',
  };
}

/** Semantic checks the JSON schema cannot express (SAP-side limits). */
export function validateSusoDocument(local: SusoLocal): string[] {
  const errors: string[] = [];
  const header = local?.header ?? ({} as SusoHeader);
  const general = local?.generalInformation ?? ({} as SusoGeneralInformation);

  const description = asText(header.description);
  if (!description) {
    errors.push('header.description is required');
  } else if (description.length > DESCRIPTION_MAX_LENGTH) {
    errors.push(`header.description is ${description.length} characters long; the SAP limit is ${DESCRIPTION_MAX_LENGTH}`);
  }
  const originalLanguage = asText(header.originalLanguage);
  if (!originalLanguage) {
    errors.push('header.originalLanguage is required (two-letter ISO code, e.g. "en")');
  } else if (!LANGUAGE_PATTERN.test(originalLanguage)) {
    errors.push(`header.originalLanguage "${originalLanguage}" is not a two-letter ISO language code`);
  }
  if (header.abapLanguageVersion !== undefined && !ABAP_LANGUAGE_VERSIONS.includes(header.abapLanguageVersion)) {
    errors.push(`header.abapLanguageVersion "${header.abapLanguageVersion}" must be standard, keyUser or cloudDevelopment`);
  }

  const objectClass = asUpperText(general.objectClass);
  if (!objectClass) {
    errors.push('generalInformation.objectClass is required');
  } else if (objectClass.length > 4) {
    // TOBJ-OCLSS is CHAR 4, but delivered values are stored unpadded and the
    // wire document therefore carries e.g. "AIF" instead of "AIF ".
    errors.push(`generalInformation.objectClass must be 1-4 characters (XUOBJCLASS), got "${objectClass}"`);
  }

  const fieldBlock = asUpperText(general.fieldBlock);
  if (fieldBlock.length > FIELD_BLOCK_MAX_LENGTH) {
    errors.push(`generalInformation.fieldBlock must not exceed ${FIELD_BLOCK_MAX_LENGTH} characters (TOBJ-FBLOCK)`);
  }

  const fields = local?.authorizationFields ?? [];
  if (fields.length === 0) {
    errors.push('authorizationFields must contain at least one field');
  } else if (fields.length > 10) {
    errors.push(`authorizationFields must not contain more than 10 fields (got ${fields.length})`);
  }
  const seenFields = new Set<string>();
  fields.forEach((entry, index) => {
    const field = asUpperText(entry?.authorizationField);
    if (!field) {
      errors.push(`authorizationFields[${index}].authorizationField is required`);
      return;
    }
    if (field.length > FIELD_NAME_MAX_LENGTH) {
      errors.push(`authorizationFields[${index}].authorizationField "${field}" exceeds ${FIELD_NAME_MAX_LENGTH} characters`);
    }
    if (seenFields.has(field)) {
      errors.push(`authorizationFields[${index}].authorizationField "${field}" is listed more than once`);
    }
    seenFields.add(field);
  });

  const activities = local?.permittedActivities ?? [];
  activities.forEach((entry, index) => {
    const activity = asUpperText(entry?.activity);
    if (activity.length !== ACTIVITY_LENGTH) {
      errors.push(`permittedActivities[${index}].activity must be a ${ACTIVITY_LENGTH}-character ACTIV_AUTH value`);
    }
  });
  if (activities.length > 0 && !seenFields.has('ACTVT')) {
    errors.push('permittedActivities requires ACTVT in authorizationFields');
  }

  const attributes = local?.objectAttributes ?? {};
  if (attributes.criticality !== undefined && !CRITICALITIES.includes(attributes.criticality)) {
    errors.push(`objectAttributes.criticality "${attributes.criticality}" is not supported`);
  }
  if (
    attributes.classCopyToDefaultData !== undefined &&
    !COPY_TO_DEFAULT_DATA.includes(attributes.classCopyToDefaultData)
  ) {
    errors.push(`objectAttributes.classCopyToDefaultData "${attributes.classCopyToDefaultData}" is not supported`);
  }

  const classification = local?.classificationForCdsBdef ?? {};
  if (
    classification.usageInOwnAuthContext !== undefined &&
    !OWN_AUTH_CONTEXTS.includes(classification.usageInOwnAuthContext)
  ) {
    errors.push(`classificationForCdsBdef.usageInOwnAuthContext "${classification.usageInOwnAuthContext}" is not supported`);
  }
  if (
    classification.usageInPrivilegedBdefMode !== undefined &&
    !PRIVILEGED_BDEF_MODES.includes(classification.usageInPrivilegedBdefMode)
  ) {
    errors.push(`classificationForCdsBdef.usageInPrivilegedBdefMode "${classification.usageInPrivilegedBdefMode}" is not supported`);
  }

  const sapNew = local?.sapNewRelevance ?? {};
  const sapNewValues = sapNew.values ?? [];
  if (sapNew.isRelevantToSapNew === true && sapNewValues.length === 0) {
    errors.push('sapNewRelevance.values is required when isRelevantToSapNew is true');
  }
  sapNewValues.forEach((value, index) => {
    const release = asText(value?.release);
    if (!release || release.length > 4) {
      errors.push(`sapNewRelevance.values[${index}].release must be 1-4 characters (SYSAPRL)`);
    }
    const lineNumber = asText(value?.lineNumber);
    if (lineNumber.length > 3) {
      errors.push(`sapNewRelevance.values[${index}].lineNumber must not exceed 3 characters`);
    }
    const field = asUpperText(value?.field);
    if (field.length > FIELD_NAME_MAX_LENGTH) {
      errors.push(`sapNewRelevance.values[${index}].field must not exceed ${FIELD_NAME_MAX_LENGTH} characters`);
    }
    if (asText(value?.low).length > 40 || asText(value?.high).length > 40) {
      errors.push(`sapNewRelevance.values[${index}].low/high must not exceed 40 characters (XUVAL)`);
    }
  });

  if (typeof local?.longText === 'string' && local.longText.length > 0) {
    const lines = local.longText.split('\n');
    lines.forEach((line, index) => {
      if (line.length > LONG_TEXT_LINE_MAX_LENGTH) {
        errors.push(
          `longText line ${index + 1} is ${line.length} characters long; DOCU long-text lines are ${LONG_TEXT_LINE_MAX_LENGTH} characters`,
        );
      }
    });
  }

  return errors;
}

/** SUSO artifact: file/schema plumbing + local ↔ ICF wire mapping. */
export const susoArtifact = defineWireArtifact<SusoLocal, SusoWire>({
  type: 'SUSO',
  toWire: (local) => susoToWire(local),
  fromWire: (wire) => susoFromWire(wire as SusoWireShape),
  validate: async (doc) => {
    const result = await validateAff('SUSO', doc);
    const schemaErrors =
      result.status === 'pass' || result.status === 'warn'
        ? []
        : result.errors.map((error) => `${error.instancePath || '/'}: ${error.message ?? ''}`);
    return [...schemaErrors, ...validateSusoDocument(doc as SusoLocal)];
  },
});

/** Normalize + validate one SUSO object name (CLI argument or route segment). */
export function normalizeSusoName(raw: string): string {
  const name = (raw ?? '').trim().toUpperCase();
  if (name.length === 0 || name.length > SUSO_NAME_MAX_LENGTH || !SUSO_NAME_PATTERN.test(name)) {
    throw new CliError('SUSO_NAME_INVALID' as ErrorCode, `SUSO name "${raw}" is invalid`, {
      type: 'SUSO',
      nextSteps: [
        `Use 1-${SUSO_NAME_MAX_LENGTH} characters A-Z, 0-9, _ or '/' (XUOBJECT), e.g. ZCLI_SUSO1 or /AIF/CDLOG.`,
        'The SAP limit applies to the complete name including namespace slashes.',
      ],
      example: 'abap create SUSO ZCLI_SUSO1 --package $TMP --file src/zcli_suso1.suso.json',
    });
  }
  return name;
}

/** SUSO object name → `<token>.suso.json` filename token (AFF `(ns)name` form). */
export function susoFileToken(name: string): string {
  return affObjectToken(name);
}

/** `<token>.suso.json` filename token → SUSO object name (AFF `(ns)name` form). */
export function susoNameFromToken(token: string, basename?: string): string {
  const name = affObjectNameFromToken(token, basename).toUpperCase();
  if (name.length === 0 || name.length > SUSO_NAME_MAX_LENGTH || !SUSO_NAME_PATTERN.test(name)) {
    throw new CliError('FILE_PARSE_ERROR', `${basename ?? token} does not encode a valid SUSO object name`, {
      file: basename ?? token,
      nextSteps: ['The file name token must be the AFF `(ns)name` form or the lower-case object name.'],
      example: 'abap pull ZCLI_SUSO1 --type SUSO',
    });
  }
  return name;
}

/** Minimal valid document for `abap create --schema SUSO`. */
export function susoExample(): SusoLocal {
  return {
    formatVersion: '1',
    header: {
      description: 'CLI test authorization object',
      originalLanguage: 'en',
    },
    generalInformation: { objectClass: 'AAAT' },
    authorizationFields: [{ authorizationField: 'ACTVT' }],
    permittedActivities: [{ activity: '03' }],
  };
}

export const susoSpec: AuthTypeSpec<SusoLocal> = {
  type: 'SUSO',
  route: 'suso',
  tadirObject: 'SUSO',
  schemaFile: 'suso-v1.json',
  description: 'Authorization object (SU21)',
  nameMaxLength: SUSO_NAME_MAX_LENGTH,
  artifact: susoArtifact,
  normalizeName: normalizeSusoName,
  fileToken: susoFileToken,
  nameFromToken: (token, basename) => susoNameFromToken(token, basename),
  validateDocument: validateSusoDocument,
  example: susoExample,
};
