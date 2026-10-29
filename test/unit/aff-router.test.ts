import { describe, it, expect } from 'vitest';
import { routeAffSchema, routeType, schemaFileFor } from '../../src/abap_cli/aff/router.js';

describe('aff-router (T033-004)', () => {
  it('routes each of the 10 main JSON types', () => {
    expect(routeType('foo.clas.json')).toBe('CLAS');
    expect(routeType('foo.intf.json')).toBe('INTF');
    expect(routeType('foo.prog.json')).toBe('PROG');
    expect(routeType('foo.fugr.json')).toBe('FUGR');
    expect(routeType('foo.tabl.json')).toBe('TABL');
    expect(routeType('foo.stru.json')).toBe('STRU');
    expect(routeType('foo.doma.json')).toBe('DOMA');
    expect(routeType('foo.dtel.json')).toBe('DTEL');
    expect(routeType('foo.http.json')).toBe('HTTP');
    expect(routeType('foo.tran.json')).toBe('TRAN');
  });

  it('STRU maps to the same schema file as TABL', () => {
    expect(schemaFileFor('STRU')).toBe('tabl-v1.json');
    expect(schemaFileFor('TABL')).toBe('tabl-v1.json');
  });

  it('routes companion JSON files for FUGR (reps/func)', () => {
    expect(routeType('zmy.fugr.lzmy_grouptop.reps.json')).toBe('FUGR');
    expect(routeType('zmy.fugr.saplzmy_group.reps.json')).toBe('FUGR');
    expect(routeType('zmy.fugr.zfm_first.func.json')).toBe('FUGR');
    expect(routeType('zmy.fugr.lzmy_grouptop.reps.abap')).toBe('FUGR');
  });

  it('routes companion files for TABL/STRU', () => {
    expect(routeType('zmy.tabl.ddic')).toBe('TABL');
    expect(routeType('zmy.tabl.settings.json')).toBe('TABL');
    expect(routeType('zmy.stru.ddic')).toBe('STRU');
    expect(routeType('zmy.stru.settings.json')).toBe('STRU');
  });

  it('routes companion .abap / .properties for CLAS', () => {
    expect(routeType('zcl_demo.clas.definitions.abap')).toBe('CLAS');
    expect(routeType('zcl_demo.clas.implementations.abap')).toBe('CLAS');
    expect(routeType('zcl_demo.clas.testclasses.abap')).toBe('CLAS');
    expect(routeType('zcl_demo.clas.texts.en.properties')).toBe('CLAS');
  });

  it('does not match plain .json files (no type prefix)', () => {
    expect(routeType('notes.json')).toBeUndefined();
    expect(routeType('random.txt')).toBeUndefined();
  });

  it('routeAffSchema returns the schema file basename', () => {
    const r = routeAffSchema('foo.doma.json');
    expect(r?.type).toBe('DOMA');
    expect(r?.schemaFile).toBe('doma-v1.json');
    expect(r?.isJson).toBe(true);
  });

  it('returns isJson=false for .abap companions (not validated against schema)', () => {
    expect(routeAffSchema('zcl_demo.clas.definitions.abap')?.isJson).toBe(false);
    expect(routeAffSchema('zmy.tabl.ddic')?.isJson).toBe(false);
  });
});
