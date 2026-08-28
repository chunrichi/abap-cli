/**
 * 022: create HTTP service end-to-end tests. Drives the full CLI pipeline
 * (create → file → wire → POST /http/<name>) against a mock ICF client.
 * Mirrors ddic-create.test.ts (014) but for the HTTP service object type.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerCreateCommand } from '../../src/abap_cli/commands/create.js';
import { makeProgram, runCommand } from './cli-helper.js';

const icfPostHttp = vi.fn(async () => ({
  status: 'success' as const,
  data: { name: 'ZHTTP_TEST', type: 'HTTP', action: 'created' },
  error: null,
}));

vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: {
    create: async () => ({
      postHttp: icfPostHttp,
      getHttp: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
    }),
  },
}));

// HTTP create never touches ADT — the client is created but unused.
vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      getConfig: () => ({ sap: { username: 'MOCKUSER' }, transport: '' }),
    }),
  },
}));

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'http-create-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
});

function writeHttpJsonFile(name: string, extra: Record<string, unknown> = {}) {
  const json = {
    formatVersion: '1',
    header: { description: 'Test HTTP service', originalLanguage: 'EN' },
    generalInformation: { handlerClass: 'ZCL_HTTP_HANDLER', url: '/sap/zhttp_test' },
    name,
    ...extra,
  };
  fs.writeFileSync(path.join(cwd, 'src/zhttp_test.http.json'), JSON.stringify(json, null, 2));
}

describe('022 create HTTP service', () => {
  it('creates an HTTP service via POST /http/<name> with the wire payload', async () => {
    writeHttpJsonFile('ZHTTP_TEST');
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'HTTP', 'ZHTTP_TEST',
      '--file', 'src/zhttp_test.http.json',
      '--package', '$TMP',
      '--yes', '--json',
    ], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfPostHttp).toHaveBeenCalledWith('ZHTTP_TEST', expect.objectContaining({
      name: 'ZHTTP_TEST',
      description: 'Test HTTP service',
      originalLanguage: 'EN',
      handlerClass: 'ZCL_HTTP_HANDLER',
      url: '/sap/zhttp_test',
      package: '$TMP',
    }));
    expect(JSON.parse(res.stdout)).toMatchObject({
      data: { object: 'ZHTTP_TEST', type: 'HTTP', action: 'created' },
    });
  });

  it('command-line --description overrides file description', async () => {
    writeHttpJsonFile('ZHTTP_OVR');
    const program = makeProgram();
    registerCreateCommand(program);
    await runCommand(program, [
      'create', 'HTTP', 'ZHTTP_OVR',
      '--file', 'src/zhttp_test.http.json',
      '--package', '$TMP',
      '--description', 'CLI override',
      '--yes', '--json',
    ], { cwd });
    const callBody = icfPostHttp.mock.calls[0]![1] as any;
    expect(callBody.description).toBe('CLI override');
  });

  it('reports INVALID_ARGUMENT for invalid namespace (non-Z/Y/slash)', async () => {
    writeHttpJsonFile('XHTTP');
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'HTTP', 'XHTTP',
      '--file', 'src/zhttp_test.http.json',
      '--package', '$TMP',
      '--yes', '--json',
    ], { cwd });
    expect(res.exitCode).toBe(7); // VALIDATION_ERROR
    expect(icfPostHttp).not.toHaveBeenCalled();
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('VALIDATION_ERROR');
  });

  it('reports VALIDATION_ERROR for missing description and originalLanguage', async () => {
    fs.writeFileSync(path.join(cwd, 'src/zhttp_test.http.json'), JSON.stringify({ name: 'ZHTTP_TEST' }, null, 2));
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'HTTP', 'ZHTTP_TEST',
      '--file', 'src/zhttp_test.http.json',
      '--package', '$TMP',
      '--yes', '--json',
    ], { cwd });
    expect(res.exitCode).toBe(7);
    expect(icfPostHttp).not.toHaveBeenCalled();
  });

  it('reports INVALID_ARGUMENT for non-$TMP package without --tr', async () => {
    writeHttpJsonFile('ZHTTP_NOTMP');
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'HTTP', 'ZHTTP_NOTMP',
      '--file', 'src/zhttp_test.http.json',
      '--package', 'ZPKG',
      '--yes', '--json',
    ], { cwd });
    expect(res.exitCode).toBe(7);
    expect(icfPostHttp).not.toHaveBeenCalled();
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('VALIDATION_ERROR');
    expect(out.error.message).toContain('transportRequest');
  });

  it('ICF failure maps to HTTP_CREATE_FAILED (exit 6)', async () => {
    writeHttpJsonFile('ZHTTP_500');
    icfPostHttp.mockResolvedValueOnce({
      status: 'error',
      data: null,
      error: { code: 'HTTP_CREATE_FAILED', message: 'simulated' },
    });
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'HTTP', 'ZHTTP_500',
      '--file', 'src/zhttp_test.http.json',
      '--package', '$TMP',
      '--yes', '--json',
    ], { cwd });
    expect(res.exitCode).toBe(6);
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('HTTP_CREATE_FAILED');
  });

  it('surfaces SICF subrc/sy-msgid/sy-msgno in HTTP_SERVICE_WRITE_FAILED message (#5)', async () => {
    // Simulates the wrapper's `insert_node` failure: ABAP returns subrc=6
    // (node_already_existing) with sy-msgid=SU53 sy-msgno=819. The CLI must
    // surface this in `error.message` so users can diagnose the SICF failure.
    writeHttpJsonFile('ZHTTP_NODE_FAIL');
    icfPostHttp.mockResolvedValueOnce({
      status: 'error',
      data: null,
      error: {
        code: 'HTTP_SERVICE_WRITE_FAILED',
        message: 'SICF service creation failed (subrc=6, SU53 819): Node already exists',
      },
    });
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'HTTP', 'ZHTTP_NODE_FAIL',
      '--file', 'src/zhttp_test.http.json',
      '--package', '$TMP',
      '--yes', '--json',
    ], { cwd });
    // HTTP_SERVICE_WRITE_FAILED maps to SAP_ERROR (not in error-codes table) → exit 1.
    expect(res.exitCode).toBe(1);
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('HTTP_SERVICE_WRITE_FAILED');
    expect(out.error.message).toMatch(/subrc=6/);
    expect(out.error.message).toMatch(/SU53/);
  });
});

describe('022 create --schema HTTP', () => {
  it('reports HTTP as supported with icf route and --file requirement', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', '--schema', 'HTTP', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const out = JSON.parse(res.stdout);
    expect(out.data.supported).toBe(true);
    expect(out.data.route).toBe('icf');
    expect(out.data.type).toBe('HTTP');
    expect(out.data.options.find((o: { name: string }) => o.name === '--file')).toBeDefined();
  });
});
