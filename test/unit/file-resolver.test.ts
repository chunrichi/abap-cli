/**
 * file-resolver.ts — AFF flat filenames and type-based routing.
 *
 * Artifacts follow the SAP abap-file-formats naming convention and are written
 * flat: `<name>.<type>[.<subtype>][.<category>][.<lang>].<ext>`. There is no
 * per-object directory any more, and namespaced names use the AFF `(ns)name`
 * token (the retired abapGit `#ns#name` token is rejected with a migration
 * hint — it was never a valid AFF filename).
 *
 * 10 supported types × 2 extensions (`.json` / `.abap`) = 20 routing cases,
 * plus the filename-token round-trip and textpool `.properties` parsing.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveFile,
  buildFilename,
  affObjectToken,
  affObjectNameFromToken,
} from '../../src/abap_cli/formats/file-resolver.js';

describe('resolveFile route (type-based priority)', () => {
  describe('ADT types (.json no longer misrouted to icf)', () => {
    it('routes CLAS .json to adt', () => {
      expect(resolveFile('src/zcl_foo.clas.json').route).toBe('adt');
    });
    it('routes INTF .json to adt', () => {
      expect(resolveFile('src/zif_bar.intf.json').route).toBe('adt');
    });
    it('routes PROG .json to adt', () => {
      expect(resolveFile('src/zprog.prog.json').route).toBe('adt');
    });
    it('routes FUGR .json to adt', () => {
      expect(resolveFile('src/zfugrp.fugr.json').route).toBe('adt');
    });
    it('still routes CLAS .abap to adt (no regression)', () => {
      expect(resolveFile('src/zcl_foo.clas.abap').route).toBe('adt');
    });
    it('still routes INTF .abap to adt', () => {
      expect(resolveFile('src/zif_bar.intf.abap').route).toBe('adt');
    });
    it('still routes PROG .abap to adt', () => {
      expect(resolveFile('src/zprog.prog.abap').route).toBe('adt');
    });
    it('still routes FUGR .abap to adt', () => {
      expect(resolveFile('src/zfugrp.fugr.abap').route).toBe('adt');
    });
  });

  describe('DDIC types stay on icf route regardless of extension', () => {
    it('routes DOMA .json to icf', () => {
      expect(resolveFile('src/zdom.doma.json').route).toBe('icf');
    });
    it('routes DTEL .json to icf', () => {
      expect(resolveFile('src/zdt.dtel.json').route).toBe('icf');
    });
    it('routes TABL .json to icf', () => {
      expect(resolveFile('src/ztab.tabl.json').route).toBe('icf');
    });
    it('routes STRU .json to icf', () => {
      expect(resolveFile('src/zstru.stru.json').route).toBe('icf');
    });
    it('routes DOMA .abap to icf (type-based wins over extension)', () => {
      // Once the type is known to be DDIC, .abap is still routed to icf —
      // the type is more authoritative than the extension. The legacy
      // fallback only kicks in for unknown types.
      expect(resolveFile('src/zdom.doma.abap').route).toBe('icf');
    });
    it('routes DTEL .abap to icf (type-based)', () => {
      expect(resolveFile('src/zdt.dtel.abap').route).toBe('icf');
    });
    it('routes TABL .abap to icf (type-based)', () => {
      expect(resolveFile('src/ztab.tabl.abap').route).toBe('icf');
    });
    it('routes STRU .abap to icf (type-based)', () => {
      expect(resolveFile('src/zstru.stru.abap').route).toBe('icf');
    });
  });

  describe('HTTP / TRAN stay on icf route', () => {
    it('routes HTTP .json to icf', () => {
      expect(resolveFile('src/zsrv.http.json').route).toBe('icf');
    });
    it('routes TRAN .json to icf', () => {
      expect(resolveFile('src/ztran.tran.json').route).toBe('icf');
    });
    it('routes HTTP .abap to icf (type-based)', () => {
      expect(resolveFile('src/zsrv.http.abap').route).toBe('icf');
    });
    it('routes TRAN .abap to icf (type-based)', () => {
      expect(resolveFile('src/ztran.tran.abap').route).toBe('icf');
    });
  });

  describe('object name normalization and format field are preserved', () => {
    it('uppercases object name from filename', () => {
      const r = resolveFile('src/zcl_foo.clas.json');
      expect(r.objectName).toBe('ZCL_FOO');
      expect(r.objectType).toBe('CLAS');
      expect(r.format).toBe('json');
    });

    it('restores the namespace from the AFF parentheses token', () => {
      const r = resolveFile('src/(ui2)cl_json.clas.json');
      expect(r.objectName).toBe('/UI2/CL_JSON');
      expect(r.objectType).toBe('CLAS');
      expect(r.route).toBe('adt');
    });

    it('rejects the retired # namespace token with FILE_PARSE_ERROR and a migration hint', () => {
      expect(() => resolveFile('src/#ui2#cl_json.clas.abap')).toThrowError(
        expect.objectContaining({
          code: 'FILE_PARSE_ERROR',
          message: expect.stringMatching(/retired '#' namespace token/),
        }),
      );
      try {
        resolveFile('src/#ui2#cl_json.clas.abap');
      } catch (e) {
        const err = e as { nextSteps?: string[]; example?: string };
        expect(err.nextSteps?.join(' ')).toMatch(/abap pull/);
        expect(err.example).toBe('abap pull /UI2/CL_JSON');
      }
    });
  });

  describe('TTYP / MSAG / DDLS (dual-channel) route via registry', () => {
    it('routes TTYP .json to adt (primary channel)', () => {
      // registry.ts#sourceFor('TTYP') = 'ADT', so type-based route = 'adt'.
      // The push-flow channel-detect layer handles ICF fallback internally;
      // file-resolver only sets the *primary* route.
      expect(resolveFile('src/zttyp.ttyp.json').route).toBe('adt');
    });
    it('routes MSAG .json to adt', () => {
      expect(resolveFile('src/zmsag.msag.json').route).toBe('adt');
    });
    it('routes DDLS .json to adt', () => {
      expect(resolveFile('src/zdds.ddls.json').route).toBe('adt');
    });
  });

  describe('Unknown types fall back to extension map', () => {
    it('routes unknown .abap to adt (legacy behavior)', () => {
      // object type "FOO" is not in registry, but `.abap` extension maps to adt.
      expect(resolveFile('src/zfoo.foo.abap').route).toBe('adt');
    });
    it('routes unknown .json to icf (legacy fallback)', () => {
      // No type-based hit; fall back to EXT_ROUTE_MAP (kept as a safety net
      // for hand-crafted or future type codes).
      expect(resolveFile('src/zfoo.foo.json').route).toBe('icf');
    });
  });
});

describe('affObjectToken (object name → AFF filename token)', () => {
  it('lowercases plain names', () => {
    expect(affObjectToken('ZCL_FOO')).toBe('zcl_foo');
    expect(affObjectToken('my_table')).toBe('my_table');
  });

  it('turns /NAMESPACE/NAME into (namespace)name', () => {
    expect(affObjectToken('/UI2/CL_JSON')).toBe('(ui2)cl_json');
    expect(affObjectToken('/SAP/BC_DEMO')).toBe('(sap)bc_demo');
  });

  it('never produces the retired # token and never a path separator', () => {
    // A non-namespaced shape containing '/' is sanitized so it can never
    // escape the flat output directory.
    expect(affObjectToken('A/B/C')).toBe('a#b#c');
    expect(affObjectToken('/UI2/CL_JSON')).not.toContain('/');
  });
});

describe('affObjectNameFromToken (AFF filename token → object name)', () => {
  it('uppercases plain names', () => {
    expect(affObjectNameFromToken('zcl_foo')).toBe('ZCL_FOO');
  });

  it('restores /NAMESPACE/NAME from (namespace)name', () => {
    expect(affObjectNameFromToken('(ui2)cl_json')).toBe('/UI2/CL_JSON');
  });

  it('round-trips namespaced object names', () => {
    for (const name of ['/UI2/CL_JSON', '/SAP/BC_DEMO']) {
      expect(affObjectNameFromToken(affObjectToken(name))).toBe(name);
    }
  });

  it('rejects the retired # token with FILE_PARSE_ERROR and the basename in the message', () => {
    expect(() => affObjectNameFromToken('#ui2#cl_json', '#ui2#cl_json.clas.abap')).toThrowError(
      expect.objectContaining({
        code: 'FILE_PARSE_ERROR',
        message: expect.stringMatching(/#ui2#cl_json\.clas\.abap uses the retired '#' namespace token/),
      }),
    );
  });
});

describe('buildFilename (flat AFF filenames)', () => {
  it('builds <name>.<type>.<ext> for the main part', () => {
    expect(buildFilename('ZCL_FOO', 'CLAS')).toBe('zcl_foo.clas.abap');
    expect(buildFilename('ZMY_TABLE', 'TABL', 'main', '.json')).toBe('zmy_table.tabl.json');
  });

  it('appends the include subtype for CLAS parts', () => {
    expect(buildFilename('ZCL_FOO', 'CLAS', 'implementations')).toBe(
      'zcl_foo.clas.implementations.abap',
    );
    expect(buildFilename('ZCL_FOO', 'CLAS', 'testclasses')).toBe('zcl_foo.clas.testclasses.abap');
  });

  it('keeps subtypes like PROG include and FUGR function modules flat', () => {
    expect(buildFilename('ZPROG_TOP', 'PROG', 'include')).toBe('zprog_top.prog.include.abap');
    expect(buildFilename('ZFG_DEMO', 'FUGR', 'zfg_demo_ff01.func', '.abap')).toBe(
      'zfg_demo.fugr.zfg_demo_ff01.func.abap',
    );
  });

  it('uses the AFF parentheses token for namespaced objects', () => {
    expect(buildFilename('/UI2/CL_JSON', 'CLAS')).toBe('(ui2)cl_json.clas.abap');
  });

  it('uses only the primary type for the extension', () => {
    expect(buildFilename('ZPROG', 'PROG/P')).toBe('zprog.prog.abap');
    expect(buildFilename('ZCL_FOO', 'CLAS/OC', 'main', '.json')).toBe('zcl_foo.clas.json');
  });
});

describe('resolveFile textpool .properties', () => {
  it('parses <name>.<type>.texts.<lang>.properties', () => {
    const r = resolveFile('src/zprog.prog.texts.en.properties');
    expect(r.objectName).toBe('ZPROG');
    expect(r.objectType).toBe('PROG');
    expect(r.subtype).toBe('texts.en');
    expect(r.route).toBe('textpool');
    expect(r.format).toBe('json');
  });

  it('parses selections / headings categories', () => {
    expect(resolveFile('src/zcl_demo.clas.selections.de.properties').subtype).toBe(
      'selections.de',
    );
    expect(resolveFile('src/zcl_demo.clas.headings.en.properties').subtype).toBe('headings.en');
  });

  it('restores the namespace for namespaced textpool files', () => {
    const r = resolveFile('src/(ui2)cl_json.clas.texts.en.properties');
    expect(r.objectName).toBe('/UI2/CL_JSON');
    expect(r.objectType).toBe('CLAS');
    expect(r.subtype).toBe('texts.en');
  });

  it('rejects a retired # token in a .properties file', () => {
    expect(() => resolveFile('src/#ui2#cl_json.clas.texts.en.properties')).toThrowError(
      expect.objectContaining({ code: 'FILE_PARSE_ERROR' }),
    );
  });

  it('rejects an unknown textpool category', () => {
    expect(() => resolveFile('src/zprog.prog.symbols.en.properties')).toThrowError(
      expect.objectContaining({
        code: 'FILE_PARSE_ERROR',
        message: expect.stringMatching(/Unknown textpool category 'symbols'/),
      }),
    );
  });

  it('rejects a malformed .properties filename', () => {
    expect(() => resolveFile('src/zprog.properties')).toThrowError(
      expect.objectContaining({ code: 'FILE_PARSE_ERROR' }),
    );
  });
});
