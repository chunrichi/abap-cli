import * as fs from 'fs/promises';
import * as path from 'path';
import { TRAN_SUPPORTED_TYPES, type TranSupportedType } from '../../types/registry.js';
import { validateAffMetadata } from '../../aff/schema-validator.js';
import { stripCliEnvelope } from '../../aff/assert-metadata.js';

// Known Transaction Code object extension (abap-file-format).
export const TRAN_EXTENSIONS = ['.tran.json'];

/** Re-exported from `types/registry.ts` (T050, US11). */
export { TRAN_SUPPORTED_TYPES, type TranSupportedType };

// ---------------------------------------------------------------------------
// T2.3 AFF schema integration
// ---------------------------------------------------------------------------
// The hand-rolled `validateTranObject` below predates the AFF schema validator
// and duplicates all length / enum checks already declared in
// `src/abap_cli/schema/tran-v1.json`. The new `validateTranJson` is the
// canonical entry point and delegates to ajv. The legacy helpers stay
// exported as deprecated so downstream code (and existing tests) keep
// compiling. New code should prefer `validateTranJson`.
// ---------------------------------------------------------------------------

/**
 * Validate a Transaction document against the vendored AFF `tran-v1.json`
 * schema. Returns an array of human-readable error strings (empty when valid).
 *
 * T2.3: this is the AFF-schema-based replacement for the hand-rolled
 * `validateTranObject`. The CLI / SICF integration layer should migrate to
 * this entry point over time; for now `validateTranObject` is preserved.
 */
export function validateTranJson(data: unknown): string[] {
  // The SAP `tran-v1.json` schema rejects CLI envelope fields via
  // `additionalProperties:false`; the CLI transport envelope (name /
  // package / transportRequest) is not part of the SAP structure.
  return validateAffMetadata('TRAN', stripCliEnvelope(data));
}

/**
 * @deprecated Use {@link validateTranJson}. Kept because the existing CLI /
 * SICF integration layer and tests depend on the specific error message
 * shape (e.g. "Missing required field: name", "header.description too long").
 */
export function validateTranObject(data: unknown): string[] {
  return validateTranObjectLegacy(data as TranObjectLocal);
}

// Schema constants — mirror http-v1.json and abap-file-format http layout.
export const TRAN_CODE_MAX_LENGTH = 20;
export const TRAN_DESCRIPTION_MAX_LENGTH = 80;
export const TRAN_PROGRAM_MAX_LENGTH = 40;
export const TRAN_DYNPRO_MAX_LENGTH = 4;
export const TRAN_CLASS_MAX_LENGTH = 30;
export const TRAN_METHOD_MAX_LENGTH = 61;
export const TRAN_VARIANT_MAX_LENGTH = 14;
export const TRAN_TX_VARIANT_MAX_LENGTH = 30;
export const TRAN_IAC_SERVICE_MAX_LENGTH = 14;
export const TRAN_AUTH_OBJECT_MAX_LENGTH = 10;
export const TRAN_AUTH_FIELD_MAX_LENGTH = 10;
export const TRAN_AUTH_VALUE_MAX_LENGTH = 40;
export const TRAN_PARAM_NAME_MAX_LENGTH = 132;
export const TRAN_PARAM_VALUE_MAX_LENGTH = 50;
export const TRAN_APP_NAME_MAX_LENGTH = 30;
export const TRAN_APP_TYPE_MAX_LENGTH = 2;
export const TRAN_PROGRAM_ID_MAX_LENGTH = 4;
export const TRAN_OBJECT_TYPE_MAX_LENGTH = 4;
export const TRAN_OBJECT_NAME_MAX_LENGTH = 40;
export const TRAN_SERVICE_TYPE_MAX_LENGTH = 16;

export const TRAN_TRANSACTION_TYPES = [
  'dialogTransaction',
  'ooTransaction',
  'parameterTransaction',
  'reportTransaction',
  'variantTransaction',
] as const;
export type TranTransactionType = (typeof TRAN_TRANSACTION_TYPES)[number];

export const TRAN_ABAP_LANGUAGE_VERSIONS = ['standard', 'keyUser', 'cloudDevelopment'] as const;
export type TranAbapLanguageVersion = (typeof TRAN_ABAP_LANGUAGE_VERSIONS)[number];

