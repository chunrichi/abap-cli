import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerStatusCommand } from '../../src/abap_cli/commands/status.js';
import { makeProgram, runCommand } from './cli-helper.js';

const SAP_OBJECTS = [
  { 'adtcore:name': 'ZCL_DEMO', 'adtcore:type': 'CLAS/OC', 'adtcore:uri': '/sap/bc/adt/oo/classes/zcl_demo' },
  { 'adtcore:name': 'ZCL_OK', 'adtcore:type': 'CLAS/OC', 'adtcore:uri': '/sap/bc/adt/oo/classes/zcl_ok' },
  { 'adtcore:name': 'ZREMOTE_ONLY', 'adtcore:type': 'PROG/P', 'adtcore:uri': '/sap/bc/adt/programs/programs/zremote_only' },
];

const searchObject = vi.fn(async (query: string, _type?: string, maxResults = 100) => {
  const q = (query || '').toUpperCase();
  const matches = SAP_OBJECTS.filter((o) => !q || o['adtcore:name'].includes(q) || q.includes(o['adtcore:name']));
  return matches.slice(0, maxResults);
});
const objectStructure = vi.fn(async (objectUrl: string) => ({
  objectUrl,
  includes: [
    { 'class:includeType': 'main', 'abapsource:sourceUri': `${objectUrl}/source/main` },
  ],
}));
const getObjectSource = vi.fn(async (sourceUrl: string) => {
  if (sourceUrl.includes('zcl_demo')) return 'SAP DIFFERENT CONTENT';
  return 'CLASS zcl_ok DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_ok IMPLEMENTATION.\nENDCLASS.\n';
});

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: { create: async () => ({ searchObject, objectStructure, getObjectSource }) },
}));

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'status-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  // ZLOCAL_ONLY exists only locally.
  fs.writeFileSync(path.join(cwd, 'src/zlocal_only.prog.abap'), 'REPORT zlocal_only.\n');
  // ZCL_DEMO diverges from SAP.
  fs.writeFileSync(path.join(cwd, 'src/zcl_demo.clas.abap'), 'CLASS zcl_demo DEFINITION PUBLIC.\nENDCLASS.\n');
  // ZCL_OK matches SAP (unchanged).
  fs.writeFileSync(path.join(cwd, 'src/zcl_ok.clas.abap'), 'CLASS zcl_ok DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_ok IMPLEMENTATION.\nENDCLASS.\n');
});

function parseSuccess(res: { stdout: string }) {
  return JSON.parse(res.stdout).data;
}

describe('abap status changedParts (US4..014)', () => {
  it('reports local-only, divergent, and remote-only parts; omits unchanged', async () => {
    const program = makeProgram();
    registerStatusCommand(program);
    const res = await runCommand(program, ['status', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const data = parseSuccess(res);
    const dirs = data.changedParts.map((p: { direction: string }) => p.direction);
    expect(dirs).toContain('local-only');
    expect(dirs).toContain('divergent');
    expect(dirs).toContain('remote-only');
    expect(dirs).not.toContain('unchanged');
    const byObj = Object.fromEntries(data.changedParts.map((p: { object: string; direction: string }) => [p.object, p.direction]));
    expect(byObj.ZLOCAL_ONLY).toBe('local-only');
    expect(byObj.ZCL_DEMO).toBe('divergent');
    expect(byObj.ZREMOTE_ONLY).toBe('remote-only');
    expect(byObj.ZCL_OK).toBeUndefined();
  });

  it('--remote-only filters to remote-only entries', async () => {
    const program = makeProgram();
    registerStatusCommand(program);
    const res = await runCommand(program, ['status', '--remote-only', '--json'], { cwd });
    const data = parseSuccess(res);
    expect(data.changedParts.every((p: { direction: string }) => p.direction === 'remote-only')).toBe(true);
  });

  it('--local-only filters to local-only entries', async () => {
    const program = makeProgram();
    registerStatusCommand(program);
    const res = await runCommand(program, ['status', '--local-only', '--json'], { cwd });
    const data = parseSuccess(res);
    expect(data.changedParts.every((p: { direction: string }) => p.direction === 'local-only')).toBe(true);
  });

  it('--all includes unchanged entries', async () => {
    const program = makeProgram();
    registerStatusCommand(program);
    const res = await runCommand(program, ['status', '--all', '--json'], { cwd });
    const data = parseSuccess(res);
    const byObj = Object.fromEntries(data.changedParts.map((p: { object: string; direction: string }) => [p.object, p.direction]));
    expect(byObj.ZCL_OK).toBe('unchanged');
  });

  it('empty difference set returns changedParts:[] with exit 0', async () => {
    searchObject.mockImplementation(async () => []);
    // A workspace with no local .abap files and no SAP objects is a true empty diff.
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-empty-'));
    const program = makeProgram();
    registerStatusCommand(program);
    const res = await runCommand(program, ['status', '--json'], { cwd: emptyDir });
    expect(res.exitCode).toBeUndefined();
    const data = parseSuccess(res);
    expect(data.changedParts ?? []).toEqual([]);
  });
});
