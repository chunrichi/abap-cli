/**
  ddic-json.ts mapping round-trip tests. Written TDD-style — these tests
 * targeted the abap-file-format ↔ wire schema conversion before the SAP-side
 * ZCL_ABAP_VIBE_DDIC class was completed (Validates T005).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  localToWire,
  wireToLocal,
  localFieldToWire,
  wireFieldToLocal,
  validateDdicObject,
  DDIC_SUPPORTED_TYPES,
  getDdicJsonExample,
  getDdicFlatJsonExample,
  readDdicObjectForCreate,
} from '../../src/abap_cli/formats/ddic/json.js';

describe('014/ddic-json-map', () => {
  describe('supported types', () => {
    it('exposes DOMA/DTEL/TABL/STRU (TTYP deferred per Q2)', () => {
      expect(DDIC_SUPPORTED_TYPES).toEqual(['DOMA', 'DTEL', 'TABL', 'STRU']);
    });
  });

  describe('localFieldToWire', () => {
    it('maps snake_case local fields to camelCase wire fields', () => {
      const wire = localFieldToWire({
        fieldName: 'FIELD1',
        rollname: 'ZDMY_DE',
        dataType: 'CHAR',
        length: 20,
        decimals: 0,
        keyFlag: true,
        notNull: true,
        ddtext: 'Field 1',
        refTable: 'Z_REF',
        refField: 'Z_REF_F',
        checkTable: 'Z_CHECK',
      });
      expect(wire).toEqual({
        fieldName: 'FIELD1',
        rollname: 'ZDMY_DE',
        dataType: 'CHAR',
        length: 20,
        decimals: 0,
        keyFlag: true,
        notNull: true,
        ddtext: 'Field 1',
        refTable: 'Z_REF',
        refField: 'Z_REF_F',
        checkTable: 'Z_CHECK',
      });
    });

    it('coerces string numbers to number (JSON v1 files often have stringified numbers)', () => {
      const wire = localFieldToWire({ fieldName: 'F', length: '10', decimals: '2' });
      expect(wire.length).toBe(10);
      expect(wire.decimals).toBe(2);
    });

    it('omits undefined optional fields', () => {
      const wire = localFieldToWire({ fieldName: 'F' });
      expect(wire).toEqual({ fieldName: 'F' });
      expect('rollname' in wire).toBe(false);
    });
  });

  describe('wireFieldToLocal', () => {
    it('maps wire field back to local shape (round-trip)', () => {
      const local = wireFieldToLocal({
        fieldName: 'FIELD1',
        dataType: 'CHAR',
        length: 20,
        keyFlag: true,
        notNull: true,
        ddtext: 'Field 1',
      });
      expect(local).toEqual({
        fieldName: 'FIELD1',
        dataType: 'CHAR',
        length: 20,
        keyFlag: true,
        notNull: true,
        ddtext: 'Field 1',
      });
    });
  });

  describe('field-level round-trip', () => {
    it('local -> wire -> local preserves all fields', () => {
      const src = {
        fieldName: 'F',
        rollname: 'ZDMY',
        dataType: 'CHAR',
        length: 10,
        decimals: 0,
        keyFlag: false,
        notNull: true,
        ddtext: 'desc',
        refTable: 'ZREF',
        refField: 'ZREFF',
        checkTable: 'ZCHK',
      };
      expect(wireFieldToLocal(localFieldToWire(src))).toEqual(src);
    });
  });

  describe('localToWire — TABL (AFF nested generalInformation)', () => {
    it('maps table fields + generalInformation (AFF canonical)', () => {
      const wire = localToWire('TABL', {
        name: 'ztab',
        description: 'Example table',
        header: { description: 'Example table', originalLanguage: 'EN' },
        generalInformation: {
          deliveryClass: 'A',
          dataClassCategory: 'APPL0',
          sizeCategory: '0',
          clientDependent: true,
        },
        fields: [
          { fieldName: 'FIELD1', dataType: 'CHAR', length: 20, keyFlag: true },
          { fieldName: 'FIELD2', rollname: 'ZDMY_DE' },
        ],
        package: '$TMP',
        transportRequest: '',
      });
      expect(wire.name).toBe('ZTAB');
      // No flat top-level fields on the wire (AFF canonical).
      expect((wire as Record<string, unknown>).deliveryClass).toBeUndefined();
      expect((wire as Record<string, unknown>).clientDependent).toBeUndefined();
      expect((wire as Record<string, unknown>).dataClass).toBeUndefined();
      expect(wire.generalInformation?.deliveryClass).toBe('A');
      expect(wire.generalInformation?.dataClassCategory).toBe('APPL0');
      expect(wire.generalInformation?.sizeCategory).toBe('0');
      expect(wire.generalInformation?.clientDependent).toBe(true);
      expect(wire.fields).toHaveLength(2);
      expect(wire.fields![0]!.fieldName).toBe('FIELD1');
      expect(wire.fields![0]!.keyFlag).toBe(true);
      expect(wire.fields![1]!.rollname).toBe('ZDMY_DE');
    });
  });

  describe('localToWire — DOMA (AFF nested format.*)', () => {
    it('reads dataType/length/decimals from nested format.* (AFF canonical)', () => {
      const wire = localToWire('DOMA', {
        name: 'ZD',
        description: 'Domain',
        format: {
          dataType: 'CHAR',
          length: 3,
          decimals: 0,
          signFlag: 'X',
          lowercase: '',
          convExit: 'ALPHA',
        },
      });
      // No flat top-level fields on the wire (AFF canonical).
      expect((wire as Record<string, unknown>).dataType).toBeUndefined();
      expect((wire as Record<string, unknown>).length).toBeUndefined();
      expect((wire as Record<string, unknown>).signFlag).toBeUndefined();
      expect(wire.format?.dataType).toBe('CHAR');
      expect(wire.format?.length).toBe(3);
      expect(wire.format?.signFlag).toBe('X');
      expect(wire.format?.lowercase).toBe('');
      expect(wire.format?.convExit).toBe('ALPHA');
    });
  });

  describe('localToWire — DTEL (AFF dataTypeInformation.*)', () => {
    it('reads domain reference from nested dataTypeInformation (AFF canonical)', () => {
      const wire = localToWire('DTEL', {
        name: 'ZDE',
        description: 'Data element',
        dataTypeInformation: {
          category: 'domain',
          typeName: 'ZD',
        },
        shortText: 'Short',
        mediumText: 'Medium text',
        longText: 'Long text',
        headerText: 'Header',
      });
      expect((wire as Record<string, unknown>).domain).toBeUndefined();
      expect(wire.dataTypeInformation?.category).toBe('domain');
      expect(wire.dataTypeInformation?.typeName).toBe('ZD');
      expect(wire.shortText).toBe('Short');
      expect(wire.headerText).toBe('Header');
    });
  });

  describe('wireToLocal / round-trip', () => {
    it('TABL round-trip preserves fields[]', () => {
      const src = {
        name: 'ZTAB',
        description: 'Table',
        fields: [
          { fieldName: 'A', dataType: 'CHAR', length: 10, keyFlag: true },
          { fieldName: 'B', rollname: 'ZDMY' },
        ],
      };
      expect(wireToLocal('TABL', localToWire('TABL', src))).toEqual({
        ...src,
        package: undefined,
        transportRequest: undefined,
      });
    });

    it('DOMA round-trip preserves signFlag, lowercase, convExit (nested format.*)', () => {
      const src = {
        name: 'ZD',
        description: 'Domain',
        format: {
          dataType: 'QUAN',
          length: 13,
          decimals: 3,
          signFlag: 'X',
          lowercase: '',
          convExit: 'ALPHA',
        },
        outputCharacteristics: { length: 17 },
      };
      expect(wireToLocal('DOMA', localToWire('DOMA', src))).toEqual({
        ...src,
        package: undefined,
        transportRequest: undefined,
      });
    });
  });

  describe('validateDdicObject', () => {
    it('flags missing name', () => {
      const errors = validateDdicObject({} as any, 'DOMA');
      expect(errors.some((e) => e.includes('Missing required field: name'))).toBe(true);
    });

    it('BUG-1: missing-name error tells the user the field is top-level', () => {
      const errors = validateDdicObject({} as any, 'DOMA');
      expect(errors.some((e) => e.includes('name') && e.includes('top-level'))).toBe(true);
    });

    it('BUG-1: missing-fields error tells the user fields[] is top-level', () => {
      const errors = validateDdicObject({ name: 'ZTAB_EXAMPLE', description: 'd' } as any, 'TABL');
      expect(errors.some((e) => e.includes('fields') && e.includes('top-level'))).toBe(true);
    });

    it('flags invalid namespace', () => {
      const errors = validateDdicObject({ name: 'XTAB', description: 'x', fields: [] } as any, 'TABL');
      expect(errors.some((e) => e.includes('Invalid namespace'))).toBe(true);
    });

    it('accepts Z, Y, and slash namespaces', () => {
      expect(
        validateDdicObject({ name: 'Z', description: 'x' } as any, 'DOMA')
          .some((e) => e.includes('Missing required field: name')),
      ).toBe(false);
      expect(validateDdicObject({ name: 'Y_X', description: 'x' } as any, 'DOMA').some((e) => e.includes('Invalid namespace'))).toBe(false);
      expect(validateDdicObject({ name: '/DMO/CL_FOO', description: 'x' } as any, 'DOMA').some((e) => e.includes('Invalid namespace'))).toBe(false);
    });

    it('DOMA requires format.dataType and format.length (AFF canonical)', () => {
      const errors = validateDdicObject({ name: 'ZD', description: 'd' } as any, 'DOMA');
      expect(errors.some((e) => e.includes('format.dataType'))).toBe(true);
      expect(errors.some((e) => e.includes('format.length'))).toBe(true);
    });

    it('DTEL requires description and dataTypeInformation (AFF canonical)', () => {
      const errors = validateDdicObject({ name: 'ZDE' } as any, 'DTEL');
      expect(errors.some((e) => e.includes('description'))).toBe(true);
      expect(errors.some((e) => e.includes('dataTypeInformation'))).toBe(true);
    });

    it('TABL/STRU require non-empty fields[]', () => {
      expect(validateDdicObject({ name: 'Z', description: 'x' } as any, 'TABL')).toBeTruthy();
      const errors = validateDdicObject({ name: 'Z', description: 'x', fields: [{}] } as any, 'TABL');
      expect(errors.some((e) => e.includes('fieldName'))).toBe(true);
    });
  });

  describe('getDdicJsonExample (abap-file-format, happy-path contract)', () => {
    it('returns a non-empty example for each DDIC type', () => {
      for (const t of DDIC_SUPPORTED_TYPES) {
        const ex = getDdicJsonExample(t);
        expect(ex.length).toBeGreaterThan(0);
      }
    });

    it('TABL/STRU examples follow the abap-file-format three-piece layout (main JSON + .ddic + optional settings)', () => {
      for (const t of ['TABL', 'STRU'] as const) {
        const ex = getDdicJsonExample(t);
        expect(ex, `TABL/STRU example must mention .${t.toLowerCase()}.json`).toMatch(new RegExp(`\\.${t.toLowerCase()}\\.json`));
        expect(ex, `TABL/STRU example must mention .${t.toLowerCase()}.ddic`).toMatch(new RegExp(`\\.${t.toLowerCase()}\\.ddic`));
        expect(ex, 'TABL/STRU example must include a DDL `define table|structure` snippet').toMatch(/define\s+(table|structure)\s+\w+\s*\{/);
        if (t === 'TABL') {
          expect(ex, 'TABL example mentions optional .tabl.settings.json').toMatch(/\.tabl\.settings\.json/);
        }
      }
    });

    it('DOMA/DTEL examples are single-file (no abap-file-format three-piece)', () => {
      for (const t of ['DOMA', 'DTEL'] as const) {
        const ex = getDdicJsonExample(t);
        expect(ex).not.toMatch(/\.ddic\b/);
        expect(ex).toMatch(/"name"\s*:/);
        const jsonPart = ex.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
        const parsed = JSON.parse(jsonPart);
        expect(parsed.name).toBeTruthy();
      }
    });
  });

  describe('getDdicFlatJsonExample (BUG-1 legacy wire-flat fallback)', () => {
    it('returns a parseable wire-flat example for every DDIC type (used in VALIDATION_ERROR envelope)', () => {
      for (const t of DDIC_SUPPORTED_TYPES) {
        const ex = getDdicFlatJsonExample(t);
        expect(ex).toMatch(/"name"\s*:/);
        if (t === 'TABL' || t === 'STRU') {
          expect(ex).toMatch(/"fields"\s*:/);
        }
        const parsed = JSON.parse(ex);
        expect(parsed.name).toBeTruthy();
      }
    });
  });

  describe('readDdicObjectForCreate (abap-file-format three-piece reader)', () => {
    it('TABL: reads main + .tabl.ddic + .tabl.settings.json together (deliveryClass / dataClass / sizeCategory / clientDependent / fields from DDL)', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddic-read-'));
      try {
        fs.writeFileSync(path.join(dir, 'ztabx.tabl.json'), JSON.stringify({
          formatVersion: '1',
          header: { description: 'three-piece TABL', originalLanguage: 'en' },
        }, null, 2));
        fs.writeFileSync(path.join(dir, 'ztabx.tabl.ddic'),
          "@EndUserText.label : 'three-piece TABL'\n" +
          "@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE\n" +
          "@AbapCatalog.tableCategory : #TRANSPARENT\n" +
          "@AbapCatalog.deliveryClass : #L\n" +
          "@AbapCatalog.dataMaintenance : #RESTRICTED\n" +
          "define table ztabx {\n" +
          "  key client : abap.clnt not null;\n" +
          "  key id     : abap.char(10) not null;\n" +
          "  payload   : abap.char(255);\n" +
          "}\n");
        fs.writeFileSync(path.join(dir, 'ztabx.tabl.settings.json'), JSON.stringify({
          formatVersion: '1',
          generalInformation: { dataClassCategory: 'APPL1', sizeCategory: '3' },
        }, null, 2));

        const local = await readDdicObjectForCreate(path.join(dir, 'ztabx.tabl.json'), 'TABL');
        expect(local.name).toBe('ZTABX');
        expect(local.description).toBe('three-piece TABL');
        // 033: AFF canonical — settings live under generalInformation.*.
        expect((local as Record<string, unknown>).generalInformation).toMatchObject({
          deliveryClass: 'L',
          dataClassCategory: 'APPL1',
          sizeCategory: '3',
          clientDependent: true,
        });
        // fields order matches DDL, MANDT/CLIENT dropped from output (server-side MANDT is server's job).
        expect((local.fields as any[]).map((f) => f.fieldName)).toEqual(['ID', 'PAYLOAD']);
        expect((local.fields as any[])[0]).toMatchObject({ fieldName: 'ID', dataType: 'CHAR', length: 10, keyFlag: true, notNull: true });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('TABL: falls back to wire-flat single-file when no .tabl.ddic sidecar exists (legacy 014 contract)', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddic-read-'));
      try {
        fs.writeFileSync(path.join(dir, 'zflat.tabl.json'), JSON.stringify({
          name: 'ZFLAT',
          description: 'flat',
          deliveryClass: 'A',
          fields: [{ fieldName: 'F1', dataType: 'CHAR', length: 5 }],
        }, null, 2));
        const local = await readDdicObjectForCreate(path.join(dir, 'zflat.tabl.json'), 'TABL');
        expect(local.name).toBe('ZFLAT');
        expect((local.fields as any[])[0]?.fieldName).toBe('F1');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('TABL: surfaces TABL_DDL_INVALID (not INVALID_ARGUMENT) when the .tabl.ddic is malformed', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddic-read-'));
      try {
        fs.writeFileSync(path.join(dir, 'zbad.tabl.json'), JSON.stringify({ formatVersion: '1', header: { description: 'bad' } }, null, 2));
        fs.writeFileSync(path.join(dir, 'zbad.tabl.ddic'), '@AbapCatalog.deliveryClass : #L\n');
        await expect(readDdicObjectForCreate(path.join(dir, 'zbad.tabl.json'), 'TABL'))
          .rejects.toThrow(/Table and Structure DDL/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('STRU: reads main + .stru.ddic together (no settings sidecar required)', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddic-read-'));
      try {
        fs.writeFileSync(path.join(dir, 'zsx.stru.json'), JSON.stringify({
          formatVersion: '1',
          header: { description: 'three-piece STRU', originalLanguage: 'en' },
        }, null, 2));
        fs.writeFileSync(path.join(dir, 'zsx.stru.ddic'),
          "@EndUserText.label : 'three-piece STRU'\n" +
          "define structure zsx {\n" +
          "  field1 : abap.char(10);\n" +
          "}\n");

        const local = await readDdicObjectForCreate(path.join(dir, 'zsx.stru.json'), 'STRU');
        expect(local.name).toBe('ZSX');
        expect((local.fields as any[]).map((f) => f.fieldName)).toEqual(['FIELD1']);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('DOMA: ignores tabl-artifact path helpers (single-file wire-flat only)', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddic-read-'));
      try {
        fs.writeFileSync(path.join(dir, 'zd.doma.json'), JSON.stringify({
          name: 'ZD', description: 'Domain', dataType: 'CHAR', length: 4,
        }, null, 2));
        const local = await readDdicObjectForCreate(path.join(dir, 'zd.doma.json'), 'DOMA');
        expect(local.name).toBe('ZD');
        expect(local.dataType).toBe('CHAR');
        expect((local as any).length).toBe(4);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('client-key fields (CLIENT/MANDT) on the wire-flat path', () => {
    it('localToWire drops CLIENT/MANDT from fields[] (server prepends MANDT)', () => {
      const wire = localToWire('TABL', {
        name: 'ztab',
        clientDependent: true,
        fields: [
          { fieldName: 'CLIENT', dataType: 'CLNT', length: 3, keyFlag: true },
          { fieldName: 'MANDT', dataType: 'CLNT', length: 3, keyFlag: true },
          { fieldName: 'ID', dataType: 'CHAR', length: 10, keyFlag: true },
        ],
      });
      expect(wire.fields!.map((f) => f.fieldName)).toEqual(['ID']);
      expect(wire.warnings).toEqual([
        expect.objectContaining({
          code: 'CLIENT_FIELD_STRIPPED',
          message: expect.stringContaining('CLIENT'),
        }),
      ]);
    });

    it('localToWire does not strip non-client fields that happen to look like one', () => {
      const wire = localToWire('TABL', {
        name: 'ztab',
        clientDependent: false,
        fields: [
          { fieldName: 'CLIENT_ID', dataType: 'CHAR', length: 10 },
          { fieldName: 'MANDANT_TXT', dataType: 'CHAR', length: 20 },
        ],
      });
      expect(wire.fields!.map((f) => f.fieldName)).toEqual(['CLIENT_ID', 'MANDANT_TXT']);
      expect(wire.warnings).toBeUndefined();
    });

    it('validateDdicObject rejects a TABL whose only fields are client-key columns', () => {
      const errors = validateDdicObject({
        name: 'ZEMPTY',
        clientDependent: true,
        fields: [
          { fieldName: 'CLIENT', dataType: 'CLNT', length: 3, keyFlag: true },
        ],
      }, 'TABL');
      expect(errors.some((e) => e.includes('only client-key columns'))).toBe(true);
    });

    it('validateDdicObject flags duplicate fieldName', () => {
      const errors = validateDdicObject({
        name: 'ZDUP',
        clientDependent: false,
        fields: [
          { fieldName: 'A', dataType: 'CHAR', length: 1 },
          { fieldName: 'a', dataType: 'CHAR', length: 2 }, // case-insensitive duplicate
        ],
      }, 'TABL');
      expect(errors.some((e) => e.includes('declared more than once'))).toBe(true);
    });
  });

  // ----- T2.1 wire payload split -----

  describe('T2.1 per-type wire payloads', () => {
    it('localToWire<DOMA> returns a DdicDomaWire carrying format.* fields', () => {
      const wire = localToWire('DOMA', {
        name: 'ZDOMA_SPLIT',
        format: { dataType: 'CHAR', length: 10 },
        outputCharacteristics: { length: 10 },
      });
      // Type-level narrowing: wire.format must exist; wire.dataTypeInformation must NOT.
      expect(wire.format?.dataType).toBe('CHAR');
      expect(wire.format?.length).toBe(10);
      expect((wire as Record<string, unknown>).dataTypeInformation).toBeUndefined();
      expect((wire as Record<string, unknown>).fields).toBeUndefined();
    });

    it('localToWire<DTEL> returns a DdicDtelWire carrying dataTypeInformation (all 5 categories)', () => {
      // domain category
      const w1 = localToWire('DTEL', {
        name: 'ZDTEL_D',
        dataTypeInformation: { category: 'domain', typeName: 'ZDOMA_D' },
      });
      expect(w1.dataTypeInformation?.category).toBe('domain');
      expect(w1.dataTypeInformation?.typeName).toBe('ZDOMA_D');

      // predefinedType category
      const w2 = localToWire('DTEL', {
        name: 'ZDTEL_P',
        dataTypeInformation: { category: 'predefinedType', predefinedType: { dataType: 'I', length: 4 } },
      });
      expect(w2.dataTypeInformation?.category).toBe('predefinedType');
      expect(w2.dataTypeInformation?.predefinedType?.dataType).toBe('I');

      // referenceToPredefinedType category
      const w3 = localToWire('DTEL', {
        name: 'ZDTEL_RP',
        dataTypeInformation: { category: 'referenceToPredefinedType', typeName: 'STRING' },
      });
      expect(w3.dataTypeInformation?.category).toBe('referenceToPredefinedType');

      // referenceDictionaryType category
      const w4 = localToWire('DTEL', {
        name: 'ZDTEL_RD',
        dataTypeInformation: { category: 'referenceDictionaryType', typeName: 'ZTAB_RD' },
      });
      expect(w4.dataTypeInformation?.category).toBe('referenceDictionaryType');

      // referenceClasIntType category
      const w5 = localToWire('DTEL', {
        name: 'ZDTEL_RC',
        dataTypeInformation: { category: 'referenceClasIntType', typeName: 'ZCL_FOO' },
      });
      expect(w5.dataTypeInformation?.category).toBe('referenceClasIntType');
    });

    it('localToWire<TABL> forwards fields + generalInformation through the TABL settings wire', () => {
      const wire = localToWire('TABL', {
        name: 'ZTAB_SPLIT',
        header: { description: 'split test', originalLanguage: 'EN' },
        generalInformation: { deliveryClass: 'A', dataClass: 'APPL0', sizeCategory: '0' },
        fields: [
          { fieldName: 'KEY1', dataType: 'CHAR', length: 10, keyFlag: true },
          { fieldName: 'VAL1', dataType: 'CHAR', length: 20 },
        ],
      });
      expect(wire.fields).toHaveLength(2);
      expect(wire.fields?.[0]?.fieldName).toBe('KEY1');
      expect(wire.fields?.[0]?.keyFlag).toBe(true);
      expect(wire.generalInformation?.['deliveryClass']).toBe('A');
      // wire.format / wire.dataTypeInformation live on the DOMA / DTEL wires,
      // not the TABL settings wire.
      expect((wire as Record<string, unknown>).format).toBeUndefined();
      expect((wire as Record<string, unknown>).dataTypeInformation).toBeUndefined();
    });

    it('DdicWirePayload alias still accepts all three variants (backward compat)', () => {
      const domaWire: import('../../src/abap_cli/formats/ddic/json.js').DdicWirePayload = {
        name: 'ZDOMA_BC', format: { dataType: 'CHAR', length: 3 },
      };
      const dtelWire: import('../../src/abap_cli/formats/ddic/json.js').DdicWirePayload = {
        name: 'ZDTEL_BC', dataTypeInformation: { category: 'domain', typeName: 'ZDOMA_BC' },
      };
      const tablWire: import('../../src/abap_cli/formats/ddic/json.js').DdicWirePayload = {
        name: 'ZTAB_BC', fields: [], generalInformation: {},
      };
      expect(domaWire.name).toBe('ZDOMA_BC');
      expect(dtelWire.name).toBe('ZDTEL_BC');
      expect(tablWire.name).toBe('ZTAB_BC');
    });
  });
});
