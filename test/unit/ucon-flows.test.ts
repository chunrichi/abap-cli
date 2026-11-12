/**
 * Shared UCON object flows (SRFC / OA2P) against a mocked ICF service.
 *
 * Drives the full command pipeline (create / pull / push / delete) for both
 * types, pinning the wire payloads, the local file layout, the package /
 * transport rules and the error-code mapping. The real-SAP side is covered by
 * the integration suite and the six-phase real-system run.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerCreateCommand } from '../../src/abap_cli/commands/create.js';
import { registerPullCommand } from '../../src/abap_cli/commands/pull.js';
import { registerPushCommand } from '../../src/abap_cli/commands/push.js';
import { registerDeleteCommand } from '../../src/abap_cli/commands/delete.js';
import { CliError } from '../../src/abap_cli/output/json.js';
import { makeProgram, runCommand } from './cli-helper.js';

/** One mock ICF route table keyed by (method, path). */
const routes = new Map<string, { status: 'success' | 'error'; data?: unknown; error?: { code: string; message: string } }>();
const icfGet = vi.fn(async (route: string) => routeResult('GET', route));
const icfPost = vi.fn(async (route: string, body: unknown) => routeResult('POST', route, body));
const icfDelete = vi.fn(async (route: string, body: unknown) => routeResult('DELETE', route, body));

function routeResult(method: string, route: string, body?: unknown) {
  const hit = routes.get(`${method} ${route}`);
  if (!hit) throw new Error(`unexpected ICF route: ${method} ${route}`);
  if (hit.status === 'success') {
    const data = typeof hit.data === 'function' ? (hit.data as (b: unknown) => unknown)(body) : hit.data;
    return { status: 'success', data, error: null };
  }
  return { status: 'error', data: null, error: hit.error };
}

function respond(method: 'GET' | 'POST' | 'DELETE', path: string, payload: unknown) {
  routes.set(`${method} ${path}`, { status: 'success', data: payload });
}

function fail(method: 'GET' | 'POST' | 'DELETE', path: string, code: string, message: string) {
  routes.set(`${method} ${path}`, { status: 'error', error: { code, message } });
}

const icfCreate = vi.fn(async () => ({
  get: icfGet,
  post: icfPost,
  deleteIcfRoute: icfDelete,
  put: vi.fn(),
}));

vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: {
    create: (...args: unknown[]) => icfCreate(...(args as [])),
  },
}));

// The UCON flows never touch ADT; the push coordinator may still construct the
// client for channel-independent orchestration and transport resolution.
vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      getConfig: () => ({ sap: { username: 'MOCKUSER' }, transport: '' }),
      searchObject: vi.fn(async () => []),
    }),
  },
}));

const SRFC_LOCAL = {
  formatVersion: '1',
  description: 'Default RFC Service for Function-Module: Z_MY_RFC_FM',
  functionName: 'Z_MY_RFC_FM',
  scope: 'E',
};

const SRFC_WIRE = {
  ...SRFC_LOCAL,
  name: 'ZSRFC_DEMO',
  package: '$TMP',
  createdBy: 'MOCKUSER',
  createdOn: '2026-01-01',
  createdAt: '12:00:00',
};

const OA2P_LOCAL = {
  formatVersion: '1',
  type: 'DEFAULT',
  noAuthCheck: false,
  scopes: ['scope-one'],
};

const OA2P_WIRE = {
  ...OA2P_LOCAL,
  name: 'ZOA2P_DEMO',
  package: '$TMP',
  createdBy: 'MOCKUSER',
  createdOn: '2026-01-01',
  createdAt: '12:00:00',
};

const UCON_HTTP_LOCAL = {
  formatVersion: '1',
  description: 'Demo UCON HTTP service',
  handlers: [
    { order: '01', handlerClass: 'ZCL_HTTP_DEMO_HANDLER' },
    { order: '02', handlerClass: 'ZCL_HTTP_AUDIT_HANDLER' },
  ],
};

