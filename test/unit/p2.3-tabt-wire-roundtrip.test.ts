/**
 * End-to-end TABT settings round-trip (P2.3 verification).
 *
 * Verifies the full CLI ↔ SAP wire shape for TABT technical settings:
 *
 *   1. ABAP `build_settings_json` emits a 3-section JSON (generalInformation +
 *      buffering + dbSpecificSettings) — simulated by fixture below.
 *   2. CLI `pull` writes the wire shape to `.tabl.settings.json` via
 *      `extractTablArtifactWire`.
 *   3. CLI `pull` re-reads it via `readDdicObjectForCreate` and assembles the
 *      local DdicObject with nested generalInformation.
 *   4. CLI `push` runs `localToWire<TABL>`, forwarding generalInformation to
 *      the wire payload that SAP's `apply_ddic_table_settings` receives.
 *   5. The wire payload substring matches every ABAP `iv_payload CS '"<key>"'`
 *      guard: logChanges / translation / state / type / nrOfKeyFlds4GenericBuff /
 *      storageType / loadUnit.
 *
 * If this test passes, P1.1 + P1.2 + P2.1 + P2.3 are wired together; the
 * only remaining check is the actual SAP `DDIF_TABL_PUT` side effect.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  extractTablArtifactWire,
  localToWire,
  wireToLocal,
  readDdicObjectForCreate,
  type DdicTableSettingsWire,
} from '../../src/abap_cli/formats/ddic/json.js';

/** Simulate ABAP build_settings_json output (P1.1 reference). */
const ABAP_SETTINGS_JSON = `{
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
}
`;

const ABAP_MAIN_JSON = `{
  "formatVersion": "1",
  "header": {
    "description": "Buffering test table",
    "originalLanguage": "EN"
  }
}
`;

const ABAP_DDIC_SOURCE = `@EndUserText.label : 'Buffering test table'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #RESTRICTED
define table zbuff_test {
  key client : abap.clnt not null;
  key matnr  : abap.char(18) not null;
}
`;

