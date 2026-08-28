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

const searchObject = vi.fn(async () => [
  {
    'adtcore:name': 'ZCL_MULTI',
    'adtcore:type': 'CLAS/OC',
    'adtcore:uri': '/sap/bc/adt/oo/classes/zcl_multi',
  },
]);

const objectStructure = vi.fn(async () => ({
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
}));

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

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      searchObject,
      objectStructure,
      getObjectSource,
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
    raw.getObjectSource.mockImplementation(async (uri: string, opts?: { version?: string }) => {
      if (opts?.version !== 'active') throw new Error('expected active version');
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
});