const UCON_HTTP_WIRE = {
  ...UCON_HTTP_LOCAL,
  name: 'ZHTTP_DEMO',
  package: '$TMP',
};

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  routes.clear();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ucon-flows-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  respond('GET', '/srfc/ZSRFC_DEMO', SRFC_WIRE);
  respond('POST', '/srfc/ZSRFC_DEMO', { name: 'ZSRFC_DEMO', type: 'SRFC', action: 'created', package: '$TMP' });
  respond('DELETE', '/srfc/ZSRFC_DEMO', { name: 'ZSRFC_DEMO', type: 'SRFC', action: 'deleted' });
  respond('GET', '/oa2p/ZOA2P_DEMO', OA2P_WIRE);
  respond('POST', '/oa2p/ZOA2P_DEMO', { name: 'ZOA2P_DEMO', type: 'OA2P', action: 'created', package: '$TMP' });
  respond('DELETE', '/oa2p/ZOA2P_DEMO', { name: 'ZOA2P_DEMO', type: 'OA2P', action: 'deleted' });
  respond('GET', '/ucon_http/ZHTTP_DEMO', UCON_HTTP_WIRE);
  respond('POST', '/ucon_http/ZHTTP_DEMO', { name: 'ZHTTP_DEMO', type: 'UCON_HTTP', action: 'created', package: '$TMP' });
  respond('DELETE', '/ucon_http/ZHTTP_DEMO', { name: 'ZHTTP_DEMO', type: 'UCON_HTTP', action: 'deleted' });
});

function writeLocal(type: 'srfc' | 'oa2p' | 'ucon_http', name: string, doc: Record<string, unknown>) {
  const file = path.join(cwd, 'src', `${name}.${type}.json`);
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  return `src/${name}.${type}.json`;
}

function parseStdout(res: { stdout: string }) {
  return JSON.parse(res.stdout);
}

function parseStderr(res: { stderr: string }) {
  return JSON.parse(res.stderr);
}

async function run(argv: string[]) {
  const program = makeProgram();
  registerCreateCommand(program);
  registerPullCommand(program);
  registerPushCommand(program);
  registerDeleteCommand(program);
  return runCommand(program, [...argv, '--json'], { cwd });
}

