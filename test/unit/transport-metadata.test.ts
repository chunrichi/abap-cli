import { describe, expect, it, vi, beforeEach } from 'vitest';
import { registerTransportCommand } from '../../src/abap_cli/commands/transport.js';
import { makeProgram, runCommand } from './cli-helper.js';
import { CliError } from '../../src/abap_cli/output/json.js';

const transportDetails = vi.fn(async (number: string) => {
  if (number !== 'NDK123456') {
    throw new CliError('SAP_ERROR', `HTTP 404`, { details: { httpStatus: 404 } });
  }
  return {
    'tm:number': 'NDK123456',
    'tm:owner': 'MOCKUSER',
    'tm:desc': 'Mock request 1',
    'tm:status': 'D',
    'tm:uri': '/sap/bc/adt/cts/transportrequests/NDK123456',
    objects: [
      { 'tm:name': 'ZCL_DEMO', 'tm:type': 'CLAS/OC', 'tm:obj_info': 'Active' },
      { 'tm:name': 'ZPROG', 'tm:type': 'PROG/P', 'tm:obj_info': 'Active' },
    ],
  };
});

const transportInfo = vi.fn(async () => ({
  TRANSPORTS: [{ TRKORR: 'NDK123456', TRSTATUS: 'D', AS4USER: 'MOCKUSER', AS4TEXT: 'Mock request 1' }],
  LOCKS: undefined,
}));

const searchObject = vi.fn(async (name: string) => [
  { 'adtcore:name': name.toUpperCase(), 'adtcore:type': 'CLAS/OC', 'adtcore:uri': `/sap/bc/adt/oo/classes/${name.toLowerCase()}` },
]);
const objectStructure = vi.fn(async (objectUrl: string) => ({
  objectUrl,
  includes: [{ 'class:includeType': 'main', 'abapsource:sourceUri': `${objectUrl}/source/main` }],
}));
const lock = vi.fn(async () => ({ LOCK_HANDLE: 'lock-1' }));
const unLock = vi.fn(async () => '');
const getObjectSource = vi.fn(async () => 'CLASS zcl_demo DEFINITION PUBLIC.\nENDCLASS.\n');
const setObjectSource = vi.fn(async () => '');
const createTransport = vi.fn(async () => 'NDK999999');

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({ transportDetails, transportInfo, searchObject, objectStructure, lock, unLock, getObjectSource, setObjectSource, createTransport, getConfig: () => ({ sap: { username: 'MOCKUSER' }, transport: 'NDK123456' }) }),
  },
}));

function parseData(res: { stdout: string }) {
  return JSON.parse(res.stdout).data;
}

describe('abap transport metadata (US5, FR-015..017, SC-006)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('show returns structured metadata with objects', async () => {
    const program = makeProgram();
    registerTransportCommand(program);
    const res = await runCommand(program, ['transport', 'show', 'NDK123456', '--json']);
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    expect(data.number).toBe('NDK123456');
    expect(data.description).toBe('Mock request 1');
    expect(data.status).toBe('D');
    expect(data.owner).toBe('MOCKUSER');
    expect(data.objects).toHaveLength(2);
    expect(data.objects[0]).toMatchObject({ name: 'ZCL_DEMO', type: 'CLAS/OC' });
  });

  it('show with an unknown request returns NOT_FOUND with nextSteps', async () => {
    const program = makeProgram();
    registerTransportCommand(program);
    const res = await runCommand(program, ['transport', 'show', 'Z_NOPE', '--json']);
    expect(res.exitCode).toBe(8);
    const json = JSON.parse(res.stderr);
    expect(json.error.code).toBe('NOT_FOUND');
    expect(Array.isArray(json.error.nextSteps)).toBe(true);
  });

  it('resolve returns the object\'s current transports', async () => {
    const program = makeProgram();
    registerTransportCommand(program);
    const res = await runCommand(program, ['transport', 'resolve', 'ZCL_DEMO', '--json']);
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    expect(data.object).toBe('ZCL_DEMO');
    expect(data.transports[0]).toMatchObject({ number: 'NDK123456' });
  });

  it('assign attaches the object and reports a no-op on the second call', async () => {
    const program = makeProgram();
    registerTransportCommand(program);
    // First assign: object not yet on the transport → assigned: true.
    transportInfo.mockResolvedValueOnce({ TRANSPORTS: [], LOCKS: undefined });
    const res1 = await runCommand(program, ['transport', 'assign', 'ZCL_DEMO', '--tr', 'NDK123456', '--yes', '--json']);
    expect(res1.exitCode).toBeUndefined();
    expect(parseData(res1).assigned).toBe(true);
    expect(lock).toHaveBeenCalled();
    expect(unLock).toHaveBeenCalled();

    // Second assign: already on the transport → assigned: false (no-op).
    const res2 = await runCommand(program, ['transport', 'assign', 'ZCL_DEMO', '--tr', 'NDK123456', '--yes', '--json']);
    expect(res2.exitCode).toBeUndefined();
    expect(parseData(res2).assigned).toBe(false);
  });
});

