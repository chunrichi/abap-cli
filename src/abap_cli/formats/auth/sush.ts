/**
 * SUSH (SU22 authorization default assignment) — authorization-family document.
 *
 * One SU22 application is identified by a key `<NAME CHAR30, TYPE CHAR2>` where
 * `TYPE` is `TR` (transaction), `RF` (RFC function module), `HT` (TADIR-based
 * service) or `HS` (external service). The local file is one JSON document in
 * the upstream AFF `sush-v1.json` shape — reused as-is, no local schema
 * extension:
 *
 *   - `generalInformation.applicationType` / `.applicationName` carry the
 *     leading application: `FUNC` (RF), `TRAN` (TR), the leading TADIR object
 *     type (HT) or the `EXT_SERVICE` service type (HS), plus its name;
 *   - `generalInformation.maintenanceMode` is `USOB_SM-OKFLAG`
 *     (manual/automatic/automaticBasisObjects/noDefaultValues/deprecated/obsolete);
 *   - `authorizationObjects[].maintenanceStatus` is `USOBX-OKFLAG`
 *     (undefined/noDefault/defaultWithValues/defaultWithoutValues/inactiveValues/
 *     noAuthorizationCheck) and `authObjectFieldValues` are the `USOBT` rows.
 *
 * Canonical object name: `<NAME>.<TYPE>` (the dot only separates the key parts,
 * SU22 names never contain a dot; `/NS/NAME` namespaces stay intact). The file
 * token is the lower-case name plus the lower-case type after a final `_`
 * (`zcli_tc_sush_fm_rf.sush.json`, `(accgo)mtm_build_rf.sush.json`) — no dot, so
 * the generic `abap push` filename routing still reads `.sush.json` as the type
 * suffix and the last `_XX` parses back unambiguously.
 *
 * Wire: `GET/POST/PUT/DELETE /auth/sush/<name>` of the bundled ICF service; the
 * package and transport request travel as query parameters and the write body
 * is the document itself. `name` / `package` in the GET response are read-side
 * metadata and are stripped before the local file is written.
 */
import { defineWireArtifact } from '../artifact.js';
import { validateAff } from '../../aff/schema-validator.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import type { AuthTypeSpec } from './spec.js';

/** USOBHASH-NAME: CHAR 30, upper-case program/transaction/function name. */
export const SUSH_APP_NAME_MAX_LENGTH = 30;

/** Canonical CLI name `<NAME>.<TYPE>`: 30 + '.' + 2. */
export const SUSH_NAME_MAX_LENGTH = SUSH_APP_NAME_MAX_LENGTH + 3;

/** SU22 key types (`USOBHASH-TYPE`). */
export const SUSH_KEY_TYPES = ['TR', 'RF', 'HT', 'HS'] as const;
export type SushKeyType = (typeof SUSH_KEY_TYPES)[number];

/** AFF `generalInformation.maintenanceMode` values (USOB_SM-OKFLAG). */
export const SUSH_MAINTENANCE_MODES = [
  'manual',
  'automatic',
  'automaticBasisObjects',
  'noDefaultValues',
  'deprecated',
  'obsolete',
] as const;
export type SushMaintenanceMode = (typeof SUSH_MAINTENANCE_MODES)[number];

/** AFF `authorizationObjects[].maintenanceStatus` values (USOBX-OKFLAG). */
export const SUSH_MAINTENANCE_STATUSES = [
  'undefined',
  'noDefault',
  'defaultWithValues',
  'defaultWithoutValues',
  'inactiveValues',
  'noAuthorizationCheck',
] as const;
export type SushMaintenanceStatus = (typeof SUSH_MAINTENANCE_STATUSES)[number];

/** AFF `header.abapLanguageVersion` values (USOB_SM-ABAP_LANGUAGE_VERSION). */
export const SUSH_ABAP_LANGUAGE_VERSIONS = ['standard', 'cloudDevelopment'] as const;
export type SushAbapLanguageVersion = (typeof SUSH_ABAP_LANGUAGE_VERSIONS)[number];

/** Plain names or one well-formed `/NAMESPACE/NAME` pair, upper case. */
const SUSH_OBJECT_NAME_PATTERN = /^(?:[A-Z0-9_]+|\/[A-Z0-9_]+\/[A-Z0-9_]+)$/;
const SUSH_FIELD_NAME_PATTERN = /^[A-Z0-9_/]+$/;

