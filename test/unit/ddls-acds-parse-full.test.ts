/**
 * T3.5 — DDLS acds parser covers all 11 sourceType values.
 * Spec 036 + T3.5: extend coverage from 5 to 11 forms (tableEntity,
 * abstractEntity, customEntity, hierarchy, externalEntity, ddicBasedView).
 */
import { describe, it, expect } from 'vitest';
import { parseAcds } from '../../src/abap_cli/formats/ddls/acds.js';

describe('parseAcds (T3.5 — 11 sourceTypes)', () => {
  it.each([
    ['viewEntity', 'define view entity ZMY_VIEW as select from ztable { key id as Id }'],
    ['viewEntityExtend', 'define view entity ZMY_EXTEND extend ZMY_VIEW with { field1 : abap.char(10) }'],
    ['viewExtend', 'define view ZMY_V_EXT extend ZMY_VIEW { field2 }'],
    ['projectionView', 'define projection view ZMY_PROJ as projection on ZMY_VIEW {'],
    ['tableFunction', 'define table function ZMY_TF returns table ...'],
    ['ddicBasedView', 'define view ZMY_DDIC as select from ztable { * }'],
    ['tableEntity', 'define table entity ZMY_TABLE { key id : abap.char(10) }'],
    ['abstractEntity', 'define abstract entity ZMY_ABS { id : abap.char(10) }'],
    ['customEntity', 'define custom entity ZMY_CUST { id : abap.char(10) }'],
    ['hierarchy', 'define hierarchy ZMY_HIER parent child ...'],
    ['externalEntity', 'define external entity ZMY_EXT { id : abap.char(10) }'],
  ])('parses %s', (expectedSourceType, ddlSource) => {
    const result = parseAcds(ddlSource);
    expect(result.sourceType).toBe(expectedSourceType);
  });

  it('captures objectName from define', () => {
    const result = parseAcds('define view entity ZMY_VIEW as select from ztable {}');
    expect(result.objectName).toBe('ZMY_VIEW');
  });

  it('captures parentName from extend', () => {
    const result = parseAcds('define view entity ZMY_EXT extend ZMY_PARENT with {}');
    expect(result.parentName).toBe('ZMY_PARENT');
  });

  it('returns unknown for unrecognized shapes', () => {
    const result = parseAcds('some other content');
    expect(result.sourceType).toBe('unknown');
  });
});
