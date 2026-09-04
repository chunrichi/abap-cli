/**
 * US11 (T052): single registry covers all 10 supported object types;
 * legacy `TYPE_FOLDER` / `TYPE_MAP` / `*_SUPPORTED_TYPES` constants are gone.
 */
import { describe, it, expect } from 'vitest';
import {
  TYPE_REGISTRY,
  allSupportedTypes,
  folderFor,
  createObjtypeFor,
  sourceFor,
  isSupportedType,
  isDdicSupportedType,
  isHttpSupportedType,
  isTranSupportedType,
  DDIC_TYPES,
  HTTP_TYPES,
  TRAN_TYPES,
  DDIC_SUPPORTED_TYPES,
  HTTP_SUPPORTED_TYPES,
  TRAN_SUPPORTED_TYPES,
} from '../../src/abap_cli/types/registry.js';

describe('types/registry.ts (US11 — single source of truth)', () => {
  it('contains exactly 13 supported types (4 source + 4 DDIC + HTTP + TRAN + 3 dual-channel)', () => {
    expect(allSupportedTypes()).toHaveLength(13);
    expect(allSupportedTypes()).toEqual([
      'CLAS', 'INTF', 'PROG', 'FUGR',         // ADT source
      'TABL', 'STRU', 'DOMA', 'DTEL',         // ICF DDIC
      'HTTP', 'TRAN',                          // ICF
      'TTYP', 'MSAG', 'DDLS',                  // 036 dual-channel
    ]);
  });

  it('classifies source objects (ADT) with their createObjtype', () => {
    expect(createObjtypeFor('CLAS')).toBe('CLAS/OC');
    expect(createObjtypeFor('INTF')).toBe('INTF/OI');
    expect(createObjtypeFor('PROG')).toBe('PROG/P');
    expect(createObjtypeFor('FUGR')).toBe('FUGR/F');
    // DDIC/HTTP/TRAN have no ADT objtype.
    expect(createObjtypeFor('TABL')).toBeUndefined();
    expect(createObjtypeFor('HTTP')).toBeUndefined();
    expect(createObjtypeFor('TRAN')).toBeUndefined();
    // TTYP/MSAG/DDLS reach via channel-detect on ADT; no createObjtype string.
    expect(createObjtypeFor('TTYP')).toBeUndefined();
    expect(createObjtypeFor('MSAG')).toBeUndefined();
    expect(createObjtypeFor('DDLS')).toBeUndefined();
  });

  it('routes source objects (ADT) and TTYP/MSAG/DDLS dual-channel; TABL/HTTP/TRAN ICF only', () => {
    expect(sourceFor('CLAS')).toBe('ADT');
    expect(sourceFor('INTF')).toBe('ADT');
    expect(sourceFor('PROG')).toBe('ADT');
    expect(sourceFor('FUGR')).toBe('ADT');
    expect(sourceFor('TABL')).toBe('ICF');
    expect(sourceFor('HTTP')).toBe('ICF');
    expect(sourceFor('TRAN')).toBe('ICF');
    // 036: TTYP/MSAG/DDLS are ADT by default with optional ICF fallback.
    expect(sourceFor('TTYP')).toBe('ADT');
    expect(sourceFor('MSAG')).toBe('ADT');
    expect(sourceFor('DDLS')).toBe('ADT');
  });

  it('resolves folders uniformly for all 13 types', () => {
    expect(folderFor('CLAS')).toBe('clas');
    expect(folderFor('INTF')).toBe('intf');
    expect(folderFor('PROG')).toBe('prog');
    expect(folderFor('FUGR')).toBe('fugr');
    expect(folderFor('TABL')).toBe('tabl');
    expect(folderFor('STRU')).toBe('stru');
    expect(folderFor('DOMA')).toBe('doma');
    expect(folderFor('DTEL')).toBe('dtel');
    expect(folderFor('HTTP')).toBe('http');
    expect(folderFor('TRAN')).toBe('tran');
    // 036: dual-channel DDIC + CDS folders.
    expect(folderFor('TTYP')).toBe('ttyp');
    expect(folderFor('MSAG')).toBe('msag');
    expect(folderFor('DDLS')).toBe('ddls');
  });

  it('isSupportedType / subset helpers narrow correctly', () => {
    expect(isSupportedType('CLAS')).toBe(true);
    expect(isSupportedType('TTYP')).toBe(true);
    expect(isSupportedType('MSAG')).toBe(true);
    expect(isSupportedType('DDLS')).toBe(true);

    expect(isDdicSupportedType('TABL')).toBe(true);
    expect(isDdicSupportedType('CLAS')).toBe(false);
    expect(isHttpSupportedType('HTTP')).toBe(true);
    expect(isTranSupportedType('TRAN')).toBe(true);
  });

  it('case-insensitive: lowercase and subtype suffix resolve correctly', () => {
    expect(folderFor('clas')).toBe('clas');
    expect(folderFor('PROG/P')).toBe('prog');
    expect(folderFor('CLAS/OC')).toBe('clas');
    expect(isDdicSupportedType('TABL')).toBe(true);
    expect(isDdicSupportedType('tabl')).toBe(false); // guards expect uppercase
  });

  it('legacy *_SUPPORTED_TYPES aliases still resolve to the same values', () => {
    expect(DDIC_SUPPORTED_TYPES).toEqual(DDIC_TYPES);
    expect(HTTP_SUPPORTED_TYPES).toEqual(HTTP_TYPES);
    expect(TRAN_SUPPORTED_TYPES).toEqual(TRAN_TYPES);
  });

  it('TYPE_REGISTRY entries match the public helpers (no duplication drift)', () => {
    for (const entry of TYPE_REGISTRY) {
      expect(folderFor(entry.type)).toBe(entry.folder);
      expect(sourceFor(entry.type)).toBe(entry.source);
      expect(isSupportedType(entry.type)).toBe(true);
    }
  });
});