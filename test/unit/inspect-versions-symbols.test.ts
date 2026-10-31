import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { registerInspectCommand } from '../../src/abap_cli/commands/inspect.js';
import { makeProgram, runCommand } from './cli-helper.js';
import { parseLineRange } from '../../src/abap_cli/flows/search/inspect-ops.js';
import { parseVersionsFeed } from '../../src/abap_cli/formats/versions-feed.js';

/** Feed fixture as returned by S/4HANA for a class include (verified 2026-11-01). */
const CLASS_INCLUDE_FEED = `<?xml version="1.0" encoding="utf-8"?><atom:feed xmlns:atom="http://www.w3.org/2005/Atom" xmlns:adtcore="http://www.sap.com/adt/core"><atom:title>Version List of ZCL_DEMO (CLAS)</atom:title><atom:updated>1970-01-01T10:11:23Z</atom:updated><atom:entry><atom:author><atom:name>MOCKUSER</atom:name></atom:author><atom:content type="text/plain" src="/sap/bc/adt/oo/classes/zcl_demo/includes/main/versions/19700101101123/00004/content"/><atom:id>00004</atom:id><atom:updated>2026-10-31T19:20:44Z</atom:updated></atom:entry><atom:entry><atom:author><atom:name>MOCKUSER</atom:name></atom:author><atom:content type="text/plain" src="/sap/bc/adt/oo/classes/zcl_demo/includes/main/versions/19700101101123/00000/content"/><atom:id>00000</atom:id><atom:updated>2026-10-30T09:00:00Z</atom:updated><atom:title>Initial version</atom:title></atom:entry></atom:feed>`;

/** Object-level feed carrying the transport link (no atom:id). */
const OBJECT_FEED_WITH_TRANSPORT = `<?xml version="1.0" encoding="utf-8"?><atom:feed xmlns:atom="http://www.w3.org/2005/Atom" xmlns:adtcore="http://www.sap.com/adt/core"><atom:entry><atom:author><atom:name>DEV</atom:name></atom:author><atom:content type="text/plain" src="/sap/bc/adt/programs/programs/zprog/versions/19700101101123/00001/content"/><atom:link rel="http://www.sap.com/adt/relations/transport" type="application/vnd.sap.adt.transportrequests.v1+xml" adtcore:name="DEVK900001" href="/sap/bc/adt/cts/transportrequests/DEVK900001"/><atom:updated>2026-10-31T10:00:00Z</atom:updated><atom:title>Transport DEVK900001</atom:title></atom:entry></atom:feed>`;

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

const VERSIONS_LINK = {
  href: 'includes/main/versions',
  rel: 'http://www.sap.com/adt/relations/versions',
  type: 'application/atom+xml;type=feed',
};

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
      // Marks the structure as a class structure for the library's
      // getRevisionLink() include lookup (isClassStructure checks this field).
      ...(isClass ? { 'class:visibility': 'public' } : {}),
    },
    links: isClass ? [] : [{ href: 'versions', rel: 'http://www.sap.com/adt/relations/versions' }],
    includes: isClass
      ? [
          { 'class:includeType': 'main', 'abapsource:sourceUri': `${objectUrl}/source/main`, links: [VERSIONS_LINK] },
          { 'class:includeType': 'implementations', 'abapsource:sourceUri': `${objectUrl}/source/implementations`, links: [] },
        ]
      : [],
  };
});

const adtFeed = vi.fn(async () => CLASS_INCLUDE_FEED);

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
        name: 'LT_TYPES',
        type: 'CLAS/OLT',
        visibility: 'public',
        links: [],
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
      adtFeed,
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

