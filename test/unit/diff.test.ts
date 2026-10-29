import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerDiffCommand } from '../../src/abap_cli/commands/diff.js';
import { lineDiffSummary } from '../../src/abap_cli/flows/search/diff.js';
import { makeProgram, runCommand } from './cli-helper.js';

const SAP_OBJECTS = [
  { 'adtcore:name': 'ZCL_DEMO', 'adtcore:type': 'CLAS/OC', 'adtcore:uri': '/sap/bc/adt/oo/classes/zcl_demo' },
  { 'adtcore:name': 'ZCL_OK', 'adtcore:type': 'CLAS/OC', 'adtcore:uri': '/sap/bc/adt/oo/classes/zcl_ok' },
  { 'adtcore:name': 'ZREMOTE_ONLY', 'adtcore:type': 'PROG/P', 'adtcore:uri': '/sap/bc/adt/programs/programs/zremote_only' },
];

async function defaultSearchObject(query: string, _type?: string, maxResults = 100) {
  const q = (query || '').toUpperCase();
  const matches = SAP_OBJECTS.filter((o) => !q || o['adtcore:name'].includes(q) || q.includes(o['adtcore:name']));
  return matches.slice(0, maxResults);
}
const searchObject = vi.fn(defaultSearchObject);
const objectStructure = vi.fn(async (objectUrl: string) => ({
  objectUrl,
  includes: [{ 'class:includeType': 'main', 'abapsource:sourceUri': `${objectUrl}/source/main` }],
}));
const getObjectSource = vi.fn(async (sourceUrl: string) => {
  if (sourceUrl.includes('zcl_demo')) return 'SAP DIFFERENT CONTENT\nLINE 2\nLINE 3\n';
  return 'CLASS zcl_ok DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_ok IMPLEMENTATION.\nENDCLASS.\n';
});

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: { create: async () => ({ searchObject, objectStructure, getObjectSource }) },
}));

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  // ZLOCAL_ONLY exists only locally (local-only direction).
  fs.writeFileSync(path.join(cwd, 'src/zlocal_only.prog.abap'), 'REPORT zlocal_only.\n');
  // ZCL_DEMO exists on both sides with different content (divergent).
  fs.writeFileSync(
    path.join(cwd, 'src/zcl_demo.clas.abap'),
    'LOCAL LINE 1\nLOCAL LINE 2\nLOCAL LINE 3\nLOCAL LINE 4\nLOCAL LINE 5\n',
  );
  // ZCL_OK exists on both sides with identical content (unchanged).
  fs.writeFileSync(
    path.join(cwd, 'src/zcl_ok.clas.abap'),
    'CLASS zcl_ok DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_ok IMPLEMENTATION.\nENDCLASS.\n',
  );
});

function parseData(res: { stdout: string }) {
  return JSON.parse(res.stdout).data;
}

