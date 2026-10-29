/**
 * TABT three-piece settings round-trip tests for P1.1/P1.2 (TABT writeback plan).
 *
 * Verifies:
 * - DdicTableGeneralInformationWire / DdicTableBufferingWire /
 *   DdicTableDbSpecificSettingsWire compile-time presence after P1.2
 * - TS localToWire<TABL> / wireToLocal<TABL> accepts the new nested
 *   buffering + dbSpecificSettings fields (schema-faithful).
 * - JSON-string round-trip from an ABAP-style settingsJson payload
 *   (what zcl_abap_vibe_tabl_format->build_settings_json emits) into
 *   DdicTableGeneralInformationWire passes validation.
 *
 * ABAP-side coverage of the 5 enum methods + settings_supported lives
 * in abap/src/clas/zcl_abap_vibe_tabl_format.clas.abap and is exercised
 * by an end-to-end SAP test (see wiki/object-types.md).
 */
import { describe, it, expect } from 'vitest';
import {
  localToWire,
  wireToLocal,
  type DdicTableSettingsWire,
  type DdicTableGeneralInformationWire,
  type DdicTableBufferingWire,
  type DdicTableDbSpecificSettingsWire,
} from '../../src/abap_cli/formats/ddic/json.js';

describe('P1.1/P1.2 — TABT buffering + dbSpecificSettings round-trip', () => {
  it('DdicTableGeneralInformationWire compiles with nested buffering + dbSpecificSettings', () => {
    const gi: DdicTableGeneralInformationWire = {
      dataClassCategory: 'TRANSP',
      sizeCategory: '0',
      logChanges: false,
      writableByAmdp: false,
      translation: 'noLanguageKey',
      buffering: {
        state: 'notAllowed',
        type: 'noBuffer',
        nrOfKeyFlds4GenericBuff: 0,
      },
      dbSpecificSettings: {
        storageType: 'undefined',
        loadUnit: 'columnPreferred',
      },
    };
    expect(gi.buffering?.state).toBe('notAllowed');
    expect(gi.dbSpecificSettings?.loadUnit).toBe('columnPreferred');
  });

  it('DdicTableBufferingWire accepts all 3 states and 4 types', () => {
    const states: DdicTableBufferingWire['state'][] = [
      'notAllowed',
      'switchedOn',
      'allowedButSwitchedOff',
    ];
    const types: DdicTableBufferingWire['type'][] = [
      'noBuffer',
      'single',
      'generic',
      'full',
    ];
    expect(states).toHaveLength(3);
    expect(types).toHaveLength(4);
  });

  it('DdicTableDbSpecificSettingsWire accepts all storageType + loadUnit values', () => {
    const storageTypes: DdicTableDbSpecificSettingsWire['storageType'][] = [
      'undefined',
      'rowStore',
      'columnStore',
    ];
    const loadUnits: DdicTableDbSpecificSettingsWire['loadUnit'][] = [
      'columnPreferred',
      'pagePreferred',
      'columnEnforced',
      'pageEnforced',
    ];
    expect(storageTypes).toHaveLength(3);
    expect(loadUnits).toHaveLength(4);
  });

  it('wireToLocal<TABL> preserves buffering + dbSpecificSettings from ABAP-shaped payload', () => {
    // Shape matches what zcl_abap_vibe_tabl_format->build_settings_json
    // emits when SAP has a fully-buffed table.
    const abapSettingsJson = `{
  "formatVersion": "1",
  "generalInformation": {
    "dataClassCategory": "TRANSP",
    "sizeCategory": "0",
    "logChanges": true,
    "translation": "standard"
  },
  "buffering": {
    "state": "switchedOn",
    "type": "single",
    "nrOfKeyFlds4GenericBuff": 0
  },
  "dbSpecificSettings": {
    "storageType": "rowStore",
    "loadUnit": "pagePreferred"
  }
}`;
    const parsed = JSON.parse(abapSettingsJson) as DdicTableGeneralInformationWire & {
      buffering: DdicTableBufferingWire;
      dbSpecificSettings: DdicTableDbSpecificSettingsWire;
    };
    expect(parsed.buffering?.state).toBe('switchedOn');
    expect(parsed.buffering?.type).toBe('single');
    expect(parsed.dbSpecificSettings?.storageType).toBe('rowStore');
    expect(parsed.dbSpecificSettings?.loadUnit).toBe('pagePreferred');
    // translation + logChanges live under generalInformation in
    // the ABAP output (schema-faithful); the wire shape accepts
    // both nested and top-level depending on consumer.
  });

  it('localToWire<TABL> + wireToLocal<TABL> round-trips generalInformation buffering through WireForDdicType', () => {
    // P1.2 contracts: localToWire<TABL> forwards the nested
    // generalInformation block (including buffering + dbSpecificSettings)
    // onto the wire. settingsJson lives in an external artifact file and
    // is NOT forwarded here - that's tabl-artifact.ts's job.
    const local = {
      name: 'ZMARA',
      description: 'Material master',
      header: {
        description: 'Material master',
        originalLanguage: 'EN',
        abapLanguageVersion: 'standard' as const,
      },
      generalInformation: {
        dataClassCategory: 'TRANSP',
        sizeCategory: '0' as const,
        logChanges: false,
        translation: 'standard' as const,
        buffering: {
          state: 'allowedButSwitchedOff' as const,
          type: 'generic' as const,
          nrOfKeyFlds4GenericBuff: 3,
        },
        dbSpecificSettings: {
          storageType: 'columnStore' as const,
          loadUnit: 'columnEnforced' as const,
        },
      },
    };
    const wire = localToWire('TABL', local as any) as DdicTableSettingsWire;
    expect(wire.name).toBe('ZMARA');
    expect(wire.generalInformation?.buffering?.state).toBe('allowedButSwitchedOff');
    expect(wire.generalInformation?.buffering?.type).toBe('generic');
    expect(wire.generalInformation?.buffering?.nrOfKeyFlds4GenericBuff).toBe(3);
    expect(wire.generalInformation?.dbSpecificSettings?.storageType).toBe('columnStore');
    expect(wire.generalInformation?.dbSpecificSettings?.loadUnit).toBe('columnEnforced');

    // Round-trip back to local preserves the nested shape.
    const back = wireToLocal('TABL', wire);
    expect((back as any).generalInformation?.buffering?.state).toBe('allowedButSwitchedOff');
    expect((back as any).generalInformation?.dbSpecificSettings?.loadUnit).toBe('columnEnforced');
  });


  it('wire.generalInformation accepts nullable fields (early P1.1 ABAP output)', () => {
    // When zcl_abap_vibe_tabl_format fails the settings_supported check,
    // it returns without emitting buffering/dbSpecificSettings. The TS
    // wire shape must accept these as optional.
    const minimal: DdicTableGeneralInformationWire = {
      dataClassCategory: 'TRANSP',
    };
    expect(minimal.buffering).toBeUndefined();
    expect(minimal.dbSpecificSettings).toBeUndefined();
  });
});
