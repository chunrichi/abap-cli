/**
 * SHLP CLI paths against mocked clients: create / pull / push / delete and
 * `create --schema SHLP`. The wire payloads asserted here are the contract the
 * ICF `/ddic/shlp` handler consumes; the real-SAP round-trip lives in `tests/`.
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

const SHLP_WIRE = {
  formatVersion: '1',
  header: { description: 'Language', originalLanguage: 'en' },
  name: 'ZCLI_TC_SHLP',
  package: '$TMP',
  kind: 'elementary',
  selectionMethod: 'T002',
  selectionMethodType: 'table',
  textTable: 'T002T',
  dialogType: 'displayValuesList',
  parameters: [
    { fieldName: 'SPRAS', position: 1, rollName: 'SPRAS', input: true, output: true, selectionPosition: 1, listPosition: 1 },
    { fieldName: 'LAISO', position: 2, rollName: 'LAISO', output: true, listPosition: 2 },
  ],
  includedSearchHelps: [],
  parameterMappings: [],
  type: 'SHLP',
};

const icfPostDdic = vi.fn(async () => ({
  status: 'success' as const,
  data: { name: 'ZCLI_TC_SHLP', type: 'SHLP', action: 'created' as const },
  error: null,
}));
const icfGetDdic = vi.fn(async () => ({ status: 'success' as const, data: { ...SHLP_WIRE }, error: null }));
const icfDeleteDdic = vi.fn(async () => ({
  status: 'success' as const,
  data: { name: 'ZCLI_TC_SHLP', type: 'SHLP', action: 'deleted' },
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
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shlp-cli-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
});

function writeShlpJson(name = 'ZCLI_TC_SHLP', extra: Record<string, unknown> = {}): string {
  const json = {
    formatVersion: '1',
    header: { description: 'Language', originalLanguage: 'en' },
    name,
    package: '$TMP',
    kind: 'elementary',
    selectionMethod: 'T002',
    selectionMethodType: 'table',
    textTable: 'T002T',
    parameters: [
      { fieldName: 'SPRAS', rollName: 'SPRAS', input: true, output: true },
      { fieldName: 'LAISO', rollName: 'LAISO', output: true },
    ],
    ...extra,
  };
  fs.writeFileSync(path.join(cwd, 'src/zcli_tc_shlp.shlp.json'), JSON.stringify(json, null, 2) + '\n');
  return 'src/zcli_tc_shlp.shlp.json';
}

describe('create SHLP', () => {
  it('posts the shlp-v1 wire document to /ddic/shlp', async () => {
    const rel = writeShlpJson();
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'SHLP', 'ZCLI_TC_SHLP', '--file', rel, '--package', '$TMP', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfPostDdic.mock.calls[0]![0]).toBe('shlp');
    const wire = icfPostDdic.mock.calls[0]![1] as Record<string, unknown>;
    expect(wire).toMatchObject({ name: 'ZCLI_TC_SHLP', kind: 'elementary', selectionMethod: 'T002', package: '$TMP' });
    expect(wire.transportRequest).toBeUndefined();
    expect(JSON.parse(res.stdout).data).toMatchObject({ object: 'ZCLI_TC_SHLP', type: 'SHLP', action: 'created' });
  });

  it('posts a collective search help', async () => {
    const rel = writeShlpJson('ZCLI_TC_SHLPC', {
      kind: 'collective',
      selectionMethod: undefined,
      selectionMethodType: undefined,
      textTable: undefined,
      includedSearchHelps: [{ searchHelp: 'ZCLI_TC_SHLP', position: 1 }],
      parameterMappings: [
        { fieldName: 'SPRAS', subSearchHelp: 'ZCLI_TC_SHLP', subFieldName: 'SPRAS', valueDirection: 'import' },
      ],
    });
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'SHLP', 'ZCLI_TC_SHLPC', '--file', rel, '--package', '$TMP', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const wire = icfPostDdic.mock.calls[0]![1] as Record<string, unknown>;
    expect(wire).toMatchObject({ kind: 'collective' });
    expect((wire.parameterMappings as unknown[]).length).toBe(1);
  });

  it('rejects a JSON name that does not match the command argument', async () => {
    writeShlpJson('ZCLI_TC_OTHER');
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'SHLP', 'ZCLI_TC_SHLP', '--file', 'src/zcli_tc_shlp.shlp.json', '--package', '$TMP', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    expect(JSON.parse(res.stderr).error.code).toBe('SHLP_NAME_INVALID');
    expect(icfPostDdic).not.toHaveBeenCalled();
  });

  it('rejects an invalid shlp-v1 document before the round-trip', async () => {
    writeShlpJson('ZCLI_TC_SHLP', { header: { description: '', originalLanguage: 'en' } });
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'SHLP', 'ZCLI_TC_SHLP', '--file', 'src/zcli_tc_shlp.shlp.json', '--package', '$TMP', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    expect(JSON.parse(res.stderr).error.message).toMatch(/header\.description|schema validation/);
    expect(icfPostDdic).not.toHaveBeenCalled();
  });

  it('exposes the SHLP contract through create --schema', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'SHLP', '--schema', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const out = JSON.parse(res.stdout);
    expect(out.data).toMatchObject({ type: 'SHLP', supported: true, route: 'icf' });
    expect(out.data.exampleJson).toContain('"kind": "elementary"');
  });
});

describe('pull SHLP', () => {
  it('writes <name>.shlp.json from the ICF GET payload', async () => {
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZCLI_TC_SHLP', '--type', 'SHLP', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfGetDdic).toHaveBeenCalledWith('shlp', 'ZCLI_TC_SHLP');
    const local = JSON.parse(fs.readFileSync(path.join(cwd, 'src/zcli_tc_shlp.shlp.json'), 'utf8'));
    expect(local).toMatchObject({ formatVersion: '1', name: 'ZCLI_TC_SHLP', package: '$TMP', kind: 'elementary' });
    expect(local).not.toHaveProperty('type');
    expect(local.parameters).toHaveLength(2);
    expect(local.parameters[0]).toMatchObject({ fieldName: 'SPRAS', rollName: 'SPRAS', input: true, output: true });
  });

  it('maps a missing search help to OBJECT_NOT_FOUND (exit 8)', async () => {
    icfGetDdic.mockResolvedValueOnce({
      status: 'error' as const,
      data: null,
      error: { code: 'DDIC_OBJECT_NOT_FOUND', message: 'SHLP ZCLI_TC_SHLP not found' },
    });
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZCLI_TC_SHLP', '--type', 'SHLP', '--json'], { cwd });
    expect(res.exitCode).toBe(8);
    expect(JSON.parse(res.stderr).error.code).toBe('OBJECT_NOT_FOUND');
  });
});

describe('push SHLP', () => {
  it('probes the search help and posts the full definition as an update', async () => {
    const rel = writeShlpJson();
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', rel, '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfGetDdic).toHaveBeenCalledWith('shlp', 'ZCLI_TC_SHLP');
    expect(icfPostDdic.mock.calls[0]![0]).toBe('shlp');
    const wire = icfPostDdic.mock.calls[0]![1] as Record<string, unknown>;
    expect(wire).toMatchObject({ name: 'ZCLI_TC_SHLP', kind: 'elementary' });
    expect(JSON.parse(res.stdout).data.results[0]).toMatchObject({ status: 'written', stage: 'ddic-icf' });
  });

  it('refuses to create through push when the search help is missing', async () => {
    const rel = writeShlpJson();
    icfGetDdic.mockResolvedValueOnce({
      status: 'error' as const,
      data: null,
      error: { code: 'DDIC_OBJECT_NOT_FOUND', message: 'SHLP ZCLI_TC_SHLP not found' },
    });
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', rel, '--yes', '--json'], { cwd });
    expect(res.exitCode).toBe(8);
    expect(JSON.parse(res.stderr).error.code).toBe('OBJECT_NOT_FOUND');
    expect(icfPostDdic).not.toHaveBeenCalled();
  });
});

describe('delete SHLP', () => {
  it('deletes a $TMP search help through ICF DELETE', async () => {
    const program = makeProgram();
    registerDeleteCommand(program);
    const res = await runCommand(program, ['delete', 'ZCLI_TC_SHLP', '--type', 'SHLP', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfGetDdic).toHaveBeenCalledWith('shlp', 'ZCLI_TC_SHLP');
    expect(icfDeleteDdic).toHaveBeenCalledWith('shlp', 'ZCLI_TC_SHLP');
    expect(JSON.parse(res.stdout).data).toMatchObject({ object: 'ZCLI_TC_SHLP', type: 'SHLP', deleted: true });
  });

  it('rejects deletion of a transported search help with a clear code', async () => {
    icfGetDdic.mockResolvedValueOnce({ status: 'success' as const, data: { ...SHLP_WIRE, package: 'ZPKG' }, error: null });
    const program = makeProgram();
    registerDeleteCommand(program);
    const res = await runCommand(program, ['delete', 'ZCLI_TC_SHLP', '--type', 'SHLP', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    expect(JSON.parse(res.stderr).error.code).toBe('SHLP_DELETE_UNSUPPORTED');
    expect(icfDeleteDdic).not.toHaveBeenCalled();
  });

  it('maps a missing search help to OBJECT_NOT_FOUND (exit 8)', async () => {
    icfGetDdic.mockResolvedValueOnce({
      status: 'error' as const,
      data: null,
      error: { code: 'DDIC_OBJECT_NOT_FOUND', message: 'SHLP ZCLI_TC_SHLP not found' },
    });
    const program = makeProgram();
    registerDeleteCommand(program);
    const res = await runCommand(program, ['delete', 'ZCLI_TC_SHLP', '--type', 'SHLP', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBe(8);
    expect(JSON.parse(res.stderr).error.code).toBe('OBJECT_NOT_FOUND');
  });
});
