/**
 * Flat abap-file-format layout guarantees.
 *
 * All artifacts are written directly under the output directory as
 * `<name>.<type>[.<subtype>][.<content_type>][.<language>].<ext>`, so different
 * object types with the same name share one directory and must not clobber or
 * misread each other. Companion checks resolve purely by basename in the same
 * directory, and namespaced objects use the AFF `(ns)name` token which must
 * round-trip back to `/NS/NAME` on push.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerPullCommand } from '../../src/abap_cli/commands/pull.js';
import { registerPushCommand } from '../../src/abap_cli/commands/push.js';
import { registerCreateCommand } from '../../src/abap_cli/commands/create.js';
import { checkCompanions } from '../../src/abap_cli/aff/companion-check.js';
import {
  isTablArtifactFile,
  tablArtifactPaths,
} from '../../src/abap_cli/formats/ddic/tabl-artifact.js';
import { resolveFile } from '../../src/abap_cli/formats/file-resolver.js';
import { makeProgram, runCommand } from './cli-helper.js';

// --- ADT mock -------------------------------------------------------------
const searchObject = vi.fn();
const objectStructure = vi.fn();
const getObjectSource = vi.fn();
const lock = vi.fn(async () => ({ LOCK_HANDLE: 'lock-1' }));
const unLock = vi.fn(async () => '');
const setObjectSource = vi.fn(async () => '');
const syntaxCheck = vi.fn(async () => [] as unknown[]);
const syntaxCheckContent = vi.fn(async () => [] as unknown[]);
const activate = vi.fn(async () => '');
const transportInfo = vi.fn(async () => ({ TRANSPORTS: [] as unknown[] }));
const getTtyp = vi.fn(async () => '<ttyp:tableType/>');
const updateTtyp = vi.fn(async () => undefined);

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      searchObject,
      objectStructure,
      getObjectSource,
      lock,
      unLock,
      setObjectSource,
      syntaxCheck,
      syntaxCheckContent,
      activate,
      transportInfo,
      getTtyp,
      updateTtyp,
      getConfig: () => ({ sap: { username: 'MOCKUSER' }, transport: 'TRN001' }),
    }),
  },
}));

// --- ICF mock -------------------------------------------------------------
const icfGetDdic = vi.fn();
const icfPut = vi.fn(async () => ({
  status: 'success' as const,
  data: { action: 'updated' },
  error: null,
}));

vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: {
    create: async () => ({
      getDdic: icfGetDdic,
      put: icfPut,
      postDdic: vi.fn(),
      post: vi.fn(),
      get: vi.fn(),
    }),
  },
}));

// The channel-routed push flows read the workspace profile.
vi.mock('../../src/abap_cli/config/project-config.js', () => ({
  loadConfig: async () => ({ systemVersion: '793' }),
  findWorkspaceConfig: () => undefined,
}));

// --- helpers --------------------------------------------------------------
let cwd: string;

beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'flat-layout-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

function src(...parts: string[]): string {
  return path.join(cwd, 'src', ...parts);
}

function runPull(args: string[]) {
  const program = makeProgram();
  registerPullCommand(program);
  return runCommand(program, ['pull', ...args, '--json'], { cwd });
}

function runPush(args: string[]) {
  const program = makeProgram();
  registerPushCommand(program);
  return runCommand(program, ['push', ...args, '--yes', '--json'], { cwd });
}

function runCreateLocal(args: string[]) {
  const program = makeProgram();
  registerCreateCommand(program);
  return runCommand(program, ['create', 'local', ...args, '--json'], { cwd });
}

function mockClassObject(name: string, source: string) {
  // ADT class URLs drop the leading namespace slash (``/UI2/CL_JSON`` is
  // served under ``.../classes/ui2/cl_json``).
  const uriName = name.startsWith('/') ? name.slice(1).toLowerCase() : name.toLowerCase();
  searchObject.mockResolvedValue([
    {
      'adtcore:name': name.toUpperCase(),
      'adtcore:type': 'CLAS/OC',
      'adtcore:uri': `/sap/bc/adt/oo/classes/${uriName}`,
      'adtcore:packageName': 'ZPKG',
    },
  ]);
  objectStructure.mockImplementation(async (objectUrl: string) => ({
    objectUrl,
    metaData: {
      'adtcore:description': 'Demo class',
      'adtcore:masterLanguage': 'EN',
      'adtcore:type': 'CLAS/OC',
      'abapsource:sourceUri': `${objectUrl}/source/main`,
    },
    includes: [
      { 'class:includeType': 'main', 'abapsource:sourceUri': `${objectUrl}/source/main` },
      { 'class:includeType': 'definitions', 'abapsource:sourceUri': `${objectUrl}/source/locals_def` },
      { 'class:includeType': 'implementations', 'abapsource:sourceUri': `${objectUrl}/source/locals_imp` },
    ],
  }));
  getObjectSource.mockImplementation(async (url: string) => `${source}\n" ${url}`);
}

function tablWire(description: string) {
  return {
    name: 'ZFOO',
    type: 'TABL' as const,
    mainJson: JSON.stringify(
      { formatVersion: '1', header: { description, originalLanguage: 'EN' } },
      null,
      2,
    ),
    ddicSource: `@EndUserText.label : '${description}'\ndefine table zfoo {\n\n  key mandt : abap.clnt not null;\n}\n`,
    settingsJson: JSON.stringify(
      { formatVersion: '1', generalInformation: { dataClassCategory: 'APPL0' } },
      null,
      2,
    ),
    hasSettings: true,
  };
}

// -------------------------------------------------------------------------
describe('same object name, different types in one flat directory', () => {
  it('pulls zfoo.clas.* and zfoo.tabl.* side by side without clobbering or misreading', async () => {
    mockClassObject('ZFOO', 'CLASS zfoo DEFINITION PUBLIC.\nENDCLASS.');

    const clasRes = await runPull(['ZFOO', '--type', 'CLAS']);
    expect(clasRes.exitCode, clasRes.stderr).toBeUndefined();

    icfGetDdic.mockResolvedValueOnce({ status: 'success', data: tablWire('Foo table'), error: null });
    const tablRes = await runPull(['ZFOO', '--type', 'TABL']);
    expect(tablRes.exitCode, tablRes.stderr).toBeUndefined();

    // Both artifact families coexist in the same flat `src/` directory.
    for (const f of [
      'zfoo.clas.json',
      'zfoo.clas.abap',
      'zfoo.clas.definitions.abap',
      'zfoo.clas.implementations.abap',
      'zfoo.tabl.json',
      'zfoo.tabl.ddic',
      'zfoo.tabl.settings.json',
    ]) {
      expect(fs.existsSync(src(f)), `missing ${f}`).toBe(true);
    }
    expect(fs.readFileSync(src('zfoo.clas.abap'), 'utf8')).toContain('CLASS zfoo DEFINITION');
    expect(fs.readFileSync(src('zfoo.tabl.ddic'), 'utf8')).toContain('define table zfoo');
    // No per-type subdirectories were created.
    expect(fs.existsSync(src('clas'))).toBe(false);
    expect(fs.existsSync(src('tabl'))).toBe(false);
  });

  it('re-pulling one type rewrites only that family', async () => {
    mockClassObject('ZFOO', 'CLASS zfoo DEFINITION PUBLIC.\nENDCLASS.');
    await runPull(['ZFOO', '--type', 'CLAS']);
    icfGetDdic.mockResolvedValueOnce({ status: 'success', data: tablWire('Foo table'), error: null });
    await runPull(['ZFOO', '--type', 'TABL']);

    const tablBefore = {
      json: fs.readFileSync(src('zfoo.tabl.json'), 'utf8'),
      ddic: fs.readFileSync(src('zfoo.tabl.ddic'), 'utf8'),
      settings: fs.readFileSync(src('zfoo.tabl.settings.json'), 'utf8'),
    };

    // Update the CLAS source on "SAP" and pull it again with --overwrite.
    mockClassObject('ZFOO', 'CLASS zfoo DEFINITION PUBLIC.\n" v2\nENDCLASS.');
    const clasRes = await runPull(['ZFOO', '--type', 'CLAS', '--overwrite']);
    expect(clasRes.exitCode, clasRes.stderr).toBeUndefined();
    expect(fs.readFileSync(src('zfoo.clas.abap'), 'utf8')).toContain('" v2');

    expect(fs.readFileSync(src('zfoo.tabl.json'), 'utf8')).toBe(tablBefore.json);
    expect(fs.readFileSync(src('zfoo.tabl.ddic'), 'utf8')).toBe(tablBefore.ddic);
    expect(fs.readFileSync(src('zfoo.tabl.settings.json'), 'utf8')).toBe(tablBefore.settings);
    // And the class metadata survives the TABL overwrite below.
    const clasJson = fs.readFileSync(src('zfoo.clas.json'), 'utf8');
    const clasAbap = fs.readFileSync(src('zfoo.clas.abap'), 'utf8');

    // Re-pull the TABL with a changed wire; the CLAS family stays untouched.
    icfGetDdic.mockResolvedValueOnce({ status: 'success', data: tablWire('Changed table'), error: null });
    const tablRes = await runPull(['ZFOO', '--type', 'TABL', '--overwrite']);
    expect(tablRes.exitCode, tablRes.stderr).toBeUndefined();
    expect(JSON.parse(fs.readFileSync(src('zfoo.tabl.json'), 'utf8')).header.description).toBe(
      'Changed table',
    );
    expect(fs.readFileSync(src('zfoo.clas.json'), 'utf8')).toBe(clasJson);
    expect(fs.readFileSync(src('zfoo.clas.abap'), 'utf8')).toBe(clasAbap);
  });
});

// -------------------------------------------------------------------------
describe('TABL/STRU companion checks in a flat directory', () => {
  it('resolves the three-piece paths from any sibling basename', () => {
    const main = path.join('/work/src', 'zfoo.tabl.json');
    expect(tablArtifactPaths(main)).toEqual({
      main: '/work/src/zfoo.tabl.json',
      ddic: '/work/src/zfoo.tabl.ddic',
      settings: '/work/src/zfoo.tabl.settings.json',
    });
    // A settings.json resolves back to its own main/ddic, not a sibling's.
    expect(tablArtifactPaths('/work/src/zfoo.tabl.settings.json')).toEqual(tablArtifactPaths(main));
    expect(tablArtifactPaths('/work/src/zfoo.stru.ddic')).toEqual({
      main: '/work/src/zfoo.stru.json',
      ddic: '/work/src/zfoo.stru.ddic',
      settings: '/work/src/zfoo.stru.settings.json',
    });
    expect(isTablArtifactFile('zfoo.tabl.json')).toBe(true);
    expect(isTablArtifactFile('zfoo.tabl.settings.json')).toBe(true);
    expect(isTablArtifactFile('zfoo.stru.ddic')).toBe(true);
    expect(isTablArtifactFile('zfoo.clas.json')).toBe(false);
  });

  it('TABL/STRU require only the .ddic DDL; .settings.json is optional', async () => {
    fs.writeFileSync(src('zfoo.tabl.json'), '{}');
    fs.writeFileSync(src('zfoo.tabl.ddic'), 'define table zfoo { }\n');
    fs.writeFileSync(src('zfoo.tabl.settings.json'), '{}');

    const tablOk = await checkCompanions(src('zfoo.tabl.json'));
    expect(tablOk.missing).toEqual([]);
    expect(tablOk.optional).toEqual([]);
    expect(tablOk.severity).toBe('ok');

    // Technical settings only exist when the object carries them.
    fs.rmSync(src('zfoo.tabl.settings.json'));
    const tablMissingSettings = await checkCompanions(src('zfoo.tabl.json'));
    expect(tablMissingSettings.missing).toEqual([]);
    expect(tablMissingSettings.optional).toEqual(['zfoo.tabl.settings.json']);
    expect(tablMissingSettings.severity).toBe('ok');

    fs.writeFileSync(src('zfoo.stru.json'), '{}');
    fs.writeFileSync(src('zfoo.stru.ddic'), 'define structure zfoo { }\n');
    const struOk = await checkCompanions(src('zfoo.stru.json'));
    expect(struOk.missing).toEqual([]);
    expect(struOk.optional).toEqual(['zfoo.stru.settings.json']);
    expect(struOk.severity).toBe('ok');

    // The DDL source is the one required companion.
    fs.rmSync(src('zfoo.tabl.ddic'));
    const tablMissingDdl = await checkCompanions(src('zfoo.tabl.json'));
    expect(tablMissingDdl.missing).toEqual(['zfoo.tabl.ddic']);
    expect(tablMissingDdl.severity).toBe('structural');
  });

  it('does not read companions from a same-named object of another type', async () => {
    // Only the TABL sidecar exists; the STRU main must not borrow it.
    fs.writeFileSync(src('zfoo.tabl.ddic'), 'define table zfoo { }\n');
    fs.writeFileSync(src('zfoo.tabl.settings.json'), '{}');
    fs.writeFileSync(src('zfoo.stru.json'), '{}');

    const stru = await checkCompanions(src('zfoo.stru.json'));
    expect(stru.missing).toEqual(['zfoo.stru.ddic']);
    expect(stru.severity).toBe('structural');

    // A CLAS main in the same directory is not consulted either.
    fs.writeFileSync(src('zfoo.clas.json'), '{}');
    const tabl = await checkCompanions(src('zfoo.tabl.json'));
    expect(tabl.missing).toEqual([]);
  });
});

// -------------------------------------------------------------------------
describe('CLAS include companion checks in a flat directory', () => {
  const PARTS = ['definitions', 'implementations', 'macros', 'testclasses'];

  function writeClasParts(prefix: string) {
    fs.writeFileSync(src(`${prefix}.clas.json`), '{}');
    fs.writeFileSync(src(`${prefix}.clas.abap`), 'CLASS ' + prefix + ' DEFINITION PUBLIC.\nENDCLASS.\n');
    for (const part of PARTS) fs.writeFileSync(src(`${prefix}.clas.${part}.abap`), '');
  }

  it('recognises the full include set next to other types', async () => {
    writeClasParts('zfoo');
    // A same-named TABL family must not confuse the CLAS include check.
    fs.writeFileSync(src('zfoo.tabl.json'), '{}');
    fs.writeFileSync(src('zfoo.tabl.ddic'), '');
    fs.writeFileSync(src('zfoo.tabl.settings.json'), '{}');

    const r = await checkCompanions(src('zfoo.clas.json'));
    expect(r.missing).toEqual([]);
    expect(r.optional).toEqual(['zfoo.clas.texts.en.properties']);
    expect(r.severity).toBe('ok');
  });

  it('treats include files as optional, requires the main source, ignores TABL lookalikes', async () => {
    writeClasParts('zfoo');
    fs.writeFileSync(src('zfoo.tabl.implementations.abap'), 'not a class include');

    // A pulled class may have any subset of the optional includes.
    fs.rmSync(src('zfoo.clas.macros.abap'));
    fs.rmSync(src('zfoo.clas.testclasses.abap'));
    const partial = await checkCompanions(src('zfoo.clas.json'));
    expect(partial.missing).toEqual([]);
    expect(partial.optional).toEqual([
      'zfoo.clas.macros.abap',
      'zfoo.clas.testclasses.abap',
      'zfoo.clas.texts.en.properties',
    ]);
    expect(partial.severity).toBe('ok');

    // Only the main source is structural.
    fs.rmSync(src('zfoo.clas.abap'));
    const noMain = await checkCompanions(src('zfoo.clas.json'));
    expect(noMain.missing).toEqual(['zfoo.clas.abap']);
    expect(noMain.severity).toBe('structural');
  });

  it('handles namespaced class artifacts flat', async () => {
    writeClasParts('(ui2)cl_json');
    const r = await checkCompanions(src('(ui2)cl_json.clas.json'));
    expect(r.missing).toEqual([]);
    expect(r.severity).toBe('ok');
  });
});

// -------------------------------------------------------------------------
describe('namespaced objects end-to-end (flat AFF token)', () => {
  it('create local writes (ui2)cl_json.clas.abap and push resolves /UI2/CL_JSON', async () => {
    const created = await runCreateLocal(['CLAS', '/UI2/CL_JSON']);
    expect(created.exitCode, created.stderr).toBeUndefined();
    const data = JSON.parse(created.stdout).data;
    expect(data.file).toBe('src/(ui2)cl_json.clas.abap');
    expect(fs.existsSync(src('(ui2)cl_json.clas.abap'))).toBe(true);

    // Push reads the same flat file back to the namespaced ADT object.
    mockClassObject('/UI2/CL_JSON', 'CLASS /UI2/CL_JSON DEFINITION PUBLIC.\nENDCLASS.');
    const pushed = await runPush(['src/(ui2)cl_json.clas.abap', '--tr', 'TRN001']);
    expect(pushed.exitCode, pushed.stderr).toBeUndefined();
    expect(searchObject).toHaveBeenCalledWith('/UI2/CL_JSON', 'CLAS', expect.any(Number));
    expect(lock).toHaveBeenCalledWith('/sap/bc/adt/oo/classes/ui2/cl_json');
    expect(setObjectSource).toHaveBeenCalled();
    const results = JSON.parse(pushed.stdout).data.results as Array<{ status: string }>;
    expect(results[0]?.status).toBe('activated');
  });

  it('pull writes namespaced artifacts with the parentheses token', async () => {
    mockClassObject('/UI2/CL_JSON', 'CLASS /UI2/CL_JSON DEFINITION PUBLIC.\nENDCLASS.');
    searchObject.mockResolvedValue([
      {
        'adtcore:name': '/UI2/CL_JSON',
        'adtcore:type': 'CLAS/OC',
        'adtcore:uri': '/sap/bc/adt/oo/classes/ui2/cl_json',
      },
    ]);
    objectStructure.mockResolvedValue({
      objectUrl: '/sap/bc/adt/oo/classes/ui2/cl_json',
      metaData: {
        'adtcore:description': 'JSON helper',
        'adtcore:masterLanguage': 'EN',
        'adtcore:type': 'CLAS/OC',
        'abapsource:sourceUri': '/sap/bc/adt/oo/classes/ui2/cl_json/source/main',
      },
      includes: [
        {
          'class:includeType': 'main',
          'abapsource:sourceUri': '/sap/bc/adt/oo/classes/ui2/cl_json/source/main',
        },
      ],
    });
    getObjectSource.mockImplementation(async (url: string) => `" ${url}`);

    const res = await runPull(['/UI2/CL_JSON', '--type', 'CLAS']);
    expect(res.exitCode, res.stderr).toBeUndefined();
    expect(fs.existsSync(src('(ui2)cl_json.clas.json'))).toBe(true);
    expect(fs.existsSync(src('(ui2)cl_json.clas.abap'))).toBe(true);
    expect(fs.existsSync(src('#ui2#cl_json.clas.abap'))).toBe(false);
  });

  it('pushes (ui2)cl_json.ttyp.json as /UI2/CL_JSON', async () => {
    fs.writeFileSync(
      src('(ui2)cl_json.ttyp.json'),
      JSON.stringify({
        formatVersion: '1',
        header: { description: 'Namespaced table type', originalLanguage: 'EN' },
        accessType: 'standard',
        lineType: { rowType: 'STRING' },
      }),
    );

    const res = await runPush(['src/(ui2)cl_json.ttyp.json', '--tr', 'TRN001']);
    expect(res.exitCode, res.stderr).toBeUndefined();
    // The flat AFF token round-trips to the ABAP repository name.
    expect(getTtyp).toHaveBeenCalledWith('/UI2/CL_JSON');
    expect(updateTtyp).toHaveBeenCalledWith(
      '/UI2/CL_JSON',
      expect.stringContaining('ttyp:tableType'),
      'lock-1',
      'TRN001',
    );
    const results = JSON.parse(res.stdout).data.results as Array<{ status: string; stage: string }>;
    expect(results[0]).toMatchObject({ status: 'written', stage: 'channel-adt' });
  });

  it('rejects a retired # namespace filename with a readable FILE_PARSE_ERROR', async () => {
    fs.writeFileSync(src('#ui2#cl_json.ttyp.json'), '{}');
    const res = await runPush(['src/#ui2#cl_json.ttyp.json', '--tr', 'TRN001']);
    expect(res.exitCode).not.toBeUndefined();
    const err = JSON.parse(res.stderr);
    expect(err.error.code).toBe('FILE_PARSE_ERROR');
    expect(err.error.message).toMatch(/retired '#' namespace token/);
  });
});

// -------------------------------------------------------------------------
describe('resolveFile on flat artifacts', () => {
  it('keeps namespaced and typed tokens unambiguous', () => {
    const clas = resolveFile('src/(ui2)cl_json.clas.abap');
    expect(clas.objectName).toBe('/UI2/CL_JSON');
    expect(clas.objectType).toBe('CLAS');
    const tabl = resolveFile('src/(ui2)cl_json.tabl.json');
    expect(tabl.objectName).toBe('/UI2/CL_JSON');
    expect(tabl.objectType).toBe('TABL');
  });
});