describe('abap diff (US4..017)', () => {
  it('diff <file> divergent → correct direction + bounded summary', async () => {
    const program = makeProgram();
    registerDiffCommand(program);
    const res = await runCommand(program, ['diff', 'src/zcl_demo.clas.abap', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    const part = data.parts.find((p: { object: string }) => p.object === 'ZCL_DEMO');
    expect(part.direction).toBe('divergent');
    expect(part.summary).toBeDefined();
    expect(part.summary.added).toBeGreaterThan(0);
    expect(Array.isArray(part.summary.changedLines)).toBe(true);
  });

  it('diff <file> local-only → all added', async () => {
    const program = makeProgram();
    registerDiffCommand(program);
    const res = await runCommand(program, ['diff', 'src/zlocal_only.prog.abap', '--json'], { cwd });
    const data = parseData(res);
    const part = data.parts.find((p: { object: string }) => p.object === 'ZLOCAL_ONLY');
    expect(part.direction).toBe('local-only');
    expect(part.summary.added).toBeGreaterThan(0);
    expect(part.summary.removed).toBe(0);
  });

  it('diff --all includes unchanged parts with empty summary', async () => {
    const program = makeProgram();
    registerDiffCommand(program);
    const res = await runCommand(program, ['diff', '--all', '--json'], { cwd });
    const data = parseData(res);
    const unchanged = data.parts.find((p: { object: string }) => p.object === 'ZCL_OK');
    expect(unchanged.direction).toBe('unchanged');
  });

  it('diff --remote scopes to remote-only differences', async () => {
    const program = makeProgram();
    registerDiffCommand(program);
    const res = await runCommand(program, ['diff', '--remote', '--json'], { cwd });
    const data = parseData(res);
    expect(data.parts.length).toBeGreaterThan(0);
    for (const p of data.parts) {
      expect(p.direction).toBe('remote-only');
    }
  });

  it('no differences → parts: [] exit 0 ()', async () => {
    // Fresh workspace with only an identical object; SAP side has ONLY that object
    // too (override the search mock), so nothing differs.
    searchObject.mockImplementation(async () => [SAP_OBJECTS[1]!]); // ZCL_OK only
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-empty-'));
    fs.mkdirSync(path.join(empty, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(empty, 'src/zcl_ok.clas.abap'),
      'CLASS zcl_ok DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_ok IMPLEMENTATION.\nENDCLASS.\n',
    );
    const program = makeProgram();
    registerDiffCommand(program);
    const res = await runCommand(program, ['diff', '--json'], { cwd: empty });
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    expect((data.parts ?? []).length).toBe(0);
  });

  it('read-only — zero mutating calls ()', async () => {
    const program = makeProgram();
    registerDiffCommand(program);
    await runCommand(program, ['diff', '--all', '--json'], { cwd });
    // Only search + structure + getObjectSource are allowed (all GET/read).
    expect(searchObject).toHaveBeenCalled();
    expect(objectStructure).toHaveBeenCalled();
    expect(getObjectSource).toHaveBeenCalled();
  });

  it('diff --all tolerates stray unparseable files (no FILE_PARSE_ERROR crash)', async () => {
    // Stray files not following <name>.<type>.abap|xml used to crash whole-workspace scans.
    fs.writeFileSync(path.join(cwd, 'discovery.xml'), '<xml/>');
    fs.writeFileSync(path.join(cwd, 'source.abap'), 'REPORT zstray.');
    const program = makeProgram();
    registerDiffCommand(program);
    const res = await runCommand(program, ['diff', '--all', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    const unchanged = data.parts.find((p: { object: string }) => p.object === 'ZCL_OK');
    expect(unchanged.direction).toBe('unchanged');
  });

  it('lineDiffSummary: CRLF remote vs LF local identical content → 0/0', () => {
    const local = 'LINE 1\nLINE 2\nLINE 3\n';
    const remote = 'LINE 1\r\nLINE 2\r\nLINE 3\r\n';
    expect(lineDiffSummary(local, remote)).toEqual({ added: 0, removed: 0, changedLines: [] });
  });

  it('lineDiffSummary: one genuinely added LF line vs CRLF remote → only that line', () => {
    const local = 'LINE 1\nLINE 2\nLINE 3\nLINE 4 ADDED\n';
    const remote = 'LINE 1\r\nLINE 2\r\nLINE 3\r\n';
    expect(lineDiffSummary(local, remote)).toEqual({ added: 1, removed: 0, changedLines: [4] });
  });

  it('diff <file> CRLF local vs LF remote identical content → unchanged', async () => {
    // Restore the default search (a prior test may have overridden it).
    searchObject.mockImplementation(defaultSearchObject);
    // Same lines as the remote ZCL_OK source (LF), but stored locally as CRLF.
    fs.writeFileSync(
      path.join(cwd, 'src/zcl_ok.clas.abap'),
      'CLASS zcl_ok DEFINITION PUBLIC.\r\nENDCLASS.\r\nCLASS zcl_ok IMPLEMENTATION.\r\nENDCLASS.\r\n',
    );
    const program = makeProgram();
    registerDiffCommand(program);
    const res = await runCommand(program, ['diff', 'src/zcl_ok.clas.abap', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    const part = data.parts.find((p: { object: string }) => p.object === 'ZCL_OK');
    expect(part.direction).toBe('unchanged');
  });
});
