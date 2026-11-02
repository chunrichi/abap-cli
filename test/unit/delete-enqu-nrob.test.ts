/**
 * ENQU / NROB delete through the bundled ICF service.
 *
 * Both types have no ADT delete endpoint; the CLI dispatches to
 * `/ddic/enqu` and `/ddic/nrob`. These tests pin the dispatch, the
 * not-found/transportable error mapping and the name guards.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { registerDeleteCommand } from '../../src/abap_cli/commands/delete.js';
import { makeProgram, runCommand } from './cli-helper.js';

const icfDeleteDdic = vi.fn(async () => ({
  status: 'success' as const,
  data: { name: 'ZCLI_TC_OBJ', type: 'ENQU', action: 'deleted' },
  error: null,
}));

vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: {
    create: async () => ({
      getDdic: vi.fn(),
      deleteDdic: icfDeleteDdic,
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
  icfDeleteDdic.mockResolvedValue({
    status: 'success' as const,
    data: { name: 'ZCLI_TC_OBJ', type: 'ENQU', action: 'deleted' },
    error: null,
  });
});

describe('delete ENQU', () => {
  it('deletes through ICF without an ADT probe', async () => {
    const res = await run(['delete', 'ZCLI_TC_ENQU', '--type', 'ENQU']);
    expect(res.exitCode).toBeUndefined();
    expect(icfDeleteDdic).toHaveBeenCalledWith('enqu', 'ZCLI_TC_ENQU');
    expect(JSON.parse(res.stdout).data).toMatchObject({
      object: 'ZCLI_TC_ENQU',
      type: 'ENQU',
      deleted: true,
    });
  });

  it('maps DDIC_OBJECT_NOT_FOUND to OBJECT_NOT_FOUND (exit 8)', async () => {
    icfDeleteDdic.mockResolvedValueOnce({
      status: 'error' as const,
      data: null,
      error: { code: 'DDIC_OBJECT_NOT_FOUND', message: 'ENQU ZCLI_TC_ENQU not found' },
    });
    const res = await run(['delete', 'ZCLI_TC_ENQU', '--type', 'ENQU']);
    expect(res.exitCode).toBe(8);
    expect(JSON.parse(res.stderr).error.code).toBe('OBJECT_NOT_FOUND');
  });

  it('surfaces the transportable-object rejection', async () => {
    icfDeleteDdic.mockResolvedValueOnce({
      status: 'error' as const,
      data: null,
      error: { code: 'ENQU_DELETE_UNSUPPORTED', message: 'ENQU ZCLI_TC_ENQU is in non-local package ZPKG' },
    });
    const res = await run(['delete', 'ZCLI_TC_ENQU', '--type', 'ENQU']);
    expect(res.exitCode).toBe(7);
    expect(JSON.parse(res.stderr).error.code).toBe('ENQU_DELETE_UNSUPPORTED');
  });

  it('rejects a name longer than 16 characters before calling SAP', async () => {
    const res = await run(['delete', 'ZCLI_TC_ENQU_TOO_LONG', '--type', 'ENQU']);
    expect(res.exitCode).toBe(7);
    expect(JSON.parse(res.stderr).error.code).toBe('ENQU_NAME_INVALID');
    expect(icfDeleteDdic).not.toHaveBeenCalled();
  });
});

describe('delete NROB', () => {
  it('deletes through ICF without an ADT probe', async () => {
    icfDeleteDdic.mockResolvedValueOnce({
      status: 'success' as const,
      data: { name: 'ZCLI_TC_NROB', type: 'NROB', action: 'deleted' },
      error: null,
    });
    const res = await run(['delete', 'ZCLI_TC_NROB', '--type', 'NROB']);
    expect(res.exitCode).toBeUndefined();
    expect(icfDeleteDdic).toHaveBeenCalledWith('nrob', 'ZCLI_TC_NROB');
    expect(JSON.parse(res.stdout).data).toMatchObject({ object: 'ZCLI_TC_NROB', type: 'NROB', deleted: true });
  });

  it('maps a transported NROB to NROB_DELETE_UNSUPPORTED (exit 7)', async () => {
    icfDeleteDdic.mockResolvedValueOnce({
      status: 'error' as const,
      data: null,
      error: { code: 'NROB_DELETE_UNSUPPORTED', message: 'NROB ZCLI_TC_NROB is in non-local package ZPKG' },
    });
    const res = await run(['delete', 'ZCLI_TC_NROB', '--type', 'NROB']);
    expect(res.exitCode).toBe(7);
    expect(JSON.parse(res.stderr).error.code).toBe('NROB_DELETE_UNSUPPORTED');
  });
});
