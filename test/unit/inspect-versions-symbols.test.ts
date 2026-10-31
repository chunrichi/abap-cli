import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { registerInspectCommand } from '../../src/abap_cli/commands/inspect.js';
import { makeProgram, runCommand } from './cli-helper.js';
import { parseLineRange } from '../../src/abap_cli/flows/search/inspect-ops.js';

const searchObject = vi.fn(async (name: string) => {
  const normalized = name.replace(/\*/g, '').toUpperCase();
  if (normalized === 'ZPROG') {
    return [
      {
        'adtcore:name': 'ZPROG',
        'adtcore:type': 'PROG/P',
        'adtcore:uri': '/sap/bc/adt/programs/programs/zprog',
      },
    ];
  }
  return [
    {
      'adtcore:name': normalized,
      'adtcore:type': 'CLAS/OC',
      'adtcore:uri': `/sap/bc/adt/oo/classes/${normalized.toLowerCase()}`,
    },
  ];
});

const objectStructure = vi.fn(async (objectUrl: string) => {
  const isClass = objectUrl.includes('/classes/');
  return {
    objectUrl,
    metaData: {
      'adtcore:name': isClass ? 'ZCL_DEMO' : 'ZPROG',
      'adtcore:type': isClass ? 'CLAS/OC' : 'PROG/P',
      'adtcore:description': isClass ? 'Demo class' : 'Demo program',
      'adtcore:changedAt': 1720000000000,
      'adtcore:changedBy': 'MOCKUSER',
      'adtcore:responsible': 'MOCKUSER',
    },
    includes: isClass
      ? [
          { 'class:includeType': 'main', 'abapsource:sourceUri': `${objectUrl}/source/main` },
          { 'class:includeType': 'implementations', 'abapsource:sourceUri': `${objectUrl}/source/implementations` },
        ]
      : [],
  };
});

const revisions = vi.fn(async () => [
  {
    uri: '/sap/bc/adt/oo/classes/zcl_demo/source/main?version=000001',
    date: '2026-10-01T10:00:00Z',
    author: 'MOCKUSER',
    version: '000001',
    versionTitle: 'First version',
  },
  {
    uri: '/sap/bc/adt/oo/classes/zcl_demo/source/main?version=000002',
    date: '2026-10-02T10:00:00Z',
    author: 'MOCKUSER',
    version: '000002',
    versionTitle: 'Second version',
  },
]);

const getObjectSource = vi.fn(async () => 'CLASS zcl_demo DEFINITION PUBLIC.\nENDCLASS.\n');

const objectStructureElements = vi.fn(async () => [
  {
    name: 'ZCL_DEMO',
    type: 'CLAS/OC',
    visibility: 'public',
    links: [{ href: '#start=1,1;end=20,1', rel: 'http://www.sap.com/adt/relations/source/main' }],
    children: [
      {
        name: 'RUN',
        type: 'CLAS/OM',
        visibility: 'public',
        constructor: false,
        links: [{ href: '#start=5,4;end=9,5', rel: 'http://www.sap.com/adt/relations/source/implementationBlock' }],
        children: [],
      },
      {
        name: 'MV_COUNT',
        type: 'CLAS/OA',
        visibility: 'private',
        links: [],
        children: [],
      },
    ],
  },
]);

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      searchObject,
      objectStructure,
      revisions,
      getObjectSource,
      objectStructureElements,
    }),
  },
}));

function parseData(res: { stdout: string }) {
  return JSON.parse(res.stdout).data;
}

function parseError(res: { stderr: string }) {
  return JSON.parse(res.stderr).error;
}

describe('parseLineRange', () => {
  it('parses the start/end fragment of an ADT atom link', () => {
    expect(parseLineRange('https://host/sap/bc/adt/oo/classes/zcl_x/source/implementations#start=5,4;end=9,5')).toEqual({
      startLine: 5,
      endLine: 9,
    });
  });

  it('returns null for links without a range fragment', () => {
    expect(parseLineRange('/sap/bc/adt/oo/classes/zcl_x')).toBeNull();
    expect(parseLineRange(undefined)).toBeNull();
  });
});

