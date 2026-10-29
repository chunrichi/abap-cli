/**
 * 032 US13: PROG/I sub-route on pull.
 *
 * PROG/I (include program) is pulled as:
 *   `<name>.prog.include.abap`  — source part remapped from `main` → `include`
 *   `<name>.prog.json`          — metadata file with
 *                                 `generalInformation.programType: 'include'`
 *                                 (abap-file-format prog-v1 enum).
 *
 * The "main" part is intentionally absent: PROG/I objects have no main,
 * they only carry their own source (which is itself an include).
 *
 * Real-SAP validation note: T058 spec calls for "mock + 真实 SAP 各 1 个 I
 * 类型程序". The real-SAP case is deferred to Phase 5 (vhcala4hci:50000
 * currently unreachable); mock coverage here exercises both PROG/I shapes
 * (mock returns `programType: 'I'`, real SAP may omit programType on
 * includes — `objectType: 'PROG/I'` is the fallback trigger).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerPullCommand } from '../../src/abap_cli/commands/pull.js';
import { makeProgram, runCommand } from './cli-helper.js';

const searchObject = vi.fn(async (name: string) => [
  {
    'adtcore:name': name.toUpperCase(),
    'adtcore:type': 'PROG/I',
    'adtcore:uri': `/sap/bc/adt/programs/includes/${name.toLowerCase()}`,
  },
]);
const objectStructure = vi.fn(async (objectUrl: string) => ({
  objectUrl,
  metaData: {
    'adtcore:description': 'Demo include',
    'adtcore:masterLanguage': 'EN',
    'adtcore:type': 'PROG/I',
    'program:programType': 'I',
    'abapsource:sourceUri': `${objectUrl}/source/main`,
  },
  links: [],
}));
const getObjectSource = vi.fn(async (url: string) => `INCLUDE SOURCE ${url}`);

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      searchObject,
      objectStructure,
      getObjectSource,
      getConfig: () => ({ transport: undefined }),
    }),
  },
}));

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'prog-include-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
});

describe('032/prog-subtype-include', () => {
  it('PROG/I with programType: "I" → <name>.prog.include.abap', async () => {
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZPROG_TOP', '--type', 'PROG', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();

    const dir = path.join(cwd, 'src', 'prog', 'zprog_top');
    expect(fs.existsSync(path.join(dir, 'zprog_top.prog.include.abap'))).toBe(true);
    // main path is NOT written for PROG/I
    expect(fs.existsSync(path.join(dir, 'zprog_top.prog.abap'))).toBe(false);
  });

  it('JSON metadata carries generalInformation.programType: "include"', async () => {
    const program = makeProgram();
    registerPullCommand(program);
    await runCommand(program, ['pull', 'ZPROG_TOP', '--type', 'PROG', '--json'], { cwd });

    const dir = path.join(cwd, 'src', 'prog', 'zprog_top');
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'zprog_top.prog.json'), 'utf-8'));
    expect(meta.generalInformation.programType).toBe('include');
    expect(meta.formatVersion).toBe('1');
    expect(meta.header.description).toBe('Demo include');
  });

  it('PROG/I via objectType alone (real SAP omits programType) — same routing', async () => {
    // Simulate real-SAP behavior: program:programType is absent but
    // adtcore:type = 'PROG/I'. The sub-route fires on objectType alone.
    objectStructure.mockResolvedValueOnce({
      objectUrl: '/sap/bc/adt/programs/includes/zprog_real',
      metaData: {
        'adtcore:description': 'Real SAP include',
        'adtcore:masterLanguage': 'EN',
        'adtcore:type': 'PROG/I',
        'abapsource:sourceUri': '/sap/bc/adt/programs/includes/zprog_real/source/main',
      },
      links: [],
    });
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZPROG_REAL', '--type', 'PROG', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();

    const dir = path.join(cwd, 'src', 'prog', 'zprog_real');
    expect(fs.existsSync(path.join(dir, 'zprog_real.prog.include.abap'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'zprog_real.prog.abap'))).toBe(false);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'zprog_real.prog.json'), 'utf-8'));
    expect(meta.generalInformation.programType).toBe('include');
  });

  it('PROG executable (programType "1") stays on the main path (regression)', async () => {
    // Pull back to a normal PROG/P — main path must NOT be remapped.
    searchObject.mockResolvedValueOnce([
      {
        'adtcore:name': 'ZPROG_EXEC',
        'adtcore:type': 'PROG/P',
        'adtcore:uri': '/sap/bc/adt/programs/programs/zprog_exec',
      },
    ]);
    objectStructure.mockResolvedValueOnce({
      objectUrl: '/sap/bc/adt/programs/programs/zprog_exec',
      metaData: {
        'adtcore:description': 'Executable program',
        'adtcore:masterLanguage': 'EN',
        'adtcore:type': 'PROG/P',
        'program:programType': '1',
        'abapsource:sourceUri': '/sap/bc/adt/programs/programs/zprog_exec/source/main',
      },
      links: [],
    });
    const program = makeProgram();
    registerPullCommand(program);
    await runCommand(program, ['pull', 'ZPROG_EXEC', '--type', 'PROG', '--json'], { cwd });

    const dir = path.join(cwd, 'src', 'prog', 'zprog_exec');
    expect(fs.existsSync(path.join(dir, 'zprog_exec.prog.abap'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'zprog_exec.prog.include.abap'))).toBe(false);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'zprog_exec.prog.json'), 'utf-8'));
    expect(meta.generalInformation.programType).toBe('executableProgram');
  });

  it('PROG module pool (programType "M") and subroutine pool ("S") stay on main path', async () => {
    for (const rawType of ['M', 'S'] as const) {
      vi.clearAllMocks();
      cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'prog-pool-'));
      fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
      const expectedName = rawType === 'M' ? 'ZPROG_M' : 'ZPROG_S';
      const lc = expectedName.toLowerCase();
      searchObject.mockResolvedValueOnce([
        {
          'adtcore:name': expectedName,
          'adtcore:type': 'PROG/P',
          'adtcore:uri': `/sap/bc/adt/programs/programs/${lc}`,
        },
      ]);
      objectStructure.mockResolvedValueOnce({
        objectUrl: `/sap/bc/adt/programs/programs/${lc}`,
        metaData: {
          'adtcore:description': `${rawType} pool`,
          'adtcore:masterLanguage': 'EN',
          'adtcore:type': 'PROG/P',
          'program:programType': rawType,
          'abapsource:sourceUri': `/sap/bc/adt/programs/programs/${lc}/source/main`,
        },
        links: [],
      });
      const program = makeProgram();
      registerPullCommand(program);
      await runCommand(program, ['pull', expectedName, '--type', 'PROG', '--json'], { cwd });
      const dir = path.join(cwd, 'src', 'prog', lc);
      expect(fs.existsSync(path.join(dir, `${lc}.prog.abap`))).toBe(true);
      expect(fs.existsSync(path.join(dir, `${lc}.prog.include.abap`))).toBe(false);
    }
  });

  it('CLAS is unaffected by PROG/I sub-route (regression on shared strategy)', async () => {
    // CLAS shares sourceObjectStrategy() with PROG — verify the sub-route
    // doesn't bleed into CLAS includes. CLAS uses `main` / `implementations`
    // / `testclasses` subtypes, never `include`.
    searchObject.mockResolvedValueOnce([
      {
        'adtcore:name': 'ZCL_DEMO',
        'adtcore:type': 'CLAS',
        'adtcore:uri': '/sap/bc/adt/oo/classes/zcl_demo',
      },
    ]);
    objectStructure.mockResolvedValueOnce({
      objectUrl: '/sap/bc/adt/oo/classes/zcl_demo',
      metaData: {
        'adtcore:description': 'Demo class',
        'adtcore:masterLanguage': 'EN',
        'adtcore:type': 'CLAS/OC',
        'abapsource:sourceUri': '/sap/bc/adt/oo/classes/zcl_demo/source/main',
      },
      includes: [
        { 'class:includeType': 'main', 'abapsource:sourceUri': '/sap/bc/adt/oo/classes/zcl_demo/source/main' },
        { 'class:includeType': 'implementations', 'abapsource:sourceUri': '/sap/bc/adt/oo/classes/zcl_demo/source/locals_imp' },
      ],
    });
    const program = makeProgram();
    registerPullCommand(program);
    await runCommand(program, ['pull', 'ZCL_DEMO', '--type', 'CLAS', '--json'], { cwd });

    const dir = path.join(cwd, 'src', 'clas', 'zcl_demo');
    expect(fs.existsSync(path.join(dir, 'zcl_demo.clas.abap'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'zcl_demo.clas.implementations.abap'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'zcl_demo.clas.include.abap'))).toBe(false);
  });
});