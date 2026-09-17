import { describe, expect, it } from 'vitest';
import { normalizeFugrFunctionModule } from '../../src/abap_cli/flows/edit/pull-fugr-ff.js';

describe('pull FUGR/FF normalization', () => {
  it('passes non-FF objects through unchanged', () => {
    const object = { name: 'ZCL_DEMO', type: 'CLAS', objectUrl: '/sap/bc/adt/classes/zcl_demo' };
    const out = normalizeFugrFunctionModule(object);
    expect(out.object).toEqual(object);
    expect(out.requestedFunctionModule).toBeUndefined();
  });

  it('rewrites FUGR/FF to the parent function group (FUGR/F) by default', () => {
    const object = {
      name: 'ZFM_FOO',
      type: 'FUGR/FF',
      objectUrl: '/sap/bc/adt/functions/groups/zfg_foo/fmodules/zfm_foo',
    };
    const out = normalizeFugrFunctionModule(object);
    expect(out.object).toEqual({
      name: 'ZFG_FOO',
      type: 'FUGR/F',
      objectUrl: '/sap/bc/adt/functions/groups/zfg_foo',
    });
    // By default the original FM is the requested module (so the fugr
    // strategy scopes its output to this one FM).
    expect(out.requestedFunctionModule).toEqual({
      name: 'ZFM_FOO',
      objectUrl: '/sap/bc/adt/functions/groups/zfg_foo/fmodules/zfm_foo',
    });
  });

  it('preserves an explicit requested function module override', () => {
    const object = {
      name: 'ZFM_FOO',
      type: 'FUGR/FF',
      objectUrl: '/sap/bc/adt/functions/groups/zfg_foo/fmodules/zfm_foo',
    };
    const override = { name: 'OTHER_FM', objectUrl: '/sap/bc/adt/functions/groups/zfg_foo/fmodules/other_fm' };
    const out = normalizeFugrFunctionModule(object, override);
    expect(out.object.name).toBe('ZFG_FOO');
    expect(out.requestedFunctionModule).toBe(override);
  });

  it('decodes URL-encoded namespaced parent groups', () => {
    const object = {
      name: '/BMW/CHECK',
      type: 'FUGR/FF',
      objectUrl: '/sap/bc/adt/functions/groups/%2Fbmw%2Ffoo/fmodules/%2Fbmw%2Fcheck',
    };
    const out = normalizeFugrFunctionModule(object);
    expect(out.object.name).toBe('/BMW/FOO');
    expect(out.object.type).toBe('FUGR/F');
    expect(out.object.objectUrl).toBe('/sap/bc/adt/functions/groups/%2Fbmw%2Ffoo');
  });

  it('throws SAP_ERROR when the FF URL has no parent function group', () => {
    const object = { name: 'ZFM_ORPHAN', type: 'FUGR/FF', objectUrl: '/sap/bc/adt/something/else' };
    expect(() => normalizeFugrFunctionModule(object)).toThrow(/Cannot determine the parent function group/);
  });
});
