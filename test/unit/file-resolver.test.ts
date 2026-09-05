/**
 * file-resolver.ts routing — 037 US3 acceptance matrix.
 *
 * 10 supported types × 2 extensions (`.json` / `.abap`) = 20 cases.
 * Asserts that `resolveFile` returns the correct route derived from the
 * object type (via `registry.ts#sourceFor`), not from a hardcoded
 * extension map. Prior bug: `*.json` was hardcoded to `icf`, causing
 * ADT types (CLAS/INTF/PROG/FUGR) to be misrouted.
 */
import { describe, it, expect } from 'vitest';
import { resolveFile } from '../../src/abap_cli/formats/file-resolver.js';

describe('resolveFile route (037 US3 — type-based priority)', () => {
  describe('ADT types (.json no longer misrouted to icf)', () => {
    it('routes CLAS .json to adt', () => {
      expect(resolveFile('src/clas/zcl_foo/zcl_foo.clas.json').route).toBe('adt');
    });
    it('routes INTF .json to adt', () => {
      expect(resolveFile('src/intf/zif_bar/zif_bar.intf.json').route).toBe('adt');
    });
    it('routes PROG .json to adt', () => {
      expect(resolveFile('src/prog/zprog/zprog.prog.json').route).toBe('adt');
    });
    it('routes FUGR .json to adt', () => {
      expect(resolveFile('src/fugr/zfugrp/zfugrp.fugr.json').route).toBe('adt');
    });
    it('still routes CLAS .abap to adt (no regression)', () => {
      expect(resolveFile('src/clas/zcl_foo/zcl_foo.clas.abap').route).toBe('adt');
    });
    it('still routes INTF .abap to adt', () => {
      expect(resolveFile('src/intf/zif_bar/zif_bar.intf.abap').route).toBe('adt');
    });
    it('still routes PROG .abap to adt', () => {
      expect(resolveFile('src/prog/zprog/zprog.prog.abap').route).toBe('adt');
    });
    it('still routes FUGR .abap to adt', () => {
      expect(resolveFile('src/fugr/zfugrp/zfugrp.fugr.abap').route).toBe('adt');
    });
  });

  describe('DDIC types stay on icf route regardless of extension', () => {
    it('routes DOMA .json to icf', () => {
      expect(resolveFile('src/doma/zdom/zdom.doma.json').route).toBe('icf');
    });
    it('routes DTEL .json to icf', () => {
      expect(resolveFile('src/dtel/zdt/zdt.dtel.json').route).toBe('icf');
    });
    it('routes TABL .json to icf', () => {
      expect(resolveFile('src/tabl/ztab/ztab.tabl.json').route).toBe('icf');
    });
    it('routes STRU .json to icf', () => {
      expect(resolveFile('src/stru/zstru/zstru.stru.json').route).toBe('icf');
    });
    it('routes DOMA .abap to icf (type-based wins over extension)', () => {
      // Once the type is known to be DDIC, .abap is still routed to icf —
      // the type is more authoritative than the extension. The legacy
      // fallback only kicks in for unknown types.
      expect(resolveFile('src/doma/zdom/zdom.doma.abap').route).toBe('icf');
    });
    it('routes DTEL .abap to icf (type-based)', () => {
      expect(resolveFile('src/dtel/zdt/zdt.dtel.abap').route).toBe('icf');
    });
    it('routes TABL .abap to icf (type-based)', () => {
      expect(resolveFile('src/tabl/ztab/ztab.tabl.abap').route).toBe('icf');
    });
    it('routes STRU .abap to icf (type-based)', () => {
      expect(resolveFile('src/stru/zstru/zstru.stru.abap').route).toBe('icf');
    });
  });

  describe('HTTP / TRAN stay on icf route', () => {
    it('routes HTTP .json to icf', () => {
      expect(resolveFile('src/http/zsrv/zsrv.http.json').route).toBe('icf');
    });
    it('routes TRAN .json to icf', () => {
      expect(resolveFile('src/tran/ztran/ztran.tran.json').route).toBe('icf');
    });
    it('routes HTTP .abap to icf (type-based)', () => {
      expect(resolveFile('src/http/zsrv/zsrv.http.abap').route).toBe('icf');
    });
    it('routes TRAN .abap to icf (type-based)', () => {
      expect(resolveFile('src/tran/ztran/ztran.tran.abap').route).toBe('icf');
    });
  });

  describe('object name normalization and format field are preserved', () => {
    it('uppercases object name from filename', () => {
      const r = resolveFile('src/clas/zcl_foo/zcl_foo.clas.json');
      expect(r.objectName).toBe('ZCL_FOO');
      expect(r.objectType).toBe('CLAS');
      expect(r.format).toBe('json');
    });

    it('restores `/` from `#` for namespaced objects', () => {
      const r = resolveFile('src/clas/#ui2#cl_json/#ui2#cl_json.clas.json');
      expect(r.objectName).toBe('/UI2/CL_JSON');
      expect(r.objectType).toBe('CLAS');
      expect(r.route).toBe('adt');
    });
  });

  describe('TTYP / MSAG / DDLS (036 dual-channel) route via registry', () => {
    it('routes TTYP .json to icf (registry says ADT but ICF is fallback; primary = adt)', () => {
      // registry.ts#sourceFor('TTYP') = 'ADT', so type-based route = 'adt'.
      // The push-flow channel-detect layer handles ICF fallback internally;
      // file-resolver only sets the *primary* route.
      expect(resolveFile('src/ttyp/zttyp/zttyp.ttyp.json').route).toBe('adt');
    });
    it('routes MSAG .json to adt', () => {
      expect(resolveFile('src/msag/zmsag/zmsag.msag.json').route).toBe('adt');
    });
    it('routes DDLS .json to adt', () => {
      expect(resolveFile('src/ddls/zdds/zdds.ddls.json').route).toBe('adt');
    });
  });

  describe('Unknown types fall back to extension map', () => {
    it('routes unknown .abap to adt (legacy behavior)', () => {
      // object type "FOO" is not in registry, but `.abap` extension maps to adt.
      expect(resolveFile('src/foo/zfoo/zfoo.foo.abap').route).toBe('adt');
    });
    it('routes unknown .json to icf (legacy fallback)', () => {
      // No type-based hit; fall back to EXT_ROUTE_MAP (kept as a safety net
      // for hand-crafted or future type codes).
      expect(resolveFile('src/foo/zfoo/zfoo.foo.json').route).toBe('icf');
    });
  });
});
