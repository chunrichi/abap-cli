import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerPushCommand } from '../../src/abap_cli/commands/push.js';
import { makeProgram, runCommand } from './cli-helper.js';

const lock = vi.fn(async () => ({ LOCK_HANDLE: 'lock-1' }));
const setObjectSource = vi.fn(async () => '');
const activate = vi.fn(async () => '');
const activateAll = vi.fn(async () => ({ success: true, inactive: [] }));
const unLock = vi.fn(async () => '');
const searchObject = vi.fn();
const objectStructure = vi.fn();
const getObjectSource = vi.fn(async () => '');
const getActiveObjectSource = vi.fn(async () => '');
const transportInfo = vi.fn(async () => ({ TRANSPORTS: [] }));
const getConfig = vi.fn(() => ({ transport: 'TRN001' }));

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      lock, setObjectSource, activate, activateAll, unLock, searchObject, objectStructure, getObjectSource, getActiveObjectSource, transportInfo, getConfig,
      syntaxCheck: vi.fn(async () => []),
      syntaxCheckContent: vi.fn(async () => []),
    }),
  },
}));

const GROUP = '/sap/bc/adt/functions/groups/zfg_wechat_table';

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  // Reset implementations so previous tests' overrides do not leak.
  getActiveObjectSource.mockImplementation(async () => '');
  activateAll.mockImplementation(async () => ({ success: true, inactive: [] }));
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
        { 'adtcore:name': 'LZFG_WECHAT_TABLEF01', 'adtcore:type': 'FUGR/I', 'adtcore:uri': `${GROUP}/includes/lzfg_wechat_tablef01` },
        { 'adtcore:name': 'LZFG_WECHAT_TABLEO01', 'adtcore:type': 'FUGR/I', 'adtcore:uri': `${GROUP}/includes/lzfg_wechat_tableo01` },
        { 'adtcore:name': 'LZFG_WECHAT_TABLEI01', 'adtcore:type': 'FUGR/I', 'adtcore:uri': `${GROUP}/includes/lzfg_wechat_tablei01` },
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
    // T1.6: FM activation now goes through activateAll (not the single-object
    // activate overload), with parentUri pointing at the enclosing group.
    expect(activateAll).toHaveBeenCalledWith([
      expect.objectContaining({
        uri: `${GROUP}/fmodules/tableframe_zfg_wechat_table`,
        type: 'FUGR/FF',
        name: 'TABLEFRAME_ZFG_WECHAT_TABLE',
        parentUri: GROUP,
      }),
    ]);
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

  it('T1.6: pushes an FXX include using its child object URL (not the group)', async () => {
    const file = writeFile(
      'src/zfg_wechat_table/zfg_wechat_table.fugr.lzfg_wechat_tablef01.reps.abap',
      'INCLUDE LZFG_WECHAT_TABLEF01.',
    );
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', file, '--tr', 'TRN001', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    // FXX push locks the FXX child URL, not the group URL.
    expect(lock).toHaveBeenCalledWith(`${GROUP}/includes/lzfg_wechat_tablef01`);
    expect(setObjectSource).toHaveBeenCalledWith(
      `${GROUP}/includes/lzfg_wechat_tablef01/source/main`,
      expect.stringContaining('LZFG_WECHAT_TABLEF01'),
      'lock-1',
      'TRN001',
    );
  });

  it('T1.6: dry-run does not make any mutating network calls', async () => {
    const file = writeFile(
      'src/zfg_wechat_table/zfg_wechat_table.fugr.lzfg_wechat_tablef01.reps.abap',
      'INCLUDE LZFG_WECHAT_TABLEF01.',
    );
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', file, '--tr', 'TRN001', '--yes', '--dry-run', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(lock).not.toHaveBeenCalled();
    expect(setObjectSource).not.toHaveBeenCalled();
    expect(activateAll).not.toHaveBeenCalled();
    expect(unLock).not.toHaveBeenCalled();
  });

  it('T1.6: FM push throws ACTIVATION_FAILED when latest and active source diverge', async () => {
    const file = writeFile(
      'src/zfg_wechat_table/zfg_wechat_table.fugr.tableframe_zfg_wechat_table.func.abap',
      'FUNCTION TABLEFRAME_ZFG_WECHAT_TABLE.\nENDFUNCTION.',
    );
    getActiveObjectSource.mockImplementation(async () => 'STALE SOURCE');
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', file, '--tr', 'TRN001', '--yes', '--json'], { cwd });
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toMatch(/ACTIVATION_FAILED|active source is stale/i);
  });

  it('T1.6: FM push normalizes SAP-native FUNC source to canonical before write', async () => {
    const file = writeFile(
      'src/zfg_wechat_table/zfg_wechat_table.fugr.tableframe_zfg_wechat_table.func.abap',
      [
        'FUNCTION TABLEFRAME_ZFG_WECHAT_TABLE.',
        '*"  IMPORTING',
        '*"    IV_INPUT type I',
        '  ev_output = iv_input.',
        'ENDFUNCTION.',
      ].join('\n'),
    );
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', file, '--tr', 'TRN001', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    // The canonical form contains explicit IMPORTING header (not the SAP-native *").
    const writeCall = setObjectSource.mock.calls[0];
    expect(writeCall?.[1]).toContain('IMPORTING');
    expect(writeCall?.[1]).not.toContain('*"~');
  });
});
