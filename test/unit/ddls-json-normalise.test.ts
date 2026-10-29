/**
 * T3.5 — DDLS metadata normalisation.
 *
 * Verifies the new `enumOrDefault` + `normaliseDdlsMetadata` helpers
 * added on top of the existing `ddls/json.ts` module. These close
 * the gap between real-SAP wire responses (which always carry a
 * canonical value) and locally-edited fixtures (which may carry a
 * typo or future enum value).
 */
import { describe, it, expect } from 'vitest';
import {
  enumOrDefault,
  normaliseDdlsMetadata,
  DDLS_SOURCE_TYPES,
  DDLS_SOURCE_ORIGINS,
  type DdlsLocal,
} from '../../src/abap_cli/formats/ddls/json.js';

const baseDoc: DdlsLocal = {
  formatVersion: '1',
  header: { description: '', originalLanguage: 'EN' },
  sourceType: 'viewEntity',
};

describe('enumOrDefault', () => {
  it('returns the value when it is in the allowed set', () => {
    expect(enumOrDefault('viewEntity', DDLS_SOURCE_TYPES, 'unknown')).toBe('viewEntity');
    expect(enumOrDefault('abapDevelopmentTools', DDLS_SOURCE_ORIGINS, 'abapDevelopmentTools'))
      .toBe('abapDevelopmentTools');
  });

  it('falls back to the default when the value is missing', () => {
    expect(enumOrDefault(undefined, DDLS_SOURCE_TYPES, 'unknown')).toBe('unknown');
  });

  it('falls back to the default when the value is unrecognised', () => {
    expect(enumOrDefault('futureType', DDLS_SOURCE_TYPES, 'unknown')).toBe('unknown');
    expect(enumOrDefault('typo', DDLS_SOURCE_ORIGINS, 'abapDevelopmentTools'))
      .toBe('abapDevelopmentTools');
  });
});

describe('normaliseDdlsMetadata', () => {
  it('preserves a valid sourceOrigin + sourceType pair', () => {
    const result = normaliseDdlsMetadata({
      ...baseDoc,
      sourceOrigin: 'customCdsViews',
      sourceType: 'tableEntity',
    });
    expect(result.sourceOrigin).toBe('customCdsViews');
    expect(result.sourceType).toBe('tableEntity');
  });

  it('defaults missing sourceOrigin to abapDevelopmentTools', () => {
    const result = normaliseDdlsMetadata({ ...baseDoc, sourceType: 'viewEntity' });
    expect(result.sourceOrigin).toBe('abapDevelopmentTools');
  });

  it('defaults missing sourceType to unknown', () => {
    // Construct a doc missing sourceType on purpose.
    const partial = { ...baseDoc, sourceOrigin: 'abapDevelopmentTools' } as DdlsLocal;
    delete (partial as { sourceType?: unknown }).sourceType;
    const result = normaliseDdlsMetadata(partial);
    expect(result.sourceType).toBe('unknown');
  });

  it('defaults unrecognised sourceType to unknown', () => {
    const result = normaliseDdlsMetadata({
      ...baseDoc,
      sourceType: 'nonExistentType' as unknown as DdlsLocal['sourceType'],
    });
    expect(result.sourceType).toBe('unknown');
  });

  it('defaults unrecognised sourceOrigin to abapDevelopmentTools', () => {
    const result = normaliseDdlsMetadata({
      ...baseDoc,
      sourceOrigin: 'bogusOrigin',
      sourceType: 'viewEntity',
    });
    expect(result.sourceOrigin).toBe('abapDevelopmentTools');
  });

  it('round-trips all 11 canonical sourceType values', () => {
    const types: DdlsLocal['sourceType'][] = [
      'viewEntity', 'viewEntityExtend', 'viewExtend', 'projectionView',
      'tableFunction', 'ddicBasedView', 'tableEntity', 'abstractEntity',
      'customEntity', 'hierarchy', 'externalEntity',
    ];
    for (const t of types) {
      const result = normaliseDdlsMetadata({
        ...baseDoc,
        sourceOrigin: 'abapDevelopmentTools',
        sourceType: t,
      });
      expect(result.sourceType).toBe(t);
    }
  });
});