export interface SushHeader {
  /** AFF header description (up to 60 characters); informational only. */
  description: string;
  /** AFF original language (two-letter ISO, lower case). */
  originalLanguage: string;
  /** USOB_SM-ABAP_LANGUAGE_VERSION; omitted for standard ABAP. */
  abapLanguageVersion?: SushAbapLanguageVersion;
}

export interface SushGeneralInformation {
  /** Leading application name: function module / transaction / TADIR obj_name / service path. */
  applicationName: string;
  /** Leading application type: FUNC / TRAN / TADIR object type / EXT_SERVICE type. */
  applicationType: string;
  /** USOB_SM-OKFLAG; `manual` when not maintained. */
  maintenanceMode: SushMaintenanceMode;
  /** AFF cloud-only flag; always `yes` on-premise. */
  defaultValuesRequired: 'yes' | 'no';
  /** AFF cloud-only documentation; not stored on-premise. */
  documentation?: string;
}

export interface SushFieldValue {
  authFieldName: string;
  authFieldLowValue?: string;
  authFieldHighValue?: string;
}

export interface SushAuthorizationObject {
  authObjectName: string;
  maintenanceStatus: SushMaintenanceStatus;
  documentation?: string;
  authObjectFieldValues?: SushFieldValue[];
}

/** Local `<token>.sush.json` document (AFF `sush-v1.json`). */
export interface SushLocal {
  formatVersion: '1';
  header: SushHeader;
  generalInformation: SushGeneralInformation;
  authorizationObjects?: SushAuthorizationObject[];
}

/** GET response document: the local document plus read-side metadata. */
export interface SushWire extends SushLocal {
  name?: string;
  package?: string;
}

