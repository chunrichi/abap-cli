/**
 * Phase 4 — DCLS / DDLX / DDLA / SRVD create handlers + requiresFile fail-fast.
 *
 * Regression: docs and SKILL.md marketed these four types as
 * `create: ✅ --file`; the previous dispatcher fell through to the typed
 * `createObject({objtype: 'DCLS/DC'})` path with a wrong objtype (registry
 * didn't list DCLS/DDLX/DDLA as requiresFile). The new handlers register
 * `DCLS/DL` / `DDLX/EX` / `DDLA/ADF` / `SRVD/SRV` against the ADT typed
 * wrapper and refuse to proceed without the companion `.acds` source.
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

const createObject = vi.fn(async () => undefined);
/** searchObject stub: returns [] (no hits) so the real `resolveObject` produces
 *  a CliError('OBJECT_NOT_FOUND') — we don't want to re-implement that error
 *  shape here. */
const searchObject = vi.fn(async () => []);

vi.mock('../../src/abap_cli/config/project-config.js', () => ({
  loadConfig: async () => mockConfig,
  readCaCertificate: () => undefined,
}));

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      createObject,
      searchObject,
      getConfig: () => ({ transport: 'TRN001' }),
    }),
  },
}));

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.systemVersion = '793';
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'create-cds-ext-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  searchObject.mockResolvedValue([]);
});

/** Copy an AFF fixture out of the repo into the temp cwd. */
function copyFixture(dir: string, name: string): string {
  fs.copyFileSync(path.resolve('test/fixtures', dir, name), path.join(cwd, name));
  return name;
}

function run(args: string[]) {
  const program = makeProgram();
  registerCreateCommand(program);
  return runCommand(
    program,
    [...args, '--package', '$TMP', '--description', 'test object', '--yes', '--json'],
    { cwd },
  );
}

describe('create dispatcher — DCLS / DDLX / DDLA / SRVD require --file (USAGE)', () => {
  it.each(['DCLS', 'DDLX', 'DDLA', 'SRVD'])(
    'rejects %s without --file with USAGE (exit 2)',
    async (type) => {
      const res = await run(['create', type, 'ZMY_TEST']);
      expect(res.exitCode).toBe(2);
      const out = JSON.parse(res.stderr);
      expect(out.error.code).toBe('USAGE');
      expect(out.error.message).toMatch(/requires --file/);
      expect(createObject).not.toHaveBeenCalled();
    },
  );
});

describe('create dispatcher — DCLS / DDLX / DDLA / SRVD happy path', () => {
  it.each([
    ['DCLS', 'zmy_dcls.dcls.json', 'DCLS/DL', 'zmy_dcls.dcls.acds'],
    ['DDLX', 'zmy_ddlx.ddlx.json', 'DDLX/EX', 'zmy_ddlx.ddlx.acds'],
    ['DDLA', 'zmy_ddla.ddla.json', 'DDLA/ADF', 'zmy_ddla.ddla.acds'],
    ['SRVD', 'zmy_srvd.srvd.json', 'SRVD/SRV', 'zmy_srvd.srvd.acds'],
  ])('%s routes to ADT typed createObject with the correct objtype', async (type, jsonName, objtype, acdsName) => {
    copyFixture(type.toLowerCase(), jsonName);
    copyFixture(type.toLowerCase(), acdsName);
    const res = await run(['create', type, 'ZMY_TEST', '--file', jsonName]);
    if (res.exitCode !== undefined) {
      console.error('FAILED. stderr:', res.stderr);
    }
    expect(res.exitCode).toBeUndefined();
    expect(createObject).toHaveBeenCalledTimes(1);
    expect(createObject).toHaveBeenCalledWith(
      expect.objectContaining({ objtype, name: 'ZMY_TEST', parentName: '$TMP' }),
    );
    expect(JSON.parse(res.stdout)).toMatchObject({
      status: 'success',
      data: { object: 'ZMY_TEST', type, action: 'created', channel: 'adt' },
    });
  });

  it('rejects DCLS create when the .acds sidecar is missing (VALIDATION_ERROR)', async () => {
    copyFixture('dcls', 'zmy_dcls.dcls.json'); // no acds
    const res = await run(['create', 'DCLS', 'ZMY_DCLS', '--file', 'zmy_dcls.dcls.json']);
    // VALIDATION_ERROR exits with the error's category code (7).
    expect(res.exitCode).toBe(7);
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('VALIDATION_ERROR');
    expect(out.error.message).toMatch(/companion\s+source/);
    expect(createObject).not.toHaveBeenCalled();
  });
});

describe('create dispatcher — BDEF remains pull-only', () => {
  it('rejects BDEF without --file message pointing to schema (registry has no requiresFile)', async () => {
    // BDEF in the registry has no createObjtype and no requiresFile, so it
    // must NOT apply the requiresFile fail-fast. Instead it should fall
    // through to resolveType which rejects unknown source objects.
    const res = await run(['create', 'BDEF', 'ZMY_BDEF', '--description', 'x']);
    expect(res.exitCode).not.toBe(2);
    expect(JSON.parse(res.stderr).error.message).not.toMatch(/requires --file/);
  });
});