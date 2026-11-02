/**
 * HTTP (SICF node) delete through the bundled ICF service.
 *
 * SICF nodes are not ADT objects, so the CLI dispatches straight to
 * `DELETE /http/<name>` without an ADT resolve/lock cycle. These tests pin the
 * dispatch, the local-name guard and the not-found / has-children /
 * transportable / authorization error mapping.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { registerDeleteCommand } from '../../src/abap_cli/commands/delete.js';
import { makeProgram, runCommand } from './cli-helper.js';

const icfDeleteHttp = vi.fn(async () => ({
  status: 'success' as const,
  data: { name: 'ZCLI_TC_HTTP', type: 'HTTP', action: 'deleted' },
  error: null,
}));

vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: {
    create: async () => ({
      getHttp: vi.fn(),
      deleteHttp: icfDeleteHttp,
    }),
  },
}));

function run(args: string[]) {
  const program = makeProgram();
  registerDeleteCommand(program);
  return runCommand(program, [...args, '--yes', '--json'], { cwd: process.cwd() });
}

beforeEach(() => {
  vi.clearAllMocks();
  icfDeleteHttp.mockResolvedValue({
    status: 'success' as const,
    data: { name: 'ZCLI_TC_HTTP', type: 'HTTP', action: 'deleted' },
    error: null,
  });
});

describe('delete HTTP', () => {
  it('deletes through ICF without an ADT probe', async () => {
    const res = await run(['delete', 'ZCLI_TC_HTTP', '--type', 'HTTP']);
    expect(res.exitCode).toBeUndefined();
    expect(icfDeleteHttp).toHaveBeenCalledWith('ZCLI_TC_HTTP');
    expect(JSON.parse(res.stdout).data).toMatchObject({
      object: 'ZCLI_TC_HTTP',
      type: 'HTTP',
      deleted: true,
    });
  });

  it('accepts a /-prefixed SICF path', async () => {
    icfDeleteHttp.mockResolvedValueOnce({
      status: 'success' as const,
      data: { name: 'zcli_tc_http', type: 'HTTP', action: 'deleted' },
      error: null,
    });
    const res = await run(['delete', '/sap/zcli_tc_http', '--type', 'HTTP']);
    expect(res.exitCode).toBeUndefined();
    expect(icfDeleteHttp).toHaveBeenCalledWith('/sap/zcli_tc_http');
    expect(JSON.parse(res.stdout).data.object).toBe('zcli_tc_http');
  });

  it('maps HTTP_OBJECT_NOT_FOUND to OBJECT_NOT_FOUND (exit 8)', async () => {
    icfDeleteHttp.mockResolvedValueOnce({
      status: 'error' as const,
      data: null,
      error: { code: 'HTTP_OBJECT_NOT_FOUND', message: 'SICF service not found: /sap/zcli_tc_http' },
    });
    const res = await run(['delete', 'ZCLI_TC_HTTP', '--type', 'HTTP']);
    expect(res.exitCode).toBe(8);
    expect(JSON.parse(res.stderr).error.code).toBe('OBJECT_NOT_FOUND');
  });

  it('surfaces a transportable-node rejection (exit 7)', async () => {
    icfDeleteHttp.mockResolvedValueOnce({
      status: 'error' as const,
      data: null,
      error: { code: 'HTTP_DELETE_UNSUPPORTED', message: 'ZCLI_TC_HTTP is in package ZPKG' },
    });
    const res = await run(['delete', 'ZCLI_TC_HTTP', '--type', 'HTTP']);
    expect(res.exitCode).toBe(7);
    expect(JSON.parse(res.stderr).error.code).toBe('HTTP_DELETE_UNSUPPORTED');
  });

  it('surfaces the has-children rejection (exit 7)', async () => {
    icfDeleteHttp.mockResolvedValueOnce({
      status: 'error' as const,
      data: null,
      error: { code: 'HTTP_SERVICE_HAS_CHILDREN', message: 'child nodes exist' },
    });
    const res = await run(['delete', 'ZCLI_TC_HTTP', '--type', 'HTTP']);
    expect(res.exitCode).toBe(7);
    expect(JSON.parse(res.stderr).error.code).toBe('HTTP_SERVICE_HAS_CHILDREN');
  });

  it('surfaces the authorization rejection (exit 5)', async () => {
    icfDeleteHttp.mockResolvedValueOnce({
      status: 'error' as const,
      data: null,
      error: { code: 'HTTP_SERVICE_NOT_AUTHORIZED', message: 'not authorized' },
    });
    const res = await run(['delete', 'ZCLI_TC_HTTP', '--type', 'HTTP']);
    expect(res.exitCode).toBe(5);
    expect(JSON.parse(res.stderr).error.code).toBe('HTTP_SERVICE_NOT_AUTHORIZED');
  });

  it('falls back to HTTP_DELETE_FAILED when the ICF error carries no code', async () => {
    icfDeleteHttp.mockResolvedValueOnce({
      status: 'error' as const,
      data: null,
      error: null,
    });
    const res = await run(['delete', 'ZCLI_TC_HTTP', '--type', 'HTTP']);
    expect(res.exitCode).toBe(6);
    expect(JSON.parse(res.stderr).error.code).toBe('HTTP_DELETE_FAILED');
  });

  it('rejects a bare node name longer than 15 characters before calling SAP', async () => {
    const res = await run(['delete', 'ZCLI_TC_HTTP_TOO_LONG', '--type', 'HTTP']);
    expect(res.exitCode).toBe(7);
    expect(JSON.parse(res.stderr).error.code).toBe('HTTP_SERVICE_INVALID');
    expect(icfDeleteHttp).not.toHaveBeenCalled();
  });
});
