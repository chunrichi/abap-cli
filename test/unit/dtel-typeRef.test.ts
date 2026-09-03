/**
 * 033 + 032: DTEL dataTypeInformation categories per AFF dtel-v1.json.
 *
 * AFF canonical categories:
 *   - 'domain'                     — typeName is the domain.
 *   - 'predefinedType'             — type info under .predefinedType.{dataType,length}.
 *   - 'referenceToPredefinedType'  — typeName is a predefined ABAP type.
 *   - 'referenceDictionaryType'    — referencedTypeName is a DDIC type (e.g. TTYP).
 *   - 'referenceClasIntType'       — referencedTypeName is a class/interface.
 *
 * Wire and local mirror the AFF nested shape (no flat `typeRef` envelope).
 * Legacy 032 alias `typeRef` on local is mapped to `referenceDictionaryType`
 * on the wire and accepted on the wire-side read.
 */
import { describe, it, expect } from 'vitest';
import { localToWire, wireToLocal } from '../../src/abap_cli/formats/ddic/json.js';
import { CliError } from '../../src/abap_cli/output/json.js';

describe('033/dtel-dataTypeInformation', () => {
  describe('wireToLocal', () => {
    it('maps wire dataTypeInformation (category: referenceDictionaryType) → local', () => {
      const local = wireToLocal('DTEL', {
        name: 'ZDE_REF',
        description: 'Data element referencing a dictionary type',
        dataTypeInformation: { category: 'referenceDictionaryType', typeName: 'ZMY_TTYP' },
      });
      const dti = (local as Record<string, unknown>).dataTypeInformation as
        | Record<string, unknown>
        | undefined;
      expect(dti).toBeDefined();
      expect(dti?.category).toBe('referenceDictionaryType');
      expect(dti?.typeName).toBe('ZMY_TTYP');
    });

    it('preserves referencedTypeName when present on wire', () => {
      const local = wireToLocal('DTEL', {
        name: 'ZDE_REF2',
        description: 'Data element with full dataTypeInformation',
        dataTypeInformation: {
          category: 'referenceDictionaryType',
          typeName: 'ZMY_TTYP',
          referencedTypeName: 'ZMY_TABLE_TYPE',
        },
      });
      const dti = (local as Record<string, unknown>).dataTypeInformation as Record<string, unknown>;
      expect(dti.typeName).toBe('ZMY_TTYP');
      expect(dti.referencedTypeName).toBe('ZMY_TABLE_TYPE');
    });

    it('does not emit dataTypeInformation when wire has none', () => {
      const local = wireToLocal('DTEL', {
        name: 'ZDE_PLAIN',
        description: 'Plain domain-based data element',
        domain: 'ZDMY',
      });
      expect((local as Record<string, unknown>).dataTypeInformation).toBeUndefined();
    });
  });

  describe('localToWire', () => {
    it('maps local dataTypeInformation (category: typeRef alias) → wire referenceDictionaryType', () => {
      const wire = localToWire('DTEL', {
        name: 'ZDE_REF',
        description: 'Reverse mapping',
        dataTypeInformation: {
          category: 'typeRef',
          typeName: 'ZMY_TTYP',
        },
      } as Record<string, unknown>);
      // 032 legacy alias `typeRef` → AFF canonical `referenceDictionaryType`.
      expect(wire.typeRef).toBeUndefined();
      const dti = wire.dataTypeInformation as Record<string, unknown>;
      expect(dti.category).toBe('referenceDictionaryType');
      expect(dti.typeName).toBe('ZMY_TTYP');
    });

    it('preserves referencedTypeName on round-trip', () => {
      const wire = localToWire('DTEL', {
        name: 'ZDE_FULL',
        description: 'With referencedTypeName',
        dataTypeInformation: {
          category: 'typeRef',
          typeName: 'ZMY_TTYP',
          referencedTypeName: 'ZMY_TABLE_TYPE',
        },
      } as Record<string, unknown>);
      const dti = wire.dataTypeInformation as Record<string, unknown>;
      expect(dti.category).toBe('referenceDictionaryType');
      expect(dti.typeName).toBe('ZMY_TTYP');
      expect(dti.referencedTypeName).toBe('ZMY_TABLE_TYPE');
    });

    it('emits dataTypeInformation for category: domain', () => {
      const wire = localToWire('DTEL', {
        name: 'ZDE_OTHER',
        description: 'Other category',
        dataTypeInformation: {
          category: 'domain',
          typeName: 'ZDMY',
        },
      } as Record<string, unknown>);
      expect(wire.dataTypeInformation).toEqual({ category: 'domain', typeName: 'ZDMY' });
    });
  });

  describe('round-trip', () => {
    it('localToWire → wireToLocal preserves dataTypeInformation (typeRef alias)', () => {
      const src = {
        name: 'ZDE_RT',
        description: 'Round trip',
        shortText: 'Short',
        dataTypeInformation: {
          category: 'typeRef',
          typeName: 'ZMY_TTYP',
        },
      };
      const wire = localToWire('DTEL', src as Record<string, unknown>);
      expect((wire.dataTypeInformation as Record<string, unknown>).category).toBe(
        'referenceDictionaryType',
      );
      const back = wireToLocal('DTEL', wire);
      const dti = (back as Record<string, unknown>).dataTypeInformation as Record<string, unknown>;
      expect(dti.category).toBe('referenceDictionaryType');
      expect(dti.typeName).toBe('ZMY_TTYP');
      expect(back.shortText).toBe('Short');
    });
  });

  describe('error handling', () => {
    it('throws DTEL_CATEGORY_UNSUPPORTED for unknown category in wire dataTypeInformation', () => {
      expect(() =>
        wireToLocal('DTEL', {
          name: 'ZDE_BAD',
          description: 'Unknown category',
          dataTypeInformation: { category: 'totallyMadeUpCategory', typeName: 'ZCL' },
        } as unknown as Parameters<typeof wireToLocal>[1]),
      ).toThrowError(CliError);
      try {
        wireToLocal('DTEL', {
          name: 'ZDE_BAD',
          description: 'Unknown category',
          dataTypeInformation: { category: 'totallyMadeUpCategory', typeName: 'ZCL' },
        } as unknown as Parameters<typeof wireToLocal>[1]);
      } catch (e) {
        const err = e as CliError;
        expect(err.code).toBe('DTEL_CATEGORY_UNSUPPORTED');
        expect(err.message).toContain('totallyMadeUpCategory');
        expect(err.message).toContain('domain');
        expect(err.message).toContain('predefinedType');
      }
    });

    it('accepts the AFF canonical categories without throwing', () => {
      const knownCategories = [
        'domain',
        'predefinedType',
        'referenceToPredefinedType',
        'referenceDictionaryType',
        'referenceClasIntType',
      ];
      for (const cat of knownCategories) {
        expect(() =>
          wireToLocal('DTEL', {
            name: 'ZDE_OK',
            description: 'Known category',
            dataTypeInformation: { category: cat, typeName: 'ZREF' },
          } as unknown as Parameters<typeof wireToLocal>[1]),
        ).not.toThrow();
      }
    });

    it('does not throw when wire has no dataTypeInformation at all', () => {
      expect(() =>
        wireToLocal('DTEL', {
          name: 'ZDE_PLAIN',
          description: 'Plain domain',
          domain: 'ZDMY',
        }),
      ).not.toThrow();
    });
  });
});