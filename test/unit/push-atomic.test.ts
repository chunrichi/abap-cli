import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerPushCommand } from '../../src/abap_cli/commands/push.js';
import { makeProgram, runCommand } from './cli-helper.js';

const lock = vi.fn(async () => ({ LOCK_HANDLE: 'lock-1' }));
const setObjectSource = vi.fn(async () => '');
const syntaxCheck = vi.fn(async () => []);
const activate = vi.fn(async () => '');
const unLock = vi.fn(async () => '');
const searchObject = vi.fn(async (name: string) => [
  { 'adtcore:name': name.toUpperCase(), 'adtcore:type': 'CLAS/OC', 'adtcore:uri': `/sap/bc/adt/oo/classes/${name.toLowerCase()}` },
]);
const objectStructure = vi.fn(async (objectUrl: string) => ({
  objectUrl,
  includes: [{ 'class:includeType': 'main', 'abapsource:sourceUri': `${objectUrl}/source/main` }],
}));
const syntaxCheckContent = vi.fn(async () => []);

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      lock, setObjectSource, syntaxCheck, activate, unLock, searchObject, objectStructure, syntaxCheckContent,
      getConfig: () => ({ sap: { username: 'MOCKUSER' }, transport: 'TRN001' }),
    }),
  },
}));

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'src/zcl_ok.clas.abap'), 'CLASS zcl_ok DEFINITION PUBLIC.\nENDCLASS.\n');
});

describe('abap push --atomic (US8, FR-025, SC-007)', () => {
  it('a file that fails validation writes nothing (zero mutating calls)', async () => {
    // A DDIC-route file with a type outside the 014 supported scope (TTYP)
    // fails structural validation (validateLocalFile → DDIC_NOT_SUPPORTED).
    fs.writeFileSync(path.join(cwd, 'src/zlocal.ttyp.json'), '{"rowType":"ZREF"}');
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zcl_ok.clas.abap', 'src/zlocal.ttyp.json', '--tr', 'TRN001', '--atomic', '--json'], { cwd });
    expect(res.exitCode).not.toBe(0);
    expect(lock).not.toHaveBeenCalled();
    expect(setObjectSource).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it('an all-valid batch is written and activated', async () => {
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zcl_ok.clas.abap', '--tr', 'TRN001', '--atomic', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(lock).toHaveBeenCalled();
    expect(setObjectSource).toHaveBeenCalled();
    expect(activate).toHaveBeenCalled();
  });
});
