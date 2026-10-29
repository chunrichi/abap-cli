/**
 * P3.1: TABT settings payload enum validation tests.
 *
 * Validates that `validateTabtPayload` (synchronous, in `formats/ddic/json.ts`)
 * correctly enforces the enum values declared by `src/abap_cli/schema/tabt-v1.json`:
 *
 *   - generalInformation.translation: noLanguageKey|standard|loadTable|objectSpecific|notRelevant
 *   - generalInformation.sizeCategory: undefined|0..9
 *   - generalInformation.buffering.state: notAllowed|switchedOn|allowedButSwitchedOff
 *   - generalInformation.buffering.type: noBuffer|single|generic|full
 *   - generalInformation.dbSpecificSettings.storageType: undefined|rowStore|columnStore
 *   - generalInformation.dbSpecificSettings.loadUnit: columnPreferred|pagePreferred|columnEnforced|pageEnforced
 */
import { describe, it, expect } from 'vitest';
import { validateTabtPayload } from '../../src/abap_cli/formats/ddic/json.js';

describe('P3.1 — validateTabtPayload enum checks', () => {
  it('returns null (valid) for a complete payload', () => {
    expect(validateTabtPayload({
      translation: 'standard',
      sizeCategory: '0',
      buffering: { state: 'switchedOn', type: 'single', nrOfKeyFlds4GenericBuff: 0 },
      dbSpecificSettings: { storageType: 'rowStore', loadUnit: 'pagePreferred' },
    })).toBeNull();
  });

  it('returns null (valid) for empty settings (only create-time fields present)', () => {
    expect(validateTabtPayload({
      dataClassCategory: 'TRANSP',
      clientDependent: true,
    })).toBeNull();
  });

  it('rejects invalid translation', () => {
    const errs = validateTabtPayload({ translation: 'bogus' });
    expect(errs).not.toBeNull();
    expect(errs![0]).toMatch(/translation.*bogus/);
  });

  it('rejects invalid sizeCategory (numeric > 9)', () => {
    expect(validateTabtPayload({ sizeCategory: '10' })![0]).toMatch(/sizeCategory/);
  });

  it('rejects invalid buffering.state', () => {
    const errs = validateTabtPayload({
      buffering: { state: 'switched_off' },
    });
    expect(errs).not.toBeNull();
    expect(errs![0]).toMatch(/buffering\.state/);
  });

  it('rejects invalid buffering.type', () => {
    const errs = validateTabtPayload({
      buffering: { type: 'partial' },
    });
    expect(errs![0]).toMatch(/buffering\.type/);
  });

  it('rejects invalid dbSpecificSettings.storageType', () => {
    const errs = validateTabtPayload({
      dbSpecificSettings: { storageType: 'memory' },
    });
    expect(errs![0]).toMatch(/storageType/);
  });

  it('rejects invalid dbSpecificSettings.loadUnit', () => {
    const errs = validateTabtPayload({
      dbSpecificSettings: { loadUnit: 'lazy' },
    });
    expect(errs![0]).toMatch(/loadUnit/);
  });

  it('collects multiple errors in a single pass', () => {
    const errs = validateTabtPayload({
      translation: 'bogus',
      buffering: { state: 'invalid', type: 'invalid' },
      dbSpecificSettings: { storageType: 'invalid', loadUnit: 'invalid' },
    });
    expect(errs).not.toBeNull();
    // 1 translation + 1 buffering.state + 1 buffering.type + 1 storageType + 1 loadUnit = 5
    expect(errs!.length).toBe(5);
  });

  it('tolerates partial settings (only buffering, no translation/dbSpecific)', () => {
    expect(validateTabtPayload({
      buffering: { state: 'notAllowed', type: 'noBuffer' },
    })).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(validateTabtPayload(null)).toBeNull();
    expect(validateTabtPayload(undefined)).toBeNull();
    expect(validateTabtPayload('string')).toBeNull();
    expect(validateTabtPayload(42)).toBeNull();
  });

  it('accepts all valid translation values (5 enums)', () => {
    for (const v of ['noLanguageKey', 'standard', 'loadTable', 'objectSpecific', 'notRelevant']) {
      expect(validateTabtPayload({ translation: v })).toBeNull();
    }
  });

  it('accepts all valid storageType values (3 enums)', () => {
    for (const v of ['undefined', 'rowStore', 'columnStore']) {
      expect(validateTabtPayload({ dbSpecificSettings: { storageType: v } })).toBeNull();
    }
  });
});
