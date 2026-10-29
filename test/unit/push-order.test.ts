import { describe, expect, it } from 'vitest';
import { orderTargetsByDependency } from '../../src/abap_cli/flows/edit/push-order.js';

describe('push dependency topology ordering', () => {
  it('orders DDIC prerequisites before classes and programs', () => {
    const input = [
      'src/Programs/ztool.prog.abap',
      'src/Classes/zcl_session.clas.abap',
      'src/Lock Objects/ez_session.enqu.json',
      'src/Database Tables/ztab.tabl.json',
      'src/Data Elements/zdtel.dtel.json',
      'src/Domains/zdom.doma.json',
    ];

    const ordered = orderTargetsByDependency(input);

    expect(ordered).toEqual([
      'src/Domains/zdom.doma.json',
      'src/Data Elements/zdtel.dtel.json',
      'src/Database Tables/ztab.tabl.json',
      'src/Lock Objects/ez_session.enqu.json',
      'src/Classes/zcl_session.clas.abap',
      'src/Programs/ztool.prog.abap',
    ]);
  });

  it('preserves stable relative order for files of the same type', () => {
    const input = [
      'src/Database Tables/ztab_b.tabl.json',
      'src/Database Tables/ztab_a.tabl.json',
      'src/Programs/zprog_2.prog.abap',
      'src/Programs/zprog_1.prog.abap',
    ];

    const ordered = orderTargetsByDependency(input);

    expect(ordered).toEqual([
      'src/Database Tables/ztab_b.tabl.json',
      'src/Database Tables/ztab_a.tabl.json',
      'src/Programs/zprog_2.prog.abap',
      'src/Programs/zprog_1.prog.abap',
    ]);
  });

  it('sorts tabl artifact sidecars with the same priority as the main file', () => {
    const input = [
      'src/Programs/ztool.prog.abap',
      'src/Database Tables/ztab.tabl.ddic',
      'src/Database Tables/ztab.tabl.json',
    ];

    const ordered = orderTargetsByDependency(input);

    expect(ordered).toEqual([
      'src/Database Tables/ztab.tabl.ddic',
      'src/Database Tables/ztab.tabl.json',
      'src/Programs/ztool.prog.abap',
    ]);
  });

  it('sinks unknown / unresolvable files to the end (priority 100)', () => {
    const input = [
      'src/no-extension-stray-file',
      'src/Classes/zcl_session.clas.abap',
    ];

    const ordered = orderTargetsByDependency(input);

    expect(ordered).toEqual([
      'src/Classes/zcl_session.clas.abap',
      'src/no-extension-stray-file',
    ]);
  });
});
