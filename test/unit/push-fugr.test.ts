import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerPushCommand } from '../../src/abap_cli/commands/push.js';
import { makeProgram, runCommand } from './cli-helper.js';

const lock = vi.fn(async () => ({ LOCK_HANDLE: 'lock-1' }));
const setObjectSource = vi.fn(async () => '');
const activate = vi.fn(async () => '');
const unLock = vi.fn(async () => '');
const searchObject = vi.fn();
const objectStructure = vi.fn();
const transportInfo = vi.fn(async () => ({ TRANSPORTS: [] }));
const getConfig = vi.fn(() => ({ transport: 'TRN001' }));

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      lock, setObjectSource, activate, unLock, searchObject, objectStructure, transportInfo, getConfig,
      syntaxCheck: vi.fn(async () => []),
      syntaxCheckContent: vi.fn(async () => []),
    }),
  },
}));

const GROUP = '/sap/bc/adt/functions/groups/zfg_wechat_table';

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'push-fugr-'));
  fs.mkdirSync(path.join(cwd, 'src', 'zfg_wechat_table'), { recursive: true });

  // resolveObject: exact name fails, wildcard returns the group.
  searchObject.mockImplementation(async (name: string, type?: string) => {
    if (name === 'ZFG_WECHAT_TABLE') return [];
    if (name === '*ZFG_WECHAT_TABLE*' && type === 'FUGR') {
      return [{ 'adtcore:name': 'ZFG_WECHAT_TABLE', 'adtcore:type': 'FUGR/F', 'adtcore:uri': GROUP }];
    }
    if (name === 'LZFG_WECHAT_TABLE*') {
      return [
        { 'adtcore:name': 'LZFG_WECHAT_TABLETOP', 'adtcore:type': 'FUGR/I', 'adtcore:uri': `${GROUP}/includes/lzfg_wechat_tabletop` },
        { 'adtcore:name': 'LZFG_WECHAT_TABLEUXX', 'adtcore:type': 'FUGR/I', 'adtcore:uri': `${GROUP}/includes/lzfg_wechat_tableuxx` },
      ];
    }
    // enumerateFugr *ZFG_WECHAT_TABLE* — group + function modules.
    return [
      { 'adtcore:name': 'ZFG_WECHAT_TABLE', 'adtcore:type': 'FUGR/F', 'adtcore:uri': GROUP },
      { 'adtcore:name': 'TABLEFRAME_ZFG_WECHAT_TABLE', 'adtcore:type': 'FUGR/FF', 'adtcore:uri': `${GROUP}/fmodules/tableframe_zfg_wechat_table` },
    ];
  });

  objectStructure.mockImplementation(async (uri: string) => {
    const meta: Record<string, unknown> = {
      'adtcore:name': uri.split('/').pop()!.toUpperCase(),
      'abapsource:sourceUri': 'source/main',
    };
    if (uri === GROUP) {
      meta['adtcore:description'] = '组描述';
      meta['adtcore:masterLanguage'] = 'ZH';
      meta['abapsource:fixPointArithmetic'] = true;
    } else if (uri.includes('/fmodules/')) {
      meta['adtcore:description'] = '函数模块';
      meta['fmodule:processingType'] = 'normal';
    } else {
      meta['adtcore:description'] = 'include';
    }
    return { metaData: meta };
  });
});

function writeFile(rel: string, content: string): string {
  const abs = path.join(cwd, rel);
  fs.writeFileSync(abs, content);
  return rel;
}

describe('abap push FUGR (sub-object mapping)', () => {
  it('pushes a function module file to its fmodules source URI', async () => {
    const file = writeFile('src/zfg_wechat_table/zfg_wechat_table.fugr.tableframe_zfg_wechat_table.func.abap', 'FUNCTION TABLEFRAME_ZFG_WECHAT_TABLE.\nENDFUNCTION.');
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', file, '--tr', 'TRN001', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    // The function module is locked independently from the group.
    expect(lock).toHaveBeenCalledWith(`${GROUP}/fmodules/tableframe_zfg_wechat_table`);
    expect(setObjectSource).toHaveBeenCalledWith(
      `${GROUP}/fmodules/tableframe_zfg_wechat_table/source/main`,
      expect.stringContaining('TABLEFRAME_ZFG_WECHAT_TABLE'),
      'lock-1',
      'TRN001',
    );
    expect(unLock).toHaveBeenCalledWith(`${GROUP}/fmodules/tableframe_zfg_wechat_table`, 'lock-1');
    expect(activate).toHaveBeenCalledWith(GROUP, 'FUGR/F', 'ZFG_WECHAT_TABLE');
  });

  it('pushes the sapl<name>.reps file to the group source/main (group lock)', async () => {
    const file = writeFile('src/zfg_wechat_table/zfg_wechat_table.fugr.saplzfg_wechat_table.reps.abap', 'FUNCTION-POOL ZFG_WECHAT_TABLE.');
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', file, '--tr', 'TRN001', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(lock).toHaveBeenCalledWith(GROUP);
    expect(setObjectSource).toHaveBeenCalledWith(`${GROUP}/source/main`, expect.stringContaining('FUNCTION-POOL'), 'lock-1', 'TRN001');
  });

  it('pushes the l<name>top.reps file to the include source URI (include lock)', async () => {
    const file = writeFile('src/zfg_wechat_table/zfg_wechat_table.fugr.lzfg_wechat_tabletop.reps.abap', 'INCLUDE LZFG_WECHAT_TABLETOP.');
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', file, '--tr', 'TRN001', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(lock).toHaveBeenCalledWith(`${GROUP}/includes/lzfg_wechat_tabletop`);
    expect(setObjectSource).toHaveBeenCalledWith(
      `${GROUP}/includes/lzfg_wechat_tabletop/source/main`,
      expect.stringContaining('LZFG_WECHAT_TABLETOP'),
      'lock-1',
      'TRN001',
    );
    expect(unLock).toHaveBeenCalledWith(`${GROUP}/includes/lzfg_wechat_tabletop`, 'lock-1');
  });

  it('unknown FUGR subtype fails without writing', async () => {
    const file = writeFile('src/zfg_wechat_table/zfg_wechat_table.fugr.lzfg_wechat_tablef99.reps.abap', 'INCLUDE LZFG_WECHAT_TABLEF99.');
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', file, '--tr', 'TRN001', '--yes', '--json'], { cwd });
    expect(res.exitCode).not.toBe(0);
    expect(setObjectSource).not.toHaveBeenCalled();
  });
});
