/**
 * VIEW CLI paths against mocked clients: create / pull / push / delete and
 * `create --schema VIEW`. The wire payloads asserted here are the contract the
 * ICF `/ddic/view` handler consumes; the real-SAP round-trip lives in
 * `tests/` (local evidence).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { registerCreateCommand } from '../../src/abap_cli/commands/create.js';
import { registerPullCommand } from '../../src/abap_cli/commands/pull.js';
import { registerPushCommand } from '../../src/abap_cli/commands/push.js';
import { registerDeleteCommand } from '../../src/abap_cli/commands/delete.js';
import { makeProgram, runCommand } from './cli-helper.js';

const VIEW_WIRE = {
  formatVersion: '1',
  header: { description: 'Demo view', originalLanguage: 'en' },
  name: 'ZCLI_TC_VIEW',
  package: '$TMP',
  viewClass: 'databaseView',
  rootTable: 'T000',
  tables: [{ tableName: 'T000', tablePosition: 1, foreignTableName: 'T000' }],
  fields: [
    { tableName: 'T000', fieldName: 'MANDT', keyFlag: true, rollName: 'MANDT' },
    { tableName: 'T000', fieldName: 'MTEXT', rollName: 'MTEXT_D' },
  ],
  joinConditions: [],
  selectionConditions: [],
  type: 'VIEW',
};

const icfPostDdic = vi.fn(async () => ({
  status: 'success' as const,
  data: { name: 'ZCLI_TC_VIEW', type: 'VIEW', action: 'created' as const },
  error: null,
}));
const icfGetDdic = vi.fn(async () => ({ status: 'success' as const, data: { ...VIEW_WIRE }, error: null }));
const icfDeleteDdic = vi.fn(async () => ({
  status: 'success' as const,
  data: { name: 'ZCLI_TC_VIEW', type: 'VIEW', action: 'deleted' },
  error: null,
}));

vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: {
    create: async () => ({
      postDdic: icfPostDdic,
      getDdic: icfGetDdic,
      deleteDdic: icfDeleteDdic,
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    }),
  },
}));

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      getConfig: () => ({ sap: { username: 'MOCKUSER' }, transport: '' }),
      searchObject: vi.fn(async () => []),
    }),
  },
}));

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'view-cli-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
});

function writeViewJson(name = 'ZCLI_TC_VIEW', extra: Record<string, unknown> = {}): string {
  const json = {
    formatVersion: '1',
    header: { description: 'Demo view', originalLanguage: 'en' },
    name,
    package: '$TMP',
    viewClass: 'databaseView',
    rootTable: 'T000',
    tables: [{ tableName: 'T000', tablePosition: 1 }],
    fields: [{ tableName: 'T000', fieldName: 'MANDT', keyFlag: true }],
    ...extra,
  };
  fs.writeFileSync(path.join(cwd, 'src/zcli_tc_view.view.json'), JSON.stringify(json, null, 2) + '\n');
  return 'src/zcli_tc_view.view.json';
}

describe('create VIEW', () => {
  it('posts the view-v1 wire document to /ddic/view', async () => {
    const rel = writeViewJson();
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'VIEW', 'ZCLI_TC_VIEW', '--file', rel, '--package', '$TMP', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const wire = icfPostDdic.mock.calls[0]![1] as Record<string, unknown>;
    expect(icfPostDdic.mock.calls[0]![0]).toBe('view');
    expect(wire).toMatchObject({
      name: 'ZCLI_TC_VIEW',
      package: '$TMP',
      viewClass: 'databaseView',
      rootTable: 'T000',
    });
    expect(wire.transportRequest).toBeUndefined();
    const out = JSON.parse(res.stdout);
    expect(out.data).toMatchObject({ object: 'ZCLI_TC_VIEW', type: 'VIEW', action: 'created' });
  });

  it('rejects a view name longer than 16 characters before touching SAP', async () => {
    writeViewJson();
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'VIEW', 'ZCLI_TC_VIEW_17CHARS', '--file', 'src/zcli_tc_view.view.json', '--package', '$TMP', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    expect(JSON.parse(res.stderr).error.code).toBe('VIEW_NAME_INVALID');
    expect(icfPostDdic).not.toHaveBeenCalled();
  });

  it('rejects a JSON name that does not match the command argument', async () => {
    writeViewJson('ZCLI_TC_OTHER');
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'VIEW', 'ZCLI_TC_VIEW', '--file', 'src/zcli_tc_view.view.json', '--package', '$TMP', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    expect(JSON.parse(res.stderr).error.code).toBe('VIEW_NAME_INVALID');
  });

  it('rejects an invalid view-v1 document before the round-trip', async () => {
    writeViewJson('ZCLI_TC_VIEW', { header: { description: '', originalLanguage: 'en' } });
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'VIEW', 'ZCLI_TC_VIEW', '--file', 'src/zcli_tc_view.view.json', '--package', '$TMP', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    expect(JSON.parse(res.stderr).error.message).toMatch(/header\.description|schema validation/);
    expect(icfPostDdic).not.toHaveBeenCalled();
  });

  it('requires --tr for a non-$TMP package', async () => {
    writeViewJson();
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'VIEW', 'ZCLI_TC_VIEW', '--file', 'src/zcli_tc_view.view.json', '--package', 'ZPKG', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    expect(JSON.parse(res.stderr).error.message).toMatch(/transport/);
  });

  it('exposes the VIEW contract through create --schema', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'VIEW', '--schema', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const out = JSON.parse(res.stdout);
    expect(out.data).toMatchObject({ type: 'VIEW', supported: true, route: 'icf' });
    expect(out.data.exampleJson).toContain('"viewClass": "databaseView"');
  });
});

describe('pull VIEW', () => {
  it('writes <name>.view.json from the ICF GET payload', async () => {
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZCLI_TC_VIEW', '--type', 'VIEW', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfGetDdic).toHaveBeenCalledWith('view', 'ZCLI_TC_VIEW');
    const file = path.join(cwd, 'src/zcli_tc_view.view.json');
    const local = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(local).toMatchObject({ formatVersion: '1', name: 'ZCLI_TC_VIEW', package: '$TMP', viewClass: 'databaseView' });
    expect(local).not.toHaveProperty('type');
    expect(local.tables).toEqual([{ tableName: 'T000', tablePosition: 1, foreignTableName: 'T000' }]);
    expect(local.fields[0]).toMatchObject({ tableName: 'T000', fieldName: 'MANDT', keyFlag: true, rollName: 'MANDT' });
    const out = JSON.parse(res.stdout);
    expect(out.data.written).toEqual(['src/zcli_tc_view.view.json']);
  });

  it('maps a missing view to OBJECT_NOT_FOUND (exit 8)', async () => {
    icfGetDdic.mockResolvedValueOnce({
      status: 'error' as const,
      data: null,
      error: { code: 'DDIC_OBJECT_NOT_FOUND', message: 'VIEW ZCLI_TC_VIEW not found' },
    });
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZCLI_TC_VIEW', '--type', 'VIEW', '--json'], { cwd });
    expect(res.exitCode).toBe(8);
    expect(JSON.parse(res.stderr).error.code).toBe('OBJECT_NOT_FOUND');
  });
});

describe('push VIEW', () => {
  it('probes the view and posts the full definition as an update', async () => {
    const rel = writeViewJson();
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', rel, '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfGetDdic).toHaveBeenCalledWith('view', 'ZCLI_TC_VIEW');
    const wire = icfPostDdic.mock.calls[0]![1] as Record<string, unknown>;
    expect(icfPostDdic.mock.calls[0]![0]).toBe('view');
    expect(wire).toMatchObject({ name: 'ZCLI_TC_VIEW', viewClass: 'databaseView' });
    const out = JSON.parse(res.stdout);
    expect(out.data.results[0]).toMatchObject({ status: 'written', stage: 'ddic-icf' });
  });

  it('refuses to create through push when the view is missing', async () => {
    const rel = writeViewJson();
    icfGetDdic.mockResolvedValueOnce({
      status: 'error' as const,
      data: null,
      error: { code: 'DDIC_OBJECT_NOT_FOUND', message: 'VIEW ZCLI_TC_VIEW not found' },
    });
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', rel, '--yes', '--json'], { cwd });
    expect(res.exitCode).toBe(8);
    expect(JSON.parse(res.stderr).error.code).toBe('OBJECT_NOT_FOUND');
    expect(icfPostDdic).not.toHaveBeenCalled();
  });
});

describe('delete VIEW', () => {
  it('deletes a $TMP view through ICF DELETE', async () => {
    const program = makeProgram();
    registerDeleteCommand(program);
    const res = await runCommand(program, ['delete', 'ZCLI_TC_VIEW', '--type', 'VIEW', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfGetDdic).toHaveBeenCalledWith('view', 'ZCLI_TC_VIEW');
    expect(icfDeleteDdic).toHaveBeenCalledWith('view', 'ZCLI_TC_VIEW');
    const out = JSON.parse(res.stdout);
    expect(out.data).toMatchObject({ object: 'ZCLI_TC_VIEW', type: 'VIEW', deleted: true, packageName: '$TMP' });
  });

  it('rejects deletion of a transported view with a clear code', async () => {
    icfGetDdic.mockResolvedValueOnce({
      status: 'success' as const,
      data: { ...VIEW_WIRE, package: 'ZPKG' },
      error: null,
    });
    const program = makeProgram();
    registerDeleteCommand(program);
    const res = await runCommand(program, ['delete', 'ZCLI_TC_VIEW', '--type', 'VIEW', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    expect(JSON.parse(res.stderr).error.code).toBe('VIEW_DELETE_UNSUPPORTED');
    expect(icfDeleteDdic).not.toHaveBeenCalled();
  });

  it('maps a missing view to OBJECT_NOT_FOUND (exit 8)', async () => {
    icfGetDdic.mockResolvedValueOnce({
      status: 'error' as const,
      data: null,
      error: { code: 'DDIC_OBJECT_NOT_FOUND', message: 'VIEW ZCLI_TC_VIEW not found' },
    });
    const program = makeProgram();
    registerDeleteCommand(program);
    const res = await runCommand(program, ['delete', 'ZCLI_TC_VIEW', '--type', 'VIEW', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBe(8);
    expect(JSON.parse(res.stderr).error.code).toBe('OBJECT_NOT_FOUND');
  });
});
