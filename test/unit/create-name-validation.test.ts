/**
 * F-8: `abap create` validates the object-name length/chars locally (zero SAP
 * round-trip) instead of reporting a misleading OBJECT_NOT_FOUND after the
 * oversized name has been dialled into SAP. Validation mirrors the DDIC
 * client-side name validation (VALIDATION_ERROR / exit 7) and deliberately
 * does NOT enforce a Z/Y prefix ($TMP accepts e.g. A123).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerCreateCommand } from '../../src/abap_cli/commands/create.js';
import { makeProgram, runCommand } from './cli-helper.js';

const createObject = vi.fn(async () => undefined);
const searchObject = vi.fn(async () => [] as any[]);
const validateNewObject = vi.fn(async () => ({ success: true, SHORT_TEXT: 'OK' }));
const icfPostDdic = vi.fn(async () => undefined);

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      createObject: (...args: unknown[]) => createObject(...args),
      searchObject: (...args: unknown[]) => searchObject(...args),
      validateNewObject: (...args: unknown[]) => validateNewObject(...args),
      getConfig: () => ({ sap: { username: 'MOCKUSER' }, transport: 'TRN001' }),
    }),
  },
}));

vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: {
    create: async () => ({ postDdic: (...args: unknown[]) => icfPostDdic(...args) }),
  },
}));

// Exact repro from the real-SAP finding (31 chars > the 30-char SAP cap).
const TOO_LONG = 'ZCLI_TC_TOOLONGNAME_1234567890X';
const NAMESPACED_TOO_LONG = `/UI2/${'A'.repeat(28)}`; // 33 chars total > 30

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'create-name-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
});

function parseError(res: { stderr: string }) {
  return JSON.parse(res.stderr).error;
}

function runCreateArgs(type: string, name: string, extra: string[] = []) {
  return ['create', type, name, '--package', '$TMP', '--description', 'T', '--yes', '--json', ...extra];
}

describe('abap create name validation (fail-fast, zero SAP round-trip)', () => {
  it('RED/regression: a >30-char source-object name fails locally with VALIDATION_ERROR (exit 7)', async () => {
    expect(TOO_LONG.length).toBeGreaterThan(30);
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, runCreateArgs('CLAS', TOO_LONG), { cwd });
    expect(res.exitCode).toBe(7);
    const err = parseError(res);
    expect(err.code).toBe('VALIDATION_ERROR');
    // Pure local — no client/search/create round-trip happened.
    expect(searchObject).not.toHaveBeenCalled();
    expect(createObject).not.toHaveBeenCalled();
  });

  it('the same name is rejected on the --check-only path before validateNewObject', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, runCreateArgs('CLAS', TOO_LONG, ['--check-only']), { cwd });
    expect(res.exitCode).toBe(7);
    expect(parseError(res).code).toBe('VALIDATION_ERROR');
    expect(validateNewObject).not.toHaveBeenCalled();
  });

  it('rejects names with illegal characters (space, dash) locally', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    for (const bad of ['ZCL FOO', 'ZCL-FOO']) {
      const res = await runCommand(program, runCreateArgs('CLAS', bad), { cwd });
      expect(res.exitCode, `name ${bad}`).toBe(7);
      expect(parseError(res).code, `name ${bad}`).toBe('VALIDATION_ERROR');
      expect(createObject, `name ${bad}`).not.toHaveBeenCalled();
    }
  });

  it('rejects a whitespace-only name', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, runCreateArgs('CLAS', '   '), { cwd });
    expect(res.exitCode).toBe(7);
    expect(parseError(res).code).toBe('VALIDATION_ERROR');
  });

  it('rejects malformed or oversized namespaced names', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    for (const bad of ['/UI2', NAMESPACED_TOO_LONG]) {
      const res = await runCommand(program, runCreateArgs('CLAS', bad), { cwd });
      expect(res.exitCode, `name ${bad}`).toBe(7);
      expect(parseError(res).code, `name ${bad}`).toBe('VALIDATION_ERROR');
    }
  });

  it('accepts legal names ZCL_FOO / A123 / /UI2/CL_JSON and uppercases lowercase input', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    for (const [input, expected] of [['ZCL_FOO', 'ZCL_FOO'], ['A123', 'A123'], ['/UI2/CL_JSON', '/UI2/CL_JSON'], ['zcl_foo', 'ZCL_FOO']] as const) {
      const res = await runCommand(program, runCreateArgs('CLAS', input, ['--check-only']), { cwd });
      expect(res.exitCode, `name ${input}`).toBeUndefined();
      const data = JSON.parse(res.stdout).data;
      expect(data.object, `name ${input}`).toBe(expected);
      expect(data.checkOnly).toBe(true);
    }
    expect(createObject).not.toHaveBeenCalled();
  });

  it('DDIC create: a too-long positional name fails before the --file / ICF round-trip', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    // --file points at a non-existent path: reaching the file read would yield
    // INVALID_ARGUMENT; VALIDATION_ERROR proves the local name check ran first.
    const res = await runCommand(program,
      ['create', 'TABL', TOO_LONG, '--file', 'src/nope.tabl.json', '--package', '$TMP', '--yes', '--json'],
      { cwd });
    expect(res.exitCode).toBe(7);
    expect(parseError(res).code).toBe('VALIDATION_ERROR');
    expect(icfPostDdic).not.toHaveBeenCalled();
  });

  it('create local validates the name too — no draft file is written', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'local', 'CLAS', TOO_LONG, '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    expect(parseError(res).code).toBe('VALIDATION_ERROR');
    expect(fs.existsSync(path.join(cwd, 'src/clas', TOO_LONG.toLowerCase(), `${TOO_LONG.toLowerCase()}.clas.abap`))).toBe(false);
  });

  it('create local accepts a namespaced name (maps to # dir on disk)', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'local', 'CLAS', '/UI2/CL_JSON', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(JSON.parse(res.stdout).data.file).toBe('src/clas/#ui2#cl_json/#ui2#cl_json.clas.abap');
    expect(fs.existsSync(path.join(cwd, 'src/clas/#ui2#cl_json/#ui2#cl_json.clas.abap'))).toBe(true);
  });
});
