import { describe, expect, it, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerCreateCommand } from '../../src/abap_cli/commands/create.js';
import { listTemplates } from '../../src/abap_cli/formats/templates.js';
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

  it('exposes the ALV report templates in the registry (F-21)', () => {
    const names = listTemplates('PROG').map((t) => t.name);
    expect(names).toContain('report-alv');
    expect(names).toContain('report-alv-selection');
    // The registry drives the create-schema contract, so both names must be there too.
    expect(listTemplates('prog').map((t) => t.name)).toEqual(names);
  });

  it('--template report-alv writes a cl_salv_table skeleton with a field catalog (F-21)', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'local', 'PROG', 'ZPROG_ALV', '--template', 'report-alv', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(parseData(res).template).toBe('report-alv');
    const content = fs.readFileSync(path.join(cwd, 'src/prog/zprog_alv/zprog_alv.prog.abap'), 'utf-8');
    expect(content).toContain('REPORT ZPROG_ALV.');
    expect(content).toContain('cl_salv_table=>factory(');
    expect(content).toContain('set_table_for_first_display(');
    // Explicit field catalog: lvc_t_fcat plus the fieldname/coltext rows.
    expect(content).toContain('TYPE lvc_t_fcat');
    expect(content).toContain('it_fieldcatalog = lt_fcat');
    expect(content).toContain("fieldname = 'MATNR'");
    // Runnable without a selection screen: plain START-OF-SELECTION flow.
    expect(content).toContain('START-OF-SELECTION.');
    expect(content).not.toContain('SELECT-OPTIONS');
  });

  it('--template report-alv-selection adds a selection screen and START-OF-SELECTION (F-21)', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'local', 'PROG', 'ZPROG_ALVS', '--template', 'report-alv-selection', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(parseData(res).template).toBe('report-alv-selection');
    const content = fs.readFileSync(path.join(cwd, 'src/prog/zprog_alvs/zprog_alvs.prog.abap'), 'utf-8');
    expect(content).toContain('SELECTION-SCREEN BEGIN OF BLOCK');
    expect(content).toContain('SELECT-OPTIONS: s_matnr');
    expect(content).toContain('PARAMETERS:     p_max TYPE i');
    expect(content).toContain('START-OF-SELECTION.');
    expect(content).toContain('cl_salv_table=>factory(');
    expect(content).toContain('it_fieldcatalog = lt_fcat');
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

  it('TYPE_NOT_SUPPORTED: DDIC type has no local skeleton, zero files, exit 7', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'local', 'TABL', 'ZTAB', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    const err = parseError(res);
    // `create local` supports CLAS/INTF/PROG/FUGR only; every other registered
    // type (DDIC / HTTP / TRAN / TTYP / MSAG / DDLS / …) reports
    // TYPE_NOT_SUPPORTED from `resolveType`.
    expect(err.code).toBe('TYPE_NOT_SUPPORTED');
    expect(err.message).toMatch(/create local/);
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
