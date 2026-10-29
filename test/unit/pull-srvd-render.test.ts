/**
 * T3.1 — `renderSourceMetadata` (in pull-strategy.ts) projects sourceOrigin
 * and sourceType for SRVD under `generalInformation` (per srvd-v1.json),
 * not at the top level as DDLS does.
 */
import { describe, it, expect } from 'vitest';
import { renderSourceMetadata } from '../../src/abap_cli/formats/pull-strategy.js';
import type { ObjectMetadata } from '../../src/abap_cli/formats/object-parts.js';

const baseMeta: ObjectMetadata = {
  description: 'Service def',
  masterLanguage: 'EN',
  objectType: 'SRVD/SD',
  sourceOrigin: 'abapDevelopmentTools',
  sourceType: 'definition',
};

describe('renderSourceMetadata for SRVD (T3.1)', () => {
  it('nests sourceOrigin + sourceType under generalInformation', () => {
    const result = renderSourceMetadata('SRVD', baseMeta, 'SRVD/SD');
    expect(result).not.toHaveProperty('sourceOrigin');
    expect(result).not.toHaveProperty('sourceType');
    expect(result.generalInformation).toEqual({
      sourceOrigin: 'abapDevelopmentTools',
      sourceType: 'definition',
    });
  });

  it('preserves the extension sourceType for SRVD', () => {
    const result = renderSourceMetadata('SRVD', { ...baseMeta, sourceType: 'extension' }, 'SRVD/SD');
    expect(result.generalInformation).toEqual({
      sourceOrigin: 'abapDevelopmentTools',
      sourceType: 'extension',
    });
  });

  it('defaults sourceOrigin to abapDevelopmentTools when missing', () => {
    const { sourceOrigin: _drop, ...meta } = baseMeta;
    const result = renderSourceMetadata('SRVD', meta, 'SRVD/SD');
    expect(result.generalInformation).toEqual({
      sourceOrigin: 'abapDevelopmentTools',
      sourceType: 'definition',
    });
  });

  it('defaults sourceType to definition when missing (SRVD-specific fallback)', () => {
    const { sourceType: _drop, ...meta } = baseMeta;
    const result = renderSourceMetadata('SRVD', meta, 'SRVD/SD');
    expect(result.generalInformation).toEqual({
      sourceOrigin: 'abapDevelopmentTools',
      sourceType: 'definition',
    });
  });

  it('defaults unrecognised sourceOrigin to abapDevelopmentTools', () => {
    const result = renderSourceMetadata('SRVD', { ...baseMeta, sourceOrigin: 'futureOrigin' }, 'SRVD/SD');
    expect(result.generalInformation!.sourceOrigin).toBe('abapDevelopmentTools');
  });

  it('defaults unrecognised sourceType to definition', () => {
    const result = renderSourceMetadata('SRVD', { ...baseMeta, sourceType: 'futureType' }, 'SRVD/SD');
    expect(result.generalInformation!.sourceType).toBe('definition');
  });

  it('does not add generalInformation for CLAS / INTF / PROG', () => {
    const result = renderSourceMetadata('CLAS', baseMeta, 'CLAS/OC');
    expect(result.generalInformation).toBeUndefined();
  });

  it('does not add generalInformation for BDEF / DCLS / DDLX / DDLA', () => {
    for (const type of ['BDEF', 'DCLS', 'DDLX', 'DDLA']) {
      const result = renderSourceMetadata(type, baseMeta, `${type}/XX`);
      expect(result.generalInformation).toBeUndefined();
    }
  });
});
