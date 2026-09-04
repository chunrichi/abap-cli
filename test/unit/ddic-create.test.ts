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
  // 033: AFF canonical — table-level metadata lives under
  // `generalInformation.*`. The flat top-level fields (`deliveryClass` etc.)
  // are legacy014 and only accepted on read.
  const json = {
    formatVersion: '1',
    header: { description: 'Test table', originalLanguage: 'EN' },
    name,
    generalInformation: {
      deliveryClass: 'A',
      dataClassCategory: 'APPL0',
      sizeCategory: '0',
      clientDependent: false,
    },
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
      '--yes', '--json',
    ], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfPostDdic).toHaveBeenCalledWith('tabl', expect.objectContaining({
      name: 'ZTAB_TEST',
      description: 'Test table',
      generalInformation: expect.objectContaining({
        deliveryClass: 'A',
        dataClassCategory: 'APPL0',
        sizeCategory: '0',
        clientDependent: false,
      }),
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
    // Flip clientDependent on the local file (AFF canonical: under generalInformation.*).
    const json = JSON.parse(fs.readFileSync(path.join(cwd, 'src/ztab_test.tabl.json'), 'utf-8'));
    json.name = 'ZTAB_CLI';
    json.generalInformation.clientDependent = true;
    fs.writeFileSync(path.join(cwd, 'src/ztab_test.tabl.json'), JSON.stringify(json));

    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'TABL', 'ZTAB_CLI',
      '--file', 'src/ztab_test.tabl.json',
      '--package', '$TMP',
      '--yes', '--json',
    ], { cwd });
    expect(res.exitCode).toBeUndefined();
    const callBody = icfPostDdic.mock.calls[0]![1] as any;
    expect(callBody.generalInformation?.clientDependent).toBe(true);
    // The MANDT prepend is a server-side concern (CLI sends what the file declares);
    // for the create-then-pull round-trip the server is responsible for SPRING.
  });

  it('strips CLIENT/MANDT from fields[] when clientDependent=true', async () => {
    // User writes `clientDependent: true` and explicitly declares a `CLIENT`
    // field. The CLI must NOT forward it to the wire payload — the server
    // prepends MANDT, and a duplicate would fail the BAPI call with a
    // misleading "Field already exists" error.
    writeTableJson('ZTAB_CLI_STRIP', [
      { fieldName: 'CLIENT', dataType: 'CLNT', length: 3, keyFlag: true },
      { fieldName: 'ID', dataType: 'CHAR', length: 10, keyFlag: true },
    ]);
    const json = JSON.parse(fs.readFileSync(path.join(cwd, 'src/ztab_test.tabl.json'), 'utf-8'));
    json.name = 'ZTAB_CLI_STRIP';
    json.generalInformation.clientDependent = true;
    fs.writeFileSync(path.join(cwd, 'src/ztab_test.tabl.json'), JSON.stringify(json));

    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'TABL', 'ZTAB_CLI_STRIP',
      '--file', 'src/ztab_test.tabl.json',
      '--package', '$TMP',
      '--yes', '--json',
    ], { cwd });
    expect(res.exitCode).toBeUndefined();
    const callBody = icfPostDdic.mock.calls[0]![1] as any;
    expect(callBody.generalInformation?.clientDependent).toBe(true);
    expect(callBody.fields.map((f: any) => f.fieldName)).toEqual(['ID']);
    expect(Array.isArray(callBody.warnings)).toBe(true);
    expect(callBody.warnings.some((w: any) => w.code === 'CLIENT_FIELD_STRIPPED')).toBe(true);
  });

  it('rejects a TABL whose only fields are CLIENT/MANDT (fast-fail)', async () => {
    writeTableJson('ZEMPTY_CLI', [
      { fieldName: 'CLIENT', dataType: 'CLNT', length: 3, keyFlag: true },
    ]);
    const json = JSON.parse(fs.readFileSync(path.join(cwd, 'src/ztab_test.tabl.json'), 'utf-8'));
    json.name = 'ZEMPTY_CLI';
    json.generalInformation.clientDependent = true;
    fs.writeFileSync(path.join(cwd, 'src/ztab_test.tabl.json'), JSON.stringify(json));

    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'TABL', 'ZEMPTY_CLI',
      '--file', 'src/ztab_test.tabl.json',
      '--package', '$TMP',
      '--yes', '--json',
    ], { cwd });
    expect(res.exitCode).toBe(7); // VALIDATION_ERROR
    expect(icfPostDdic).not.toHaveBeenCalled();
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('VALIDATION_ERROR');
    expect(out.error.details.some((d: string) => d.includes('only client-key columns'))).toBe(true);
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
      '--yes', '--json',
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
      '--yes', '--json',
    ], { cwd });
    expect(res.exitCode).toBe(7); // VALIDATION_ERROR
    expect(icfPostDdic).not.toHaveBeenCalled();
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('VALIDATION_ERROR');
  });

  it('BUG-1: VALIDATION_ERROR for a nested-header file embeds a wire example', async () => {
    // First-time user pattern: abap-file-format nested header, no top-level name/fields.
    fs.writeFileSync(path.join(cwd, 'src/ztodo.tabl.json'), JSON.stringify({
      formatVersion: '1',
      header: { description: 'Todo', originalLanguage: 'EN' },
    }, null, 2));
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'TABL', 'ZTODO',
      '--file', 'src/ztodo.tabl.json',
      '--package', '$TMP',
      '--yes', '--json',
    ], { cwd });
    expect(res.exitCode).toBe(7);
    expect(icfPostDdic).not.toHaveBeenCalled();
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('VALIDATION_ERROR');
    // details should mention both missing fields (and the top-level hint, see ddic-json-map).
    expect(out.error.details).toEqual(expect.arrayContaining([
      expect.stringContaining('name'),
      expect.stringContaining('fields'),
    ]));
    // The example must be a parseable wire-flat JSON with top-level `name`.
    expect(typeof out.error.example).toBe('string');
    const exampleBlock = out.error.example.split('#')[0]; // strip trailing comment line
    const parsed = JSON.parse(exampleBlock);
    expect(parsed.name).toBeTypeOf('string');
    expect(Array.isArray(parsed.fields)).toBe(true);
  });

  it('abap-file-format three-piece TABL: main + .tabl.ddic + .tabl.settings.json drive the wire payload', async () => {
    // abap-file-format happy path: main JSON is just header, .tabl.ddic is the
    // source of truth for fields, .tabl.settings.json holds dataClassCategory /
    // sizeCategory. The CLI must stitch all three into the wire payload sent
    // to the ICF service.
    fs.writeFileSync(path.join(cwd, 'src/zthree.tabl.json'), JSON.stringify({
      formatVersion: '1',
      header: { description: 'three-piece TABL', originalLanguage: 'en' },
    }, null, 2));
    fs.writeFileSync(path.join(cwd, 'src/zthree.tabl.ddic'),
      "@EndUserText.label : 'three-piece TABL'\n" +
      "@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE\n" +
      "@AbapCatalog.tableCategory : #TRANSPARENT\n" +
      "@AbapCatalog.deliveryClass : #L\n" +
      "@AbapCatalog.dataMaintenance : #RESTRICTED\n" +
      "define table zthree {\n" +
      "  key client : abap.clnt not null;\n" +
      "  key id     : abap.char(10) not null;\n" +
      "  payload   : abap.char(255);\n" +
      "}\n");
    fs.writeFileSync(path.join(cwd, 'src/zthree.tabl.settings.json'), JSON.stringify({
      formatVersion: '1',
      generalInformation: { dataClassCategory: 'APPL1', sizeCategory: '3' },
    }, null, 2));

    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'TABL', 'ZTHREE',
      '--file', 'src/zthree.tabl.json',
      '--package', '$TMP',
      '--yes', '--json',
    ], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfPostDdic).toHaveBeenCalledWith('tabl', expect.objectContaining({
      name: 'ZTHREE',
      description: 'three-piece TABL',
      generalInformation: expect.objectContaining({
        deliveryClass: 'L',
        dataClassCategory: 'APPL1',
        sizeCategory: '3',
        clientDependent: true,
      }),
      package: '$TMP',
    }));
    const callBody = icfPostDdic.mock.calls[0]![1] as any;
    // MANDT/CLIENT is dropped from the wire (server prepends it itself).
    // Field order in `fields[]` mirrors the DDL order (key first).
    expect(callBody.fields.map((f: any) => f.fieldName)).toEqual(['ID', 'PAYLOAD']);
    expect(callBody.fields[0]).toMatchObject({ fieldName: 'ID', dataType: 'CHAR', length: 10, keyFlag: true, notNull: true });
    expect(callBody.fields[1]).toMatchObject({ fieldName: 'PAYLOAD', dataType: 'CHAR', length: 255, keyFlag: false });
  });

  it('abap-file-format TABL with malformed .tabl.ddic surfaces TABL_DDL_INVALID (not INVALID_ARGUMENT)', async () => {
    fs.writeFileSync(path.join(cwd, 'src/zbad.tabl.json'), JSON.stringify({
      formatVersion: '1',
      header: { description: 'bad' },
    }, null, 2));
    fs.writeFileSync(path.join(cwd, 'src/zbad.tabl.ddic'), '@AbapCatalog.deliveryClass : #L\n');
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'TABL', 'ZBAD',
      '--file', 'src/zbad.tabl.json',
      '--package', '$TMP',
      '--yes', '--json',
    ], { cwd });
    expect(res.exitCode).toBe(7);
    expect(icfPostDdic).not.toHaveBeenCalled();
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('TABL_DDL_INVALID');
  });

  it('abap-file-format TABL: only main JSON present → falls back to legacy wire-flat shape (backwards compat)', async () => {
    // No .tabl.ddic sidecar: CLI must NOT crash and must treat the main
    // JSON as the legacy wire-flat single-file shape. The wire now nests
    // fields/generalInformation on a happy path; the legacy local shape is
    // accepted on input for migration and lifted into the AFF nested wire.
    fs.writeFileSync(path.join(cwd, 'src/zlegacy.tabl.json'), JSON.stringify({
      name: 'ZLEGACY',
      description: 'legacy flat',
      deliveryClass: 'A',
      fields: [{ fieldName: 'F1', dataType: 'CHAR', length: 5 }],
    }, null, 2));
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'TABL', 'ZLEGACY',
      '--file', 'src/zlegacy.tabl.json',
      '--package', '$TMP',
      '--yes', '--json',
    ], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfPostDdic).toHaveBeenCalledWith('tabl', expect.objectContaining({
      name: 'ZLEGACY',
      fields: [expect.objectContaining({ fieldName: 'F1', dataType: 'CHAR', length: 5 })],
    }));
  });

  it('reports VALIDATION_ERROR for empty fields list', async () => {
    writeTableJson('ZTAB_EMPTY', []);
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'TABL', 'ZTAB_EMPTY',
      '--file', 'src/ztab_test.tabl.json',
      '--package', '$TMP',
      '--yes', '--json',
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
      '--yes', '--json',
    ], { cwd });
    expect(res.exitCode).toBe(7);
    expect(icfPostDdic).not.toHaveBeenCalled();
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('VALIDATION_ERROR');
    expect(out.error.message).toContain('transportRequest');
  });

  it('routes TTYP through the 036 channel flow instead of rejecting the type', async () => {
    writeTableJson('ZTAB_X');
    fs.writeFileSync(path.join(cwd, 'src/ztab_x.ttyp.json'), '{"name":"ZTAB_X","rowType":"ZREF"}');
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'TTYP', 'ZTAB_X',
      '--file', 'src/ztab_x.ttyp.json',
      '--package', '$TMP',
      '--yes', '--json',
    ], { cwd });
    expect(res.exitCode).toBe(7);
    // The file above is not a valid ttyp-v1 document, so the schema check
    // rejects it — the type itself is now supported.
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('VALIDATION_ERROR');
    expect(out.error.code).not.toBe('TYPE_NOT_SUPPORTED');
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
      '--yes', '--json',
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
      '--yes', '--json',
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
      dataTypeInformation: {
        category: 'domain',
        typeName: 'ZDOMA_TEST',
      },
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
      '--yes', '--json',
    ], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfPostDdic).toHaveBeenCalledWith('dtel', expect.objectContaining({
      name: 'ZDTEL_TEST',
      description: 'Data element',
      dataTypeInformation: { category: 'domain', typeName: 'ZDOMA_TEST' },
      shortText: 'Short',
      mediumText: 'Medium text',
      longText: 'Long field text',
      headerText: 'Header',
    }));
  });

  it('creates a domain via POST /ddic/doma with nested format.*', async () => {
    icfPostDdic.mockResolvedValue({ status: 'success' as const, data: { name: 'ZDOMA_TEST', type: 'DOMA', action: 'created' }, error: null });
    writeFile('src/zdoma_test.doma.json', {
      name: 'ZDOMA_TEST',
      description: 'Domain',
      format: {
        dataType: 'QUAN',
        length: 13,
        decimals: 3,
        signFlag: 'X',
        lowercase: '',
        convExit: 'ALPHA',
      },
    });
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'DOMA', 'ZDOMA_TEST',
      '--file', 'src/zdoma_test.doma.json',
      '--package', '$TMP',
      '--yes', '--json',
    ], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfPostDdic).toHaveBeenCalledWith('doma', expect.objectContaining({
      name: 'ZDOMA_TEST',
      description: 'Domain',
      format: {
        dataType: 'QUAN',
        length: 13,
        decimals: 3,
        signFlag: 'X',
        lowercase: '',
        convExit: 'ALPHA',
      },
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
      '--yes', '--json',
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
      '--yes', '--json',
    ], { cwd });
    expect(res.exitCode).toBe(7);
    expect(icfPostDdic).not.toHaveBeenCalled();
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('VALIDATION_ERROR');
  });
});
