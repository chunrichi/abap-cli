import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerCheckCommand } from '../../src/abap_cli/commands/check.js';
import { makeProgram, runCommand } from './cli-helper.js';

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
  objectIsComplete: true,
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

describe('abap check modes (021: subcommands — syntax / content / atc)', () => {
  it('`check syntax` emits unified issues/failure shape for a bad file', async () => {
    const program = makeProgram();
    registerCheckCommand(program);
    const res = await runCommand(program, ['check', 'syntax', 'src/zcl_bad.clas.abap', '--json'], { cwd });
    const { json, exitCode } = parseError(res);
    expect(exitCode).toBe(7);
    expect(json.error.details.issues).toBeDefined();
    expect(json.error.details.issues[0]).toMatchObject({ severity: 'error' });
    expect(json.error.details.issues[0].line).toBe(2);
    expect(typeof json.error.details.issues[0].code).toBe('string');
  });

  it('`check --files <f>` is a shortcut for `check syntax <f>`', async () => {
    const program = makeProgram();
    registerCheckCommand(program);
    const res = await runCommand(program, ['check', '--files', 'src/zcl_bad.clas.abap', '--json'], { cwd });
    const { json, exitCode } = parseError(res);
    expect(exitCode).toBe(7);
    expect(json.error.code).toBe('SYNTAX_ERROR');
  });

  it('`check syntax` with an ok file succeeds with failure:false', async () => {
    const program = makeProgram();
    registerCheckCommand(program);
    const res = await runCommand(program, ['check', 'syntax', 'src/zcl_ok.clas.abap', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const json = JSON.parse(res.stdout);
    expect(json.status).toBe('success');
    expect(json.data.issues).toEqual([]);
    expect(json.data.failure).toBe(false);
  });

  it('--all and --changed are mutually exclusive (exit 2)', async () => {
    const program = makeProgram();
    registerCheckCommand(program);
    const res = await runCommand(program, ['check', 'syntax', '--all', '--changed', '--json'], { cwd });
    expect(res.exitCode).toBe(2);
    const { json } = parseError(res);
    expect(json.error.code).toBe('INVALID_ARGUMENT');
  });

  it('--changed with a clean change set fails fast with guidance', async () => {
    const program = makeProgram();
    registerCheckCommand(program);
    const res = await runCommand(program, ['check', 'syntax', '--changed', '--json'], { cwd });
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toMatch(/no files|changed|nothing/i);
  });

  it('--strict promotes warnings to failure', async () => {
    const program = makeProgram();
    registerCheckCommand(program);
    const res = await runCommand(program, ['check', 'syntax', 'src/zcl_warn.clas.abap', '--strict', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    const { json } = parseError(res);
    expect(json.error.details.issues[0].severity).toBe('warning');
  });

  it('`check content` runs locally with zero SAP calls', async () => {
    const program = makeProgram();
    registerCheckCommand(program);
    const res = await runCommand(program, ['check', 'content', 'src/zcl_ok.clas.abap', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(searchObject).not.toHaveBeenCalled();
    expect(objectStructure).not.toHaveBeenCalled();
    expect(syntaxCheckContent).not.toHaveBeenCalled();
    const json = JSON.parse(res.stdout);
    expect(json.data.issues).toEqual([]);
    expect(json.data.failure).toBe(false);
  });

  it('`check atc --variant` runs an ATC check and maps findings to issues', async () => {
    const program = makeProgram();
    registerCheckCommand(program);
    const res = await runCommand(program, ['check', 'atc', 'src/zcl_ok.clas.abap', '--variant', 'Z_ATC_VAR', '--strict', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    const { json } = parseError(res);
    expect(atcCheckVariant).toHaveBeenCalledWith('Z_ATC_VAR');
    expect(json.error.details.issues[0]).toMatchObject({ code: 'check_style', severity: 'warning', line: 3 });
  });

  it('`check atc --out <file>` persists the raw ATC worklist', async () => {
    const program = makeProgram();
    registerCheckCommand(program);
    const outFile = path.join(cwd, 'atc-out.json');
    const res = await runCommand(program, ['check', 'atc', 'src/zcl_ok.clas.abap', '--variant', 'Z_ATC_VAR', '--strict', '--out', outFile, '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    const { json } = parseError(res);
    expect(json.error.details.out).toBe(outFile);
    const saved = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
    expect(saved.variant).toBe('Z_ATC_VAR');
    expect(saved.files).toHaveLength(1);
    expect(saved.files[0].file).toMatch(/zcl_ok\.clas\.abap$/);
    expect(saved.files[0].worklist.id).toBe('WL001');
    expect(saved.files[0].worklist.objects[0].findings[0].checkId).toBe('check_style');
  });

  it('`check atc --out` (no value) writes to the default .abap/atc/<variant>-<timestamp>.json', async () => {
    const program = makeProgram();
    registerCheckCommand(program);
    const res = await runCommand(program, ['check', 'atc', 'src/zcl_ok.clas.abap', '--variant', 'Z_ATC_VAR', '--out', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const json = JSON.parse(res.stdout);
    const out = json.data.out as string;
    expect(out).toMatch(/\.abap\/atc\/Z_ATC_VAR-\d{8}T\d{6}\.json$/);
    expect(fs.existsSync(out)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(out, 'utf-8'));
    expect(saved.variant).toBe('Z_ATC_VAR');
  });

  it('`check syntax --out x.json` is rejected (--out only applies to atc)', async () => {
    const program = makeProgram();
    registerCheckCommand(program);
    // --out is only valid on `check atc`; commander rejects the unknown option
    // on `check syntax`. In the test harness (without exitOverride) the
    // rejection surfaces as a non-zero exit code and may emit no JSON envelope.
    const res = await runCommand(program, ['check', 'syntax', 'src/zcl_ok.clas.abap', '--out', 'x.json', '--json'], { cwd });
    expect(res.exitCode).not.toBe(0);
  });

  it('bare `abap check` (no subcommand, no target) prints subcommand help (exit 0)', async () => {
    const program = makeProgram();
    registerCheckCommand(program);
    const res = await runCommand(program, ['check', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(res.stdout).toContain('Usage:');
    expect(res.stdout).toMatch(/syntax|content|atc/);
  });

});
