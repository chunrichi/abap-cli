import { describe, expect, it, vi, beforeEach } from 'vitest';
import { registerInspectCommand } from '../../src/abap_cli/commands/inspect.js';
import { makeProgram, runCommand } from './cli-helper.js';
import { CliError } from '../../src/abap_cli/output/json.js';

const searchObject = vi.fn(async (name: string) => {
  const n = name.toUpperCase();
  if (n === 'ZNOPE') return [];
  return [
    {
      'adtcore:name': n,
      'adtcore:type': 'CLAS/OC',
      'adtcore:uri': `/sap/bc/adt/oo/classes/${n.toLowerCase()}`,
      'adtcore:description': 'Demo class',
      'adtcore:packageName': 'ZPKG',
    },
  ];
});
const objectStructure = vi.fn(async () => ({
  objectUrl: '/sap/bc/adt/oo/classes/zcl_multi',
  metaData: {
    'adtcore:name': 'ZCL_MULTI',
    'adtcore:type': 'CLAS/OC',
    'adtcore:description': 'Class with multiple includes',
    'adtcore:changedAt': 1720000000000,
    'adtcore:changedBy': 'MOCKUSER',
    'adtcore:responsible': 'MOCKUSER',
  },
  includes: [
    { 'class:includeType': 'main', 'abapsource:sourceUri': '/sap/bc/adt/oo/classes/zcl_multi/source/main' },
    { 'class:includeType': 'definitions', 'abapsource:sourceUri': '/sap/bc/adt/oo/classes/zcl_multi/source/locals_def' },
    { 'class:includeType': 'implementations', 'abapsource:sourceUri': '/sap/bc/adt/oo/classes/zcl_multi/source/locals_imp' },
  ],
}));
const objectStructureElements = vi.fn(async () => [
  { name: 'RUN', type: 'method', visibility: 'public', children: [] },
]);
const transportInfo = vi.fn(async () => ({
  TRANSPORTS: [{ TRKORR: 'NDK123456', TRSTATUS: 'D', AS4USER: 'MOCKUSER', AS4TEXT: 'Mock request 1' }],
  LOCKS: undefined,
}));
const lock = vi.fn();

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      searchObject,
      objectStructure,
      objectStructureElements,
      transportInfo,
      lock,
    }),
  },
}));

function parseData(res: { stdout: string }) {
  return JSON.parse(res.stdout).data;
}

describe('abap inspect (US3, FR-011..014, SC-004)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('metadata always present (object/type/uri) — no flags → concise default (FR-011/FR-012)', async () => {
    const program = makeProgram();
    registerInspectCommand(program);
    const res = await runCommand(program, ['inspect', 'ZCL_MULTI', '--json']);
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    expect(data.metadata.object).toBe('ZCL_MULTI');
    expect(data.metadata.type).toBe('CLAS/OC');
    expect(data.metadata.uri).toBe('/sap/bc/adt/oo/classes/zcl_multi');
    expect(data.structure).toBeUndefined();
    expect(data.includes).toBeUndefined();
    expect(data.locks).toBeUndefined();
  });

  it('--structure adds structure elements (FR-012)', async () => {
    const program = makeProgram();
    registerInspectCommand(program);
    const res = await runCommand(program, ['inspect', 'ZCL_MULTI', '--structure', '--json']);
    const data = parseData(res);
    expect(data.structure).toHaveLength(1);
    expect(data.structure[0]).toMatchObject({ name: 'RUN', type: 'method' });
    expect(objectStructureElements).toHaveBeenCalled();
  });

  it('--includes lists main + locals_def + locals_imp with sourceUri (FR-012)', async () => {
    const program = makeProgram();
    registerInspectCommand(program);
    const res = await runCommand(program, ['inspect', 'ZCL_MULTI', '--includes', '--json']);
    const data = parseData(res);
    expect(data.includes).toHaveLength(3);
    expect(data.includes.map((i: { includeType: string }) => i.includeType).sort()).toEqual(['definitions', 'implementations', 'main']);
    expect(data.includes[0].sourceUri).toContain('/source/main');
  });

  it('--locks returns transport ownership (FR-012)', async () => {
    const program = makeProgram();
    registerInspectCommand(program);
    const res = await runCommand(program, ['inspect', 'ZCL_MULTI', '--locks', '--json']);
    const data = parseData(res);
    expect(data.locks).toHaveLength(1);
    expect(data.locks[0]).toMatchObject({ transport: 'NDK123456', status: 'D' });
    expect(transportInfo).toHaveBeenCalled();
  });

  it('--package returns packageName (FR-012)', async () => {
    const program = makeProgram();
    registerInspectCommand(program);
    const res = await runCommand(program, ['inspect', 'ZCL_MULTI', '--package', '--json']);
    const data = parseData(res);
    expect(data.metadata.packageName).toBe('ZPKG');
  });

  it('unknown object → OBJECT_NOT_FOUND exit 8 with nextSteps (FR-013)', async () => {
    const program = makeProgram();
    registerInspectCommand(program);
    const res = await runCommand(program, ['inspect', 'ZNOPE', '--json']);
    expect(res.exitCode).toBe(8);
    const parsed = JSON.parse(res.stderr);
    expect(parsed.status).toBe('error');
    expect(parsed.error.code).toBe('OBJECT_NOT_FOUND');
  });

  it('read-only — never calls lock() (FR-014)', async () => {
    const program = makeProgram();
    registerInspectCommand(program);
    await runCommand(program, ['inspect', 'ZCL_MULTI', '--structure', '--includes', '--locks', '--package', '--json']);
    expect(lock).not.toHaveBeenCalled();
  });

  it('missing object arg → USAGE error (FR-011)', async () => {
    const program = makeProgram();
    registerInspectCommand(program);
    const res = await runCommand(program, ['inspect', '--json']);
    expect(res.exitCode).toBe(2);
    const parsed = JSON.parse(res.stderr);
    expect(parsed.error.code).toBe('USAGE');
  });
});