describe('parseVersionsFeed', () => {
  it('reads the version id from atom:id and parses author/date/uri', () => {
    const entries = parseVersionsFeed(CLASS_INCLUDE_FEED);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      version: '00004',
      author: 'MOCKUSER',
      date: '2026-10-31T19:20:44Z',
    });
    expect(entries[0]!.uri).toContain('/versions/19700101101123/00004/content');
    expect(entries[1]).toMatchObject({ version: '00000', title: 'Initial version' });
  });

  it('keeps the transport request when the feed exposes the link', () => {
    const entries = parseVersionsFeed(OBJECT_FEED_WITH_TRANSPORT);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ version: '00001', transport: 'DEVK900001' });
  });

  it('falls back to the content URI when atom:id is absent', () => {
    const entries = parseVersionsFeed(
      '<atom:feed><atom:entry><atom:content src="/x/versions/1/00007/content"/><atom:updated>2026-01-01T00:00:00Z</atom:updated></atom:entry></atom:feed>',
    );
    expect(entries[0]!.version).toBe('00007');
  });
});

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
    expect(data.versions.count).toBe(2);
    expect(data.versions.versions[0]).toMatchObject({
      version: '00004',
      author: 'MOCKUSER',
      date: '2026-10-31T19:20:44Z',
    });
    expect(data.versions.versions[0].uri).toContain('/versions/19700101101123/00004/content');
    expect(adtFeed).toHaveBeenCalledWith('/sap/bc/adt/oo/classes/zcl_demo/includes/main/versions');
  });

  it('--show returns the selected version source', async () => {
    const program = makeProgram();
    registerInspectCommand(program);
    const res = await runCommand(program, ['inspect', 'ZCL_DEMO', '--versions', '--show', '00000', '--json']);
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    expect(data.versions.shown.version).toBe('00000');
    expect(data.versions.shown.source).toContain('CLASS zcl_demo');
    expect(getObjectSource).toHaveBeenCalledWith('/sap/bc/adt/oo/classes/zcl_demo/includes/main/versions/19700101101123/00000/content');
  });

  it('--show --out writes the version source and reports a relative path', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'abap-inspect-out-'));
    try {
      const program = makeProgram();
      registerInspectCommand(program);
      const res = await runCommand(program, ['inspect', 'ZCL_DEMO', '--versions', '--show', '00004', '--out', 'v4.abap', '--json'], { cwd });
      expect(res.exitCode).toBeUndefined();
      const data = parseData(res);
      expect(data.versions.shown.out).toBe('v4.abap');
      expect(fs.readFileSync(path.join(cwd, 'v4.abap'), 'utf8')).toContain('CLASS zcl_demo');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('maps a missing versions link to TYPE_NOT_SUPPORTED', async () => {
    objectStructure.mockResolvedValueOnce({
      objectUrl: '/sap/bc/adt/oo/classes/zcl_demo',
      metaData: { 'adtcore:name': 'ZCL_DEMO', 'adtcore:type': 'CLAS/OC' },
      links: [],
      includes: [{ 'class:includeType': 'main', 'abapsource:sourceUri': '/sap/bc/adt/oo/classes/zcl_demo/source/main', links: [] }],
    });
    const program = makeProgram();
    registerInspectCommand(program);
    const res = await runCommand(program, ['inspect', 'ZCL_DEMO', '--versions', '--json']);
    expect(res.exitCode).toBe(7);
    expect(parseError(res).code).toBe('TYPE_NOT_SUPPORTED');
  });

  it('requires --versions when --show / --out / --include are used', async () => {
    const showProgram = makeProgram();
    registerInspectCommand(showProgram);
    const show = await runCommand(showProgram, ['inspect', 'ZCL_DEMO', '--show', '00000', '--json']);
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
    expect(error.details.available).toEqual(['00004', '00000']);
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
    expect(data.symbols.count).toBe(4);
    const run = data.symbols.symbols.find((s: { name: string }) => s.name === 'RUN');
    expect(run).toMatchObject({ kind: 'method', visibility: 'public', startLine: 5, endLine: 9 });
    const localType = data.symbols.symbols.find((s: { name: string }) => s.name === 'LT_TYPES');
    expect(localType).toMatchObject({ kind: 'local-class-type', startLine: null, endLine: null });
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
    const res = await runCommand(program, ['inspect', 'ZCL_DEMO', '--symbols', '--name-pattern', '(', '--json']);
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
