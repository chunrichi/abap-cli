/**
 * abap deploy — release-form merge wiring (abap/deploy.json).
 *
 * The bundled ICF service is developed as a tree of global classes and
 * published as a single global handler whose helpers are downgraded to
 * `lcl_*` local classes. These tests pin the deploy-side assembly:
 *  - release is the default: only handler + standalone objects are pushed, the
 *    handler gets generated main/definitions/implementations parts;
 *  - `--dev` keeps every class global and orders activation by dependencies;
 *  - manifest inconsistencies fail with DEPLOY_MANIFEST_INVALID.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CliError } from '../../src/abap_cli/output/json.js';
import { deployBundled } from '../../src/abap_cli/flows/edit/deploy.js';

const writes: { url: string; content: string }[] = [];
const lock = vi.fn(async () => ({ LOCK_HANDLE: 'lock-1' }));
const setObjectSource = vi.fn(async (url: string, content: string) => {
  writes.push({ url, content });
  return '';
});
const unLock = vi.fn(async () => '');
const activate = vi.fn(async () => '');
const runClass = vi.fn(async () =>
  JSON.stringify({ status: 'success', action: 'already_active', node: { active: true } }),
);
const inactiveObjects = vi.fn(async () => []);
const activateAll = vi.fn(async () => ({ messages: [] }));
const objectStructure = vi.fn(async (objectUrl: string) => ({
  objectUrl,
  includes: [
    { 'class:includeType': 'main', 'abapsource:sourceUri': `${objectUrl}/source/main` },
    { 'class:includeType': 'definitions', 'abapsource:sourceUri': `${objectUrl}/includes/definitions` },
    { 'class:includeType': 'implementations', 'abapsource:sourceUri': `${objectUrl}/includes/implementations` },
  ],
}));
const getObjectSource = vi.fn(async (_url: string) => '');
const searchObject = vi.fn(async (name: string) => [
  {
    'adtcore:name': name.toUpperCase(),
    'adtcore:type': 'CLAS/OC',
    'adtcore:uri': `/sap/bc/adt/oo/classes/${name.toLowerCase()}`,
  },
]);

const client = {
  lock, setObjectSource, unLock, activate, runClass, inactiveObjects, activateAll,
  objectStructure, searchObject, getObjectSource,
  getConfig: () => ({ sap: { username: 'MOCKUSER' } }),
} as never;

const HANDLER = 'ZCL_TEST_HANDLER';
const TYPES = 'ZCL_TEST_TYPES';
const HELPER = 'ZCL_TEST_HELPER';
const STANDALONE = 'ZCL_TEST_STANDALONE';

const SOURCES: Record<string, string> = {
  [HANDLER]: [
    'CLASS zcl_test_handler DEFINITION PUBLIC CREATE PUBLIC.',
    '  PUBLIC SECTION.',
    '    CLASS-METHODS run.',
    'ENDCLASS.',
    '',
    'CLASS zcl_test_handler IMPLEMENTATION.',
    '  METHOD run.',
    '    DATA(lv) = zcl_test_types=>ty_some_type.',
    '    lv = zcl_test_types=>ty_some_type.',
    '    zcl_test_helper=>do_it( ).',
    '  ENDMETHOD.',
    'ENDCLASS.',
  ].join('\n'),
  [TYPES]: [
    'CLASS zcl_test_types DEFINITION PUBLIC FINAL CREATE PUBLIC.',
    '  PUBLIC SECTION.',
    '    TYPES ty_some_type TYPE i.',
    'ENDCLASS.',
    '',
    'CLASS zcl_test_types IMPLEMENTATION.',
    'ENDCLASS.',
  ].join('\n'),
  [HELPER]: [
    'CLASS zcl_test_helper DEFINITION PUBLIC FINAL CREATE PUBLIC.',
    '  PUBLIC SECTION.',
    '    CLASS-METHODS do_it.',
    'ENDCLASS.',
    '',
    'CLASS zcl_test_helper IMPLEMENTATION.',
    '  METHOD do_it.',
    '    DATA(lv) = zcl_test_types=>ty_some_type.',
    '    lv = 1.',
    '  ENDMETHOD.',
    'ENDCLASS.',
  ].join('\n'),
  [STANDALONE]: [
    'CLASS zcl_test_standalone DEFINITION PUBLIC CREATE PUBLIC.',
    '  PUBLIC SECTION.',
    '    INTERFACES if_oo_adt_classrun.',
    'ENDCLASS.',
    '',
    'CLASS zcl_test_standalone IMPLEMENTATION.',
    '  METHOD if_oo_adt_classrun~main.',
    '    DATA(lv) = 1.',
    '  ENDMETHOD.',
    'ENDCLASS.',
  ].join('\n'),
};

const MANIFEST = {
  handler: HANDLER,
  merged: [
    { global: TYPES, local: 'lcl_types' },
    { global: HELPER, local: 'lcl_helper' },
  ],
  standalone: [STANDALONE],
};

let rootDir: string;
let sourceDir: string;

function writeFixture(): void {
  sourceDir = path.join(rootDir, 'abap', 'src');
  fs.mkdirSync(sourceDir, { recursive: true });
  for (const [name, source] of Object.entries(SOURCES)) {
    fs.writeFileSync(path.join(sourceDir, `${name.toLowerCase()}.clas.abap`), source);
    fs.writeFileSync(
      path.join(sourceDir, `${name.toLowerCase()}.clas.json`),
      JSON.stringify({ formatVersion: '1', header: { description: `${name} fixture`, originalLanguage: 'en' } }, null, 2),
    );
  }
}

function writeManifest(manifest: unknown): void {
  fs.writeFileSync(path.join(rootDir, 'abap', 'deploy.json'), JSON.stringify(manifest, null, 2));
}

beforeEach(() => {
  vi.clearAllMocks();
  writes.length = 0;
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-release-'));
  writeFixture();
  writeManifest(MANIFEST);
});

describe('abap deploy — release form (default)', () => {
  it('pushes only handler + standalone objects and generates the merged includes', async () => {
    const summary = await deployBundled(client, {
      transport: '', yes: true, sourceDir, package: '$TMP',
    });

    expect(summary.mode).toBe('release');
    expect(summary.mergedClasses).toBe(2);
    expect(summary.objects.map((o) => o.object).sort()).toEqual([HANDLER, STANDALONE].sort());
    // Handler = 3 generated parts; standalone = 1 part.
    expect(summary.files).toHaveLength(4);
    expect(summary.files.map((f) => f.file).sort()).toEqual([
      'zcl_test_handler.clas.abap',
      'zcl_test_handler.clas.definitions.abap',
      'zcl_test_handler.clas.implementations.abap',
      'zcl_test_standalone.clas.abap',
    ]);

    const byUrl = new Map(writes.map((w) => [w.url, w.content]));
    const main = byUrl.get('/sap/bc/adt/oo/classes/zcl_test_handler/source/main') ?? '';
    const definitions = byUrl.get('/sap/bc/adt/oo/classes/zcl_test_handler/includes/definitions') ?? '';
    const implementations = byUrl.get('/sap/bc/adt/oo/classes/zcl_test_handler/includes/implementations') ?? '';

    // Main keeps the handler class and calls the local helpers.
    expect(main).toContain('CLASS zcl_test_handler DEFINITION PUBLIC CREATE PUBLIC.');
    expect(main).toContain('lcl_types=>ty_some_type');
    expect(main).toContain('lcl_helper=>do_it( )');

    // Definitions: global headers downgraded, no global helper names left.
    expect(definitions).toContain('CLASS lcl_types DEFINITION.');
    expect(definitions).toContain('CLASS lcl_helper DEFINITION.');
    expect(definitions).not.toMatch(/ZCL_TEST_(TYPES|HELPER)/i);
    expect(definitions.indexOf('CLASS lcl_types DEFINITION.')).toBeLessThan(
      definitions.indexOf('CLASS lcl_helper DEFINITION.'),
    );

    // Implementations: only classes with a method body, renamed to lcl_*.
    expect(implementations).toContain('CLASS lcl_helper IMPLEMENTATION.');
    expect(implementations).toContain('lcl_types=>ty_some_type');
    expect(implementations).not.toMatch(/ZCL_TEST_(TYPES|HELPER)/i);

    // Standalone class keeps its global name and source.
    const standalone = byUrl.get('/sap/bc/adt/oo/classes/zcl_test_standalone/source/main') ?? '';
    expect(standalone).toContain('CLASS zcl_test_standalone DEFINITION');
  });

  it('--diff treats CRLF-normalised remote sources as unchanged', async () => {
    // First pass captures what the release deploy writes, then the mock serves
    // it back with the CRLF line endings real SAP returns.
    await deployBundled(client, { transport: '', yes: true, sourceDir, package: '$TMP' });
    const pushed = new Map(writes.map((w) => [w.url, w.content]));
    getObjectSource.mockImplementation(async (url: string) => {
      // Real SAP: CRLF line endings, include parts without the trailing newline.
      return (pushed.get(url) ?? '').replace(/\n/g, '\r\n').replace(/\r\n$/, '');
    });
    writes.length = 0;

    const summary = await deployBundled(client, {
      transport: '', yes: true, diff: true, sourceDir, package: '$TMP',
    });

    expect(summary.objects.every((o) => o.status === 'unchanged')).toBe(true);
    expect(summary.files.every((f) => f.status === 'skipped' && f.changed === false)).toBe(true);
    expect(writes).toHaveLength(0);
  });

  it('keeps the development sources untouched on disk', async () => {
    await deployBundled(client, { transport: '', yes: true, sourceDir, package: '$TMP' });
    expect(fs.readFileSync(path.join(sourceDir, 'zcl_test_types.clas.abap'), 'utf-8')).toBe(SOURCES[TYPES]);
    expect(
      fs.existsSync(path.join(sourceDir, 'zcl_test_handler.clas.definitions.abap')),
    ).toBe(false);
  });

  it('reports an unknown bundled class as DEPLOY_MANIFEST_INVALID', async () => {
    fs.writeFileSync(
      path.join(sourceDir, 'zcl_test_orphan.clas.abap'),
      'CLASS zcl_test_orphan DEFINITION PUBLIC CREATE PUBLIC.\nENDCLASS.\n',
    );
    await expect(
      deployBundled(client, { transport: '', yes: true, sourceDir, package: '$TMP' }),
    ).rejects.toMatchObject({ code: 'DEPLOY_MANIFEST_INVALID' });
  });

  it('rejects a committed handler include (must be generated at deploy time)', async () => {
    fs.writeFileSync(
      path.join(sourceDir, 'zcl_test_handler.clas.definitions.abap'),
      'CLASS lcl_stale DEFINITION.\nENDCLASS.\n',
    );
    await expect(
      deployBundled(client, { transport: '', yes: true, sourceDir, package: '$TMP' }),
    ).rejects.toMatchObject({ code: 'DEPLOY_MANIFEST_INVALID' });
  });

  it('rejects a manifest entry with no bundled source', async () => {
    writeManifest({ ...MANIFEST, standalone: [STANDALONE, 'ZCL_TEST_GHOST'] });
    await expect(
      deployBundled(client, { transport: '', yes: true, sourceDir, package: '$TMP' }),
    ).rejects.toMatchObject({ code: 'DEPLOY_MANIFEST_INVALID' });
  });

  it('surfaces merge failures as DEPLOY_MERGE_FAILED', async () => {
    fs.writeFileSync(
      path.join(sourceDir, 'zcl_test_types.clas.abap'),
      'not an ABAP class at all\n',
    );
    await expect(
      deployBundled(client, { transport: '', yes: true, sourceDir, package: '$TMP' }),
    ).rejects.toMatchObject({ code: 'DEPLOY_MERGE_FAILED' });
  });
});

describe('abap deploy --dev — development form', () => {
  it('pushes every class as a global object in dependency order', async () => {
    const summary = await deployBundled(client, {
      transport: '', yes: true, sourceDir, package: '$TMP', dev: true,
    });

    expect(summary.mode).toBe('dev');
    expect(summary.mergedClasses).toBeUndefined();
    expect(summary.objects.map((o) => o.object)).toEqual([TYPES, HELPER, HANDLER, STANDALONE]);
    // Every class main is pushed as-is: the handler still references the
    // global helper classes in the development form.
    const handlerMain = writes.find((w) => w.url.endsWith('/zcl_test_handler/source/main'))?.content ?? '';
    expect(handlerMain).toContain('zcl_test_types=>ty_some_type');
    expect(handlerMain).toContain('zcl_test_helper=>do_it( )');
    expect(summary.files.map((f) => f.file).sort()).toEqual([
      'zcl_test_handler.clas.abap',
      'zcl_test_helper.clas.abap',
      'zcl_test_standalone.clas.abap',
      'zcl_test_types.clas.abap',
    ]);
  });

  it('does not generate include parts in the development form', async () => {
    await deployBundled(client, { transport: '', yes: true, sourceDir, package: '$TMP', dev: true });
    expect(writes.some((w) => w.url.includes('/includes/definitions'))).toBe(false);
    expect(writes.some((w) => w.url.includes('/includes/implementations'))).toBe(false);
  });
});
