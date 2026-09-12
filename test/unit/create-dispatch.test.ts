/**
 * Phase 3 — `runCreate` dispatcher coverage.
 *
 * The per-type create flows are exercised elsewhere (`http-create.test.ts`,
 * `create-fugr-func.test.ts`, `create-name-validation.test.ts`). What was NOT
 * covered is the registry dispatch layer itself: `createHandlerFor` lookup,
 * the data-driven `requiresFile` fail-fast, and the fact that TTYP / MSAG /
 * DDLS reach their handlers through the CLI. These tests drive the real
 * `abap create` command against mocked ADT / ICF clients.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { registerCreateCommand } from '../../src/abap_cli/commands/create.js';
import { makeProgram, runCommand } from './cli-helper.js';

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { systemVersion: '793' } as { systemVersion?: string },
}));

const createTtyp = vi.fn(async () => {});
const createMsag = vi.fn(async () => {});
const createDdls = vi.fn(async () => {});
const icfPost = vi.fn(async () => ({ status: 'success' as const, data: {}, error: null }));

vi.mock('../../src/abap_cli/config/project-config.js', () => ({
  loadConfig: async () => mockConfig,
  readCaCertificate: () => undefined,
}));

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      createTtyp,
      createMsag,
      createDdls,
      getConfig: () => ({ transport: 'TRN001' }),
    }),
  },
}));

vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: {
    create: async () => ({ post: icfPost, get: vi.fn(), postHttp: vi.fn(), getHttp: vi.fn(), postTran: vi.fn() }),
  },
}));

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.systemVersion = '793';
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'create-dispatch-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
});

/** Copy an AFF fixture out of the repo into the temp cwd. */
function copyFixture(rel: string): string {
  fs.copyFileSync(path.resolve('test/fixtures', rel), path.join(cwd, path.basename(rel)));
  return path.basename(rel);
}

function run(args: string[]) {
  const program = makeProgram();
  registerCreateCommand(program);
  // --description keeps the run past the pre-dispatch USAGE checks so each
  // test exercises the requiresFile gate (or the handler), not arg parsing.
  return runCommand(program, [...args, '--package', '$TMP', '--description', 'test object', '--yes', '--json'], { cwd });
}

describe('create dispatcher — handler registry routing', () => {
  it('TTYP routes to the ADT handler on a modern kernel', async () => {
    const file = copyFixture('ttyp/zmy_ttyp.ttyp.json');
    const res = await run(['create', 'TTYP', 'ZMY_TTYP', '--file', file]);
    expect(res.exitCode).toBeUndefined();
    expect(createTtyp).toHaveBeenCalledWith('ZMY_TTYP', expect.any(String), '$TMP', undefined);
    expect(JSON.parse(res.stdout)).toMatchObject({
      status: 'success',
      data: { object: 'ZMY_TTYP', type: 'TTYP', action: 'created', channel: 'adt' },
    });
  });

  it('TTYP falls back to the ICF handler on an ECC EHP6 kernel', async () => {
    mockConfig.systemVersion = '731';
    const file = copyFixture('ttyp/zmy_ttyp.ttyp.json');
    const res = await run(['create', 'TTYP', 'ZMY_TTYP', '--file', file]);
    expect(res.exitCode).toBeUndefined();
    expect(createTtyp).not.toHaveBeenCalled();
    expect(icfPost).toHaveBeenCalledWith(
      '/ddic/ttyp/ZMY_TTYP',
      expect.objectContaining({ main: expect.any(Object) }),
    );
    expect(JSON.parse(res.stdout)).toMatchObject({
      data: { object: 'ZMY_TTYP', type: 'TTYP', action: 'created', channel: 'icf' },
    });
  });

  it('MSAG routes through its registered handler', async () => {
    const file = copyFixture('msag/zmy_msag.msag.json');
    const res = await run(['create', 'MSAG', 'ZMY_MSAG', '--file', file]);
    expect(res.exitCode).toBeUndefined();
    expect(createMsag).toHaveBeenCalledTimes(1);
    expect(JSON.parse(res.stdout)).toMatchObject({
      data: { object: 'ZMY_MSAG', type: 'MSAG', action: 'created', channel: 'adt' },
    });
  });

  it('DDLS routes through its handler (ADT only, needs the .acds companion)', async () => {
    const file = copyFixture('ddls/zmy_ddls.ddls.json');
    copyFixture('ddls/zmy_ddls.ddls.acds');
    const res = await run(['create', 'DDLS', 'ZMY_DDLS', '--file', file]);
    expect(res.exitCode).toBeUndefined();
    expect(createDdls).toHaveBeenCalledTimes(1);
    expect(JSON.parse(res.stdout)).toMatchObject({
      data: { object: 'ZMY_DDLS', type: 'DDLS', action: 'created', channel: 'adt' },
    });
  });
});

describe('create dispatcher — requiresFile fail-fast', () => {
  it.each(['TTYP', 'MSAG', 'DDLS', 'TABL', 'HTTP', 'TRAN'])(
    'rejects %s without --file with USAGE (exit 2)',
    async (type) => {
      const res = await run(['create', type, 'ZMY_TEST']);
      expect(res.exitCode).toBe(2);
      const out = JSON.parse(res.stderr);
      expect(out.error.code).toBe('USAGE');
      expect(out.error.message).toMatch(/requires --file/);
    },
  );

  it('accepts a source-object type without --file (no registry handler)', async () => {
    // CLAS has no create handler: the dispatcher must NOT apply the
    // requiresFile gate, and instead falls through to the ADT source path.
    const res = await run(['create', 'CLAS', 'ZCL_MISSING', '--description', 'x']);
    // We only assert we got past the USAGE/--file gate: the ADT mock has no
    // createObject, so the failure is a downstream SAP/ADT error, not USAGE.
    expect(res.exitCode).not.toBe(2);
    expect(JSON.parse(res.stderr).error.message).not.toMatch(/requires --file/);
  });
});
