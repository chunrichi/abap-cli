import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerSyncCommand } from '../../src/abap_cli/commands/sync.js';
import { makeProgram, runCommand } from './cli-helper.js';
import { CliError } from '../../src/abap_cli/output/json.js';

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
  includes: [{ 'class:includeType': 'main', 'abapsource:sourceUri': `${objectUrl}/source/main` }],
}));
const getObjectSource = vi.fn(async (sourceUrl: string) => {
  if (sourceUrl.includes('zcl_demo')) return 'SAP DIFFERENT CONTENT\n';
  return 'CLASS zcl_ok DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_ok IMPLEMENTATION.\nENDCLASS.\n';
});
// Push-side mocks (lock/write/activate/unlock) — counted to prove zero mutating
// calls under --dry-run and conflict refusal.
const lock = vi.fn(async () => ({ LOCK_HANDLE: 'lock-1' }));
const unLock = vi.fn(async () => '');
const setObjectSource = vi.fn(async () => '');
const activate = vi.fn(async () => '');
const syntaxCheckContent = vi.fn(async () => []);

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      searchObject,
      objectStructure,
      getObjectSource,
      lock,
      unLock,
      setObjectSource,
      activate,
      syntaxCheckContent,
    }),
  },
}));

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  // ZLOCAL_ONLY: local-only.
  fs.writeFileSync(path.join(cwd, 'src/zlocal_only.prog.abap'), 'REPORT zlocal_only.\n');
  // ZCL_DEMO: divergent (SAP has different content).
  fs.writeFileSync(path.join(cwd, 'src/zcl_demo.clas.abap'), 'LOCAL CONTENT A\nLOCAL CONTENT B\n');
  // ZCL_OK: unchanged.
  fs.writeFileSync(
    path.join(cwd, 'src/zcl_ok.clas.abap'),
    'CLASS zcl_ok DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_ok IMPLEMENTATION.\nENDCLASS.\n',
  );
});

function parseData(res: { stdout: string }) {
  return JSON.parse(res.stdout).data;
}

describe('abap sync (US5, FR-018..021, SC-006)', () => {
  it('--status reports detected directions (FR-018)', async () => {
    const program = makeProgram();
    registerSyncCommand(program);
    const res = await runCommand(program, ['sync', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    expect(data.direction).toBe('status');
    const dirs = data.parts.map((p: { direction: string }) => p.direction);
    expect(dirs).toContain('local-only');
    expect(dirs).toContain('remote-only');
    expect(dirs).toContain('divergent');
  });

  it('--dry-run → dryRun true, actionable parts planned, zero mutating calls (FR-019, SC-006)', async () => {
    const program = makeProgram();
    registerSyncCommand(program);
    const res = await runCommand(program, ['sync', '--pull', '--dry-run', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    expect(data.dryRun).toBe(true);
    const actionable = data.parts.filter((p: { action: string; status: string }) => p.action === 'pull' && p.status === 'planned');
    expect(actionable.length).toBeGreaterThan(0);
    for (const p of actionable) {
      expect(p.status).toBe('planned');
    }
    // Zero mutating calls.
    expect(lock).not.toHaveBeenCalled();
    expect(setObjectSource).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it('--push over divergent without --yes → conflict + fail fast exit 7, nothing written (FR-021, SC-006)', async () => {
    const program = makeProgram();
    registerSyncCommand(program);
    const res = await runCommand(program, ['sync', '--push', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    const parsed = JSON.parse(res.stderr);
    expect(parsed.status).toBe('error');
    expect(parsed.error.code).toBe('VALIDATION_ERROR');
    expect(parsed.error.nextSteps.some((s: string) => s.includes('--yes'))).toBe(true);
    // No mutating calls.
    expect(lock).not.toHaveBeenCalled();
    expect(setObjectSource).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it('--push with --yes over divergent → confirms and pushes, mutating calls happen (FR-020/FR-021)', async () => {
    // Keep only the divergent part (ZCL_DEMO exists on SAP, so pushObject works);
    // local-only parts require create (out of sync's push scope) — remove them.
    fs.rmSync(path.join(cwd, 'src/zlocal_only.prog.abap'));
    const program = makeProgram();
    registerSyncCommand(program);
    const res = await runCommand(program, ['sync', '--push', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    const demo = data.parts.find((p: { object: string }) => p.object === 'ZCL_DEMO');
    expect(demo.status).toBe('done');
    // Mutating calls happened for the confirmed divergent push.
    expect(lock).toHaveBeenCalled();
    expect(setObjectSource).toHaveBeenCalled();
  });

  it('--pull --push together → INVALID_ARGUMENT exit 2 (FR-018)', async () => {
    const program = makeProgram();
    registerSyncCommand(program);
    const res = await runCommand(program, ['sync', '--pull', '--push', '--json'], { cwd });
    expect(res.exitCode).toBe(2);
    const parsed = JSON.parse(res.stderr);
    expect(parsed.error.code).toBe('INVALID_ARGUMENT');
  });

  it('--pull --dry-run plans pulls (FR-019)', async () => {
    const program = makeProgram();
    registerSyncCommand(program);
    const res = await runCommand(program, ['sync', '--pull', '--dry-run', '--json'], { cwd });
    const data = parseData(res);
    expect(data.direction).toBe('pull');
    expect(data.dryRun).toBe(true);
  });
});