/** Loose shape of the ICF wire document (CHAR fields may serialize as ''). */
interface SushWireShape {
  formatVersion?: string;
  header?: { description?: string; originalLanguage?: string; abapLanguageVersion?: string } | null;
  generalInformation?: {
    applicationName?: string;
    applicationType?: string;
    maintenanceMode?: string;
    defaultValuesRequired?: string;
    documentation?: string;
  } | null;
  authorizationObjects?: Array<{
    authObjectName?: string;
    maintenanceStatus?: string;
    documentation?: string;
    authObjectFieldValues?: Array<{
      authFieldName?: string;
      authFieldLowValue?: string;
      authFieldHighValue?: string;
    }> | null;
  }> | null;
  name?: string;
  package?: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isMaintenanceMode(value: string): value is SushMaintenanceMode {
  return (SUSH_MAINTENANCE_MODES as readonly string[]).includes(value);
}

function isMaintenanceStatus(value: string): value is SushMaintenanceStatus {
  return (SUSH_MAINTENANCE_STATUSES as readonly string[]).includes(value);
}

function isAbapLanguageVersion(value: string): value is SushAbapLanguageVersion {
  return (SUSH_ABAP_LANGUAGE_VERSIONS as readonly string[]).includes(value);
}

/** True when the application type denotes a `RF` (`FUNC`) or `TR` (`TRAN`) app. */
export function sushKeyTypeOfApplicationType(applicationType: string): SushKeyType | undefined {
  const type = text(applicationType).toUpperCase();
  if (type === 'FUNC') return 'RF';
  if (type === 'TRAN') return 'TR';
  return undefined;
}

/**
 * Wire → local document: strip the read-side `name` / `package` pair, default
 * the optional AFF fields and drop empty values so pull → push → pull is stable.
 */
export function sushFromWire(wire: unknown): SushLocal {
  const shape = (wire ?? {}) as SushWireShape;
  const header = shape.header ?? {};
  const general = shape.generalInformation ?? {};

  const local: SushLocal = {
    formatVersion: '1',
    header: {
      description: text(header.description),
      originalLanguage: text(header.originalLanguage).toLowerCase() || 'en',
    },
    generalInformation: {
      applicationName: text(general.applicationName),
      applicationType: text(general.applicationType).toUpperCase(),
      maintenanceMode: isMaintenanceMode(text(general.maintenanceMode))
        ? (text(general.maintenanceMode) as SushMaintenanceMode)
        : 'manual',
      defaultValuesRequired: text(general.defaultValuesRequired).toLowerCase() === 'no' ? 'no' : 'yes',
    },
  };

  const abapLanguageVersion = text(header.abapLanguageVersion);
  if (isAbapLanguageVersion(abapLanguageVersion) && abapLanguageVersion !== 'standard') {
    local.header.abapLanguageVersion = abapLanguageVersion;
  }

  const authorizationObjects: SushAuthorizationObject[] = [];
  for (const object of shape.authorizationObjects ?? []) {
    const authObjectName = text(object?.authObjectName).toUpperCase();
    if (!authObjectName) continue;
    const maintenanceStatus = text(object?.maintenanceStatus);
    const localObject: SushAuthorizationObject = {
      authObjectName,
      maintenanceStatus: isMaintenanceStatus(maintenanceStatus) ? maintenanceStatus : 'defaultWithValues',
    };
    const fieldValues: SushFieldValue[] = [];
    for (const value of object?.authObjectFieldValues ?? []) {
      const authFieldName = text(value?.authFieldName).toUpperCase();
      if (!authFieldName) continue;
      const fieldValue: SushFieldValue = { authFieldName };
      const low = text(value?.authFieldLowValue);
      const high = text(value?.authFieldHighValue);
      if (low) fieldValue.authFieldLowValue = low;
      if (high) fieldValue.authFieldHighValue = high;
      fieldValues.push(fieldValue);
    }
    if (fieldValues.length > 0) localObject.authObjectFieldValues = fieldValues;
    authorizationObjects.push(localObject);
  }
  if (authorizationObjects.length > 0) local.authorizationObjects = authorizationObjects;

  return local;
}

/** Local document → POST/PUT body (full AFF document, required fields filled). */
export function sushToWire(local: SushLocal): SushWire {
  const header = local.header ?? ({} as SushHeader);
  const general = local.generalInformation ?? ({} as SushGeneralInformation);
  const applicationType = text(general.applicationType).toUpperCase();
  const applicationName = text(general.applicationName);
  const description = text(header.description).slice(0, 60) || `R3TR ${applicationType} ${applicationName}`.trim();

  const wire: SushWire = {
    formatVersion: '1',
    header: {
      description,
      originalLanguage: text(header.originalLanguage).toLowerCase() || 'en',
    },
    generalInformation: {
      applicationName,
      applicationType,
      maintenanceMode: isMaintenanceMode(text(general.maintenanceMode))
        ? (text(general.maintenanceMode) as SushMaintenanceMode)
        : 'manual',
      defaultValuesRequired: text(general.defaultValuesRequired).toLowerCase() === 'no' ? 'no' : 'yes',
    },
  };
  const abapLanguageVersion = text(header.abapLanguageVersion);
  if (isAbapLanguageVersion(abapLanguageVersion) && abapLanguageVersion !== 'standard') {
    wire.header.abapLanguageVersion = abapLanguageVersion;
  }

  const authorizationObjects = local.authorizationObjects ?? [];
  wire.authorizationObjects = authorizationObjects.map((object) => {
    const maintenanceStatus = text(object.maintenanceStatus);
    const wireObject: SushAuthorizationObject = {
      authObjectName: text(object.authObjectName).toUpperCase(),
      maintenanceStatus: isMaintenanceStatus(maintenanceStatus) ? maintenanceStatus : 'defaultWithValues',
    };
    const fieldValues = object.authObjectFieldValues ?? [];
    wireObject.authObjectFieldValues = fieldValues.map((value) => {
      const wireValue: SushFieldValue = { authFieldName: text(value.authFieldName).toUpperCase() };
      const low = text(value.authFieldLowValue);
      const high = text(value.authFieldHighValue);
      if (low) wireValue.authFieldLowValue = low;
      if (high) wireValue.authFieldHighValue = high;
      return wireValue;
    });
    return wireObject;
  });

  return wire;
}

/**
 * Semantic checks the AFF schema cannot express: SAP naming for the leading
 * object, enum membership (clearer than the raw schema error), duplicate
 * authorization objects / field values.
 */
export function validateSushDocument(local: SushLocal): string[] {
  const errors: string[] = [];
  const header = local?.header ?? ({} as SushHeader);
  const general = local?.generalInformation ?? ({} as SushGeneralInformation);

  if (local?.formatVersion !== '1') {
    errors.push(`formatVersion must be '1' (got '${String(local?.formatVersion)}')`);
  }
  if (!header.originalLanguage || header.originalLanguage.trim().length < 2) {
    errors.push('header.originalLanguage must be a two-letter language code');
  }
  if (text(header.abapLanguageVersion) && !isAbapLanguageVersion(text(header.abapLanguageVersion))) {
    errors.push(`header.abapLanguageVersion "${header.abapLanguageVersion}" is not standard or cloudDevelopment`);
  }

  const applicationName = text(general.applicationName);
  const applicationType = text(general.applicationType).toUpperCase();
  if (!applicationName) {
    errors.push('generalInformation.applicationName is required');
  } else if (applicationName.length > 132) {
    errors.push('generalInformation.applicationName is longer than 132 characters');
  }
  if (!applicationType) {
    errors.push('generalInformation.applicationType is required');
  } else if (applicationType.length > 80) {
    errors.push('generalInformation.applicationType is longer than 80 characters');
  }
  const keyType = sushKeyTypeOfApplicationType(applicationType);
  if (
    keyType &&
    (applicationName.length > SUSH_APP_NAME_MAX_LENGTH || !SUSH_OBJECT_NAME_PATTERN.test(applicationName.toUpperCase()))
  ) {
    errors.push(`generalInformation.applicationName "${applicationName}" is not a valid ${keyType} object name`);
  }
  if (text(general.maintenanceMode) && !isMaintenanceMode(text(general.maintenanceMode))) {
    errors.push(`generalInformation.maintenanceMode "${general.maintenanceMode}" is not a supported AFF value`);
  }
  if (text(general.defaultValuesRequired) && !['yes', 'no'].includes(text(general.defaultValuesRequired).toLowerCase())) {
    errors.push(`generalInformation.defaultValuesRequired "${general.defaultValuesRequired}" is not yes or no`);
  }

  const seenObjects = new Set<string>();
  for (const object of local?.authorizationObjects ?? []) {
    const objectName = text(object?.authObjectName).toUpperCase();
    if (!objectName) {
      errors.push('authorizationObjects[].authObjectName is required');
      continue;
    }
    if (objectName.length > 10 || !SUSH_FIELD_NAME_PATTERN.test(objectName)) {
      errors.push(`authorization object "${object.authObjectName}" is not a valid authorization object name`);
    }
    if (seenObjects.has(objectName)) {
      errors.push(`duplicate authorization object "${objectName}"`);
    }
    seenObjects.add(objectName);
    if (text(object?.maintenanceStatus) && !isMaintenanceStatus(text(object.maintenanceStatus))) {
      errors.push(`authorization object "${objectName}" has an unsupported maintenanceStatus "${object.maintenanceStatus}"`);
    }
    const seenValues = new Set<string>();
    for (const value of object?.authObjectFieldValues ?? []) {
      const fieldName = text(value?.authFieldName).toUpperCase();
      if (!fieldName) {
        errors.push(`authorization object "${objectName}" has a field value without authFieldName`);
        continue;
      }
      if (fieldName.length > 10 || !SUSH_FIELD_NAME_PATTERN.test(fieldName)) {
        errors.push(`authorization field "${value.authFieldName}" of "${objectName}" is not a valid field name`);
      }
      const low = text(value?.authFieldLowValue);
      const high = text(value?.authFieldHighValue);
      if (low.length > 40 || high.length > 40) {
        errors.push(`field value of "${objectName}/${fieldName}" is longer than 40 characters`);
      }
      const dedupeKey = `${fieldName}\u0000${low}`;
      if (seenValues.has(dedupeKey)) {
        errors.push(`duplicate field value "${objectName}/${fieldName}" with low value "${low}"`);
      }
      seenValues.add(dedupeKey);
    }
  }

  return errors;
}

/** AFF schema + semantic validation for the SUSH artifact. */
export const sushArtifact = defineWireArtifact<SushLocal, SushWire>({
  type: 'SUSH',
  toWire: (local) => sushToWire(local),
  fromWire: (wire) => sushFromWire(wire),
  validate: async (doc) => {
    const result = await validateAff('SUSH', doc);
    const schemaErrors =
      result.status === 'pass' || result.status === 'warn'
        ? []
        : result.errors.map((error) => `${error.instancePath || '/'}: ${error.message ?? ''}`);
    return [...schemaErrors, ...validateSushDocument(doc as SushLocal)];
  },
});

function nameError(raw: string, reason: string): CliError {
  return new CliError('SUSH_NAME_INVALID' as ErrorCode, `SUSH name "${raw}" is invalid: ${reason}`, {
    type: 'SUSH',
    nextSteps: [
      'Use the canonical form <NAME>.<TYPE>, e.g. ZCLI_TC_SUSH_FM.RF or OCS_GET_INSTALLED_COMPS.RF.',
      `NAME is 1-${SUSH_APP_NAME_MAX_LENGTH} characters A-Z, 0-9, _ or a /NS/NAME namespace; TYPE is TR, RF, HT or HS.`,
    ],
    example: 'abap pull OCS_GET_INSTALLED_COMPS.RF --type SUSH',
  });
}

/** Split a canonical `<NAME>.<TYPE>` name; returns undefined for non-canonical input. */
export function splitSushName(name: string): { appName: string; type: SushKeyType } | undefined {
  const value = (name ?? '').trim().toUpperCase();
  const dot = value.lastIndexOf('.');
  if (dot <= 0 || dot >= value.length - 1) return undefined;
  const appName = value.slice(0, dot);
  const type = value.slice(dot + 1) as SushKeyType;
  if (!(SUSH_KEY_TYPES as readonly string[]).includes(type)) return undefined;
  return { appName, type };
}

/**
 * Normalize + validate one SUSH object name. Accepts the canonical
 * `<NAME>.<TYPE>`, the raw 32-character TADIR composite
 * (`<NAME padded to 30><TYPE>`) and the `<NAME> <TYPE>` alias.
 */
export function normalizeSushName(raw: string): string {
  const value = (raw ?? '').trim().toUpperCase();
  if (!value) throw nameError(raw, 'the name is empty');

  let appName = '';
  let type = '';
  const canonical = splitSushName(value);
  if (canonical) {
    appName = canonical.appName;
    type = canonical.type;
  } else if (value.length === 32) {
    appName = value.slice(0, SUSH_APP_NAME_MAX_LENGTH).trimEnd();
    type = value.slice(SUSH_APP_NAME_MAX_LENGTH);
  } else {
    const space = value.indexOf(' ');
    if (space > 0) {
      appName = value.slice(0, space).trim();
      type = value.slice(space + 1).trim();
    }
  }

  if (!appName || !type) {
    throw nameError(
      raw,
      'expected <NAME>.<TYPE> (e.g. ZCLI_TC_SUSH_FM.RF), the raw 32-character TADIR name, or "<NAME> <TYPE>"',
    );
  }
  if (appName.length > SUSH_APP_NAME_MAX_LENGTH || !SUSH_OBJECT_NAME_PATTERN.test(appName)) {
    throw nameError(
      raw,
      `"${appName}" must be 1-${SUSH_APP_NAME_MAX_LENGTH} characters A-Z, 0-9, _ or a /NS/NAME namespace (SU22 names contain no dot, space or dash)`,
    );
  }
  if (!(SUSH_KEY_TYPES as readonly string[]).includes(type)) {
    throw nameError(raw, `type "${type}" is not supported (TR, RF, HT or HS)`);
  }
  return `${appName}.${type}`;
}

/** SAP object name → SUSH filename token (`(ns)rest_type`, no dot). */
export function sushFileToken(name: string): string {
  const current = normalizeSushName(name);
  const split = splitSushName(current)!;
  const lower = split.appName.toLowerCase();
  const namespaced = /^\/([^/]+)\/([^/]+)$/.exec(lower);
  const tokenName = namespaced ? `(${namespaced[1]!})${namespaced[2]!}` : lower;
  return `${tokenName}_${split.type.toLowerCase()}`;
}

/** SUSH filename token → canonical object name (reverse of {@link sushFileToken}). */
export function sushNameFromToken(token: string, basename?: string): string {
  const display = basename ?? token;
  const raw = (token ?? '').trim();
  if (raw.startsWith('#')) {
    throw new CliError(
      'FILE_PARSE_ERROR',
      `${display} uses the retired '#' namespace token; abap-file-format names use '(...)'`,
      {
        file: display,
        nextSteps: ['Re-run `abap pull <NAME>.<TYPE> --type SUSH` to write the AFF-style file name.'],
        example: 'abap pull ZCLI_TC_SUSH_FM.RF --type SUSH',
      },
    );
  }
  if (!raw) {
    throw new CliError('FILE_PARSE_ERROR', `${display} does not carry a SUSH object name`, { file: display });
  }

  let value = raw.toUpperCase();
  const namespaced = /^\(([^)]+)\)(.+)$/.exec(value);
  if (namespaced) value = `/${namespaced[1]!}/${namespaced[2]!}`;
  value = value.replace(/~/g, '/');

