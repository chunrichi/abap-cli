import { describe, expect, it, vi } from 'vitest';
import {
  enumerateFugr,
  fugrFileToken,
  fugrPushTargetFor,
  fugrSourceUrlForSubtype,
  isFugrTopInclude,
  isFugrUxxInclude,
  readFuncIncludeNumbers,
  type FugrLayout,
} from '../../src/abap_cli/formats/fugr-layout.js';

describe('fugrFileToken / isFugrTopInclude / isFugrUxxInclude (T1.3)', () => {
  it('fugrFileToken keeps simple names lowercased', () => {
    expect(fugrFileToken('LZFG_TOP')).toBe('lzfg_top');
    expect(fugrFileToken('ZFN_ONE')).toBe('zfn_one');
  });

  it('fugrFileToken encodes namespaced names with the AFF parentheses form', () => {
    expect(fugrFileToken('/UI5/CL_FOO')).toBe('#ui5#cl_foo');
  });

  it('isFugrTopInclude matches TOP include (and only TOP)', () => {
    expect(isFugrTopInclude('LZFG_TOP', 'ZFG')).toBe(true);
    expect(isFugrTopInclude('LZFG_F01', 'ZFG')).toBe(false);
    expect(isFugrTopInclude('LZFGU01', 'ZFG')).toBe(false);
  });

  it('isFugrUxxInclude matches the field-style U01..U99 and the legacy UXX form', () => {
    expect(isFugrUxxInclude('LZFGU01', 'ZFG')).toBe(true);
    expect(isFugrUxxInclude('LZFGU02', 'ZFG')).toBe(true);
    expect(isFugrUxxInclude('LZFGU99', 'ZFG')).toBe(true);
    expect(isFugrUxxInclude('LZFGUXX', 'ZFG')).toBe(true);
    // Non-includes
    expect(isFugrUxxInclude('LZFG_F01', 'ZFG')).toBe(false);
    expect(isFugrUxxInclude('LZFG_TOP', 'ZFG')).toBe(false);
    expect(isFugrUxxInclude('ZOTHERU01', 'ZFG')).toBe(false);
  });
});

const GROUP = '/sap/bc/adt/functions/groups/zfg';

function structure(name: string, type: string, sourceUri = 'source/main', description = ''): Record<string, unknown> {
  return {
    'adtcore:name': name,
    'adtcore:type': type,
    'abapsource:sourceUri': sourceUri,
    'adtcore:description': description,
  };
}

describe('enumerateFugr — preserve FXX/OXX/IXX (T1.3)', () => {
  it('returns all FUGR/I includes (FXX/OXX/IXX preserved, UXX included)', async () => {
    const client = {
      objectStructure: vi.fn(async (uri: string) => {
        if (uri === GROUP) {
          return { metaData: { ...structure('ZFG', 'FUGR/F'), 'abapsource:sourceUri': 'source/main' } };
        }
        const name = (uri.split('/').pop() ?? '').toUpperCase();
        return { metaData: structure(name, 'FUGR/I') };
      }),
      searchObject: vi.fn(async (query: string) => {
        if (query === 'LZFG*') {
          return [
            { 'adtcore:name': 'LZFG_TOP', 'adtcore:type': 'FUGR/I', 'adtcore:uri': `${GROUP}/includes/lzfg_top` },
            { 'adtcore:name': 'LZFG_F01', 'adtcore:type': 'FUGR/I', 'adtcore:uri': `${GROUP}/includes/lzfg_f01` },
            { 'adtcore:name': 'LZFG_O01', 'adtcore:type': 'FUGR/I', 'adtcore:uri': `${GROUP}/includes/lzfg_o01` },
            { 'adtcore:name': 'LZFG_I01', 'adtcore:type': 'FUGR/I', 'adtcore:uri': `${GROUP}/includes/lzfg_i01` },
            { 'adtcore:name': 'LZFGU01', 'adtcore:type': 'FUGR/I', 'adtcore:uri': `${GROUP}/includes/lzfgu01` },
          ];
        }
        return [];
      }),
      getObjectSource: vi.fn(async () => ''),
    } as never;
    const layout = await enumerateFugr(client, GROUP);
    const names = layout.includes.map((i) => i.name).sort();
    expect(names).toContain('LZFG_TOP');
    expect(names).toContain('LZFG_F01');
    expect(names).toContain('LZFG_O01');
    expect(names).toContain('LZFG_I01');
    expect(names).toContain('LZFGU01');
  });

  it('honours requestedFunctionModule filter (only the requested FM is returned)', async () => {
    const client = {
      objectStructure: vi.fn(async (uri: string) => {
        if (uri === GROUP) {
          return { metaData: { ...structure('ZFG', 'FUGR/F'), 'abapsource:sourceUri': 'source/main' } };
        }
        const name = (uri.split('/').pop() ?? '').toUpperCase();
        return { metaData: structure(name, uri.includes('/fmodules/') ? 'FUGR/FF' : 'FUGR/I') };
      }),
      searchObject: vi.fn(async (query: string) => {
        if (query === 'LZFG*') {
          return [
            { 'adtcore:name': 'LZFG_TOP', 'adtcore:type': 'FUGR/I', 'adtcore:uri': `${GROUP}/includes/lzfg_top` },
          ];
        }
        // '*ZFG*' returns no FUGR/FF hits → the requested FM is the only one.
        return [];
      }),
      getObjectSource: vi.fn(async () => ''),
    } as never;
    const layout = await enumerateFugr(client, GROUP, {
      name: 'ZFN_ONE',
      objectUrl: `${GROUP}/fmodules/zfn_one`,
    });
    // The locally-requested FM is appended even if search did not return it.
    expect(layout.funcs.map((f) => f.name).sort()).toEqual(['ZFN_ONE']);
  });
});

