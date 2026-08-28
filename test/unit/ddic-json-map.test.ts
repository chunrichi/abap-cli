/**
 * 014: ddic-json.ts mapping round-trip tests. Written TDD-style — these tests
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
} from '../../src/abap_cli/dictionary/ddic-json.js';

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

  describe('localToWire — TABL', () => {
    it('maps table fields, deliveryClass, clientDependent, etc.', () => {
      const wire = localToWire('TABL', {
        name: 'ztab',
        description: 'Example table',
        deliveryClass: 'A',
        dataClass: 'APPL0',
        sizeCategory: '0',
        clientDependent: true,
        allowMaintenance: false,
        fields: [
          { fieldName: 'FIELD1', dataType: 'CHAR', length: 20, keyFlag: true },
          { fieldName: 'FIELD2', rollname: 'ZDMY_DE' },
        ],
        package: '$TMP',
        transportRequest: '',
      });
      expect(wire.name).toBe('ZTAB');
      expect(wire.deliveryClass).toBe('A');
      expect(wire.clientDependent).toBe(true);
      expect(wire.fields).toHaveLength(2);
      expect(wire.fields![0]!.fieldName).toBe('FIELD1');
      expect(wire.fields![0]!.keyFlag).toBe(true);
      expect(wire.fields![1]!.rollname).toBe('ZDMY_DE');
    });
  });

  describe('localToWire — DOMA', () => {
    it('maps datatype, length, decimals, signFlag, lowercase, convExit', () => {
      const wire = localToWire('DOMA', {
        name: 'ZD',
        description: 'Domain',
        dataType: 'CHAR',
        length: 3,
        decimals: 0,
        signFlag: false,
        lowercase: true,
        convExit: 'ALPHA',
      });
      expect(wire.dataType).toBe('CHAR');
      expect(wire.length).toBe(3);
      expect(wire.lowercase).toBe(true);
      expect(wire.convExit).toBe('ALPHA');
    });
  });

  describe('localToWire — DTEL', () => {
    it('maps domain reference and screen texts', () => {
      const wire = localToWire('DTEL', {
        name: 'ZDE',
        description: 'Data element',
        domain: 'ZD',
        shortText: 'Short',
        mediumText: 'Medium text',
        longText: 'Long text',
        headerText: 'Header',
      });
      expect(wire.domain).toBe('ZD');
      expect(wire.shortText).toBe('Short');
      expect(wire.headerText).toBe('Header');
    });
  });

  describe('wireToLocal / round-trip', () => {
    it('TABL round-trip preserves all fields', () => {
      const src = {
        name: 'ZTAB',
        description: 'Table',
        deliveryClass: 'A',
        dataClass: 'APPL0',
        sizeCategory: '0',
        clientDependent: true,
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

    it('DOMA round-trip preserves signFlag, lowercase, convExit', () => {
      const src = {
        name: 'ZD',
        description: 'Domain',
        dataType: 'QUAN',
        length: 13,
        decimals: 3,
        signFlag: true,
        lowercase: false,
        convExit: 'ALPHA',
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

    it('DOMA requires dataType and length', () => {
      const errors = validateDdicObject({ name: 'ZD', description: 'd' } as any, 'DOMA');
      expect(errors).toContain('Domain missing: dataType');
      expect(errors).toContain('Domain missing: length');
    });

    it('DTEL requires description and at least one of domain or built-in type', () => {
      const errors = validateDdicObject({ name: 'ZDE' } as any, 'DTEL');
      expect(errors).toContain('DataElement missing: description');
      expect(errors).toContain('DataElement must reference a domain OR specify a built-in type (dataType)');
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
        expect(local.deliveryClass).toBe('L');
        expect(local.dataClass).toBe('APPL1');
        expect(local.sizeCategory).toBe('3');
        expect(local.clientDependent).toBe(true);
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
});
