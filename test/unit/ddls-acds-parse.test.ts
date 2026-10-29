/**
 * Spec 036 T036-038: parseAcds 5-shape coverage.
 *
 * Per spec: viewEntity / projectionView / tableFunction (define forms) +
 * viewEntityExtend / viewExtend (extend forms with parentName). The
 * `unknown` fallback covers malformed DDL.
 */
import { describe, it, expect } from 'vitest';
import { parseAcds } from '../../src/abap_cli/formats/ddls/acds.js';

describe('parseAcds (036 US4)', () => {
  it('recognises viewEntity', () => {
    const r = parseAcds('define view entity ZMY_VIEW as select from t000 { key mandt as Client }');
    expect(r.sourceType).toBe('viewEntity');
    expect(r.objectName).toBe('ZMY_VIEW');
  });

  it('recognises projectionView', () => {
    const r = parseAcds('define projection view ZMY_PROJ as select from ZMY_VIEW { * }');
    expect(r.sourceType).toBe('projectionView');
    expect(r.objectName).toBe('ZMY_PROJ');
  });

  it('recognises tableFunction', () => {
    const r = parseAcds('define table function ZMY_TF returns table (client abap.clnt) implemented by method ZCL_MY_TF=>get_rows;');
    expect(r.sourceType).toBe('tableFunction');
  });

  it('recognises viewEntityExtend with parentName', () => {
    const r = parseAcds('define view entity ZMY_EXT extend ZMY_VIEW { col : abap.char(10) }');
    expect(r.sourceType).toBe('viewEntityExtend');
    expect(r.parentName).toBe('ZMY_VIEW');
  });

  it('recognises viewExtend with parentName', () => {
    const r = parseAcds('define view ZMY_LEGACY_EXT extend ZMY_VIEW { col : abap.char(10) }');
    expect(r.sourceType).toBe('viewExtend');
    expect(r.parentName).toBe('ZMY_VIEW');
  });

  it('returns unknown for malformed DDL', () => {
    const r = parseAcds('this is not cds');
    expect(r.sourceType).toBe('unknown');
    expect(r.objectName).toBeUndefined();
  });
});