  const parsed = /^(.*)_([A-Z]{2})$/.exec(value);
  if (!parsed || !parsed[1]) {
    throw new CliError('FILE_PARSE_ERROR', `${display} does not encode a SUSH object name`, {
      file: display,
      nextSteps: [
        'SUSH file names are <name>_<type>.sush.json, e.g. zcli_tc_sush_fm_rf.sush.json ((accgo)fm_rf.sush.json for namespaced names).',
        'Re-run `abap pull <NAME>.<TYPE> --type SUSH` to regenerate the file name.',
      ],
      example: 'abap pull ZCLI_TC_SUSH_FM.RF --type SUSH',
    });
  }
  const appName = parsed[1]!;
  const type = parsed[2]! as SushKeyType;
  if (!(SUSH_KEY_TYPES as readonly string[]).includes(type)) {
    throw new CliError('FILE_PARSE_ERROR', `${display} ends with _${type}, which is not a SUSH key type`, {
      file: display,
      nextSteps: [`SUSH types are ${SUSH_KEY_TYPES.join(', ')}.`],
      example: 'abap pull ZCLI_TC_SUSH_FM.RF --type SUSH',
    });
  }
  return normalizeSushName(`${appName}.${type}`);
}

/**
 * Canonical name carried by the document itself, when it can be derived: the
 * leading application of a `FUNC`/`TRAN` document is the key name, `HT`/`HS`
 * documents reference a leading object without the SAP-computed hash key.
 */