describe('P2.3 — end-to-end TABT settings round-trip', () => {
  it('pull path: SAP wire -> extractTablArtifactWire.settingsJson is verbatim ABAP output', () => {
    const wire = {
      name: 'ZBUFF_TEST',
      type: 'TABL' as const,
      mainJson: ABAP_MAIN_JSON,
      ddicSource: ABAP_DDIC_SOURCE,
      settingsJson: ABAP_SETTINGS_JSON,
      hasSettings: true,
    } as unknown as DdicTableSettingsWire;

    const pieces = extractTablArtifactWire(wire);
    expect(pieces).toBeDefined();
    expect(pieces!.hasSettings).toBe(true);
    expect(pieces!.settingsJson).toBe(ABAP_SETTINGS_JSON);
  });

  it('full round-trip: pull artifact -> three-piece files -> readDdicObjectForCreate -> localToWire -> ABAP payload', async () => {
    // 1. Set up a tmp dir mimicking what writePullDdicTabl would produce.
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'p23-tabt-'));
    try {
      const folder = path.join(tmpDir, 'src', 'tabl');
      await fs.mkdir(folder, { recursive: true });
      const mainAbs = path.join(folder, 'zbuff_test.tabl.json');
      const ddicAbs = path.join(folder, 'zbuff_test.tabl.ddic');
      const settingsAbs = path.join(folder, 'zbuff_test.tabl.settings.json');
      await fs.writeFile(mainAbs, ABAP_MAIN_JSON, 'utf-8');
      await fs.writeFile(ddicAbs, ABAP_DDIC_SOURCE, 'utf-8');
      await fs.writeFile(settingsAbs, ABAP_SETTINGS_JSON, 'utf-8');

      // 2. CLI readDdicObjectForCreate reads all three pieces and assembles
      //    local.generalInformation from .tabl.settings.json (P2.3 merges
      //    top-level buffering + dbSpecificSettings under generalInformation).
      const local = await readDdicObjectForCreate(mainAbs, 'TABL');
      expect((local as any).generalInformation).toBeDefined();
      expect((local as any).generalInformation.buffering).toEqual({
        state: 'switchedOn',
        type: 'single',
        nrOfKeyFlds4GenericBuff: 0,
      });
      expect((local as any).generalInformation.dbSpecificSettings).toEqual({
        storageType: 'rowStore',
        loadUnit: 'pagePreferred',
      });
      expect((local as any).generalInformation.logChanges).toBe(true);
      expect((local as any).generalInformation.translation).toBe('standard');

      // 3. CLI localToWire<TABL> -> wire payload that ABAP apply_ddic_table_settings receives.
      const wire = localToWire('TABL', local) as DdicTableSettingsWire;
      expect(wire.generalInformation).toBeDefined();
      expect(wire.generalInformation?.buffering?.state).toBe('switchedOn');
      expect(wire.generalInformation?.buffering?.type).toBe('single');
      expect(wire.generalInformation?.dbSpecificSettings?.storageType).toBe('rowStore');
      expect(wire.generalInformation?.dbSpecificSettings?.loadUnit).toBe('pagePreferred');

      // 4. Verify ABAP apply_ddic_table_settings substring guards would all fire.
      //    When CLI POSTs the wire to /ddic/tabl, SAP serializes it as JSON;
      //    the substring checks happen on that string.
      const payloadForSap = JSON.stringify(wire);
      expect(payloadForSap).toContain('"logChanges"');
      expect(payloadForSap).toContain('"translation"');
      expect(payloadForSap).toContain('"state"');
      expect(payloadForSap).toContain('"type"');
      expect(payloadForSap).toContain('"nrOfKeyFlds4GenericBuff"');
      expect(payloadForSap).toContain('"storageType"');
      expect(payloadForSap).toContain('"loadUnit"');

      // 5. Reverse path: wireToLocal<TABL> round-trip.
      const back = wireToLocal('TABL', wire);
      expect((back as any).generalInformation?.buffering?.state).toBe('switchedOn');
      expect((back as any).generalInformation?.dbSpecificSettings?.storageType).toBe('rowStore');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('partial settings payload (only buffering, no logChanges/translation) triggers only buffering path', () => {
    // When the user edits .tabl.settings.json to change buffering but keeps
    // logChanges/translation unchanged, ABAP's gated `iv_payload CS '"<key>"'`
    // checks mean only the buffering fields get re-applied to DD09L.
    const wire = localToWire('TABL', {
      name: 'ZBUFF_TEST',
      generalInformation: {
        buffering: { state: 'allowedButSwitchedOff', type: 'generic', nrOfKeyFlds4GenericBuff: 2 },
        dbSpecificSettings: { storageType: 'columnStore', loadUnit: 'columnEnforced' },
      },
    } as any) as DdicTableSettingsWire;
    const payloadForSap = JSON.stringify(wire);

    // ABAP P2.1 gate fires (buffering/dbSpecificSettings present):
    expect(payloadForSap).toContain('"buffering"');
    expect(payloadForSap).toContain('"dbSpecificSettings"');
    // Per-field gates that fire:
    expect(payloadForSap).toContain('"state"');
    expect(payloadForSap).toContain('"type"');
    expect(payloadForSap).toContain('"nrOfKeyFlds4GenericBuff"');
    expect(payloadForSap).toContain('"storageType"');
    expect(payloadForSap).toContain('"loadUnit"');
    // logChanges/translation absent from payload -> SAP keeps DD09L untouched
    // for those fields.
    expect(payloadForSap).not.toContain('"logChanges"');
    expect(payloadForSap).not.toContain('"translation"');
  });

  it('plain settings.json (no buffering/dbSpecificSettings) does not trigger apply_ddic_table_settings', () => {
    // TABL with only deliveryClass/dataClass/sizeCategory (create-time only).
    // ABAP's gate must NOT fire -- apply_ddic_table_settings would error on
    // missing buffering fields.
    const wire = localToWire('TABL', {
      name: 'ZCREATE_ONLY',
      generalInformation: {
        deliveryClass: 'A',
        dataClassCategory: 'APPL0',
        sizeCategory: '0',
        clientDependent: false,
      },
    } as any) as DdicTableSettingsWire;
    const payloadForSap = JSON.stringify(wire);

    // Gate check (ABAP create_ddic_table line 2201):
    expect(payloadForSap).not.toContain('"logChanges"');
    expect(payloadForSap).not.toContain('"translation"');
    expect(payloadForSap).not.toContain('"buffering"');
    expect(payloadForSap).not.toContain('"dbSpecificSettings"');
  });
});