export const TRAN_LOCK_STATUSES = ['locked', 'notLocked'] as const;
export const TRAN_STV_MODES = ['allowed', 'notAllowed'] as const;
export const TRAN_SKIP_MODES = ['skip', 'show'] as const;
export const TRAN_UPDATE_MODES = ['notSet', 'asynchronous', 'synchronous', 'local'] as const;
export const TRAN_INHERITANCE_MODES = ['active', 'inactive'] as const;
export const TRAN_PERVASIVE_MODES = ['disabled', 'enabled'] as const;
export const TRAN_SUPPORT_MODES = ['supported', 'notSupported'] as const;
export const TRAN_UI_CLASSIFICATIONS = ['professionalUserTransaction', 'easyWebTransaction'] as const;
export const TRAN_MAINTENANCE_MODES = [
  'manual',
  'automatic',
  'automaticBasisObjects',
  'noDefaultValues',
  'deprecated',
  'obsolete',
] as const;
export const TRAN_DEFAULT_VALUES_REQUIRED = ['yes', 'no'] as const;
export const TRAN_MAINTENANCE_STATUSES = [
  'undefined',
  'noDefault',
  'defaultWithValues',
  'defaultWithoutValues',
  'inactiveValues',
] as const;
export const TRAN_RELATIONSHIP_TYPES = ['includeRole', 'requiresRole'] as const;

export interface TranDialogTransaction {
  programName?: string;
  programDynnr?: string;
  stvMaintenanceMode?: (typeof TRAN_STV_MODES)[number];
}

export interface TranParameterTransaction {
  parParentTransactionCode?: string;
  skipInitialScreenMode?: (typeof TRAN_SKIP_MODES)[number];
  parameterValues?: { parameterName: string; parameterValue?: string }[];
}

export interface TranReportTransaction {
  reportName?: string;
  reportDynnr?: string;
  reportVariantName?: string;
}

export interface TranOoTransaction {
  localInProgramIndi?: boolean;
  classProgramName?: string;
  className?: string;
  methodName?: string;
  ooTransactionModelIndi?: boolean;
  updateMode?: (typeof TRAN_UPDATE_MODES)[number];
}

export interface TranVariantTransaction {
  varParentTransactionCode?: string;
  transactionVariantCiIndi?: boolean;
  transactionCiVariantName?: string;
  transactionVariantName?: string;
}

export interface TranGeneralInformation {
  transactionType: TranTransactionType;
  lockStatus?: (typeof TRAN_LOCK_STATUSES)[number];
  dialogTransaction?: TranDialogTransaction;
  parameterTransaction?: TranParameterTransaction;
  reportTransaction?: TranReportTransaction;
  ooTransaction?: TranOoTransaction;
  variantTransaction?: TranVariantTransaction;
}

export interface TranTransactionService {
  applicationName: string;
  applicationType: string;
  programId?: string;
  objectType?: string;
  objectName?: string;
  serviceType?: string;
  service?: string;
}

export interface TranTransactionRelationship {
  relationshipType: (typeof TRAN_RELATIONSHIP_TYPES)[number];
  relatedTcode?: string;
}

export interface TranServiceRelationship {
  relationshipType: (typeof TRAN_RELATIONSHIP_TYPES)[number];
  relatedApplicationType: string;
  relatedApplicationName: string;
  programId?: string;
  objectType?: string;
  objectName?: string;
  serviceType?: string;
  service?: string;
}

export interface TranUiAttributes {
  inheritanceMode?: (typeof TRAN_INHERITANCE_MODES)[number];
  uiClassification?: (typeof TRAN_UI_CLASSIFICATIONS)[number];
  iacServiceName?: string;
  pervasiveMode?: (typeof TRAN_PERVASIVE_MODES)[number];
  webguiMode?: (typeof TRAN_SUPPORT_MODES)[number];
  platinMode?: (typeof TRAN_SUPPORT_MODES)[number];
  win32Mode?: (typeof TRAN_SUPPORT_MODES)[number];
}

export interface TranAuthObjectFieldValue {
  authFieldName: string;
  authFieldLowValue?: string;
  authFieldHighValue?: string;
}

export interface TranAuthorizationObject {
  authObjectName?: string;
  authObjectFieldValues?: { authFieldName: string; authFieldValue?: string }[];
}

