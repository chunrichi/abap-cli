import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerPullCommand } from '../../src/abap_cli/commands/pull.js';
import { makeProgram, runCommand } from './cli-helper.js';

const searchObject = vi.fn(async (name: string) => [
  { 'adtcore:name': name.toUpperCase(), 'adtcore:type': 'CLAS', 'adtcore:uri': `/sap/bc/adt/oo/classes/${name.toLowerCase()}` },
]);
const defaultObjectStructure = async (objectUrl: string) => ({
  objectUrl,
  metaData: {
    'adtcore:description': 'Demo class',
    'adtcore:masterLanguage': 'EN',
    'adtcore:type': 'CLAS/OC',
    'abapsource:sourceUri': `${objectUrl}/source/main`,
  },
  includes: [
    { 'class:includeType': 'main', 'abapsource:sourceUri': `${objectUrl}/source/main` },
    { 'class:includeType': 'definitions', 'abapsource:sourceUri': `${objectUrl}/source/locals_def` },
    { 'class:includeType': 'implementations', 'abapsource:sourceUri': `${objectUrl}/source/locals_imp` },
    { 'class:includeType': 'testclasses', 'abapsource:sourceUri': `${objectUrl}/source/testclasses` },
  ],
});
const objectStructure = vi.fn(defaultObjectStructure);
const getObjectSource = vi.fn(async (url: string) => `SOURCE ${url}`);

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
  searchObject.mockImplementation(async (name: string) => [
    { 'adtcore:name': name.toUpperCase(), 'adtcore:type': 'CLAS', 'adtcore:uri': `/sap/bc/adt/oo/classes/${name.toLowerCase()}` },
  ]);
  objectStructure.mockImplementation(defaultObjectStructure);
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pull-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
});

function read(res: { stdout: string }): { status: string; data: Record<string, unknown> } {
  return JSON.parse(res.stdout);
}

