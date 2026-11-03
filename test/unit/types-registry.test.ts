/**
 * single registry covers all 10 supported object types
 * legacy `TYPE_FOLDER` / `TYPE_MAP` / `*_SUPPORTED_TYPES` constants are gone.
 */
import { describe, it, expect } from 'vitest';
import {
  TYPE_REGISTRY,
  allSupportedTypes,
  maxNameLengthFor,
  packageNotApplicableFor,
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
  it('contains exactly 37 supported types (4 source + DEVC + 4 DDIC + ENQU + VIEW + SHLP + NROB + HTTP + TRAN + SM59 + XSLT + 3 dual-channel + 6 + 3 ATC + 5 CDS technical + TYPE + 2 application jobs)', () => {
    // added: SRVB (metadata-only), SRVD, BDEF, DCLS, DDLX, DDLA.
    // added: ENQU (lock object, ICF) and NROB (number range object, ICF).
    // added: DEVC (package, ADT package resource; push unsupported).
    expect(allSupportedTypes()).toHaveLength(37);
    expect(allSupportedTypes()).toEqual([
      'CLAS', 'INTF', 'PROG', 'FUGR',         // ADT source
      'DEVC',                                  // ADT package resource
      'TABL', 'STRU', 'DOMA', 'DTEL',         // ICF DDIC
      'ENQU', 'VIEW', 'SHLP', 'NROB',          // — ICF DDIC family
      'HTTP', 'TRAN', 'SM59', 'XSLT',          // ICF (SM59 = HTTP destination)
      'TTYP', 'MSAG', 'DDLS',                  // dual-channel
      'SRVB', 'SRVD', 'BDEF',                  // /
      'DCLS', 'DDLX', 'DDLA',
      'CHKC', 'CHKO', 'CHKV',                  // ATC configuration objects
      'DTDC', 'DTEB', 'DSFD', 'DSFI',          // CDS technical objects
      'DRTY',
      'TYPE',                                  // type pool
      'SAJC', 'SAJT',                          // application jobs
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
    // (post-review): SRVD / DCLS / DDLX / DDLA / BDEF / SRVB carry their own
    // objtype string for create(); SRVB is metadata-only (no push/update).
    expect(createObjtypeFor('SRVB')).toBe('SRVB/SVB');
    expect(createObjtypeFor('SRVD')).toBe('SRVD/SRV');
    expect(createObjtypeFor('BDEF')).toBe('BDEF/BDO');
    expect(createObjtypeFor('DCLS')).toBe('DCLS/DL');
    expect(createObjtypeFor('DDLX')).toBe('DDLX/EX');
    expect(createObjtypeFor('DDLA')).toBe('DDLA/ADF');
    // ATC configuration objects carry the objtype reported by typestructure.
    expect(createObjtypeFor('CHKC')).toBe('CHKC/TYP');
    expect(createObjtypeFor('CHKO')).toBe('CHKO/TYP');
    expect(createObjtypeFor('CHKV')).toBe('CHKV/TYP');
    // CDS technical objects carry the objtype reported by typestructure.
    expect(createObjtypeFor('DTDC')).toBe('DTDC/DF');
    expect(createObjtypeFor('DTEB')).toBe('DTEB/DF');
    expect(createObjtypeFor('DSFD')).toBe('DSFD/SCF');
    expect(createObjtypeFor('DSFI')).toBe('DSFI/SFI');
    expect(createObjtypeFor('DRTY')).toBe('DRTY/STY');
    expect(createObjtypeFor('TYPE')).toBe('TYPE/DG');
    // Application jobs carry the plain ADT type code (no /subtype).
    expect(createObjtypeFor('SAJC')).toBe('SAJC');
    expect(createObjtypeFor('SAJT')).toBe('SAJT');
  });

  it('exposes the per-type object-name limit only where it differs from 30', () => {
    // Application-job names are 40 characters (typestructure OBJNAME_MAXLENGTH).
    expect(maxNameLengthFor('SAJC')).toBe(40);
    expect(maxNameLengthFor('sajt')).toBe(40);
    // SM59 destinations are RFCDEST (CHAR 32).
    expect(maxNameLengthFor('SM59')).toBe(32);
    expect(maxNameLengthFor('CLAS')).toBeUndefined();
    expect(maxNameLengthFor('TYPE')).toBeUndefined();
  });

  it('routes source objects (ADT) and TTYP/MSAG/DDLS dual-channel; TABL/HTTP/TRAN ICF only', () => {
    expect(sourceFor('CLAS')).toBe('ADT');
    expect(sourceFor('INTF')).toBe('ADT');
    expect(sourceFor('PROG')).toBe('ADT');
    expect(sourceFor('FUGR')).toBe('ADT');
    expect(sourceFor('TABL')).toBe('ICF');
    expect(sourceFor('HTTP')).toBe('ICF');
    expect(sourceFor('TRAN')).toBe('ICF');
    // SM59 HTTP destinations are served by the ICF /sm59 route.
    expect(sourceFor('SM59')).toBe('ICF');
    // VIEW is a local-extension AFF document served by the ICF service.
    expect(sourceFor('VIEW')).toBe('ICF');
    expect(sourceFor('SHLP')).toBe('ICF');
    expect(sourceFor('XSLT')).toBe('ICF');
    // TTYP/MSAG/DDLS are ADT by default with optional ICF fallback.
    expect(sourceFor('TTYP')).toBe('ADT');
    expect(sourceFor('MSAG')).toBe('ADT');
    expect(sourceFor('DDLS')).toBe('ADT');
    // ATC configuration objects are ADT-only (no ICF fallback).
    expect(sourceFor('CHKC')).toBe('ADT');
    expect(sourceFor('CHKO')).toBe('ADT');
    expect(sourceFor('CHKV')).toBe('ADT');
    // CDS technical objects are ADT-only (no ICF fallback).
    expect(sourceFor('DTDC')).toBe('ADT');
    expect(sourceFor('DTEB')).toBe('ADT');
    expect(sourceFor('DSFD')).toBe('ADT');
    expect(sourceFor('DSFI')).toBe('ADT');
    expect(sourceFor('DRTY')).toBe('ADT');
    expect(sourceFor('TYPE')).toBe('ADT');
  });

  it('marks SM59 as outside the package/transport model', () => {
    // RFCDES is a client-independent system table: no TADIR object, no package.
    expect(packageNotApplicableFor('SM59')).toBe(true);
    expect(packageNotApplicableFor('CLAS')).toBe(false);
    expect(packageNotApplicableFor('TABL')).toBe(false);
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