describe('abap create SRFC', () => {
  it('posts the name + wire document through /srfc/<name>', async () => {
    const file = writeLocal('srfc', 'zsrfc_demo', SRFC_LOCAL);
    const res = await run(['create', 'SRFC', 'ZSRFC_DEMO', '--file', file, '--package', '$TMP', '--yes']);
    expect(res.exitCode).toBeUndefined();
    expect(icfPost).toHaveBeenCalledWith('/srfc/ZSRFC_DEMO', {
      ...SRFC_LOCAL,
      name: 'ZSRFC_DEMO',
      package: '$TMP',
    });
    expect(parseStdout(res)).toMatchObject({
      status: 'success',
      data: { object: 'ZSRFC_DEMO', type: 'SRFC', action: 'created', channel: 'icf', package: '$TMP' },
    });
  });

  it('passes --tr for a transportable package', async () => {
    const file = writeLocal('srfc', 'zsrfc_demo', SRFC_LOCAL);
    const res = await run([
      'create', 'SRFC', 'ZSRFC_DEMO', '--file', file, '--package', 'ZPKG_DEV', '--tr', 'NDK900123', '--yes',
    ]);
    expect(res.exitCode).toBeUndefined();
    expect(icfPost).toHaveBeenCalledWith(
      '/srfc/ZSRFC_DEMO',
      expect.objectContaining({ package: 'ZPKG_DEV', transportRequest: 'NDK900123' }),
    );
  });

  it('rejects a transportable package without --tr before the SAP call', async () => {
    const file = writeLocal('srfc', 'zsrfc_demo', SRFC_LOCAL);
    const res = await run(['create', 'SRFC', 'ZSRFC_DEMO', '--file', file, '--package', 'ZPKG_DEV', '--yes']);
    expect(res.exitCode).toBe(7);
    expect(parseStderr(res).error.code).toBe('VALIDATION_ERROR');
    expect(icfPost).not.toHaveBeenCalled();
  });

  it('--check-only validates locally and never creates an ICF client', async () => {
    const file = writeLocal('srfc', 'zsrfc_demo', SRFC_LOCAL);
    const res = await run(['create', 'SRFC', 'ZSRFC_DEMO', '--file', file, '--package', '$TMP', '--check-only', '--yes']);
    expect(res.exitCode).toBeUndefined();
    expect(icfCreate).not.toHaveBeenCalled();
    expect(parseStdout(res)).toMatchObject({ data: { checkOnly: true, valid: true } });
  });

  it('rejects an over-long name before the SAP call', async () => {
    // UCONRFCSERVID is CHAR 30 — the shared 30-char object-name guard rejects
    // it before the type flow runs.
    const file = writeLocal('srfc', 'zsrfc_demo', SRFC_LOCAL);
    const res = await run(['create', 'SRFC', 'Z' + 'X'.repeat(30), '--file', file, '--package', '$TMP', '--yes']);
    expect(res.exitCode).toBe(7);
    expect(parseStderr(res).error.code).toBe('VALIDATION_ERROR');
    expect(icfPost).not.toHaveBeenCalled();
  });

  it('rejects a file whose name token does not match the service name', async () => {
    const file = writeLocal('srfc', 'zsrfc_other', SRFC_LOCAL);
    const res = await run(['create', 'SRFC', 'ZSRFC_DEMO', '--file', file, '--package', '$TMP', '--yes']);
    expect(res.exitCode).toBe(2);
    expect(parseStderr(res).error.code).toBe('INVALID_ARGUMENT');
    expect(icfPost).not.toHaveBeenCalled();
  });

  it('surfaces a SAP-side validation error code verbatim', async () => {
    fail('POST', '/srfc/ZSRFC_DEMO', 'SRFC_FUNCTION_NOT_RFC_ENABLED', 'function module Z_MY_RFC_FM is not RFC-enabled');
    const file = writeLocal('srfc', 'zsrfc_demo', SRFC_LOCAL);
    const res = await run(['create', 'SRFC', 'ZSRFC_DEMO', '--file', file, '--package', '$TMP', '--yes']);
    expect(res.exitCode).toBe(7);
    expect(parseStderr(res).error).toMatchObject({ code: 'SRFC_FUNCTION_NOT_RFC_ENABLED' });
  });
});

describe('abap pull SRFC / OA2P', () => {
  it('writes the local document without the server-owned fields', async () => {
    const res = await run(['pull', 'ZSRFC_DEMO', '--type', 'SRFC']);
    expect(res.exitCode).toBeUndefined();
    expect(icfGet).toHaveBeenCalledWith('/srfc/ZSRFC_DEMO');
    const file = path.join(cwd, 'src', 'zsrfc_demo.srfc.json');
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(SRFC_LOCAL);
  });

  it('maps a missing service to OBJECT_NOT_FOUND', async () => {
    fail('GET', '/srfc/ZSRFC_DEMO', 'SRFC_OBJECT_NOT_FOUND', 'not found');
    const res = await run(['pull', 'ZSRFC_DEMO', '--type', 'SRFC']);
    expect(res.exitCode).toBe(8);
    expect(parseStderr(res).error.code).toBe('OBJECT_NOT_FOUND');
  });

  it('pulls an OA2P profile with its scopes', async () => {
    const res = await run(['pull', 'ZOA2P_DEMO', '--type', 'OA2P']);
    expect(res.exitCode).toBeUndefined();
    const file = path.join(cwd, 'src', 'zoa2p_demo.oa2p.json');
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(OA2P_LOCAL);
  });
});

