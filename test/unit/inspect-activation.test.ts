/**
 * #4 (feedback/ISSUES.md): `inspect --activation` must ignore the `main`
 * part's `active` flag (which reports false for the INCLUDE program even when
 * the class is fully activated) and base `ok` on the implementation parts.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { registerInspectCommand } from '../../src/abap_cli/commands/inspect.js';
import { makeProgram, runCommand } from './cli-helper.js';

const LATEST_DEF = 'CLASS zcl_x DEFINITION.\nENDCLASS.';
const LATEST_IMP = 'CLASS zcl_x IMPLEMENTATION.\nENDCLASS.';
const LATEST_MAIN = 'INCLUDE zcl_x_main.\n';
const ACTIVE_DEF = LATEST_DEF;
const ACTIVE_IMP = LATEST_IMP;
const ACTIVE_MAIN = ''; // ADT returns empty active for `main` INCLUDE program

const searchObject = vi.fn(async (query: string) => {
  if (query.includes('ZCLI_PROG')) {
    return [
      {
        'adtcore:name': 'ZCLI_PROG',
        'adtcore:type': 'PROG/P',
        'adtcore:uri': '/sap/bc/adt/programs/programs/zcli_prog',
        'adtcore:packageName': '$TMP',
      },
    ];
  }
  return [
    {
      'adtcore:name': 'ZCL_MULTI',
      'adtcore:type': 'CLAS/OC',
      'adtcore:uri': '/sap/bc/adt/oo/classes/zcl_multi',
      'adtcore:packageName': '$TMP',
    },
  ];
});

const objectStructure = vi.fn(async (url: string) => {
  if (url.includes('zcli_prog')) {
    return {
      objectUrl: '/sap/bc/adt/programs/programs/zcli_prog',
      metaData: {
        'adtcore:name': 'ZCLI_PROG',
        'adtcore:type': 'PROG/P',
        'adtcore:description': 'Demo',
      },
      includes: [
        { 'class:includeType': 'main', 'abapsource:sourceUri': '/source/main' },
      ],
    };
  }
  return {
    objectUrl: '/sap/bc/adt/oo/classes/zcl_multi',
    metaData: {
      'adtcore:name': 'ZCL_MULTI',
      'adtcore:type': 'CLAS/OC',
      'adtcore:description': 'Demo',
    },
    includes: [
      { 'class:includeType': 'main', 'abapsource:sourceUri': '/source/main' },
      { 'class:includeType': 'definitions', 'abapsource:sourceUri': '/source/locals_def' },
      { 'class:includeType': 'implementations', 'abapsource:sourceUri': '/source/locals_imp' },
    ],
  };
});

// Map sourceUri → return value: latest vs active.
const getObjectSource = vi.fn(async (uri: string) => {
  if (uri.includes('locals_def')) return LATEST_DEF;
  if (uri.includes('locals_imp')) return LATEST_IMP;
  if (uri.endsWith('main')) return LATEST_MAIN;
  return '';
});
const raw = {
  getObjectSource: vi.fn(async (uri: string, opts?: { version?: string }) => {
    if (opts?.version !== 'active') throw new Error('expected active version');
    if (uri.includes('locals_def')) return ACTIVE_DEF;
    if (uri.includes('locals_imp')) return ACTIVE_IMP;
    if (uri.endsWith('main')) return ACTIVE_MAIN;
    return '';
  }),
};
// inspect-ops reads the active version through the wrapper method (routed via
// `_call`) rather than reaching into `raw`.
const getActiveObjectSource = vi.fn(async (uri: string) => {
  if (uri.includes('locals_def')) return ACTIVE_DEF;
  if (uri.includes('locals_imp')) return ACTIVE_IMP;
  if (uri.endsWith('main')) return ACTIVE_MAIN;
  return '';
});

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      searchObject,
      objectStructure,
      getObjectSource,
      getActiveObjectSource,
      raw,
      lock: vi.fn(),
    }),
  },
}));

describe('inspect --activation (#4)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ok=true when implementations+definitions are active even if main INCLUDE reports false', async () => {
    const program = makeProgram();
    registerInspectCommand(program);
    const res = await runCommand(program, ['inspect', 'ZCL_MULTI', '--activation', '--json']);
    expect(res.exitCode).toBeUndefined();
    const data = JSON.parse(res.stdout).data;
    expect(data.activation.ok).toBe(true);
    // The `main` part is still reported for visibility (active:false is expected).
    const main = data.activation.parts.find((p: { includeType: string }) => p.includeType === 'main');
    expect(main.active).toBe(false);
    // No `inactive` list when ok.
    expect(data.activation.inactive).toBeUndefined();
  });

  it('ok=false when implementations part is stale (active != latest)', async () => {
    getActiveObjectSource.mockImplementation(async (uri: string) => {
      if (uri.includes('locals_imp')) return 'CLASS zcl_x IMPLEMENTATION.\n  STALE.\nENDCLASS.';
      if (uri.includes('locals_def')) return ACTIVE_DEF;
      if (uri.endsWith('main')) return ACTIVE_MAIN;
      return '';
    });
    const program = makeProgram();
    registerInspectCommand(program);
    const res = await runCommand(program, ['inspect', 'ZCL_MULTI', '--activation', '--json']);
    const data = JSON.parse(res.stdout).data;
    expect(data.activation.ok).toBe(false);
    expect(data.activation.inactive).toEqual([
      { includeType: 'implementations', reason: 'stale_active' },
    ]);
  });

  it('annotates OO class `main` part with a note about SAP INCLUDE byte-mismatch quirk', async () => {
    // CLAS/OC `source/main` latest != active is structural (SAP regenerates the
    // active INCLUDE with case-lowering + create-private + section headers), so
    // the user must not act on `main.active: false`. Surface a per-part note.
    // Reset the active-source mock so the prior test's stale-active state does
    // not leak into this one.
    getActiveObjectSource.mockImplementation(async (uri: string) => {
      if (uri.includes('locals_def')) return ACTIVE_DEF;
      if (uri.includes('locals_imp')) return ACTIVE_IMP;
      if (uri.endsWith('main')) return ACTIVE_MAIN;
      return '';
    });
    const program = makeProgram();
    registerInspectCommand(program);
    const res = await runCommand(program, ['inspect', 'ZCL_MULTI', '--activation', '--json']);
    const data = JSON.parse(res.stdout).data;
    const main = data.activation.parts.find((p: { includeType: string }) => p.includeType === 'main');
    expect(main.note).toMatch(/system-managed|sap.*include|byte-mismatch|regenerat/i);
    // Note is informational; ok stays driven by implementation parts.
    expect(data.activation.ok).toBe(true);
  });

  it('does NOT add the OO-class quirk note on non-OO source/main parts (e.g. PROG)', async () => {
    // PROG has no system-managed INCLUDE quirk — its `source/main` is a single
    // user-editable include, so latest===active is the right signal. The
    // searchObject / objectStructure mocks above already route PROG/P to its
    // own single-main include layout.
    const program = makeProgram();
    registerInspectCommand(program);
    const res = await runCommand(program, ['inspect', 'ZCLI_PROG', '--activation', '--json']);
    const data = JSON.parse(res.stdout).data;
    const main = data.activation.parts.find((p: { includeType: string }) => p.includeType === 'main');
    expect(main.note).toBeUndefined();
  });
});