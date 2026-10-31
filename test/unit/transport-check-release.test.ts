import { describe, expect, it, vi, beforeEach } from 'vitest';
import { registerTransportCommand } from '../../src/abap_cli/commands/transport.js';
import { makeProgram, runCommand } from './cli-helper.js';
import { CliError } from '../../src/abap_cli/output/json.js';

const transportInfo = vi.fn(async () => ({
  RECORDING: 'X',
  KORRFLAG: '',
  MESSAGES: [],
  TRANSPORTS: [{ TRKORR: 'DEVK900001', TRSTATUS: 'D', AS4USER: 'MOCKUSER', AS4TEXT: 'Demo request' }],
}));

const transportRelease = vi.fn(async () => [
  {
    'chkrun:reporter': 'ZCL_DEMO',
    'chkrun:status': 'released',
    'chkrun:statusText': 'Object released',
    messages: [],
  },
]);

const searchObject = vi.fn(async (name: string) => [
  {
    'adtcore:name': name.replace(/\*/g, '').toUpperCase(),
    'adtcore:type': 'CLAS/OC',
    'adtcore:uri': `/sap/bc/adt/oo/classes/${name.replace(/\*/g, '').toLowerCase()}`,
  },
]);

const objectStructure = vi.fn(async (objectUrl: string) => ({
  objectUrl,
  includes: [{ 'class:includeType': 'main', 'abapsource:sourceUri': `${objectUrl}/source/main` }],
}));

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({ transportInfo, transportRelease, searchObject, objectStructure }),
  },
}));

function parseData(res: { stdout: string }) {
  return JSON.parse(res.stdout).data;
}

function parseError(res: { stderr: string }) {
  return JSON.parse(res.stderr).error;
}

describe('abap transport check', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports the recording flag and candidate transports', async () => {
    const program = makeProgram();
    registerTransportCommand(program);
    const res = await runCommand(program, ['transport', 'check', 'ZCL_DEMO', '--json']);
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    expect(data.object).toBe('ZCL_DEMO');
    expect(data.ok).toBe(true);
    expect(data.recording).toBe('X');
    expect(data.transports).toHaveLength(1);
    expect(data.transports[0]).toMatchObject({ number: 'DEVK900001', status: 'D', owner: 'MOCKUSER' });
    expect(transportInfo).toHaveBeenCalled();
  });

  it('turns a blocking SAP error into ok:false with the message', async () => {
    transportInfo.mockRejectedValueOnce(new CliError('SAP_ERROR', 'Object is locked by user OTHER'));
    const program = makeProgram();
    registerTransportCommand(program);
    const res = await runCommand(program, ['transport', 'check', 'ZCL_DEMO', '--json']);
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    expect(data.ok).toBe(false);
    expect(data.messages[0].text).toMatch(/locked by user OTHER/);
    // `stripEmpty` drops the empty transports array; ok/messages carry the result.
    expect(data.transports).toBeUndefined();
  });

  it('rejects a missing object argument with USAGE (not a silent success)', async () => {
    const program = makeProgram();
    registerTransportCommand(program);
    const res = await runCommand(program, ['transport', 'check', '--json']);
    expect(res.exitCode).toBe(2);
    expect(parseError(res).code).toBe('USAGE');
  });

  it('declares its own machine contract via --schema', async () => {
    const program = makeProgram();
    registerTransportCommand(program);
    const res = await runCommand(program, ['transport', 'check', '--schema', '--json']);
    expect(res.exitCode).toBeUndefined();
    const schema = JSON.parse(res.stdout).data;
    expect(schema.command).toBe('transport check');
    expect(schema.arguments[0]).toMatchObject({ name: 'object', required: true });
    expect(schema.options.map((o: { name: string }) => o.name)).toContain('--package');
  });
});

describe('abap transport release', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires --yes (or --dry-run) in non-interactive mode', async () => {
    const program = makeProgram();
    registerTransportCommand(program);
    const res = await runCommand(program, ['transport', 'release', 'DEVK900001', '--json']);
    expect(res.exitCode).toBe(7);
    expect(parseError(res).code).toBe('VALIDATION_ERROR');
    expect(transportRelease).not.toHaveBeenCalled();
  });

  it('--dry-run plans without calling SAP', async () => {
    const program = makeProgram();
    registerTransportCommand(program);
    const res = await runCommand(program, ['transport', 'release', 'DEVK900001', '--dry-run', '--json']);
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    expect(data.dryRun).toBe(true);
    expect(data.transport).toBe('DEVK900001');
    expect(transportRelease).not.toHaveBeenCalled();
  });

  it('maps a successful release report', async () => {
    const program = makeProgram();
    registerTransportCommand(program);
    const res = await runCommand(program, ['transport', 'release', 'DEVK900001', '--yes', '--json']);
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    expect(data.released).toBe(true);
    expect(data.reports[0]).toMatchObject({ reporter: 'ZCL_DEMO', status: 'released' });
  });

  it('turns abortrelapifail into a structured SAP_ERROR', async () => {
    transportRelease.mockResolvedValueOnce([
      {
        'chkrun:reporter': 'ZCL_DEMO',
        'chkrun:status': 'abortrelapifail',
        'chkrun:statusText': 'Release failed',
        messages: [{ 'chkrun:type': 'E', 'chkrun:shortText': 'Object inactive' }],
      },
    ]);
    const program = makeProgram();
    registerTransportCommand(program);
    const res = await runCommand(program, ['transport', 'release', 'DEVK900001', '--yes', '--json']);
    expect(res.exitCode).toBe(6);
    const error = parseError(res);
    expect(error.code).toBe('SAP_ERROR');
    expect(error.details.reports[0].status).toBe('abortrelapifail');
    expect(error.details.reports[0].messages[0].text).toBe('Object inactive');
  });

  it('passes --ignore-locks / --ignore-atc through to the library call', async () => {
    const program = makeProgram();
    registerTransportCommand(program);
    const res = await runCommand(program, [
      'transport',
      'release',
      'DEVK900001',
      '--ignore-locks',
      '--ignore-atc',
      '--yes',
      '--json',
    ]);
    expect(res.exitCode).toBeUndefined();
    expect(transportRelease).toHaveBeenCalledWith('DEVK900001', true, true);
  });

  it('rejects a missing transport argument with USAGE', async () => {
    const program = makeProgram();
    registerTransportCommand(program);
    const res = await runCommand(program, ['transport', 'release', '--yes', '--json']);
    expect(res.exitCode).toBe(2);
    expect(parseError(res).code).toBe('USAGE');
  });
});
