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
  it('contains exactly 10 supported types (4 source + 4 DDIC + HTTP + TRAN)', () => {
    expect(allSupportedTypes()).toHaveLength(10);
    expect(allSupportedTypes()).toEqual([
      'CLAS', 'INTF', 'PROG', 'FUGR',         // ADT source
      'TABL', 'STRU', 'DOMA', 'DTEL',         // DDIC
      'HTTP', 'TRAN',                          // ICF
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
  });

  it('routes source objects to ADT and others to ICF', () => {
    expect(sourceFor('CLAS')).toBe('ADT');
    expect(sourceFor('INTF')).toBe('ADT');
    expect(sourceFor('PROG')).toBe('ADT');
    expect(sourceFor('FUGR')).toBe('ADT');
    expect(sourceFor('TABL')).toBe('ICF');
    expect(sourceFor('HTTP')).toBe('ICF');
    expect(sourceFor('TRAN')).toBe('ICF');
  });

  it('resolves folders uniformly for all 10 types', () => {
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
  });

  it('isSupportedType / subset helpers narrow correctly', () => {
    expect(isSupportedType('CLAS')).toBe(true);
    expect(isSupportedType('TTYP')).toBe(false);
    expect(isSupportedType('MSAG')).toBe(false);

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