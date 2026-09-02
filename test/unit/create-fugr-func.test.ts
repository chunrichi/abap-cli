/**
 * FUGR/FF — `abap create FUGR <group> --func <module>` creates a function
 * module (FUGR/FF child) inside an existing function group via the ADT
 * createObject endpoint `/sap/bc/adt/functions/groups/<group>/fmodules`
 * (abap-adt-api objectcreator FUGR/FF), activates it, and pulls the local
 * `<group>.fugr.<fm>.func.{abap,json}` pair.
 *
 * Real-SAP evidence (2026-09-02, vhcala4hci $TMP): the FUGR/FF POST is
 * accepted, the module is created active, and `abap pull FUGR <group>`
 * round-trips it as .func files. These tests cover the CLI entry contract
 * against a stateful mock.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerCreateCommand } from '../../src/abap_cli/commands/create.js';
import { makeProgram, runCommand } from './cli-helper.js';

const GROUP = '/sap/bc/adt/functions/groups/zfg_demo';
const GROUP_NAME = 'ZFG_DEMO';
const FM_NAME = 'ZFG_DEMO_FF01';
const FM_URI = `${GROUP}/fmodules/zfg_demo_ff01`;

const createObject = vi.fn(async (opts: { objtype: string; name: string }) => {
  if (opts.objtype === 'FUGR/FF') fms.add(opts.name.toUpperCase());
});
const activate = vi.fn(async () => '');
const searchObject = vi.fn();
const objectStructure = vi.fn();
const getObjectSource = vi.fn();
const userTransports = vi.fn(async () => ({ workbench: [], customizing: [] }));

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      createObject,
      activate,
      searchObject,
      objectStructure,
      getObjectSource,
      userTransports,
      getConfig: () => ({ sap: { username: 'MOCKUSER' }, transport: undefined }),
    }),
  },
}));

// Stateful mock: the group pre-exists; the FM appears only after createObject.
const fms = new Set<string>();

beforeEach(() => {
  vi.clearAllMocks();
  fms.clear();

  searchObject.mockImplementation(async (query: string) => {
    const upper = query.toUpperCase();
    if (query === GROUP_NAME || query === FM_NAME) return []; // real-ADT: bare names need wildcards
    const hits: Array<Record<string, string>> = [];
    hits.push({ 'adtcore:name': GROUP_NAME, 'adtcore:type': 'FUGR/F', 'adtcore:uri': GROUP });
    if (fms.has(FM_NAME)) {
      hits.push({ 'adtcore:name': FM_NAME, 'adtcore:type': 'FUGR/FF', 'adtcore:uri': FM_URI });
    }
    if (upper.startsWith('LZFG_DEMO')) {
      // FUGR/I includes: TOP + the U01 include holding the FM->number table.
      return [
        { 'adtcore:name': 'LZFG_DEMOTOP', 'adtcore:type': 'FUGR/I', 'adtcore:uri': '/sap/bc/adt/programs/includes/lzfg_demotop' },
        { 'adtcore:name': 'LZFG_DEMOU01', 'adtcore:type': 'FUGR/I', 'adtcore:uri': '/sap/bc/adt/programs/includes/lzfg_demou01' },
      ];
    }
    return hits;
  });

  objectStructure.mockImplementation(async (uri: string) => {
    if (uri.startsWith('/sap/bc/adt/programs/includes/')) {
      const name = uri.split('/').pop()!.toUpperCase();
      return {
        metaData: {
          'adtcore:name': name,
          'adtcore:type': 'FUGR/I',
          'adtcore:description': 'include',
          'abapsource:sourceUri': uri,
        },
      };
    }
    if (uri.includes('/fmodules/')) {
      const name = uri.split('/').pop()!.toUpperCase();
      return {
        metaData: {
          'adtcore:name': name,
          'adtcore:type': 'FUGR/FF',
          'adtcore:description': 'probe fm',
          'abapsource:sourceUri': `${uri}/source/main`,
          'fmodule:processingType': 'normal',
        },
      };
    }
    return {
      metaData: {
        'adtcore:name': GROUP_NAME,
        'adtcore:type': 'FUGR/F',
        'adtcore:description': 'demo group',
        'adtcore:masterLanguage': 'EN',
        'abapsource:sourceUri': `${GROUP}/source/main`,
        'abapsource:fixPointArithmetic': true,
      },
    };
  });

  getObjectSource.mockImplementation(async (url: string) => {
    if (url.includes('lzfg_demou01')) return `INCLUDE LZFG_DEMOU01.  "${FM_NAME}\n`;
    return `SOURCE ${url}`;
  });
});

let cwd: string;
beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'create-fugr-func-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
});

function parseData(res: { stdout: string }) {
  return JSON.parse(res.stdout).data;
}
function parseError(res: { stderr: string }) {
  return JSON.parse(res.stderr).error;
}

function createFugrFuncArgs(extra: string[] = []) {
  return ['create', 'FUGR', GROUP_NAME, '--func', FM_NAME, '--package', '$TMP', '--description', 'T', '--yes', '--json', ...extra];
}

describe('abap create FUGR <group> --func <module> (FUGR/FF child)', () => {
  it('creates the function module via the FUGR/FF endpoint and pulls the .func pair', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, createFugrFuncArgs(), { cwd });
    expect(res.exitCode).toBeUndefined();

    // createObject hits the ADT child endpoint with the group as parent.
    const call = createObject.mock.calls[0]?.[0];
    expect(call.objtype).toBe('FUGR/FF');
    expect(call.name).toBe(FM_NAME);
    expect(call.parentName).toBe(GROUP_NAME);
    expect(call.parentPath).toBe(GROUP);

    // Activation targets the module object URL.
    expect(activate).toHaveBeenCalledWith(FM_URI, 'FUGR/FF', FM_NAME);

    const data = parseData(res);
    expect(data.object).toBe(FM_NAME);
    expect(data.type).toBe('FUGR/FF');
    expect(data.group).toBe(GROUP_NAME);
    expect(data.activated).toBe(true);
    expect(data.localFile).toMatch(/zfg_demo\/zfg_demo\.fugr\.zfg_demo_ff01\.func\.abap$/);

    // Pull layout: .func.abap + .func.json with includeNumber from the U01 include.
    const dir = path.join(cwd, 'src', 'fugr', 'zfg_demo');
    const abap = path.join(dir, 'zfg_demo.fugr.zfg_demo_ff01.func.abap');
    const json = path.join(dir, 'zfg_demo.fugr.zfg_demo_ff01.func.json');
    expect(fs.existsSync(abap)).toBe(true);
    expect(fs.readFileSync(abap, 'utf-8')).toContain(`SOURCE ${FM_URI}/source/main`);
    const func = JSON.parse(fs.readFileSync(json, 'utf-8'));
    expect(func.processingType).toBe('normal');
    expect(func.includeNumber).toBe('01');
  });

  it('--no-activate skips activation but still creates', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, createFugrFuncArgs(['--no-activate']), { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(createObject).toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    expect(parseData(res).activated).toBe(false);
  });

  it('--no-pull skips the create-then-pull local files', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, createFugrFuncArgs(['--no-pull']), { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(parseData(res).localFile).toBeUndefined();
    expect(fs.existsSync(path.join(cwd, 'src', 'fugr', 'zfg_demo'))).toBe(false);
  });

  it('--func is rejected for non-FUGR types', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'CLAS', 'ZCL_X', '--func', 'FF01', '--package', '$TMP', '--description', 'T', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBe(2);
    expect(parseError(res).code).toBe('INVALID_ARGUMENT');
    expect(createObject).not.toHaveBeenCalled();
  });

  it('fails with OBJECT_NOT_FOUND when the group does not exist', async () => {
    searchObject.mockImplementation(async () => [] as Array<Record<string, string>>);
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, createFugrFuncArgs(), { cwd });
    expect(res.exitCode).toBe(8);
    const err = parseError(res);
    expect(err.code).toBe('OBJECT_NOT_FOUND');
    expect(createObject).not.toHaveBeenCalled();
  });

  it('fails with OBJECT_EXISTS when the module already exists in the group', async () => {
    fms.add(FM_NAME);
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, createFugrFuncArgs(), { cwd });
    expect(res.exitCode).toBe(2);
    const err = parseError(res);
    expect(err.code).toBe('OBJECT_EXISTS');
    expect(createObject).not.toHaveBeenCalled();
  });

  it('validates the module name locally (oversized name, zero create calls)', async () => {
    const tooLong = `ZFG_DEMO_${'A'.repeat(30)}`; // > 30 chars
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'FUGR', GROUP_NAME, '--func', tooLong, '--package', '$TMP', '--description', 'T', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    expect(parseError(res).code).toBe('VALIDATION_ERROR');
    expect(createObject).not.toHaveBeenCalled();
  });
});