describe('abap transport write protection (P0.3)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('create without --yes in non-TTY mode rejects with VALIDATION_ERROR', async () => {
    const program = makeProgram();
    registerTransportCommand(program);
    const res = await runCommand(program, ['transport', 'create', 'Demo request', '--json']);
    expect(res.exitCode).toBe(7);
    const json = JSON.parse(res.stderr);
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.message).toMatch(/--yes|--dry-run/);
    expect(Array.isArray(json.error.nextSteps)).toBe(true);
  });

  it('create with --dry-run skips the SAP call and reports dry-run=true', async () => {
    const program = makeProgram();
    registerTransportCommand(program);
    const res = await runCommand(program, ['transport', 'create', 'Demo request', '--package', 'ztmp', '--dry-run', '--json']);
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    expect(data.dryRun).toBe(true);
    expect(data.transport).toBeNull();
    expect(data.package).toBe('ZTMP');
    expect(data.ref).toBe('/sap/bc/adt/packages/ZTMP');
    // No SAP call should happen in dry-run.
    expect(setObjectSource).not.toHaveBeenCalled();
  });

  it('create with --yes overrides the non-TTY guard and creates the transport', async () => {
    const program = makeProgram();
    registerTransportCommand(program);
    const res = await runCommand(program, ['transport', 'create', 'Demo request', '--yes', '--json']);
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    expect(data.transport).toBe('NDK999999');
    expect(data.dryRun).toBeUndefined();
    expect(createTransport).toHaveBeenCalledOnce();
    expect(createTransport.mock.calls[0][1]).toBe('Demo request');
  });

  it('assign without --yes/--dry-run in non-TTY mode rejects with VALIDATION_ERROR', async () => {
    const program = makeProgram();
    registerTransportCommand(program);
    const res = await runCommand(program, ['transport', 'assign', 'ZCL_DEMO', '--tr', 'NDK123456', '--json']);
    expect(res.exitCode).toBe(7);
    const json = JSON.parse(res.stderr);
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(lock).not.toHaveBeenCalled();
    expect(setObjectSource).not.toHaveBeenCalled();
  });

  it('assign with --dry-run reports the plan without mutating SAP calls', async () => {
    const program = makeProgram();
    registerTransportCommand(program);
    const res = await runCommand(program, ['transport', 'assign', 'ZCL_DEMO', '--tr', 'NDK123456', '--dry-run', '--json']);
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    expect(data.dryRun).toBe(true);
    expect(data.transport).toBe('NDK123456');
    expect(lock).not.toHaveBeenCalled();
    expect(setObjectSource).not.toHaveBeenCalled();
  });

  it('assign with --tr before --yes still works (option order independence)', async () => {
    const program = makeProgram();
    registerTransportCommand(program);
    transportInfo.mockResolvedValueOnce({ TRANSPORTS: [], LOCKS: undefined });
    const res = await runCommand(program, ['transport', 'assign', '--tr', 'NDK123456', 'ZCL_DEMO', '--yes', '--json']);
    expect(res.exitCode).toBeUndefined();
    expect(parseData(res).assigned).toBe(true);
  });
});
