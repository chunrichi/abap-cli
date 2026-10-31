/**
 * single registry covers all 10 supported object types
 * legacy `TYPE_FOLDER` / `TYPE_MAP` / `*_SUPPORTED_TYPES` constants are gone.
 */
import { describe, it, expect } from 'vitest';
import {
  TYPE_REGISTRY,
  allSupportedTypes,
  createObjtypeFor,
  sourceFor,
  isSupportedType,
  isDdicSupportedType,
  isHttpSupportedType,
  isTranSupportedType,
  DDIC_TYPES,
  HTTP_TYPES,
  TRAN_TYPES,
} from '../../src/abap_cli/types/registry.js';

describe('types/registry.ts (single source of truth)', () => {
  it('contains exactly 21 supported types (4 source + 4 DDIC + ENQU + NROB + HTTP + TRAN + 3 dual-channel + 6 )', () => {
    // added: SRVB (metadata-only), SRVD, BDEF, DCLS, DDLX, DDLA.
    // added: ENQU (lock object, ICF) and NROB (number range object, ICF).
    expect(allSupportedTypes()).toHaveLength(21);
    expect(allSupportedTypes()).toEqual([
      'CLAS', 'INTF', 'PROG', 'FUGR',         // ADT source
      'TABL', 'STRU', 'DOMA', 'DTEL',         // ICF DDIC
      'ENQU', 'NROB',                          // — ICF DDIC family
      'HTTP', 'TRAN',                          // ICF
      'TTYP', 'MSAG', 'DDLS',                  // dual-channel
      'SRVB', 'SRVD', 'BDEF',                  // /
      'DCLS', 'DDLX', 'DDLA',
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
    // (post-review): SRVD / DCLS / DDLX / DDLA carry their own
    // objtype string for create(); SRVB / BDEF are pull-only because either
    // `abap-adt-api`'s typed `createObject` doesn't accept them (BDEF) or
    // SAP GUI owns the lifecycle (SRVB).
    expect(createObjtypeFor('SRVB')).toBeUndefined();
    expect(createObjtypeFor('SRVD')).toBe('SRVD/SRV');
    expect(createObjtypeFor('BDEF')).toBeUndefined();
    expect(createObjtypeFor('DCLS')).toBe('DCLS/DL');
    expect(createObjtypeFor('DDLX')).toBe('DDLX/EX');
    expect(createObjtypeFor('DDLA')).toBe('DDLA/ADF');
  });

  it('routes source objects (ADT) and TTYP/MSAG/DDLS dual-channel; TABL/HTTP/TRAN ICF only', () => {
    expect(sourceFor('CLAS')).toBe('ADT');
    expect(sourceFor('INTF')).toBe('ADT');
    expect(sourceFor('PROG')).toBe('ADT');
    expect(sourceFor('FUGR')).toBe('ADT');
    expect(sourceFor('TABL')).toBe('ICF');
    expect(sourceFor('HTTP')).toBe('ICF');
    expect(sourceFor('TRAN')).toBe('ICF');
    // TTYP/MSAG/DDLS are ADT by default with optional ICF fallback.
    expect(sourceFor('TTYP')).toBe('ADT');
    expect(sourceFor('MSAG')).toBe('ADT');
    expect(sourceFor('DDLS')).toBe('ADT');
  });

  it('has no type → folder mapping anymore (flat abap-file-format layout)', async () => {
    // Artifacts are written flat (<dir>/<name>.<type>.<ext>), so the registry
    // must not carry a per-type local folder or expose folderFor().
    const mod = await import('../../src/abap_cli/types/registry.js');
    expect('folderFor' in mod).toBe(false);
    expect('DEFAULT_FOLDER' in mod).toBe(false);
    for (const entry of TYPE_REGISTRY) {
      expect('folder' in entry).toBe(false);
    }
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
    expect(createObjtypeFor('clas')).toBe('CLAS/OC');
    expect(createObjtypeFor('PROG/P')).toBe('PROG/P');
    expect(createObjtypeFor('CLAS/OC')).toBe('CLAS/OC');
    expect(isDdicSupportedType('TABL')).toBe(true);
    expect(isDdicSupportedType('tabl')).toBe(false); // guards expect uppercase
  });

  it('TYPE_REGISTRY entries match the public helpers (no duplication drift)', () => {
    for (const entry of TYPE_REGISTRY) {
      expect(sourceFor(entry.type)).toBe(entry.source);
      expect(isSupportedType(entry.type)).toBe(true);
    }
  });
});