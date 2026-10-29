/**
 * DDIC local-shape validation: per-type contract checks plus the synchronous
 * TABT settings gate used by `push`.
 */
import type { DdicFieldLocal, DdicObject } from './types.js';
import { stripClientFields } from './wire.js';

/**
 * Validate a local DDIC object against the per-type contract.
 * Returns an array of human-readable errors (empty when valid).
 * Namespace / package / transport rules enforced here.
 */
export function validateDdicObject(data: DdicObject, objectType: string): string[] {
  const errors: string[] = [];
  if (!data.name) {
    // The file's `name` must be a top-level JSON field, not nested under
    // `header` or anywhere else. Spell that out so first-time users stop
    // writing abap-file-format's nested header layout.
    errors.push(
      `Missing required field: name (must be a top-level field, e.g. { "name": "ZTAB_EXAMPLE", ... })`,
    );
  }

  // Namespace enforcement: Z/Y/slash only.
  const name = data.name ?? '';
  if (name && name[0] !== 'Z' && name[0] !== 'Y' && name[0] !== '/') {
    errors.push(`Invalid namespace: name must start with Z, Y, or / (got "${name}")`);
  }

  switch (objectType) {
    case 'DOMA': {
      // 033: AFF canonical — `format.dataType` / `format.length`. Legacy flat
      // top-level dataType/length are still accepted as a back-compat shim
      // for pre-014 scripts; the error message keeps the user pointed at the
      // AFF canonical shape so the migration path is clear.
      const format = (data as Record<string, unknown>).format as Record<string, unknown> | undefined;
      const fmtDataType = format?.dataType;
      const fmtLength = format?.length;
      const flatDataType = (data as Record<string, unknown>).dataType;
      const flatLength = (data as Record<string, unknown>).length;
      const hasCanonical = fmtDataType !== undefined && fmtLength !== undefined;
      const hasLegacy = flatDataType !== undefined && flatLength !== undefined;
      if (!hasCanonical && !hasLegacy) {
        errors.push('Domain missing: format.dataType and format.length (AFF canonical under `format.*`)');
      } else if (hasCanonical && (fmtLength === null || fmtLength === undefined)) {
        errors.push('Domain missing: format.length');
      }
      break;
    }
    case 'DTEL': {
      // 033: AFF canonical — `dataTypeInformation.{category, typeName}`.
      const dti = (data as Record<string, unknown>).dataTypeInformation as Record<string, unknown> | undefined;
      const flatDomain = (data as Record<string, unknown>).domain;
      const flatDataType = (data as Record<string, unknown>).dataType;
      if (!data.description) {
        errors.push('DataElement missing: description (and `header.description` per AFF)');
      }
      const hasCanonical = !!dti && (
        dti.category === 'domain' ||
        dti.category === 'predefinedType' ||
        dti.category === 'referenceToPredefinedType' ||
        dti.category === 'referenceDictionaryType' ||
        dti.category === 'referenceClasIntType' ||
        dti.category === 'typeRef' // 032 legacy alias
      );
      const hasLegacy = !!flatDomain || !!flatDataType;
      if (!hasCanonical && !hasLegacy) {
        errors.push(
          'DataElement must declare `dataTypeInformation: { category, typeName }` (AFF) or a flat `domain` (legacy)',
        );
      }
      break;
    }
    case 'TABL':
    case 'STRU':
      if (!Array.isArray((data as Record<string, unknown>).fields)) {
        // BUG-1: spell out that `fields` is a top-level array, not nested.
        errors.push(
          `${objectType} missing: fields (must be a top-level array, e.g. { "fields": [{ "fieldName": "...", "dataType": "...", "length": N }] })`,
        );
      } else {
        const fields = (data as Record<string, unknown>).fields as Array<Record<string, unknown>>;
        if (fields.length === 0) errors.push(`${objectType} fields list is empty`);
        // Enforce the same strip the wire serializer applies, so a user who
        // writes *only* `CLIENT`/`MANDT` in fields[] gets a clear error
        // instead of a silent empty payload.
        const afterStrip = stripClientFields(fields as unknown as DdicFieldLocal[]);
        if (afterStrip.length === 0 && fields.length > 0) {
          errors.push(
            `${objectType} fields list contains only client-key columns (CLIENT/MANDT); these are auto-prepended by the server when clientDependent: true, so the table has no user-defined fields. Add at least one non-client field, or set clientDependent: false.`,
          );
        }
        // Duplicate fieldName is always wrong — the server would reject it
        // anyway, so we surface it before the round-trip.
        const seen = new Set<string>();
        for (const f of fields) {
          if (!f.fieldName) errors.push(`${objectType} field missing: fieldName`);
          else {
            const key = String(f.fieldName).toUpperCase();
            if (seen.has(key)) {
              errors.push(`${objectType} field "${f.fieldName}" is declared more than once`);
            } else {
              seen.add(key);
            }
          }
        }
      }
      break;
    case 'TTYP':
      // Q2: out of scope for this phase; existing diagnostics retained.
      if (!(data as Record<string, unknown>).rowType) errors.push('TableType missing: rowType');
      break;
  }
  return errors;
}

