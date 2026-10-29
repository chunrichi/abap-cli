/**
 * T3.4 — DCLS / DDLX / DDLA pull end-to-end.
 *
 * Each of the three CDS-extension types shares the same sourceObjectStrategy
 * layout; only the AFF folder + ADT endpoint differ. The tests exercise the
 * full file-write path (`runPullX` → `pullObject` → `writePullFile`) for all
 * three types against the same mock ADT client.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

interface PullArgs {
  type: 'DCLS' | 'DDLX' | 'DDLA';
  name: string;
  body: string;
  endpoint: string;
  expectedFolder: string;
}

const PULL_ARGS: PullArgs[] = [
  {
    type: 'DCLS',
    name: 'zmy_dcls',
    body: '@MappingRole: true\ndefine role ZMY_DCLS { grant select on ZMY_VIEW; }',
    endpoint: '/sap/bc/adt/dcls/dc/zmy_dcls',
    expectedFolder: 'dcls',
  },
  {
    type: 'DDLX',
    name: 'zmy_ddlx',
    body: 'define view ZMY_DDLX as select from ztable { key id as Id }',
    endpoint: '/sap/bc/adt/ddlx/extensions/zmy_ddlx',
    expectedFolder: 'ddlx',
  },
  {
    type: 'DDLA',
    name: 'zmy_ddla',
    body: '@Metadata.layer: #CORE\ndefine annotation ZMY_DDLA { }',
    endpoint: '/sap/bc/adt/ddla/annotations/zmy_ddla',
    expectedFolder: 'ddla',
  },
];

const objectStructureMock = vi.fn(async (_url: string) => ({
  metaData: {
    'adtcore:description': 'CDS extension',
    'adtcore:masterLanguage': 'EN',
    'abapsource:sourceUri': 'source/main',
  },
}));

const getObjectSourceMock = vi.fn(async (_url: string) => 'placeholder');

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      objectStructure: objectStructureMock,
      getObjectSource: getObjectSourceMock,
    }),
  },
}));

let root: string;
beforeEach(() => {
  vi.clearAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pull-cds-ext-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

async function loadPullModule() {
  return import('../../src/abap_cli/flows/edit/pull-cds-extension.js');
}

describe.each(PULL_ARGS)('T3.4 — pull $type', (args) => {
  it(`writes the .${args.type.toLowerCase()}.json + .acds pair`, async () => {
    getObjectSourceMock.mockResolvedValueOnce(args.body);
    const mod = await loadPullModule();
    const runPull = (mod as Record<string, (name: string, opts: { rootDir: string }) => Promise<{ object: string; files: string[] }>>)[
      `runPull${args.type.charAt(0)}${args.type.slice(1).toLowerCase()}`
    ];
    const result = await runPull(args.name, { rootDir: root });
    expect(result.object).toBe(args.name.toUpperCase());
    expect(result.files).toHaveLength(2);

    const dir = path.join(root, args.expectedFolder, args.name);
    const jsonPath = path.join(dir, `${args.name}.${args.type.toLowerCase()}.json`);
    const acdsPath = path.join(dir, `${args.name}.${args.type.toLowerCase()}.acds`);
    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(acdsPath)).toBe(true);

    const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    expect(json.formatVersion).toBe('1');
    expect(json.header).toEqual({ description: 'CDS extension', originalLanguage: 'en' });

    const acds = fs.readFileSync(acdsPath, 'utf8');
    expect(acds).toBe(args.body);
  });

  it(`passes AFF pre-validation against ${args.type.toLowerCase()}-v1.json`, async () => {
    getObjectSourceMock.mockResolvedValueOnce(args.body);
    const mod = await loadPullModule();
    const runPull = (mod as Record<string, (name: string, opts: { rootDir: string }) => Promise<{ object: string }>>)[
      `runPull${args.type.charAt(0)}${args.type.slice(1).toLowerCase()}`
    ];
    await expect(runPull(args.name, { rootDir: root })).resolves.toMatchObject({
      object: args.name.toUpperCase(),
    });
  });

  it(`uses the .acds source extension (not .abap / .abdl)`, async () => {
    getObjectSourceMock.mockResolvedValueOnce(args.body);
    const mod = await loadPullModule();
    const runPull = (mod as Record<string, (name: string, opts: { rootDir: string }) => Promise<{ files: string[] }>>)[
      `runPull${args.type.charAt(0)}${args.type.slice(1).toLowerCase()}`
    ];
    const result = await runPull(args.name, { rootDir: root });
    const extensions = result.files.map((f) => path.extname(f));
    expect(extensions).toContain('.json');
    expect(extensions).toContain('.acds');
    expect(extensions).not.toContain('.abap');
    expect(extensions).not.toContain('.abdl');
  });
});
