import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerCreateCommand } from '../../src/abap_cli/commands/create.js';
import { makeProgram, runCommand } from './cli-helper.js';

// Stateful mock: an object "exists" only after createObject has been called.
const createdNames = new Set<string>();
const createObject = vi.fn(async (opts: { name: string }) => {
  createdNames.add(opts.name.toUpperCase());
});
const searchObject = vi.fn(async (name: string) => {
  const upper = name.toUpperCase();
  return createdNames.has(upper)
    ? [{ 'adtcore:name': upper, 'adtcore:type': 'CLAS/OC', 'adtcore:uri': `/sap/bc/adt/oo/classes/${name.toLowerCase()}` }]
    : [];
});
const objectStructure = vi.fn(async (objectUrl: string) => ({
  objectUrl,
  includes: [{ 'class:includeType': 'main', 'abapsource:sourceUri': `${objectUrl}/source/main` }],
}));
const getObjectSource = vi.fn(async (_url: string) => 'CLASS zcl_tmpl DEFINITION PUBLIC.\nENDCLASS.\n');
const lock = vi.fn(async () => ({ LOCK_HANDLE: 'lock-1' }));
const setObjectSource = vi.fn(async () => '');
const syntaxCheck = vi.fn(async () => []);
const activate = vi.fn(async () => '');
const unLock = vi.fn(async () => '');
const validateNewObject = vi.fn(async () => ({ SEVERITY: 'INFO', SHORT_TEXT: 'OK', success: true }));

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      createObject, searchObject, objectStructure, getObjectSource, lock, setObjectSource, syntaxCheck, activate, unLock,
      validateNewObject, getConfig: () => ({ sap: { username: 'MOCKUSER' }, transport: 'TRN001' }),
    }),
  },
}));

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  createdNames.clear();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'create-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
});

function parseData(res: { stdout: string }) {
  return JSON.parse(res.stdout).data;
}

describe('abap create options (US7, FR-021..023, SC-008)', () => {
  it('--check-only validates without creating (zero create calls)', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'CLAS', 'ZCL_CHK', '--package', 'ZPKG', '--description', 'T', '--check-only', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(createObject).not.toHaveBeenCalled();
    expect(validateNewObject).toHaveBeenCalled();
    const data = parseData(res);
    expect(data.checkOnly).toBe(true);
  });

  it('--template generates the registry skeleton and reports the template name', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'CLAS', 'ZCL_TMPL', '--package', 'ZPKG', '--description', 'T', '--template', 'public-method', '--no-pull', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    expect(data.template).toBe('public-method');
    expect(data.object).toBe('ZCL_TMPL');
    const written = setObjectSource.mock.calls[0]?.[1] as string;
    expect(written).toContain('METHODS hello');
  });

  it('--no-pull skips the pull-back (no localFile)', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'CLAS', 'ZCL_NOPULL', '--package', 'ZPKG', '--description', 'T', '--no-pull', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    expect(data.localFile).toBeUndefined();
    expect(fs.existsSync(path.join(cwd, 'src/zcl_nopull/zcl_nopull.clas.abap'))).toBe(false);
  });

  it('default create writes the local file (create-then-pull)', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', 'CLAS', 'ZCL_PULL', '--package', 'ZPKG', '--description', 'T', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    expect(data.localFile).toMatch(/zcl_pull\/zcl_pull\.clas\.abap$/);
    expect(fs.existsSync(path.join(cwd, 'src/zcl_pull/zcl_pull.clas.abap'))).toBe(true);
  });
});