export interface TranAuthorizationDefaultObject {
  authObjectName?: string;
  maintenanceStatus?: (typeof TRAN_MAINTENANCE_STATUSES)[number];
  documentation?: string;
  authObjectFieldValues?: TranAuthObjectFieldValue[];
}

export interface TranAuthorizationDefaults {
  maintenanceMode: (typeof TRAN_MAINTENANCE_MODES)[number];
  defaultValuesRequired: (typeof TRAN_DEFAULT_VALUES_REQUIRED)[number];
  inheritanceMode?: (typeof TRAN_INHERITANCE_MODES)[number];
  documentation?: string;
  authObjects?: TranAuthorizationDefaultObject[];
}

export interface TranStartAuthorizationObject {
  authObjectName: string;
  authObjectFieldValues?: { authFieldName: string; authFieldValue?: string }[];
}

export interface TranAuthorizations {
  startAuthorizationObject?: TranStartAuthorizationObject;
  authorizationDefaults: TranAuthorizationDefaults;
}

export interface TranUserInterface {
  uiAttributes?: TranUiAttributes;
}

export interface TranHeader {
  description: string;
  originalLanguage: string;
  abapLanguageVersion?: TranAbapLanguageVersion;
}

/**
 * Local abap-file-format Transaction representation.
 * Mirrors `zif_aff_tran_v1.intf.abap` ty_main (snake_case JSON layout).
 */
export interface TranObjectLocal {
  name: string;
  formatVersion: '1';
  header: TranHeader;
  generalInformation: TranGeneralInformation;
  transactionServices?: TranTransactionService[];
  transactionRelationships?: TranTransactionRelationship[];
  serviceRelationships?: TranServiceRelationship[];
  userInterface?: TranUserInterface;
  authorizations?: TranAuthorizations;
  [key: string]: unknown;
}

/**
 * ICF wire representation (camelCase + transport envelope).
 *
 * 037 US2 (S07): matches SAP `ty_tran_data` (nested `header / generalInformation`
 * etc.) one-to-one. SAP-side `build_tran_payload` returns nested; CLI used to
 * send a flat wire (description / originalLanguage / transactionType at top
 * level), which the ABAP deserialize mapped to empty nested slots.
 */
export interface TranWirePayload {
  name: string;
  formatVersion?: '1';
  header?: TranHeader;
  generalInformation?: TranGeneralInformation;
  transactionServices?: TranTransactionService[];
  transactionRelationships?: TranTransactionRelationship[];
  serviceRelationships?: TranServiceRelationship[];
  userInterface?: TranUserInterface;
  authorizations?: TranAuthorizations;
  /** Transport envelope — top-level only, not part of the SAP struct. */
  package?: string;
  transportRequest?: string;
}

/**
 * Read a Transaction JSON file from disk.
 */
export async function readTranJson(filePath: string): Promise<TranObjectLocal> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as TranObjectLocal;
}

/**
 * Write a Transaction JSON file to disk, validating against the AFF
 * `tran-v1.json` schema before writing. Throws on schema violation.
 *
 * The validator is applied to the AFF-shaped core (formatVersion / header /
 * generalInformation / …) so CLI-only transport fields (`name`, `package`,
 * `transportRequest`) — which the SAP schema explicitly rejects via
 * `additionalProperties:false` — do not block legitimate round-trips.
 */