/**
 * P3.1: TABT settings valid enums - mirrors `tabt-v1.json` enum values.
 * Kept in sync with `src/abap_cli/schema/tabt-v1.json` (the AFF schema is
 * the source of truth; this map is a synchronous shortcut for the CLI push
 * path so we can validate without the AJV overhead).
 */
const TABT_VALID_ENUMS = {
  translation: ['noLanguageKey', 'standard', 'loadTable', 'objectSpecific', 'notRelevant'],
  bufferingState: ['notAllowed', 'switchedOn', 'allowedButSwitchedOff'],
  bufferingType: ['noBuffer', 'single', 'generic', 'full'],
  storageType: ['undefined', 'rowStore', 'columnStore'],
  loadUnit: ['columnPreferred', 'pagePreferred', 'columnEnforced', 'pageEnforced'],
  sizeCategory: ['undefined', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
} as const;

/**
 * P3.1: validate a TABL/STRU `generalInformation` payload against the
 * `tabt-v1.json` enum values. Synchronous (no AJV dependency) so it can
 * run inline in push.ts / create.ts without an `await` boundary.
 *
 * Returns null on success, or a list of human-readable errors.
 */
export function validateTabtPayload(settings: unknown): string[] | null {
  if (!settings || typeof settings !== 'object') return null;
  const s = settings as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof s.translation === 'string' && !(TABT_VALID_ENUMS.translation as readonly string[]).includes(s.translation)) {
    errors.push(`generalInformation.translation: '${s.translation}' is not a valid TABT enum value (expected one of ${TABT_VALID_ENUMS.translation.join('|')})`);
  }
  if (typeof s.sizeCategory === 'string' && !(TABT_VALID_ENUMS.sizeCategory as readonly string[]).includes(s.sizeCategory)) {
    errors.push(`generalInformation.sizeCategory: '${s.sizeCategory}' is not a valid TABT enum value (expected one of ${TABT_VALID_ENUMS.sizeCategory.join('|')})`);
  }
  const buffering = s.buffering as Record<string, unknown> | undefined;
  if (buffering && typeof buffering === 'object') {
    if (typeof buffering.state === 'string' && !(TABT_VALID_ENUMS.bufferingState as readonly string[]).includes(buffering.state)) {
      errors.push(`buffering.state: '${buffering.state}' is not a valid TABT enum value (expected one of ${TABT_VALID_ENUMS.bufferingState.join('|')})`);
    }
    if (typeof buffering.type === 'string' && !(TABT_VALID_ENUMS.bufferingType as readonly string[]).includes(buffering.type)) {
      errors.push(`buffering.type: '${buffering.type}' is not a valid TABT enum value (expected one of ${TABT_VALID_ENUMS.bufferingType.join('|')})`);
    }
  }
  const db = s.dbSpecificSettings as Record<string, unknown> | undefined;
  if (db && typeof db === 'object') {
    if (typeof db.storageType === 'string' && !(TABT_VALID_ENUMS.storageType as readonly string[]).includes(db.storageType)) {
      errors.push(`dbSpecificSettings.storageType: '${db.storageType}' is not a valid TABT enum value (expected one of ${TABT_VALID_ENUMS.storageType.join('|')})`);
    }
    if (typeof db.loadUnit === 'string' && !(TABT_VALID_ENUMS.loadUnit as readonly string[]).includes(db.loadUnit)) {
      errors.push(`dbSpecificSettings.loadUnit: '${db.loadUnit}' is not a valid TABT enum value (expected one of ${TABT_VALID_ENUMS.loadUnit.join('|')})`);
    }
  }
  return errors.length === 0 ? null : errors;
}