describe('abap pull (abap-file-format layout)', () => {
  it('writes one directory per object with .json metadata + .abap source (main part)', async () => {
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZCL_DEMO', '--type', 'CLAS', '--json'], { cwd });

    const data = read(res).data;
    expect(res.exitCode).toBeUndefined();

    const dir = path.join(cwd, 'src', 'clas', 'zcl_demo');
    expect(fs.existsSync(path.join(dir, 'zcl_demo.clas.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'zcl_demo.clas.abap'))).toBe(true);
    // local types use the abap-file-format include names (definitions/implementations)
    expect(fs.existsSync(path.join(dir, 'zcl_demo.clas.definitions.abap'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'zcl_demo.clas.implementations.abap'))).toBe(true);
    // testclasses part is excluded by default
    expect(fs.existsSync(path.join(dir, 'zcl_demo.clas.testclasses.abap'))).toBe(false);

    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'zcl_demo.clas.json'), 'utf-8'));
    expect(meta.formatVersion).toBe('1');
    expect(meta.header.description).toBe('Demo class');
    expect(meta.header.originalLanguage).toBe('en');

    expect(data.written).toContain('src/clas/zcl_demo/zcl_demo.clas.json');
    expect(data.written).toContain('src/clas/zcl_demo/zcl_demo.clas.abap');
  });

  it('--include-tests also writes the testclasses part', async () => {
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZCL_DEMO', '--type', 'CLAS', '--include-tests', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(fs.existsSync(path.join(cwd, 'src', 'clas', 'zcl_demo', 'zcl_demo.clas.testclasses.abap'))).toBe(true);
  });

  it('namespaced objects land in a #-escaped directory', async () => {
    searchObject.mockResolvedValue([
      { 'adtcore:name': '/UI2/CL_JSON', 'adtcore:type': 'CLAS', 'adtcore:uri': '/sap/bc/adt/oo/classes/ui2/cl_json' },
    ]);
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', '/UI2/CL_JSON', '--type', 'CLAS', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();

    const dir = path.join(cwd, 'src', 'clas', '#ui2#cl_json');
    expect(fs.existsSync(path.join(dir, '#ui2#cl_json.clas.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '#ui2#cl_json.clas.abap'))).toBe(true);
  });

  it('PROG main program: generalInformation.programType passes the enum through', async () => {
    searchObject.mockResolvedValue([
      { 'adtcore:name': 'ZAKIT_DEMO', 'adtcore:type': 'PROG/P', 'adtcore:uri': '/sap/bc/adt/programs/programs/zakit_demo' },
    ]);
    objectStructure.mockResolvedValue({
      objectUrl: '/sap/bc/adt/programs/programs/zakit_demo',
      metaData: {
        'adtcore:description': 'Demo report',
        'adtcore:masterLanguage': 'EN',
        'adtcore:type': 'PROG/P',
        'abapsource:sourceUri': '/sap/bc/adt/programs/programs/zakit_demo/source/main',
        'program:programType': 'executableProgram',
      },
      links: [],
    });

    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZAKIT_DEMO', '--type', 'PROG', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();

    const dir = path.join(cwd, 'src', 'prog', 'zakit_demo');
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'zakit_demo.prog.json'), 'utf-8'));
    expect(meta.generalInformation.programType).toBe('executableProgram');
    expect(fs.existsSync(path.join(dir, 'zakit_demo.prog.abap'))).toBe(true);
  });

  it('PROG include: programType inferred as "include" when attribute is missing (PROG/I)', async () => {
    searchObject.mockResolvedValue([
      { 'adtcore:name': 'ZPROG_TOP', 'adtcore:type': 'PROG/I', 'adtcore:uri': '/sap/bc/adt/programs/includes/zprog_top' },
    ]);
    objectStructure.mockResolvedValue({
      objectUrl: '/sap/bc/adt/programs/includes/zprog_top',
      metaData: {
        'adtcore:description': 'Demo include',
        'adtcore:masterLanguage': 'EN',
        'adtcore:type': 'PROG/I',
        'abapsource:sourceUri': '/sap/bc/adt/programs/includes/zprog_top/source/main',
      },
      links: [],
    });

    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZPROG_TOP', '--type', 'PROG', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();

    const dir = path.join(cwd, 'src', 'prog', 'zprog_top');
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'zprog_top.prog.json'), 'utf-8'));
    expect(meta.generalInformation.programType).toBe('include');
    // 032 US13: PROG/I sub-route — file lands at <name>.prog.include.abap
    // (not <name>.prog.abap as the main part) so static checks can distinguish
    // include from executable.
    expect(fs.existsSync(path.join(dir, 'zprog_top.prog.include.abap'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'zprog_top.prog.abap'))).toBe(false);
  });

  it('existing identical files are skipped; differing files need --overwrite', async () => {
    const dir = path.join(cwd, 'src', 'clas', 'zcl_demo');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'zcl_demo.clas.abap'), 'SOURCE /sap/bc/adt/oo/classes/zcl_demo/source/main');

    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZCL_DEMO', '--type', 'CLAS', '--json'], { cwd });
    const data = read(res).data;
    // identical .abap skipped, .json still written (did not exist)
    expect(data.skipped).toContain('src/clas/zcl_demo/zcl_demo.clas.abap');
    expect(data.written).toContain('src/clas/zcl_demo/zcl_demo.clas.json');

    // differing file without --overwrite → OVERWRITE_REQUIRED
    fs.writeFileSync(path.join(dir, 'zcl_demo.clas.abap'), 'DIFFERENT');
    const res2 = await runCommand(program, ['pull', 'ZCL_DEMO', '--type', 'CLAS', '--json'], { cwd });
    expect(res2.exitCode).not.toBe(0);
    const err = JSON.parse(res2.stderr);
    expect(err.error.code).toBe('OVERWRITE_REQUIRED');
  });
});