describe('readFuncIncludeNumbers — CRLF double-line INCLUDE', () => {
  it('parses single-line INCLUDE comment form', async () => {
    const uxx = {
      name: 'LZFGUXX',
      objectUrl: `${GROUP}/includes/lzfguxx`,
      sourceUrl: `${GROUP}/includes/lzfguxx/source/main`,
      description: '',
    } as never;
    const client = {
      getObjectSource: vi.fn(async () =>
        [
          'PROGRAM LZFGUXX.',
          'INCLUDE LZFGUXX.',
          '',
          '***********************************************************************',
          '*       CLASS lcl_cl_demo DEFINITION',
          '***********************************************************************',
          'INCLUDE LZFGU01.  "ZFN_ONE',
          'INCLUDE LZFGU02.  "ZFN_TWO',
          '',
          'ENDFUNCTION.',
        ].join('\n'),
      ),
    } as never;
    const numbers = await readFuncIncludeNumbers(client, 'ZFG', [uxx]);
    expect(numbers.get('ZFN_ONE')).toBe('01');
    expect(numbers.get('ZFN_TWO')).toBe('02');
  });

  it('parses CRLF double-line INCLUDE form (real SAP)', async () => {
    const uxx = {
      name: 'LZFGUXX',
      objectUrl: `${GROUP}/includes/lzfguxx`,
      sourceUrl: `${GROUP}/includes/lzfguxx/source/main`,
      description: '',
    } as never;
    const client = {
      getObjectSource: vi.fn(async () =>
        'INCLUDE LZFGUXX.\r\nINCLUDE LZFGU01.\r\n  "ZFN_ONE\r\nINCLUDE LZFGU02.\r\n  "ZFN_TWO\r\n',
      ),
    } as never;
    const numbers = await readFuncIncludeNumbers(client, 'ZFG', [uxx]);
    expect(numbers.get('ZFN_ONE')).toBe('01');
    expect(numbers.get('ZFN_TWO')).toBe('02');
  });
});

describe('fugrPushTargetFor — FXX/OXX/IXX lock targets', () => {
  it('resolves FXX/OXX/IXX .reps targets to their include child URL', () => {
    const layout: FugrLayout = {
      group: 'ZFG',
      groupLow: 'zfg',
      groupFile: 'zfg',
      saplUrl: `${GROUP}/source/main`,
      includes: [
        {
          name: 'LZFG_F01',
          objectUrl: `${GROUP}/includes/lzfg_f01`,
          sourceUrl: `${GROUP}/includes/lzfg_f01/source/main`,
          description: 'FXX',
        },
        {
          name: 'LZFG_TOP',
          objectUrl: `${GROUP}/includes/lzfg_top`,
          sourceUrl: `${GROUP}/includes/lzfg_top/source/main`,
          description: 'TOP',
        },
      ],
      funcs: [],
    };
    const fxx = fugrPushTargetFor(layout, 'lzfg_f01.reps', GROUP);
    expect(fxx?.objectUrl).toBe(`${GROUP}/includes/lzfg_f01`);
    expect(fxx?.sourceUrl).toBe(`${GROUP}/includes/lzfg_f01/source/main`);

    const top = fugrPushTargetFor(layout, 'lzfg_top.reps', GROUP);
    expect(top?.objectUrl).toBe(`${GROUP}/includes/lzfg_top`);

    const groupMain = fugrPushTargetFor(layout, 'saplzfg.reps', GROUP);
    expect(groupMain?.objectUrl).toBe(GROUP);
    expect(groupMain?.sourceUrl).toBe(`${GROUP}/source/main`);
  });

  it('returns undefined for unknown subtypes', () => {
    const layout: FugrLayout = {
      group: 'ZFG',
      groupLow: 'zfg',
      groupFile: 'zfg',
      saplUrl: `${GROUP}/source/main`,
      includes: [],
      funcs: [],
    };
    expect(fugrPushTargetFor(layout, 'lzfg_ghost.reps', GROUP)).toBeUndefined();
    expect(fugrPushTargetFor(layout, 'ghost.func', GROUP)).toBeUndefined();
    expect(fugrSourceUrlForSubtype(layout, 'saplzfg.reps')).toBe(`${GROUP}/source/main`);
  });
});
