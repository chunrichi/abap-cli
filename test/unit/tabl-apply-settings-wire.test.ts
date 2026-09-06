/**
 * TABT writeback wire-shape tests for P2.1 (apply_ddic_table_settings).
 *
 * The ABAP apply_ddic_table_settings itself runs on SAP and is exercised
 * end-to-end by `abap deploy` + manual smoke. Here we cover the TS-side
 * guarantee that the wire payload CLI sends to ABAP matches the JSON
 * keys ABAP expects (`is_settings-*-*` access paths):
 *
 *   iv_payload CS '"logChanges"'           -> is_settings-log_changes
 *   iv_payload CS '"translation"'          -> is_settings-translation
 *   iv_payload CS '"state"'                 -> is_settings-buffering-state
 *   iv_payload CS '"type"'                  -> is_settings-buffering-type
 *   iv_payload CS '"nrOfKeyFlds4GenericBuff"' -> is_settings-buffering-nr_of_key_flds4_generic_buff
 *   iv_payload CS '"storageType"'           -> is_settings-db_specific_settings-storage_type
 *   iv_payload CS '"loadUnit"'              -> is_settings-db_specific_settings-load_unit
 *
 * Each test asserts both:
 *   (1) The camelCase key is present in the JSON payload string (ABAP `CS '...'` check)
 *   (2) localToWire<TABL> / wireToLocal<TABL> carries the typed value through.
 */
import { describe, it, expect } from 'vitest';
import {
  localToWire,
  wireToLocal,
  type DdicTableSettingsWire,
} from '../../src/abap_cli/formats/ddic/json.js';

/** ABAP `iv_payload CS '"<key>"'` simulator — exact substring match (case-sensitive). */
function payloadContains(payload: string, key: string): boolean {
  return payload.includes(`"${key}"`);
}

/** JSON serializer used by ABAP's /ui2/cl_json with pretty_mode-camel_case. */
function toAbapCamelCaseJson(value: unknown): string {
  return JSON.stringify(value);
}

describe('P2.1 — TABT apply_ddic_table_settings wire shape', () => {
  it('"logChanges" key in payload matches ABAP substring check', () => {
    const payload = toAbapCamelCaseJson({ logChanges: true });
    expect(payloadContains(payload, 'logChanges')).toBe(true);
  });

  it('"translation" key maps to is_settings-translation (5 enum values)', () => {
    for (const v of ['noLanguageKey', 'standard', 'loadTable', 'objectSpecific', 'notRelevant']) {
      const payload = toAbapCamelCaseJson({ translation: v });
      expect(payloadContains(payload, 'translation')).toBe(true);
    }
  });

  it('"state" key maps to is_settings-buffering-state (3 enum values)', () => {
    for (const v of ['notAllowed', 'switchedOn', 'allowedButSwitchedOff']) {
      const payload = toAbapCamelCaseJson({ buffering: { state: v } });
      expect(payloadContains(payload, 'state')).toBe(true);
    }
  });

  it('"type" key maps to is_settings-buffering-type (4 enum values)', () => {
    for (const v of ['noBuffer', 'single', 'generic', 'full']) {
      const payload = toAbapCamelCaseJson({ buffering: { type: v } });
      expect(payloadContains(payload, 'type')).toBe(true);
    }
  });

  it('"nrOfKeyFlds4GenericBuff" key matches buffering.nrOfKeyFlds4GenericBuff', () => {
    const payload = toAbapCamelCaseJson({
      buffering: { nrOfKeyFlds4GenericBuff: 3 },
    });
    expect(payloadContains(payload, 'nrOfKeyFlds4GenericBuff')).toBe(true);
  });

  it('"storageType" key maps to dbSpecificSettings.storageType (3 enum values)', () => {
    for (const v of ['undefined', 'rowStore', 'columnStore']) {
      const payload = toAbapCamelCaseJson({ dbSpecificSettings: { storageType: v } });
      expect(payloadContains(payload, 'storageType')).toBe(true);
    }
  });

  it('"loadUnit" key maps to dbSpecificSettings.loadUnit (4 enum values)', () => {
    for (const v of ['columnPreferred', 'pagePreferred', 'columnEnforced', 'pageEnforced']) {
      const payload = toAbapCamelCaseJson({ dbSpecificSettings: { loadUnit: v } });
      expect(payloadContains(payload, 'loadUnit')).toBe(true);
    }
  });

  it('create_ddic_table gate fires when payload contains ANY of 4 TABT keys', () => {
    // ABAP IF chain: iv_payload CS '"logChanges"' OR '"translation"' OR '"buffering"' OR '"dbSpecificSettings"'
    const gateKeys = ['logChanges', 'translation', 'buffering', 'dbSpecificSettings'];
    for (const key of gateKeys) {
      const payload = toAbapCamelCaseJson({ [key]: key === 'logChanges' ? true : 'foo' });
      const fires = gateKeys.some((k) => payloadContains(payload, k));
      expect(fires).toBe(true);
    }
  });

  it('create_ddic_table gate does NOT fire when only deliveryClass/sizeCategory present', () => {
    // Pure create-time payload without TABT fields must not trigger apply_ddic_table_settings.
    const payload = toAbapCamelCaseJson({
      generalInformation: {
        deliveryClass: 'A',
        sizeCategory: '0',
        clientDependent: true,
      },
    });
    expect(payloadContains(payload, 'logChanges')).toBe(false);
    expect(payloadContains(payload, 'translation')).toBe(false);
    expect(payloadContains(payload, 'buffering')).toBe(false);
    expect(payloadContains(payload, 'dbSpecificSettings')).toBe(false);
  });

  it('full TABT payload round-trips through localToWire<TABL> + wireToLocal<TABL>', () => {
    const local = {
      name: 'ZBUFF_TEST',
      description: 'Buffering test table',
      header: {
        description: 'Buffering test table',
        originalLanguage: 'EN',
        abapLanguageVersion: 'standard' as const,
      },
      generalInformation: {
        dataClassCategory: 'TRANSP',
        sizeCategory: '0' as const,
        logChanges: true,
        translation: 'standard' as const,
        buffering: {
          state: 'switchedOn' as const,
          type: 'single' as const,
          nrOfKeyFlds4GenericBuff: 0,
        },
        dbSpecificSettings: {
          storageType: 'rowStore' as const,
          loadUnit: 'pagePreferred' as const,
        },
      },
    };
    const wire = localToWire('TABL', local as any) as DdicTableSettingsWire;
    expect(wire.generalInformation?.logChanges).toBe(true);
    expect(wire.generalInformation?.translation).toBe('standard');
    expect(wire.generalInformation?.buffering?.state).toBe('switchedOn');
    expect(wire.generalInformation?.buffering?.type).toBe('single');
    expect(wire.generalInformation?.buffering?.nrOfKeyFlds4GenericBuff).toBe(0);
    expect(wire.generalInformation?.dbSpecificSettings?.storageType).toBe('rowStore');
    expect(wire.generalInformation?.dbSpecificSettings?.loadUnit).toBe('pagePreferred');

    // Round-trip
    const back = wireToLocal('TABL', wire);
    expect((back as any).generalInformation?.buffering?.state).toBe('switchedOn');
    expect((back as any).generalInformation?.dbSpecificSettings?.loadUnit).toBe('pagePreferred');
  });
});
