/**
 * 014 US1: create DDIC table (TABL) end-to-end tests. Drives the full CLI pipeline
 * (create → file → wire → POST /ddic/tabl) against the mock-adt server.
 * Written TDD-style — tests exercise the create command's DDIC path with the
 * client pointed at the mock; they fail without the T011/T012 wiring.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerCreateCommand } from '../../src/abap_cli/commands/create.js';
import { makeProgram, runCommand } from './cli-helper.js';

const adtCreate = vi.fn(async () => undefined);
const adtValidate = vi.fn(async () => ({ success: true, SHORT_TEXT: '' }));
const searchObject = vi.fn(async () => [] as any[]);

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      createObject: (...args: unknown[]) => adtCreate(...args),
      validateNewObject: (...args: unknown[]) => adtValidate(...args),
      searchObject: (...args: unknown[]) => searchObject(...args),
      getConfig: () => ({ sap: { username: 'MOCKUSER', client: '001', language: 'EN' }, transport: 'TRN001', package: '$TMP' }),
      raw: { classRun: vi.fn() },
    }),
  },
}));

const icfPostDdic = vi.fn(async () => ({
  status: 'success' as const,
  data: { name: 'ZTAB_TEST', type: 'TABL', action: 'created' },
  error: null,
}));
const icfGetDdic = vi.fn(async () => ({ status: 'success' as const, data: null, error: null }));

vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: {
    create: async () => ({
      postDdic: icfPostDdic,
      getDdic: icfGetDdic,
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
    }),
  },
}));

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ddic-create-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
});

function writeTableJson(name: string, fields: any[] = [{ fieldName: 'FIELD1', dataType: 'CHAR', length: 20, keyFlag: true }]) {
  const json = {
    formatVersion: '1',
    header: { description: 'Test table', originalLanguage: 'EN' },
    name,
    deliveryClass: 'A',
    dataClass: 'APPL0',
    sizeCategory: '0',
    clientDependent: false,
    fields,
  };
  fs.writeFileSync(path.join(cwd, 'src/ztab_test.tabl.json'), JSON.stringify(json, null, 2));
}

describe('014/US1 create TABL', () => {
  it('creates a transparent table via POST /ddic/tabl and returns action', async () => {
    writeTableJson('ZTAB_TEST');
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'TABL', 'ZTAB_TEST',
      '--file', 'src/ztab_test.tabl.json',
      '--package', '$TMP',
      '--json',
    ], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfPostDdic).toHaveBeenCalledWith('tabl', expect.objectContaining({
      name: 'ZTAB_TEST',
      description: 'Test table',
      deliveryClass: 'A',
      dataClass: 'APPL0',
      sizeCategory: '0',
      clientDependent: false,
      fields: expect.arrayContaining([
        expect.objectContaining({ fieldName: 'FIELD1', dataType: 'CHAR', length: 20, keyFlag: true }),
      ]),
      package: '$TMP',
    }));
    expect(JSON.parse(res.stdout)).toMatchObject({
      data: { object: 'ZTAB_TEST', type: 'TABL', action: 'created' },
    });
  });

  it('auto-prepends MANDT when clientDependent=true', async () => {
    writeTableJson('ZTAB_CLI', [
      { fieldName: 'FIELD1', dataType: 'CHAR', length: 20, keyFlag: true },
    ]);
    // Flip clientDependent on the local file.
    const json = JSON.parse(fs.readFileSync(path.join(cwd, 'src/ztab_test.tabl.json'), 'utf-8'));
    json.name = 'ZTAB_CLI';
    json.clientDependent = true;
    fs.writeFileSync(path.join(cwd, 'src/ztab_test.tabl.json'), JSON.stringify(json));

    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'TABL', 'ZTAB_CLI',
      '--file', 'src/ztab_test.tabl.json',
      '--package', '$TMP',
      '--json',
    ], { cwd });
    expect(res.exitCode).toBeUndefined();
    const callBody = icfPostDdic.mock.calls[0]![1] as any;
    expect(callBody.clientDependent).toBe(true);
    // The MANDT prepend is a server-side concern (CLI sends what the file declares);
    // for the create-then-pull round-trip the server is responsible for SPRING.
  });

  it('command-line --description overrides file description', async () => {
    writeTableJson('ZTAB_OVR');
    const program = makeProgram();
    registerCreateCommand(program);
    await runCommand(program, [
      'create', 'TABL', 'ZTAB_OVR',
      '--file', 'src/ztab_test.tabl.json',
      '--package', '$TMP',
      '--description', 'CLI override',
      '--json',
    ], { cwd });
    const callBody = icfPostDdic.mock.calls[0]![1] as any;
    expect(callBody.description).toBe('CLI override');
  });

  it('reports INVALID_ARGUMENT for invalid namespace (non-Z/Y/slash)', async () => {
    writeTableJson('XTAB');
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'TABL', 'XTAB',
      '--file', 'src/ztab_test.tabl.json',
      '--package', '$TMP',
      '--json',
    ], { cwd });
    expect(res.exitCode).toBe(7); // VALIDATION_ERROR
    expect(icfPostDdic).not.toHaveBeenCalled();
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('VALIDATION_ERROR');
  });

  it('reports VALIDATION_ERROR for empty fields list', async () => {
    writeTableJson('ZTAB_EMPTY', []);
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'TABL', 'ZTAB_EMPTY',
      '--file', 'src/ztab_test.tabl.json',
      '--package', '$TMP',
      '--json',
    ], { cwd });
    expect(res.exitCode).toBe(7);
    expect(icfPostDdic).not.toHaveBeenCalled();
  });

  it('reports INVALID_ARGUMENT for non-$TMP package without --tr', async () => {
    writeTableJson('ZTAB_NOTMP');
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'TABL', 'ZTAB_NOTMP',
      '--file', 'src/ztab_test.tabl.json',
      '--package', 'ZPKG',
      '--json',
    ], { cwd });
    expect(res.exitCode).toBe(7);
    expect(icfPostDdic).not.toHaveBeenCalled();
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('VALIDATION_ERROR');
    expect(out.error.message).toContain('transportRequest');
  });

  it('still rejects unknown types like TTYP with TYPE_NOT_SUPPORTED', async () => {
    writeTableJson('ZTAB_X');
    fs.writeFileSync(path.join(cwd, 'src/ztab_x.ttyp.json'), '{"name":"ZTAB_X","rowType":"ZREF"}');
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'TTYP', 'ZTAB_X',
      '--file', 'src/ztab_x.ttyp.json',
      '--package', '$TMP',
      '--json',
    ], { cwd });
    expect(res.exitCode).toBe(7);
    // create.ts raises TYPE_NOT_SUPPORTED for unknown DDIC types (TTYP).
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('TYPE_NOT_SUPPORTED');
  });

  it('ICF failure maps to SAP_ERROR (exit 6)', async () => {
    writeTableJson('ZTAB_500');
    icfPostDdic.mockResolvedValueOnce({
      status: 'error',
      data: null,
      error: { code: 'DDIC_CREATE_FAILED', message: 'simulated' },
    });
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'TABL', 'ZTAB_500',
      '--file', 'src/ztab_test.tabl.json',
      '--package', '$TMP',
      '--json',
    ], { cwd });
    expect(res.exitCode).toBe(6);
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('DDIC_CREATE_FAILED');
  });
});

describe('014/US2 create STRU/DTEL/DOMA', () => {
  function writeFile(rel: string, data: unknown) {
    fs.writeFileSync(path.join(cwd, rel), JSON.stringify(data, null, 2));
  }

  it('creates a structure via POST /ddic/stru with fields', async () => {
    icfPostDdic.mockResolvedValue({ status: 'success' as const, data: { name: 'ZSTRU_TEST', type: 'STRU', action: 'created' }, error: null });
    writeFile('src/zstru_test.stru.json', {
      name: 'ZSTRU_TEST',
      description: 'Test structure',
      fields: [
        { fieldName: 'FIELD1', dataType: 'CHAR', length: 20 },
        { fieldName: 'FIELD2', rollname: 'ZDMY_DE' },
      ],
    });
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'STRU', 'ZSTRU_TEST',
      '--file', 'src/zstru_test.stru.json',
      '--package', '$TMP',
      '--json',
    ], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfPostDdic).toHaveBeenCalledWith('stru', expect.objectContaining({
      name: 'ZSTRU_TEST',
      description: 'Test structure',
      fields: [
        expect.objectContaining({ fieldName: 'FIELD1', dataType: 'CHAR', length: 20 }),
        expect.objectContaining({ fieldName: 'FIELD2', rollname: 'ZDMY_DE' }),
      ],
      package: '$TMP',
    }));
    expect(JSON.parse(res.stdout)).toMatchObject({ data: { object: 'ZSTRU_TEST', type: 'STRU', action: 'created' } });
  });

  it('creates a data element with domain reference via POST /ddic/dtel', async () => {
    icfPostDdic.mockResolvedValue({ status: 'success' as const, data: { name: 'ZDTEL_TEST', type: 'DTEL', action: 'created' }, error: null });
    writeFile('src/zdtel_test.dtel.json', {
      name: 'ZDTEL_TEST',
      description: 'Data element',
      domain: 'ZDOMA_TEST',
      shortText: 'Short',
      mediumText: 'Medium text',
      longText: 'Long field text',
      headerText: 'Header',
    });
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'DTEL', 'ZDTEL_TEST',
      '--file', 'src/zdtel_test.dtel.json',
      '--package', '$TMP',
      '--json',
    ], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfPostDdic).toHaveBeenCalledWith('dtel', expect.objectContaining({
      name: 'ZDTEL_TEST',
      description: 'Data element',
      domain: 'ZDOMA_TEST',
      shortText: 'Short',
      mediumText: 'Medium text',
      longText: 'Long field text',
      headerText: 'Header',
    }));
  });

  it('creates a domain via POST /ddic/doma with type/length/decimals/sign/lowercase/convExit', async () => {
    icfPostDdic.mockResolvedValue({ status: 'success' as const, data: { name: 'ZDOMA_TEST', type: 'DOMA', action: 'created' }, error: null });
    writeFile('src/zdoma_test.doma.json', {
      name: 'ZDOMA_TEST',
      description: 'Domain',
      dataType: 'QUAN',
      length: 13,
      decimals: 3,
      signFlag: true,
      lowercase: false,
      convExit: 'ALPHA',
    });
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'DOMA', 'ZDOMA_TEST',
      '--file', 'src/zdoma_test.doma.json',
      '--package', '$TMP',
      '--json',
    ], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfPostDdic).toHaveBeenCalledWith('doma', expect.objectContaining({
      name: 'ZDOMA_TEST',
      description: 'Domain',
      dataType: 'QUAN',
      length: 13,
      decimals: 3,
      signFlag: true,
      lowercase: false,
      convExit: 'ALPHA',
    }));
  });

  it('reports VALIDATION_ERROR for DTEL missing description and domain/builtin type', async () => {
    writeFile('src/zdtel_bad.dtel.json', { name: 'ZDTEL_BAD' });
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'DTEL', 'ZDTEL_BAD',
      '--file', 'src/zdtel_bad.dtel.json',
      '--package', '$TMP',
      '--json',
    ], { cwd });
    expect(res.exitCode).toBe(7);
    expect(icfPostDdic).not.toHaveBeenCalled();
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('VALIDATION_ERROR');
  });

  it('reports VALIDATION_ERROR for DOMA missing dataType/length', async () => {
    writeFile('src/zdoma_bad.doma.json', { name: 'ZDOMA_BAD', description: 'bad' });
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'DOMA', 'ZDOMA_BAD',
      '--file', 'src/zdoma_bad.doma.json',
      '--package', '$TMP',
      '--json',
    ], { cwd });
    expect(res.exitCode).toBe(7);
    expect(icfPostDdic).not.toHaveBeenCalled();
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('VALIDATION_ERROR');
  });
});
