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
  { 'adtcore:name': name.toUpperCase(), 'adtcore:type': 'CLAS/OC', 'adtcore:uri': `/sap/bc/adt/oo/classes/${name.toLowerCase()}`, 'adtcore:packageName': 'ZPKG' },
]);
const objectStructure = vi.fn(async (objectUrl: string) => ({
  objectUrl,
  includes: [{ 'class:includeType': 'main', 'abapsource:sourceUri': `${objectUrl}/source/main` }],
}));
const syntaxCheckContent = vi.fn(async () => []);
const transportInfo = vi.fn(async () => ({ TRANSPORTS: [] }));

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      lock, setObjectSource, syntaxCheck, activate, unLock, searchObject, objectStructure, syntaxCheckContent, transportInfo,
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

describe('abap push --atomic ()', () => {
  it('a file that fails validation writes nothing (zero mutating calls)', async () => {
    // A DDIC-route file with an unregistered type (UNKN) hits the legacy
    // extension fallback (`.json` → `icf`), then validateLocalFile rejects
    // it with DDIC_NOT_SUPPORTED. 037 changed TTYP/MSAG/DDLS to ADT routing
    // so we use a deliberately unregistered type code that keeps the
    // icf-route branch alive.
    fs.writeFileSync(path.join(cwd, 'src/zlocal.unkn.json'), '{"any":"payload"}');
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zcl_ok.clas.abap', 'src/zlocal.unkn.json', '--tr', 'TRN001', '--atomic', '--yes', '--json'], { cwd });
    expect(res.exitCode).not.toBe(0);
    expect(lock).not.toHaveBeenCalled();
    expect(setObjectSource).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it('an all-valid batch is written and activated', async () => {
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zcl_ok.clas.abap', '--tr', 'TRN001', '--atomic', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(lock).toHaveBeenCalled();
    expect(setObjectSource).toHaveBeenCalled();
    expect(activate).toHaveBeenCalled();
  });
});
