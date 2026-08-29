import { describe, expect, it, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerCreateCommand } from '../../src/abap_cli/commands/create.js';
import { makeProgram, runCommand } from './cli-helper.js';

let cwd: string;
beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'create-local-'));
});

function parseData(res: { stdout: string }) {
  return JSON.parse(res.stdout).data;
}

function parseError(res: { stderr: string }) {
  return JSON.parse(res.stderr).error;
}

describe('abap create local (US1, US2..003)', () => {
  it('CLAS default skeleton: file path, content and --json contract', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'local', 'CLAS', 'ZCL_DRAFT', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    expect(data.object).toBe('ZCL_DRAFT');
    expect(data.type).toBe('CLAS');
    expect(data.template).toBeNull();
    expect(data.experimental).toBe(true);
    expect(data.file).toBe('src/clas/zcl_draft/zcl_draft.clas.abap');
    const file = path.join(cwd, 'src/clas/zcl_draft/zcl_draft.clas.abap');
    expect(fs.existsSync(file)).toBe(true);
    const content = fs.readFileSync(file, 'utf-8');
    expect(content).toContain('CLASS ZCL_DRAFT DEFINITION PUBLIC.');
    expect(content).toContain('CLASS ZCL_DRAFT IMPLEMENTATION.');
  });

  it('INTF default skeleton matches create-then-pull layout', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'local', 'INTF', 'ZIF_DRAFT', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(parseData(res).file).toBe('src/intf/zif_draft/zif_draft.intf.abap');
    const content = fs.readFileSync(path.join(cwd, 'src/intf/zif_draft/zif_draft.intf.abap'), 'utf-8');
    expect(content).toContain('INTERFACE ZIF_DRAFT PUBLIC.');
    expect(content).toContain('ENDINTERFACE.');
  });

  it('PROG default skeleton falls back to REPORT', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'local', 'PROG', 'ZPROG_DRAFT', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(parseData(res).file).toBe('src/prog/zprog_draft/zprog_draft.prog.abap');
    const content = fs.readFileSync(path.join(cwd, 'src/prog/zprog_draft/zprog_draft.prog.abap'), 'utf-8');
    expect(content).toContain('REPORT ZPROG_DRAFT.');
  });

  it('--template public-method writes the template skeleton', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'local', 'CLAS', 'ZCL_TMPL', '--template', 'public-method', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(parseData(res).template).toBe('public-method');
    const content = fs.readFileSync(path.join(cwd, 'src/clas/zcl_tmpl/zcl_tmpl.clas.abap'), 'utf-8');
    expect(content).toContain('METHODS hello');
  });

  it('runs fully offline — no SAP config or credentials needed', async () => {
    // The temp cwd has no .abap.json / keychain; success proves zero SAP access.
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'local', 'CLAS', 'ZCL_OFFLINE'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(fs.existsSync(path.join(cwd, 'src/clas/zcl_offline/zcl_offline.clas.abap'))).toBe(true);
  });

  it('FILE_EXISTS: refuses to overwrite and exits 2', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const first = await runCommand(program, ['create', 'local', 'CLAS', 'ZCL_DRAFT', '--json'], { cwd });
    expect(first.exitCode).toBeUndefined();
    const before = fs.readFileSync(path.join(cwd, 'src/clas/zcl_draft/zcl_draft.clas.abap'), 'utf-8');

    const res = await runCommand(program, ['create', 'local', 'CLAS', 'ZCL_DRAFT', '--json'], { cwd });
    expect(res.exitCode).toBe(2);
    const err = parseError(res);
    expect(err.code).toBe('FILE_EXISTS');
    const after = fs.readFileSync(path.join(cwd, 'src/clas/zcl_draft/zcl_draft.clas.abap'), 'utf-8');
    expect(after).toBe(before);
  });

  it('FUGR writes a FUNCTION-POOL skeleton', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'local', 'FUGR', 'ZFGR_DRAFT', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(parseData(res).file).toBe('src/fugr/zfgr_draft/zfgr_draft.fugr.abap');
    const content = fs.readFileSync(path.join(cwd, 'src/fugr/zfgr_draft/zfgr_draft.fugr.abap'), 'utf-8');
    expect(content).toContain('FUNCTION-POOL ZFGR_DRAFT.');
  });

  it('--template report / selection-screen for PROG', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const report = await runCommand(program, ['create', 'local', 'PROG', 'ZPROG_R', '--template', 'report', '--json'], { cwd });
    expect(report.exitCode).toBeUndefined();
    expect(fs.readFileSync(path.join(cwd, 'src/prog/zprog_r/zprog_r.prog.abap'), 'utf-8')).toContain("WRITE: / 'Hello'.");

    const sel = await runCommand(program, ['create', 'local', 'PROG', 'ZPROG_S', '--template', 'selection-screen', '--json'], { cwd });
    expect(sel.exitCode).toBeUndefined();
    expect(fs.readFileSync(path.join(cwd, 'src/prog/zprog_s/zprog_s.prog.abap'), 'utf-8')).toContain('PARAMETERS: p_name TYPE string.');
  });

  it('--dir writes to a custom output directory', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'local', 'CLAS', 'ZCL_DIR', '--dir', 'ddic/drafts', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(parseData(res).file).toBe('ddic/drafts/clas/zcl_dir/zcl_dir.clas.abap');
    expect(fs.existsSync(path.join(cwd, 'ddic/drafts/clas/zcl_dir/zcl_dir.clas.abap'))).toBe(true);
  });

  it('TYPE_NOT_SUPPORTED: unknown type, zero files, exit 7', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'local', 'XYZ', 'ZFOO', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    const err = parseError(res);
    expect(err.code).toBe('TYPE_NOT_SUPPORTED');
    expect(fs.readdirSync(cwd)).toHaveLength(0);
  });

  it('DDIC_NOT_SUPPORTED: DDIC type, zero files, exit 7', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'local', 'TABL', 'ZTAB', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    const err = parseError(res);
    expect(err.code).toBe('DDIC_NOT_SUPPORTED');
    expect(fs.readdirSync(cwd)).toHaveLength(0);
  });

  it('INVALID_ARGUMENT: unknown template, zero files, exit 2', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'local', 'CLAS', 'ZCL_T', '--template', 'nonexistent', '--json'], { cwd });
    expect(res.exitCode).toBe(2);
    const err = parseError(res);
    expect(err.code).toBe('INVALID_ARGUMENT');
    expect(fs.readdirSync(cwd)).toHaveLength(0);
  });
});
