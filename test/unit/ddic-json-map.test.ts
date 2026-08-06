/**
 * 014: ddic-json.ts mapping round-trip tests. Written TDD-style — these tests
 * targeted the abap-file-format ↔ wire schema conversion before the SAP-side
 * ZCL_ABAP_VIBE_DDIC class was completed (Validates T005).
 */
import { describe, it, expect } from 'vitest';
import {
  localToWire,
  wireToLocal,
  localFieldToWire,
  wireFieldToLocal,
  validateDdicObject,
  DDIC_SUPPORTED_TYPES,
} from '../../src/abap_cli/formats/ddic-json.js';

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
      expect(validateDdicObject({} as any, 'DOMA')).toContain('Missing required field: name');
    });

    it('flags invalid namespace', () => {
      const errors = validateDdicObject({ name: 'XTAB', description: 'x', fields: [] } as any, 'TABL');
      expect(errors.some((e) => e.includes('Invalid namespace'))).toBe(true);
    });

    it('accepts Z, Y, and slash namespaces', () => {
      expect(validateDdicObject({ name: 'Z', description: 'x' } as any, 'DOMA')).not.toContain(
        'Missing required field: name',
      );
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
});
