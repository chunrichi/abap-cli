/**
 * Push transport resolution is now per-object (resolveObjectTransport):
 * - an object already assigned to a request reuses it (no --tr required)
 * - --tr matching the binding is fine; a DIFFERENT --tr is rejected
 * - $TMP objects are transport-free (no request needed)
 * - otherwise: --tr > config > user's open request > NO_TRANSPORT
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerPushCommand } from '../../src/abap_cli/commands/push.js';
import { makeProgram, runCommand } from './cli-helper.js';

const lock = vi.fn(async () => ({ LOCK_HANDLE: 'lock-1' }));
const setObjectSource = vi.fn(async () => '');
const activate = vi.fn(async () => '');
const unLock = vi.fn(async () => '');
const syntaxCheckContent = vi.fn(async () => []);
const searchObject = vi.fn();
const objectStructure = vi.fn();
const transportInfo = vi.fn();
const userTransports = vi.fn();
const getConfig = vi.fn();

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      lock, setObjectSource, activate, unLock, searchObject, objectStructure, transportInfo, userTransports,
      syntaxCheck: vi.fn(async () => []),
      syntaxCheckContent,
      getConfig,
    }),
  },
}));

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'push-tr-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'src/zcl_tr.clas.abap'), 'CLASS zcl_tr DEFINITION PUBLIC.\nENDCLASS.\n');
  // Default: a CLAS object in package ZPKG with no binding and no user transports.
  searchObject.mockResolvedValue([
    { 'adtcore:name': 'ZCL_TR', 'adtcore:type': 'CLAS/OC', 'adtcore:uri': '/sap/bc/adt/oo/classes/zcl_tr', 'adtcore:packageName': 'ZPKG' },
  ]);
  objectStructure.mockResolvedValue({
    objectUrl: '/sap/bc/adt/oo/classes/zcl_tr',
    includes: [{ 'class:includeType': 'main', 'abapsource:sourceUri': '/sap/bc/adt/oo/classes/zcl_tr/source/main' }],
  });
  transportInfo.mockResolvedValue({ TRANSPORTS: [] });
  userTransports.mockResolvedValue({ workbench: [], customizing: [] });
  getConfig.mockReturnValue({ sap: { username: 'MOCKUSER' }, transport: '' });
});

describe('abap push per-object transport resolution', () => {
  it('reuses the object-bound request without --tr', async () => {
    transportInfo.mockResolvedValue({ TRANSPORTS: [{ TRKORR: 'BND123456', TRSTATUS: 'D' }] });
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zcl_tr.clas.abap', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(setObjectSource).toHaveBeenCalledWith(
      '/sap/bc/adt/oo/classes/zcl_tr/source/main',
      expect.any(String),
      'lock-1',
      'BND123456',
    );
    const out = JSON.parse(res.stdout);
    expect(out.data.results[0].transport).toBe('BND123456');
  });

  it('accepts --tr matching the object-bound request', async () => {
    transportInfo.mockResolvedValue({ TRANSPORTS: [{ TRKORR: 'BND123456', TRSTATUS: 'D' }] });
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zcl_tr.clas.abap', '--tr', 'BND123456', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(setObjectSource).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'lock-1', 'BND123456');
  });

  it('rejects --tr that differs from the object-bound request', async () => {
    transportInfo.mockResolvedValue({ TRANSPORTS: [{ TRKORR: 'BND123456', TRSTATUS: 'D' }] });
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zcl_tr.clas.abap', '--tr', 'OTHER001', '--yes', '--json'], { cwd });
    expect(res.exitCode).not.toBe(0);
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('VALIDATION_ERROR');
    expect(out.error.details.results[0].code).toBe('VALIDATION_ERROR');
    expect(lock).not.toHaveBeenCalled();
    expect(setObjectSource).not.toHaveBeenCalled();
  });

  it('pushes a $TMP object with no transport and no --tr', async () => {
    // Object is in $TMP (transport-free); no --tr, no config, no open request.
    searchObject.mockResolvedValue([
      { 'adtcore:name': 'ZCL_TR', 'adtcore:type': 'CLAS/OC', 'adtcore:uri': '/sap/bc/adt/oo/classes/zcl_tr', 'adtcore:packageName': '$TMP' },
    ]);
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zcl_tr.clas.abap', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(setObjectSource).toHaveBeenCalledWith(
      '/sap/bc/adt/oo/classes/zcl_tr/source/main',
      expect.any(String),
      'lock-1',
      '',
    );
    expect(activate).toHaveBeenCalled();
    const out = JSON.parse(res.stdout);
    expect(out.data.results[0].transport).toBe('');
  });

  it('falls back to the first modifiable user request when unbound', async () => {
    userTransports.mockResolvedValue({
      workbench: [{ modifiable: [{ 'tm:number': 'OPEN0001' }] }],
      customizing: [],
    });
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zcl_tr.clas.abap', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(setObjectSource).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'lock-1', 'OPEN0001');
  });

  it('still raises NO_TRANSPORT when nothing is available', async () => {
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zcl_tr.clas.abap', '--yes', '--json'], { cwd });
    expect(res.exitCode).not.toBe(0);
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('NO_TRANSPORT');
    expect(lock).not.toHaveBeenCalled();
  });

  it('uses --tr for an unbound non-$TMP object', async () => {
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zcl_tr.clas.abap', '--tr', 'EXPL0001', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(setObjectSource).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'lock-1', 'EXPL0001');
  });

  it('LOCK_FAILED surfaces nextSteps and LOCKED category when the object is locked', async () => {
    lock.mockRejectedValueOnce(new Error('Object ZCL_TR is locked by user OTHER'));
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zcl_tr.clas.abap', '--tr', 'EXPL0001', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBe(9);
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('LOCK_FAILED');
    expect(out.error.category).toBe('LOCKED');
    expect(out.error.details.results[0].nextSteps).toEqual(
      expect.arrayContaining([expect.stringContaining('abap inspect ZCL_TR --locks')]),
    );
    expect(lock).toHaveBeenCalledWith('/sap/bc/adt/oo/classes/zcl_tr');
    expect(setObjectSource).not.toHaveBeenCalled();
  });

  it('a named include the object lacks fails instead of silently writing to main', async () => {
    // Object structure only has a `main` include; pushing a `.macros.abap` file
    // must NOT fall back to main — it should fail without writing anything.
    fs.writeFileSync(path.join(cwd, 'src/zcl_tr.clas.macros.abap'), 'DEFINE macro_x.\nEND-OF-DEFINITION.\n');
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zcl_tr.clas.macros.abap', '--tr', 'EXPL0001', '--yes', '--json'], { cwd });
    expect(res.exitCode).not.toBe(0);
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('SAP_ERROR');
    expect(out.error.details.results[0].code).toBe('SAP_ERROR');
    expect(out.error.details.results[0].message).toContain('macros');
    expect(lock).not.toHaveBeenCalled();
    expect(setObjectSource).not.toHaveBeenCalled();
  });

  it('a matching named include is written to its own part', async () => {
    // Object exposes main + macros; the .macros.abap file goes to the macros part.
    objectStructure.mockResolvedValue({
      objectUrl: '/sap/bc/adt/oo/classes/zcl_tr',
      includes: [
        { 'class:includeType': 'main', 'abapsource:sourceUri': '/sap/bc/adt/oo/classes/zcl_tr/source/main' },
        { 'class:includeType': 'macros', 'abapsource:sourceUri': '/sap/bc/adt/oo/classes/zcl_tr/source/macros' },
      ],
    });
    fs.writeFileSync(path.join(cwd, 'src/zcl_tr.clas.macros.abap'), 'DEFINE macro_x.\nEND-OF-DEFINITION.\n');
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zcl_tr.clas.macros.abap', '--tr', 'EXPL0001', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(setObjectSource).toHaveBeenCalledWith(
      '/sap/bc/adt/oo/classes/zcl_tr/source/macros',
      expect.stringContaining('macro_x'),
      'lock-1',
      'EXPL0001',
    );
  });
});
