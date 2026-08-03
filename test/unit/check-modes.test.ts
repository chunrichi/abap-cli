import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerCheckCommand } from '../../src/abap_cli/commands/check.js';
import { makeProgram, runCommand } from './cli-helper.js';

// Deterministic validator mirroring test/mock-adt/server.js.
function issuesFor(content: string) {
  const issues: { line: number; offset: number; severity: string; text: string }[] = [];
  content.split('\n').forEach((line, i) => {
    if (/(^|[^a-z0-9_])syntax_error([^a-z0-9_]|$)/i.test(line)) {
      issues.push({ line: i + 1, offset: 1, severity: 'E', text: 'Unknown identifier "syntax_error"' });
    } else if (/(^|[^a-z0-9_])syntax_warning([^a-z0-9_]|$)/i.test(line)) {
      issues.push({ line: i + 1, offset: 1, severity: 'W', text: 'Suspicious statement' });
    }
  });
  return issues;
}

const searchObject = vi.fn(async (name: string) => [
  { 'adtcore:name': name.toUpperCase(), 'adtcore:type': 'CLAS/OC', 'adtcore:uri': `/sap/bc/adt/oo/classes/${name.toLowerCase()}` },
]);
const objectStructure = vi.fn(async (objectUrl: string) => ({
  objectUrl,
  // Far-future changedAt so `check --changed` sees an empty change set.
  'adtcore:changedAt': '2999-01-01T00:00:00Z',
  includes: [
    {
      'class:includeType': 'main',
      'abapsource:sourceUri': `${objectUrl}/source/main`,
    },
  ],
}));
const syntaxCheckContent = vi.fn(async (_url: string, _mainUrl: string, content: string) => issuesFor(content));
const atcCheckVariant = vi.fn(async (variant: string) => variant);
const createAtcRun = vi.fn(async (_variant: string, _mainUrl: string) => ({ id: 'RUN001', timestamp: 1722650000, infos: [] }));
const atcWorklists = vi.fn(async () => ({
  id: 'WL001',
  timestamp: 1722650000,
  usedObjectSet: 'Z_ATC_VAR',
  objectSetIsComplete: true,
  objectSets: [],
  objects: [
    {
      uri: '/sap/bc/adt/oo/classes/zcl_ok',
      type: 'CLAS/OC',
      name: 'ZCL_OK',
      packageName: '$TMP',
      author: 'MOCKUSER',
      findings: [
        {
          uri: '/sap/bc/adt/atc/findings/1',
          location: { uri: '/sap/bc/adt/oo/classes/zcl_ok/source/main', range: { start: { line: 3, column: 1 }, end: { line: 3, column: 10 } } },
          priority: 2,
          checkId: 'check_style',
          checkTitle: 'Style check',
          messageId: 'MSG001',
          messageTitle: 'Method is too long',
          exemptionApproval: '',
          exemptionKind: '',
          link: { href: '/x', rel: 'self', type: 'application/xml' },
        },
      ],
    },
  ],
}));

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      searchObject,
      objectStructure,
      syntaxCheckContent,
      atcCheckVariant,
      createAtcRun,
      atcWorklists,
    }),
  },
}));

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chkmode-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'src/zcl_ok.clas.abap'), 'CLASS zcl_ok DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_ok IMPLEMENTATION.\nENDCLASS.\n');
  fs.writeFileSync(path.join(cwd, 'src/zcl_bad.clas.abap'), 'CLASS zcl_bad DEFINITION PUBLIC.\n  DATA bad TYPE syntax_error.\nENDCLASS.\n');
  fs.writeFileSync(path.join(cwd, 'src/zcl_warn.clas.abap'), 'CLASS zcl_warn DEFINITION PUBLIC.\n  DATA x TYPE syntax_warning.\nENDCLASS.\n');
});

function parseError(res: { stdout: string; stderr: string; exitCode?: number }) {
  return { json: JSON.parse(res.stderr), exitCode: res.exitCode };
}

describe('abap check modes (US2, FR-006..009, FR-011)', () => {
  it('--syntax (default) emits unified issues/failure shape for a bad file', async () => {
    const program = makeProgram();
    registerCheckCommand(program);
    const res = await runCommand(program, ['check', 'src/zcl_bad.clas.abap', '--json'], { cwd });
    const { json, exitCode } = parseError(res);
    expect(exitCode).toBe(7);
    expect(json.error.details.issues).toBeDefined();
    expect(json.error.details.issues[0]).toMatchObject({ severity: 'error' });
    expect(json.error.details.issues[0].line).toBe(2);
    expect(typeof json.error.details.issues[0].code).toBe('string');
    expect(typeof json.error.details.issues[0].message).toBe('string');
  });

  it('--syntax with an ok file succeeds with failure:false', async () => {
    const program = makeProgram();
    registerCheckCommand(program);
    const res = await runCommand(program, ['check', 'src/zcl_ok.clas.abap', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const json = JSON.parse(res.stdout);
    expect(json.status).toBe('success');
    expect(json.data.issues).toEqual([]);
    expect(json.data.failure).toBe(false);
  });

  it('--syntax and --atc are mutually exclusive (exit 2)', async () => {
    const program = makeProgram();
    registerCheckCommand(program);
    const res = await runCommand(program, ['check', 'src/zcl_ok.clas.abap', '--syntax', '--atc', '--json'], { cwd });
    expect(res.exitCode).toBe(2);
    const { json } = parseError(res);
    expect(json.error.code).toBe('INVALID_ARGUMENT');
  });

  it('--all and --changed are mutually exclusive (exit 2)', async () => {
    const program = makeProgram();
    registerCheckCommand(program);
    const res = await runCommand(program, ['check', '--all', '--changed', '--json'], { cwd });
    expect(res.exitCode).toBe(2);
    const { json } = parseError(res);
    expect(json.error.code).toBe('INVALID_ARGUMENT');
  });

  it('--changed with a clean change set fails fast with guidance', async () => {
    const program = makeProgram();
    registerCheckCommand(program);
    // --changed compares nothing when no baseline exists → treat as empty change set
    const res = await runCommand(program, ['check', '--changed', '--json'], { cwd });
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toMatch(/no files|changed|nothing/i);
  });

  it('--strict promotes warnings to failure', async () => {
    const program = makeProgram();
    registerCheckCommand(program);
    const res = await runCommand(program, ['check', 'src/zcl_warn.clas.abap', '--strict', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    const { json } = parseError(res);
    expect(json.error.details.issues[0].severity).toBe('warning');
  });

  it('--content runs locally with zero SAP calls', async () => {
    const program = makeProgram();
    registerCheckCommand(program);
    const res = await runCommand(program, ['check', 'src/zcl_ok.clas.abap', '--content', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(searchObject).not.toHaveBeenCalled();
    expect(objectStructure).not.toHaveBeenCalled();
    expect(syntaxCheckContent).not.toHaveBeenCalled();
    const json = JSON.parse(res.stdout);
    expect(json.data.issues).toEqual([]);
    expect(json.data.failure).toBe(false);
  });

  it('--atc --variant runs an ATC check and maps findings to issues', async () => {
    const program = makeProgram();
    registerCheckCommand(program);
    const res = await runCommand(program, ['check', 'src/zcl_ok.clas.abap', '--atc', '--variant', 'Z_ATC_VAR', '--strict', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    const { json } = parseError(res);
    expect(atcCheckVariant).toHaveBeenCalledWith('Z_ATC_VAR');
    expect(json.error.details.issues[0]).toMatchObject({ code: 'check_style', severity: 'warning', line: 3 });
  });
});