export async function writeTranJson(filePath: string, data: TranObjectLocal): Promise<void> {
  const errors = validateTranJson(data);
  if (errors.length > 0) {
    throw new Error(`AFF TRAN fixture invalid: ${errors.join('; ')}`);
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/** Convert a local Transaction object (read from .tran.json) to wire payload. */
export function localToWire(local: TranObjectLocal): TranWirePayload {
  const l = local as Record<string, unknown>;
  const wire: TranWirePayload = {
    name: String(local.name).toUpperCase(),
    formatVersion: '1',
    header: local.header,
    generalInformation: local.generalInformation,
    transactionServices: local.transactionServices,
    transactionRelationships: local.transactionRelationships,
    serviceRelationships: local.serviceRelationships,
    userInterface: local.userInterface,
    authorizations: local.authorizations,
    package: l.package as string | undefined,
    transportRequest: l.transportRequest as string | undefined,
  };
  return wire;
}

/** Convert a wire payload back to local abap-file-format shape (header / generalInformation nesting). */
export function wireToLocal(wire: TranWirePayload): TranObjectLocal {
  const wireHeader = wire.header;
  const wireGeneral = wire.generalInformation;
  const header: TranHeader = {
    description: wireHeader?.description ?? '',
    originalLanguage: wireHeader?.originalLanguage ?? '',
  };
  if (wireHeader?.abapLanguageVersion !== undefined) {
    header.abapLanguageVersion = wireHeader.abapLanguageVersion as TranAbapLanguageVersion;
  }

  const generalInformation: TranGeneralInformation = {
    transactionType: wireGeneral?.transactionType ?? 'dialogTransaction',
  };
  if (wireGeneral?.lockStatus !== undefined) generalInformation.lockStatus = wireGeneral.lockStatus;
  if (wireGeneral?.dialogTransaction) generalInformation.dialogTransaction = wireGeneral.dialogTransaction;
  if (wireGeneral?.parameterTransaction) generalInformation.parameterTransaction = wireGeneral.parameterTransaction;
  if (wireGeneral?.reportTransaction) generalInformation.reportTransaction = wireGeneral.reportTransaction;
  if (wireGeneral?.ooTransaction) generalInformation.ooTransaction = wireGeneral.ooTransaction;
  if (wireGeneral?.variantTransaction) generalInformation.variantTransaction = wireGeneral.variantTransaction;

  const local: TranObjectLocal = {
    name: wire.name,
    formatVersion: '1',
    header,
    generalInformation,
  };
  if (wire.transactionServices) local.transactionServices = wire.transactionServices;
  if (wire.transactionRelationships) local.transactionRelationships = wire.transactionRelationships;
  if (wire.serviceRelationships) local.serviceRelationships = wire.serviceRelationships;
  if (wire.userInterface) local.userInterface = wire.userInterface;
  if (wire.authorizations) local.authorizations = wire.authorizations;
  return local;
}

function expectOneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    return `${label} must be one of ${allowed.join(', ')} (got "${String(value)}")`;
  }
  return null;
}

function expectString(value: unknown, label: string, maxLength: number, required: boolean): string | null {
  if (value === undefined || value === null) return required ? `${label} is required` : null;
  if (typeof value !== 'string') return `${label} must be a string`;
  if (value.length === 0) return required ? `${label} must not be empty` : null;
  if (value.length > maxLength) return `${label} too long: maxLength ${maxLength} (got ${value.length})`;
  return null;
}

function expectPattern(value: string, pattern: RegExp, label: string): string | null {
  if (!pattern.test(value)) return `${label} must match ${pattern.source}`;
  return null;
}

/**
 * Validate a local Transaction object against the abap-file-format contract.
 * Returns an array of human-readable errors (empty when valid).
 *
 * @deprecated Internal — use the public {@link validateTranJson} (AFF-schema)
 * for new code. This implementation duplicates the schema and is kept only
 * to support the deprecated `validateTranObject` alias and existing tests
 * that rely on the specific error message shapes.
 */