describe('abap inspect --versions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists version entries with date/author/title', async () => {
    const program = makeProgram();
    registerInspectCommand(program);
    const res = await runCommand(program, ['inspect', 'ZCL_DEMO', '--versions', '--json']);
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    expect(data.versions.include).toBe('main');
    expect(data.versions.versions).toHaveLength(2);
    expect(data.versions.versions[0]).toMatchObject({
      version: '000001',
      author: 'MOCKUSER',
      title: 'First version',
    });
    expect(data.versions.versions[0].uri).toContain('version=000001');
    expect(revisions).toHaveBeenCalledWith('/sap/bc/adt/oo/classes/zcl_demo', 'main');
  });

  it('--show returns the selected version source', async () => {
    const program = makeProgram();
    registerInspectCommand(program);
    const res = await runCommand(program, ['inspect', 'ZCL_DEMO', '--versions', '--show', '000001', '--json']);
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    expect(data.versions.shown.version).toBe('000001');
    expect(data.versions.shown.source).toContain('CLASS zcl_demo');
    expect(getObjectSource).toHaveBeenCalledWith('/sap/bc/adt/oo/classes/zcl_demo/source/main?version=000001');
  });

  it('--show --out writes the version source and reports a relative path', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'abap-inspect-out-'));
    try {
      const program = makeProgram();
      registerInspectCommand(program);
      const res = await runCommand(program, ['inspect', 'ZCL_DEMO', '--versions', '--show', '000002', '--out', 'v2.abap', '--json'], { cwd });
      expect(res.exitCode).toBeUndefined();
      const data = parseData(res);
      expect(data.versions.shown.out).toBe('v2.abap');
      expect(fs.readFileSync(path.join(cwd, 'v2.abap'), 'utf8')).toContain('CLASS zcl_demo');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('maps a missing versions feed to TYPE_NOT_SUPPORTED', async () => {
    revisions.mockRejectedValueOnce(new Error('Revision URL not found for object ZCL_DEMO'));
    const program = makeProgram();
    registerInspectCommand(program);
    const res = await runCommand(program, ['inspect', 'ZCL_DEMO', '--versions', '--json']);
    expect(res.exitCode).toBe(7);
    expect(parseError(res).code).toBe('TYPE_NOT_SUPPORTED');
  });

  it('requires --versions when --show / --out / --include are used', async () => {
    const showProgram = makeProgram();
    registerInspectCommand(showProgram);
    const show = await runCommand(showProgram, ['inspect', 'ZCL_DEMO', '--show', '000001', '--json']);
    expect(show.exitCode).toBe(2);
    expect(parseError(show).code).toBe('USAGE');
    const outProgram = makeProgram();
    registerInspectCommand(outProgram);
    const out = await runCommand(outProgram, ['inspect', 'ZCL_DEMO', '--out', 'x.abap', '--json']);
    expect(out.exitCode).toBe(2);
    const includeProgram = makeProgram();
    registerInspectCommand(includeProgram);
    const include = await runCommand(includeProgram, ['inspect', 'ZCL_DEMO', '--include', 'main', '--json']);
    expect(include.exitCode).toBe(2);
  });

  it('rejects a limit outside 1..200', async () => {
    const program = makeProgram();
    registerInspectCommand(program);
    const res = await runCommand(program, ['inspect', 'ZCL_DEMO', '--versions', '--limit', '0', '--json']);
    expect(res.exitCode).toBe(2);
    expect(parseError(res).code).toBe('INVALID_ARGUMENT');
  });

  it('rejects an unknown version on --show', async () => {
    const program = makeProgram();
    registerInspectCommand(program);
    const res = await runCommand(program, ['inspect', 'ZCL_DEMO', '--versions', '--show', '999999', '--json']);
    expect(res.exitCode).toBe(2);
    const error = parseError(res);
    expect(error.code).toBe('INVALID_ARGUMENT');
    expect(error.details.available).toEqual(['000001', '000002']);
  });
});

describe('abap inspect --symbols', () => {
  beforeEach(() => vi.clearAllMocks());

  it('flattens the structure tree and parses line ranges', async () => {
    const program = makeProgram();
    registerInspectCommand(program);
    const res = await runCommand(program, ['inspect', 'ZCL_DEMO', '--symbols', '--json']);
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    expect(data.symbols.supported).toBe(true);
    expect(data.symbols.symbols).toHaveLength(3);
    const run = data.symbols.symbols.find((s: { name: string }) => s.name === 'RUN');
    expect(run).toMatchObject({ kind: 'method', visibility: 'public', startLine: 5, endLine: 9 });
    const attribute = data.symbols.symbols.find((s: { name: string }) => s.name === 'MV_COUNT');
    expect(attribute).toMatchObject({ kind: 'attribute', startLine: null, endLine: null });
  });

  it('filters by kind and name pattern', async () => {
    const kindsProgram = makeProgram();
    registerInspectCommand(kindsProgram);
    const kinds = await runCommand(kindsProgram, ['inspect', 'ZCL_DEMO', '--symbols', '--kinds', 'method', '--json']);
    const kindsData = parseData(kinds);
    expect(kindsData.symbols.count).toBe(1);
    expect(kindsData.symbols.symbols.map((s: { name: string }) => s.name)).toEqual(['RUN']);
    const patternProgram = makeProgram();
    registerInspectCommand(patternProgram);
    const pattern = await runCommand(patternProgram, ['inspect', 'ZCL_DEMO', '--symbols', '--name-pattern', '^mv_', '--json']);
    const patternData = parseData(pattern);
    expect(patternData.symbols.count).toBe(1);
    expect(patternData.symbols.symbols).toHaveLength(1);
  });

  it('reports supported:false for non-class objects', async () => {
    const program = makeProgram();
    registerInspectCommand(program);
    const res = await runCommand(program, ['inspect', 'ZPROG', '--symbols', '--json']);
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    expect(data.symbols.supported).toBe(false);
    expect(data.symbols.reason).toMatch(/classes and interfaces/);
  });

  it('rejects an invalid --name-pattern with USAGE', async () => {
    const program = makeProgram();
    registerInspectCommand(program);
    const res = await runCommand(program, ['inspect', 'ZCL_DEMO', '--symbols', '--name-pattern', '(' , '--json']);
    expect(res.exitCode).toBe(2);
    expect(parseError(res).code).toBe('INVALID_ARGUMENT');
  });

  it('keeps the plain inspect contract unchanged when no new flag is passed', async () => {
    const program = makeProgram();
    registerInspectCommand(program);
    const res = await runCommand(program, ['inspect', 'ZCL_DEMO', '--json']);
    const data = parseData(res);
    expect(data.versions).toBeUndefined();
    expect(data.symbols).toBeUndefined();
    expect(data.metadata.object).toBe('ZCL_DEMO');
  });
});