export function sushObjectName(local: SushLocal): string | undefined {
  const applicationType = text(local?.generalInformation?.applicationType);
  const keyType = sushKeyTypeOfApplicationType(applicationType);
  if (!keyType) return undefined;
  const applicationName = text(local?.generalInformation?.applicationName).toUpperCase();
  if (!applicationName) return undefined;
  return `${applicationName}.${keyType}`;
}

/** Minimal valid document for `abap create --schema SUSH`. */
export function sushExample(): SushLocal {
  return {
    formatVersion: '1',
    header: {
      description: 'R3TR FUNC ZCLI_TC_SUSH_FM',
      originalLanguage: 'en',
    },
    generalInformation: {
      applicationName: 'ZCLI_TC_SUSH_FM',
      applicationType: 'FUNC',
      maintenanceMode: 'manual',
      defaultValuesRequired: 'yes',
    },
    authorizationObjects: [
      {
        authObjectName: 'S_RFC',
        maintenanceStatus: 'defaultWithValues',
        authObjectFieldValues: [
          { authFieldName: 'RFC_TYPE', authFieldLowValue: 'FUGR' },
          { authFieldName: 'RFC_NAME', authFieldLowValue: 'ZCLI_TC_SUSH_FM' },
          { authFieldName: 'ACTVT', authFieldLowValue: '16' },
        ],
      },
    ],
  };
}

export const sushSpec: AuthTypeSpec<SushLocal> = {
  type: 'SUSH',
  route: 'sush',
  tadirObject: 'SUSH',
  schemaFile: 'sush-v1.json',
  description: 'Authorization default assignment (SU22)',
  nameMaxLength: SUSH_NAME_MAX_LENGTH,
  artifact: sushArtifact,
  normalizeName: normalizeSushName,
  fileToken: sushFileToken,
  nameFromToken: (token, basename) => sushNameFromToken(token, basename),
  objectNameFromDocument: sushObjectName,
  validateDocument: validateSushDocument,
  example: sushExample,
};