describe('abap push SRFC / OA2P', () => {
  it('probes the service and sends the package read from the GET payload', async () => {
    const file = writeLocal('srfc', 'zsrfc_demo', { ...SRFC_LOCAL, scope: 'S' });
    respond('POST', '/srfc/ZSRFC_DEMO', { name: 'ZSRFC_DEMO', type: 'SRFC', action: 'updated' });
    const res = await run(['push', file, '--yes']);
    expect(res.exitCode).toBeUndefined();
    expect(icfGet).toHaveBeenCalledWith('/srfc/ZSRFC_DEMO');
    expect(icfPost).toHaveBeenCalledWith('/srfc/ZSRFC_DEMO', {
      ...SRFC_LOCAL,
      scope: 'S',
      name: 'ZSRFC_DEMO',
      package: '$TMP',
    });
    expect(parseStdout(res)).toMatchObject({ data: { results: [{ status: 'written' }] } });
  });

  it('pushes an OA2P profile as update-only', async () => {
    const file = writeLocal('oa2p', 'zoa2p_demo', { ...OA2P_LOCAL, noAuthCheck: true });
    respond('POST', '/oa2p/ZOA2P_DEMO', { name: 'ZOA2P_DEMO', type: 'OA2P', action: 'updated' });
    const res = await run(['push', file, '--yes']);
    expect(res.exitCode).toBeUndefined();
    expect(icfPost).toHaveBeenCalledWith('/oa2p/ZOA2P_DEMO', {
      formatVersion: '1',
      type: 'DEFAULT',
      noAuthCheck: true,
      scopes: ['scope-one'],
      name: 'ZOA2P_DEMO',
      package: '$TMP',
    });
  });

  it('refuses to create through push when the object is missing', async () => {
    fail('GET', '/srfc/ZSRFC_DEMO', 'SRFC_OBJECT_NOT_FOUND', 'not found');
    const file = writeLocal('srfc', 'zsrfc_demo', SRFC_LOCAL);
    const res = await run(['push', file, '--yes']);
    expect(res.exitCode).toBe(8);
    expect(parseStderr(res).error.code).toBe('OBJECT_NOT_FOUND');
    expect(icfPost).not.toHaveBeenCalled();
  });
});

describe('abap delete SRFC / OA2P', () => {
  it('deletes a local-package service without a transport request', async () => {
    const res = await run(['delete', 'ZSRFC_DEMO', '--type', 'SRFC', '--yes']);
    expect(res.exitCode).toBeUndefined();
    expect(icfDelete).toHaveBeenCalledWith('/srfc/ZSRFC_DEMO', {});
    expect(parseStdout(res)).toMatchObject({
      data: { object: 'ZSRFC_DEMO', type: 'SRFC', packageName: '$TMP', deleted: true },
    });
  });

  it('requires --tr for a transportable profile and records the deletion', async () => {
    respond('GET', '/oa2p/ZOA2P_DEMO', { ...OA2P_WIRE, package: 'ZPKG_DEV' });
    let res = await run(['delete', 'ZOA2P_DEMO', '--type', 'OA2P', '--yes']);
    expect(res.exitCode).toBe(2);
    expect(parseStderr(res).error.code).toBe('MISSING_TRANSPORT');
    expect(icfDelete).not.toHaveBeenCalled();

    res = await run(['delete', 'ZOA2P_DEMO', '--type', 'OA2P', '--tr', 'NDK900123', '--yes']);
    expect(res.exitCode).toBeUndefined();
    expect(icfDelete).toHaveBeenCalledWith('/oa2p/ZOA2P_DEMO', { transportRequest: 'NDK900123' });
  });

  it('maps a missing object to OBJECT_NOT_FOUND', async () => {
    fail('GET', '/oa2p/ZOA2P_DEMO', 'OA2P_OBJECT_NOT_FOUND', 'not found');
    const res = await run(['delete', 'ZOA2P_DEMO', '--type', 'OA2P', '--yes']);
    expect(res.exitCode).toBe(8);
    expect(parseStderr(res).error.code).toBe('OBJECT_NOT_FOUND');
  });
});

describe('abap create OA2P', () => {
  it('rejects --description (profiles have no description field)', async () => {
    const file = writeLocal('oa2p', 'zoa2p_demo', OA2P_LOCAL);
    const res = await run([
      'create', 'OA2P', 'ZOA2P_DEMO', '--file', file, '--package', '$TMP', '--description', 'nope', '--yes',
    ]);
    expect(res.exitCode).toBe(7);
    expect(parseStderr(res).error.code).toBe('TYPE_NOT_SUPPORTED');
    expect(icfPost).not.toHaveBeenCalled();
  });
});