function validateTranObjectLegacy(data: TranObjectLocal): string[] {
  const errors: string[] = [];

  // name: required, namespace Z/Y/slash, ≤ 20 chars (TSTC-TCODE length).
  const name = data.name ?? '';
  if (!name) {
    errors.push('Missing required field: name');
  } else {
    if (name[0] !== 'Z' && name[0] !== 'Y' && name[0] !== '/') {
      errors.push(`Invalid namespace: name must start with Z, Y, or / (got "${name}")`);
    }
    if (name.length > TRAN_CODE_MAX_LENGTH) {
      errors.push(`name too long: maxLength ${TRAN_CODE_MAX_LENGTH} (got ${name.length})`);
    }
  }

  // header
  if (!data.header) {
    errors.push('Missing required field: header');
  } else {
    const desc = expectString(data.header.description, 'header.description', TRAN_DESCRIPTION_MAX_LENGTH, true);
    if (desc) errors.push(desc);
    if (data.header.originalLanguage !== undefined) {
      if (typeof data.header.originalLanguage !== 'string' || data.header.originalLanguage.length < 2) {
        errors.push('header.originalLanguage must be a string of at least 2 characters');
      }
    } else {
      errors.push('header.originalLanguage is required');
    }
    const langErr = expectOneOf(data.header.abapLanguageVersion, TRAN_ABAP_LANGUAGE_VERSIONS, 'header.abapLanguageVersion');
    if (langErr) errors.push(langErr);
  }

  // generalInformation
  if (!data.generalInformation) {
    errors.push('Missing required field: generalInformation');
  } else {
    const typeErr = expectOneOf(data.generalInformation.transactionType, TRAN_TRANSACTION_TYPES, 'generalInformation.transactionType');
    if (typeErr) errors.push(typeErr);
    const lockErr = expectOneOf(data.generalInformation.lockStatus, TRAN_LOCK_STATUSES, 'generalInformation.lockStatus');
    if (lockErr) errors.push(lockErr);

    // Per-type required fields
    const txType = data.generalInformation.transactionType;
    const dt = data.generalInformation.dialogTransaction;
    const pt = data.generalInformation.parameterTransaction;
    const rt = data.generalInformation.reportTransaction;
    const ot = data.generalInformation.ooTransaction;
    const vt = data.generalInformation.variantTransaction;

    if (txType === 'dialogTransaction') {
      if (dt) {
        if (dt.programDynnr !== undefined) {
          const e = expectString(dt.programDynnr, 'dialogTransaction.programDynnr', TRAN_DYNPRO_MAX_LENGTH, false)
            ?? expectPattern(dt.programDynnr, /^[0-9]+$/, 'dialogTransaction.programDynnr');
          if (e) errors.push(e);
        }
        if (dt.programName !== undefined) {
          const e = expectString(dt.programName, 'dialogTransaction.programName', TRAN_PROGRAM_MAX_LENGTH, false);
          if (e) errors.push(e);
        }
        const stvErr = expectOneOf(dt.stvMaintenanceMode, TRAN_STV_MODES, 'dialogTransaction.stvMaintenanceMode');
        if (stvErr) errors.push(stvErr);
      }
    }
    if (txType === 'parameterTransaction') {
      if (!pt) errors.push('parameterTransaction is required when transactionType=parameterTransaction');
      else {
        const e = expectString(pt.parParentTransactionCode, 'parameterTransaction.parParentTransactionCode', TRAN_CODE_MAX_LENGTH, true);
        if (e) errors.push(e);
        const skipErr = expectOneOf(pt.skipInitialScreenMode, TRAN_SKIP_MODES, 'parameterTransaction.skipInitialScreenMode');
        if (skipErr) errors.push(skipErr);
        for (const [i, pv] of (pt.parameterValues ?? []).entries()) {
          const nameErr = expectString(pv.parameterName, `parameterTransaction.parameterValues[${i}].parameterName`, TRAN_PARAM_NAME_MAX_LENGTH, true);
          if (nameErr) errors.push(nameErr);
          if (pv.parameterValue !== undefined) {
            const valErr = expectString(pv.parameterValue, `parameterTransaction.parameterValues[${i}].parameterValue`, TRAN_PARAM_VALUE_MAX_LENGTH, false);
            if (valErr) errors.push(valErr);
          }
        }
      }
    }
    if (txType === 'reportTransaction') {
      if (rt) {
        if (rt.reportName !== undefined) {
          const e = expectString(rt.reportName, 'reportTransaction.reportName', TRAN_PROGRAM_MAX_LENGTH, false);
          if (e) errors.push(e);
        }
        if (rt.reportDynnr !== undefined) {
          const e = expectString(rt.reportDynnr, 'reportTransaction.reportDynnr', TRAN_DYNPRO_MAX_LENGTH, false)
            ?? expectPattern(rt.reportDynnr, /^[0-9]+$/, 'reportTransaction.reportDynnr');
          if (e) errors.push(e);
        }
        if (rt.reportVariantName !== undefined) {
          const e = expectString(rt.reportVariantName, 'reportTransaction.reportVariantName', TRAN_VARIANT_MAX_LENGTH, false);
          if (e) errors.push(e);
        }
      }
    }
    if (txType === 'ooTransaction') {
      if (!ot) errors.push('ooTransaction is required when transactionType=ooTransaction');
      else {
        const cn = expectString(ot.className, 'ooTransaction.className', TRAN_CLASS_MAX_LENGTH, true);
        if (cn) errors.push(cn);
        const mn = expectString(ot.methodName, 'ooTransaction.methodName', TRAN_METHOD_MAX_LENGTH, true);
        if (mn) errors.push(mn);
        if (ot.classProgramName !== undefined) {
          const e = expectString(ot.classProgramName, 'ooTransaction.classProgramName', TRAN_PROGRAM_MAX_LENGTH, false);
          if (e) errors.push(e);
        }
        const updErr = expectOneOf(ot.updateMode, TRAN_UPDATE_MODES, 'ooTransaction.updateMode');
        if (updErr) errors.push(updErr);
      }
    }
    if (txType === 'variantTransaction') {
      if (!vt) errors.push('variantTransaction is required when transactionType=variantTransaction');
      else {
        const e = expectString(vt.varParentTransactionCode, 'variantTransaction.varParentTransactionCode', TRAN_CODE_MAX_LENGTH, true);
        if (e) errors.push(e);
        if (vt.transactionCiVariantName !== undefined) {
          const ci = expectString(vt.transactionCiVariantName, 'variantTransaction.transactionCiVariantName', TRAN_TX_VARIANT_MAX_LENGTH, false);
          if (ci) errors.push(ci);
        }
        if (vt.transactionVariantName !== undefined) {
          const tn = expectString(vt.transactionVariantName, 'variantTransaction.transactionVariantName', TRAN_TX_VARIANT_MAX_LENGTH, false);
          if (tn) errors.push(tn);
        }
      }
    }
  }

  // transactionServices
  for (const [i, svc] of (data.transactionServices ?? []).entries()) {
    const a = expectString(svc.applicationName, `transactionServices[${i}].applicationName`, TRAN_APP_NAME_MAX_LENGTH, true);
    if (a) errors.push(a);
    const t = expectString(svc.applicationType, `transactionServices[${i}].applicationType`, TRAN_APP_TYPE_MAX_LENGTH, true);
    if (t) errors.push(t);
    if (svc.programId !== undefined) {
      const e = expectString(svc.programId, `transactionServices[${i}].programId`, TRAN_PROGRAM_ID_MAX_LENGTH, false);
      if (e) errors.push(e);
    }
    if (svc.objectType !== undefined) {
      const e = expectString(svc.objectType, `transactionServices[${i}].objectType`, TRAN_OBJECT_TYPE_MAX_LENGTH, false);
      if (e) errors.push(e);
    }
    if (svc.objectName !== undefined) {
      const e = expectString(svc.objectName, `transactionServices[${i}].objectName`, TRAN_OBJECT_NAME_MAX_LENGTH, false);
      if (e) errors.push(e);
    }
    if (svc.serviceType !== undefined) {
      const e = expectString(svc.serviceType, `transactionServices[${i}].serviceType`, TRAN_SERVICE_TYPE_MAX_LENGTH, false);
      if (e) errors.push(e);
    }
  }

  // transactionRelationships
  for (const [i, rel] of (data.transactionRelationships ?? []).entries()) {
    const rt = expectOneOf(rel.relationshipType, TRAN_RELATIONSHIP_TYPES, `transactionRelationships[${i}].relationshipType`);
    if (rt) errors.push(rt);
    if (rel.relatedTcode !== undefined) {
      const e = expectString(rel.relatedTcode, `transactionRelationships[${i}].relatedTcode`, TRAN_CODE_MAX_LENGTH, false);
      if (e) errors.push(e);
    }
  }

  // serviceRelationships
  for (const [i, rel] of (data.serviceRelationships ?? []).entries()) {
    const rt = expectOneOf(rel.relationshipType, TRAN_RELATIONSHIP_TYPES, `serviceRelationships[${i}].relationshipType`);
    if (rt) errors.push(rt);
    const at = expectString(rel.relatedApplicationType, `serviceRelationships[${i}].relatedApplicationType`, TRAN_APP_TYPE_MAX_LENGTH, true);
    if (at) errors.push(at);
    const an = expectString(rel.relatedApplicationName, `serviceRelationships[${i}].relatedApplicationName`, TRAN_APP_NAME_MAX_LENGTH, true);
    if (an) errors.push(an);
  }

  // userInterface.uiAttributes
  if (data.userInterface?.uiAttributes) {
    const ui = data.userInterface.uiAttributes;
    const im = expectOneOf(ui.inheritanceMode, TRAN_INHERITANCE_MODES, 'userInterface.uiAttributes.inheritanceMode');
    if (im) errors.push(im);
    const uc = expectOneOf(ui.uiClassification, TRAN_UI_CLASSIFICATIONS, 'userInterface.uiAttributes.uiClassification');
    if (uc) errors.push(uc);
    if (ui.iacServiceName !== undefined) {
      const e = expectString(ui.iacServiceName, 'userInterface.uiAttributes.iacServiceName', TRAN_IAC_SERVICE_MAX_LENGTH, false);
      if (e) errors.push(e);
    }
    const pm = expectOneOf(ui.pervasiveMode, TRAN_PERVASIVE_MODES, 'userInterface.uiAttributes.pervasiveMode');
    if (pm) errors.push(pm);
    for (const k of ['webguiMode', 'platinMode', 'win32Mode'] as const) {
      const m = expectOneOf(ui[k], TRAN_SUPPORT_MODES, `userInterface.uiAttributes.${k}`);
      if (m) errors.push(m);
    }
  }

  // authorizations
  if (data.authorizations) {
    const auth = data.authorizations;
    if (auth.startAuthorizationObject) {
      const sao = auth.startAuthorizationObject;
      const a = expectString(sao.authObjectName, 'authorizations.startAuthorizationObject.authObjectName', TRAN_AUTH_OBJECT_MAX_LENGTH, true);
      if (a) errors.push(a);
      for (const [i, fv] of (sao.authObjectFieldValues ?? []).entries()) {
        const fn = expectString(fv.authFieldName, `authorizations.startAuthorizationObject.authObjectFieldValues[${i}].authFieldName`, TRAN_AUTH_FIELD_MAX_LENGTH, true);
        if (fn) errors.push(fn);
        if (fv.authFieldValue !== undefined) {
          const fv_err = expectString(fv.authFieldValue, `authorizations.startAuthorizationObject.authObjectFieldValues[${i}].authFieldValue`, TRAN_AUTH_VALUE_MAX_LENGTH, false);
          if (fv_err) errors.push(fv_err);
        }
      }
    }
    if (!auth.authorizationDefaults) {
      errors.push('authorizations.authorizationDefaults is required when authorizations is set');
    } else {
      const ad = auth.authorizationDefaults;
      const mm = expectOneOf(ad.maintenanceMode, TRAN_MAINTENANCE_MODES, 'authorizations.authorizationDefaults.maintenanceMode');
      if (mm) errors.push(mm);
      const dvr = expectOneOf(ad.defaultValuesRequired, TRAN_DEFAULT_VALUES_REQUIRED, 'authorizations.authorizationDefaults.defaultValuesRequired');
      if (dvr) errors.push(dvr);
      const im = expectOneOf(ad.inheritanceMode, TRAN_INHERITANCE_MODES, 'authorizations.authorizationDefaults.inheritanceMode');
      if (im) errors.push(im);
      for (const [i, ao] of (ad.authObjects ?? []).entries()) {
        if (ao.authObjectName !== undefined) {
          const e = expectString(ao.authObjectName, `authorizations.authorizationDefaults.authObjects[${i}].authObjectName`, TRAN_AUTH_OBJECT_MAX_LENGTH, false);
          if (e) errors.push(e);
        }
        const ms = expectOneOf(ao.maintenanceStatus, TRAN_MAINTENANCE_STATUSES, `authorizations.authorizationDefaults.authObjects[${i}].maintenanceStatus`);
        if (ms) errors.push(ms);
        for (const [j, fv] of (ao.authObjectFieldValues ?? []).entries()) {
          const fn = expectString(fv.authFieldName, `authorizations.authorizationDefaults.authObjects[${i}].authObjectFieldValues[${j}].authFieldName`, TRAN_AUTH_FIELD_MAX_LENGTH, false);
          if (fn) errors.push(fn);
          for (const prop of [{ key: 'authFieldLowValue', max: TRAN_AUTH_VALUE_MAX_LENGTH }, { key: 'authFieldHighValue', max: TRAN_AUTH_VALUE_MAX_LENGTH }]) {
            const v = fv[prop.key as 'authFieldLowValue' | 'authFieldHighValue'];
            if (v !== undefined) {
              const e = expectString(v, `authorizations.authorizationDefaults.authObjects[${i}].authObjectFieldValues[${j}].${prop.key}`, prop.max, false);
              if (e) errors.push(e);
            }
          }
        }
      }
    }
  }

  return errors;
}
