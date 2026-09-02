/**
 * 032 US8: DTEL `typeRef` (TTYP reference) — third dataTypeInformation category.
 *
 * Wire shape: `{ typeRef: { typeName: 'ZMY_TTYP', referencedTypeName?: '...' } }`
 * Local shape: `{ dataTypeInformation: { category: 'typeRef', typeName,
 * referencedTypeName? } }` (abap-file-format nested)
 *
 * Round-trip is symmetric; unknown categories in `dataTypeInformation` raise
 * `DTEL_CATEGORY_UNSUPPORTED` (VALIDATION_ERROR/7) per spec 032 US8 AC3.
 *
 * TTYP itself is deferred per spec 032 P2 scope notes, but DTEL → TTYP
 * reference (the wire shape tested here) must work end-to-end.
 */
import { describe, it, expect } from 'vitest';
import { localToWire, wireToLocal } from '../../src/abap_cli/formats/ddic/json.js';
import { CliError } from '../../src/abap_cli/output/json.js';

describe('032/dtel-typeRef', () => {
  describe('wireToLocal', () => {
    it('maps wire typeRef → local dataTypeInformation (category: typeRef)', () => {
      const local = wireToLocal('DTEL', {
        name: 'ZDE_REF',
        description: 'Data element referencing a TTYP',
        typeRef: { typeName: 'ZMY_TTYP' },
      });
      const dti = (local as Record<string, unknown>).dataTypeInformation as
        | Record<string, unknown>
        | undefined;
      expect(dti).toBeDefined();
      expect(dti?.category).toBe('typeRef');
      expect(dti?.typeName).toBe('ZMY_TTYP');
    });

    it('preserves referencedTypeName when present on wire', () => {
      const local = wireToLocal('DTEL', {
        name: 'ZDE_REF2',
        description: 'Data element with full typeRef',
        typeRef: { typeName: 'ZMY_TTYP', referencedTypeName: 'ZMY_TABLE_TYPE' },
      });
      const dti = (local as Record<string, unknown>).dataTypeInformation as Record<string, unknown>;
      expect(dti.typeName).toBe('ZMY_TTYP');
      expect(dti.referencedTypeName).toBe('ZMY_TABLE_TYPE');
    });

    it('does not emit dataTypeInformation when wire has no typeRef', () => {
      const local = wireToLocal('DTEL', {
        name: 'ZDE_PLAIN',
        description: 'Plain domain-based data element',
        domain: 'ZDMY',
      });
      expect((local as Record<string, unknown>).dataTypeInformation).toBeUndefined();
    });

    it('ignores wire typeRef with empty typeName', () => {
      const local = wireToLocal('DTEL', {
        name: 'ZDE_EMPTY',
        description: 'Edge case: empty typeRef.typeName',
        typeRef: { typeName: '' },
      });
      expect((local as Record<string, unknown>).dataTypeInformation).toBeUndefined();
    });
  });

  describe('localToWire', () => {
    it('maps local dataTypeInformation (category: typeRef) → wire typeRef', () => {
      const wire = localToWire('DTEL', {
        name: 'ZDE_REF',
        description: 'Reverse mapping',
        dataTypeInformation: {
          category: 'typeRef',
          typeName: 'ZMY_TTYP',
        },
      } as Record<string, unknown>);
      expect(wire.typeRef).toEqual({ typeName: 'ZMY_TTYP' });
    });

    it('also accepts flat local typeRef (legacy fallback)', () => {
      const wire = localToWire('DTEL', {
        name: 'ZDE_FLAT',
        description: 'Flat local fallback',
        typeRef: { typeName: 'ZMY_TTYP' },
      } as Record<string, unknown>);
      expect(wire.typeRef).toEqual({ typeName: 'ZMY_TTYP' });
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
      expect(wire.typeRef).toEqual({
        typeName: 'ZMY_TTYP',
        referencedTypeName: 'ZMY_TABLE_TYPE',
      });
    });

    it('omits typeRef when dataTypeInformation.category is not typeRef', () => {
      const wire = localToWire('DTEL', {
        name: 'ZDE_OTHER',
        description: 'Other category',
        dataTypeInformation: {
          category: 'domain',
          typeName: 'ZDMY',
        },
      } as Record<string, unknown>);
      expect(wire.typeRef).toBeUndefined();
    });
  });

  describe('round-trip', () => {
    it('localToWire → wireToLocal preserves typeRef typeName', () => {
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
      const back = wireToLocal('DTEL', wire);
      const dti = (back as Record<string, unknown>).dataTypeInformation as Record<string, unknown>;
      expect(dti.category).toBe('typeRef');
      expect(dti.typeName).toBe('ZMY_TTYP');
      // Screen texts survive round-trip too.
      expect(back.shortText).toBe('Short');
    });
  });

  describe('error handling (AC3)', () => {
    it('throws DTEL_CATEGORY_UNSUPPORTED for unknown category in wire dataTypeInformation', () => {
      expect(() =>
        wireToLocal('DTEL', {
          name: 'ZDE_BAD',
          description: 'Unknown category',
          dataTypeInformation: { category: 'referenceClasIntType', typeName: 'ZCL' },
        } as unknown as Parameters<typeof wireToLocal>[1]),
      ).toThrowError(CliError);
      try {
        wireToLocal('DTEL', {
          name: 'ZDE_BAD',
          description: 'Unknown category',
          dataTypeInformation: { category: 'referenceClasIntType', typeName: 'ZCL' },
        } as unknown as Parameters<typeof wireToLocal>[1]);
      } catch (e) {
        const err = e as CliError;
        expect(err.code).toBe('DTEL_CATEGORY_UNSUPPORTED');
        expect(err.message).toContain('referenceClasIntType');
        expect(err.message).toContain('domain');
        expect(err.message).toContain('predefinedType');
        expect(err.message).toContain('typeRef');
      }
    });

    it('accepts the three known categories (domain, predefinedType, typeRef) without throwing', () => {
      const knownCategories = ['domain', 'predefinedType', 'typeRef'];
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
      // Existing flat shapes (domain / dataType / etc.) must keep working.
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