describe('abap create UCON_HTTP', () => {
  it('posts the ordered handler list through /ucon_http/<name>', async () => {
    const file = writeLocal('ucon_http', 'zhttp_demo', UCON_HTTP_LOCAL);
    const res = await run(['create', 'UCON_HTTP', 'ZHTTP_DEMO', '--file', file, '--package', '$TMP', '--yes']);
    expect(res.exitCode).toBeUndefined();
    expect(icfPost).toHaveBeenCalledWith('/ucon_http/ZHTTP_DEMO', {
      ...UCON_HTTP_LOCAL,
      name: 'ZHTTP_DEMO',
      package: '$TMP',
    });
    expect(parseStdout(res)).toMatchObject({
      status: 'success',
      data: { object: 'ZHTTP_DEMO', type: 'UCON_HTTP', action: 'created', channel: 'icf', package: '$TMP' },
    });
  });

  it('--check-only reports the handler tables and never calls SAP', async () => {
    const file = writeLocal('ucon_http', 'zhttp_demo', UCON_HTTP_LOCAL);
    const res = await run(['create', 'UCON_HTTP', 'ZHTTP_DEMO', '--file', file, '--package', '$TMP', '--check-only', '--yes']);
    expect(res.exitCode).toBeUndefined();
    expect(icfCreate).not.toHaveBeenCalled();
    expect(parseStdout(res)).toMatchObject({
      data: {
        checkOnly: true,
        valid: true,
        plan: { writes: ['TADIR', 'UCONHTTPSERVHEAD/UCONHTTPSERVTEXT/UCONHTTPSERVHANDL'] },
      },
    });
  });

  it('rejects a document without handlers before the SAP call', async () => {
    const file = writeLocal('ucon_http', 'zhttp_demo', { formatVersion: '1', handlers: [] });
    const res = await run(['create', 'UCON_HTTP', 'ZHTTP_DEMO', '--file', file, '--package', '$TMP', '--yes']);
    expect(res.exitCode).toBe(7);
    expect(parseStderr(res).error.code).toBe('AFF_FIXTURE_INVALID');
    expect(icfPost).not.toHaveBeenCalled();
  });

  it('rejects a transportable package without --tr', async () => {
    const file = writeLocal('ucon_http', 'zhttp_demo', UCON_HTTP_LOCAL);
    const res = await run(['create', 'UCON_HTTP', 'ZHTTP_DEMO', '--file', file, '--package', 'ZPKG_DEV', '--yes']);
    expect(res.exitCode).toBe(7);
    expect(parseStderr(res).error.code).toBe('VALIDATION_ERROR');
    expect(icfPost).not.toHaveBeenCalled();
  });

  it('surfaces a missing handler class verbatim', async () => {
    fail('POST', '/ucon_http/ZHTTP_DEMO', 'UCON_HTTP_HANDLER_NOT_FOUND', 'handler class ZCL_NOPE does not exist');
    const file = writeLocal('ucon_http', 'zhttp_demo', UCON_HTTP_LOCAL);
    const res = await run(['create', 'UCON_HTTP', 'ZHTTP_DEMO', '--file', file, '--package', '$TMP', '--yes']);
    expect(res.exitCode).toBe(7);
    expect(parseStderr(res).error).toMatchObject({ code: 'UCON_HTTP_HANDLER_NOT_FOUND' });
  });
});

