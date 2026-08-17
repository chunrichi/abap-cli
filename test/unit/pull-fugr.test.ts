import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerPullCommand } from '../../src/abap_cli/commands/pull.js';
import { makeProgram, runCommand } from './cli-helper.js';

const searchObject = vi.fn();
const objectStructure = vi.fn();
const getObjectSource = vi.fn();

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

const GROUP = '/sap/bc/adt/functions/groups/zfg_wechat_table';
const groupMeta = {
  'adtcore:name': 'ZFG_WECHAT_TABLE',
  'adtcore:type': 'FUGR/F',
  'adtcore:description': '扩展的表维护',
  'adtcore:masterLanguage': 'ZH',
  'abapsource:sourceUri': 'source/main',
  'abapsource:fixPointArithmetic': true,
};

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pull-fugr-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });

  searchObject.mockImplementation(async (query: string) => {
    if (query === 'ZFG_WECHAT_TABLE') return []; // exact name needs wildcards (real ADT quirk)
    if (query === 'LZFG_WECHAT_TABLE*') {
      return [
        { 'adtcore:name': 'LZFG_WECHAT_TABLETOP', 'adtcore:type': 'FUGR/I', 'adtcore:uri': '/sap/bc/adt/programs/includes/lzfg_wechat_tabletop' },
        { 'adtcore:name': 'LZFG_WECHAT_TABLEUXX', 'adtcore:type': 'FUGR/I', 'adtcore:uri': '/sap/bc/adt/programs/includes/lzfg_wechat_tableuxx' },
      ];
    }
    // '*ZFG_WECHAT_TABLE*'
    return [
      { 'adtcore:name': 'ZFG_WECHAT_TABLE', 'adtcore:type': 'FUGR/F', 'adtcore:uri': GROUP },
      { 'adtcore:name': 'TABLEFRAME_ZFG_WECHAT_TABLE', 'adtcore:type': 'FUGR/FF', 'adtcore:uri': `${GROUP}/fmodules/tableframe_zfg_wechat_table` },
      { 'adtcore:name': 'TABLEPROC_ZFG_WECHAT_TABLE', 'adtcore:type': 'FUGR/FF', 'adtcore:uri': `${GROUP}/fmodules/tableproc_zfg_wechat_table` },
    ];
  });

  objectStructure.mockImplementation(async (uri: string) => {
    if (uri.startsWith('/sap/bc/adt/programs/includes/')) {
      return {
        metaData: {
          'adtcore:name': uri.split('/').pop()!.toUpperCase(),
          'adtcore:type': 'FUGR/I',
          'adtcore:description': 'TOP include',
          'abapsource:sourceUri': 'source/main',
        },
      };
    }
    if (uri.includes('/fmodules/')) {
      const name = uri.split('/').pop()!.toUpperCase();
      return {
        metaData: {
          'adtcore:name': name,
          'adtcore:type': 'FUGR/FF',
          'adtcore:description': `desc ${name}`,
          'abapsource:sourceUri': 'source/main',
          'fmodule:processingType': 'normal',
        },
      };
    }
    return { metaData: groupMeta };
  });

  getObjectSource.mockImplementation(async (url: string) => {
    // The UXX include lists each function module with its include number.
    if (url.includes('lzfg_wechat_tableuxx')) {
      return (
        'INCLUDE LZFG_WECHAT_TABLEU01.  "TABLEFRAME_ZFG_WECHAT_TABLE\n' +
        'INCLUDE LZFG_WECHAT_TABLEU02.  "TABLEPROC_ZFG_WECHAT_TABLE\n'
      );
    }
    return `SOURCE ${url}`;
  });
});

function read(res: { stdout: string }): { status: string; data: Record<string, unknown> } {
  return JSON.parse(res.stdout);
}

describe('abap pull FUGR (abap-file-format layout)', () => {
  it('writes fugr.json + sapl/l<name>top reps + one func pair per module', async () => {
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZFG_WECHAT_TABLE', '--type', 'FUGR', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();

    const dir = path.join(cwd, 'src', 'fugr', 'zfg_wechat_table');
    const expected = [
      'zfg_wechat_table.fugr.json',
      'zfg_wechat_table.fugr.saplzfg_wechat_table.reps.abap',
      'zfg_wechat_table.fugr.saplzfg_wechat_table.reps.json',
      'zfg_wechat_table.fugr.lzfg_wechat_tabletop.reps.abap',
      'zfg_wechat_table.fugr.lzfg_wechat_tabletop.reps.json',
      'zfg_wechat_table.fugr.tableframe_zfg_wechat_table.func.abap',
      'zfg_wechat_table.fugr.tableframe_zfg_wechat_table.func.json',
      'zfg_wechat_table.fugr.tableproc_zfg_wechat_table.func.abap',
      'zfg_wechat_table.fugr.tableproc_zfg_wechat_table.func.json',
    ];
    for (const f of expected) {
      expect(fs.existsSync(path.join(dir, f)), f).toBe(true);
    }

    const fugr = JSON.parse(fs.readFileSync(path.join(dir, 'zfg_wechat_table.fugr.json'), 'utf-8'));
    expect(fugr.fixPointArithmetic).toBe(true);
    expect(fugr.header.originalLanguage).toBe('zh');

    const sapl = JSON.parse(fs.readFileSync(path.join(dir, 'zfg_wechat_table.fugr.saplzfg_wechat_table.reps.json'), 'utf-8'));
    expect(sapl.includeType).toBe('functionGroup');

    const top = JSON.parse(fs.readFileSync(path.join(dir, 'zfg_wechat_table.fugr.lzfg_wechat_tabletop.reps.json'), 'utf-8'));
    expect(top.includeType).toBe('include');

    const func = JSON.parse(fs.readFileSync(path.join(dir, 'zfg_wechat_table.fugr.tableframe_zfg_wechat_table.func.json'), 'utf-8'));
    expect(func.processingType).toBe('normal');
    expect(func.header.description).toBe('desc TABLEFRAME_ZFG_WECHAT_TABLE');
    // includeNumber is $required by fugr/func-v1.json — parsed from the UXX include.
    expect(func.includeNumber).toBe('01');

    const func2 = JSON.parse(fs.readFileSync(path.join(dir, 'zfg_wechat_table.fugr.tableproc_zfg_wechat_table.func.json'), 'utf-8'));
    expect(func2.includeNumber).toBe('02');
  });

  it('falls back to the module position when the UXX include is unparsable', async () => {
    getObjectSource.mockImplementation(async (url: string) =>
      url.includes('lzfg_wechat_tableuxx') ? 'REPORT nope.' : `SOURCE ${url}`,
    );
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZFG_WECHAT_TABLE', '--type', 'FUGR', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();

    const dir = path.join(cwd, 'src', 'fugr', 'zfg_wechat_table');
    const func = JSON.parse(fs.readFileSync(path.join(dir, 'zfg_wechat_table.fugr.tableframe_zfg_wechat_table.func.json'), 'utf-8'));
    expect(func.includeNumber).toBe('01');
  });
});