describe('abap pull UCON_HTTP', () => {
  it('writes the local document without server-owned fields', async () => {
    const res = await run(['pull', 'ZHTTP_DEMO', '--type', 'UCON_HTTP']);
    expect(res.exitCode).toBeUndefined();
    expect(icfGet).toHaveBeenCalledWith('/ucon_http/ZHTTP_DEMO');
    const file = path.join(cwd, 'src', 'zhttp_demo.ucon_http.json');
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(UCON_HTTP_LOCAL);
  });

  it('maps a missing service to OBJECT_NOT_FOUND', async () => {
    fail('GET', '/ucon_http/ZHTTP_DEMO', 'UCON_HTTP_OBJECT_NOT_FOUND', 'not found');
    const res = await run(['pull', 'ZHTTP_DEMO', '--type', 'UCON_HTTP']);
    expect(res.exitCode).toBe(8);
    expect(parseStderr(res).error.code).toBe('OBJECT_NOT_FOUND');
  });

  it('translates a thrown 4xx envelope into OBJECT_NOT_FOUND', async () => {
    // The ICF client throws 4xx envelopes instead of returning status:'error'.
    icfGet.mockRejectedValueOnce(new CliError('UCON_HTTP_OBJECT_NOT_FOUND', 'not found'));
    const res = await run(['pull', 'ZHTTP_DEMO', '--type', 'UCON_HTTP']);
    expect(res.exitCode).toBe(8);
    expect(parseStderr(res).error.code).toBe('OBJECT_NOT_FOUND');
  });
});

describe('abap push UCON_HTTP', () => {
  it('probes the service and sends the package read from the GET payload', async () => {
    const file = writeLocal('ucon_http', 'zhttp_demo', { ...UCON_HTTP_LOCAL, description: 'changed' });
    respond('POST', '/ucon_http/ZHTTP_DEMO', { name: 'ZHTTP_DEMO', type: 'UCON_HTTP', action: 'updated' });
    const res = await run(['push', file, '--yes']);
    expect(res.exitCode).toBeUndefined();
    expect(icfGet).toHaveBeenCalledWith('/ucon_http/ZHTTP_DEMO');
    expect(icfPost).toHaveBeenCalledWith('/ucon_http/ZHTTP_DEMO', {
      ...UCON_HTTP_LOCAL,
      description: 'changed',
      name: 'ZHTTP_DEMO',
      package: '$TMP',
    });
    expect(parseStdout(res)).toMatchObject({ data: { results: [{ status: 'written' }] } });
  });

  it('refuses to create through push when the service is missing', async () => {
    fail('GET', '/ucon_http/ZHTTP_DEMO', 'UCON_HTTP_OBJECT_NOT_FOUND', 'not found');
    const file = writeLocal('ucon_http', 'zhttp_demo', UCON_HTTP_LOCAL);
    const res = await run(['push', file, '--yes']);
    expect(res.exitCode).toBe(8);
    expect(parseStderr(res).error.code).toBe('OBJECT_NOT_FOUND');
    expect(icfPost).not.toHaveBeenCalled();
  });
});

describe('abap delete UCON_HTTP', () => {
  it('deletes a local-package service without a transport request', async () => {
    const res = await run(['delete', 'ZHTTP_DEMO', '--type', 'UCON_HTTP', '--yes']);
    expect(res.exitCode).toBeUndefined();
    expect(icfDelete).toHaveBeenCalledWith('/ucon_http/ZHTTP_DEMO', {});
    expect(parseStdout(res)).toMatchObject({
      data: { object: 'ZHTTP_DEMO', type: 'UCON_HTTP', packageName: '$TMP', deleted: true },
    });
  });

  it('requires --tr for a transportable service and records the deletion', async () => {
    respond('GET', '/ucon_http/ZHTTP_DEMO', { ...UCON_HTTP_WIRE, package: 'ZPKG_DEV' });
    let res = await run(['delete', 'ZHTTP_DEMO', '--type', 'UCON_HTTP', '--yes']);
    expect(res.exitCode).toBe(2);
    expect(parseStderr(res).error.code).toBe('MISSING_TRANSPORT');
    expect(icfDelete).not.toHaveBeenCalled();

    res = await run(['delete', 'ZHTTP_DEMO', '--type', 'UCON_HTTP', '--tr', 'NDK900123', '--yes']);
    expect(res.exitCode).toBeUndefined();
    expect(icfDelete).toHaveBeenCalledWith('/ucon_http/ZHTTP_DEMO', { transportRequest: 'NDK900123' });
  });
});
