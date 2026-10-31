/**
 * A source object's AFF `.json` is metadata, never ABAP source.
 *
 * `abap pull` writes `<name>.<type>.json` next to the real source file. Before
 * the guard, `abap push <name>.clas.json` fell through to the generic source
 * path: the JSON text was read as ABAP source and written into the object's
 * main include (and `--no-activate` still reported success). The guard rejects
 * the file before any ADT client is created, so a metadata-only push performs
 * zero SAP calls; `--all` never scans `.json` and keeps pushing the source
 * files only, and genuine AFF artifacts (TTYP …) still push through their
 * channel-routed handlers.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerPushCommand } from '../../src/abap_cli/commands/push.js';
import { makeProgram, runCommand } from './cli-helper.js';

// --- ADT mock -------------------------------------------------------------
const createClient = vi.fn();
const searchObject = vi.fn();
const objectStructure = vi.fn();
const getObjectSource = vi.fn();
const lock = vi.fn(async () => ({ LOCK_HANDLE: 'lock-1' }));
const unLock = vi.fn(async () => '');
const setObjectSource = vi.fn(async () => '');
const syntaxCheckContent = vi.fn(async () => [] as unknown[]);
const activate = vi.fn(async () => '');
const transportInfo = vi.fn(async () => ({ TRANSPORTS: [] as unknown[] }));
const getTtyp = vi.fn(async () => '<ttyp:tableType/>');
const updateTtyp = vi.fn(async () => undefined);

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => {
      createClient();
      return {
        searchObject,
        objectStructure,
        getObjectSource,
        lock,
        unLock,
        setObjectSource,
        syntaxCheckContent,
        activate,
        transportInfo,
        getTtyp,
        updateTtyp,
        getConfig: () => ({ sap: { username: 'MOCKUSER' }, transport: 'TRN001' }),
      };
    },
  },
}));

// --- config / ICF mocks (channel-routed push reads the workspace profile) ---
vi.mock('../../src/abap_cli/config/project-config.js', () => ({
  loadConfig: async () => ({ systemVersion: '793' }),
  findWorkspaceConfig: () => undefined,
}));

vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: {
    create: async () => ({
      getDdic: vi.fn(),
      put: vi.fn(async () => ({ status: 'success' as const, data: {}, error: null })),
      postDdic: vi.fn(),
      post: vi.fn(),
      get: vi.fn(),
    }),
  },
}));

// --- helpers --------------------------------------------------------------
let cwd: string;

beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'push-metadata-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

function src(...parts: string[]): string {
  return path.join(cwd, 'src', ...parts);
}

function runPush(args: string[]) {
  const program = makeProgram();
  registerPushCommand(program);
  return runCommand(program, ['push', ...args, '--yes', '--json'], { cwd });
}

function writeClassFixtures(): void {
  fs.writeFileSync(
    src('zcl_foo.clas.json'),
    JSON.stringify({ formatVersion: '1', header: { description: 'Demo class', originalLanguage: 'EN' } }),
  );
  fs.writeFileSync(src('zcl_foo.clas.abap'), 'CLASS zcl_foo DEFINITION PUBLIC.\nENDCLASS.\n');
}

function mockClassObject(name: string) {
  searchObject.mockResolvedValue([
    {
      'adtcore:name': name.toUpperCase(),
      'adtcore:type': 'CLAS/OC',
      'adtcore:uri': `/sap/bc/adt/oo/classes/${name.toLowerCase()}`,
      'adtcore:packageName': 'ZPKG',
    },
  ]);
  objectStructure.mockImplementation(async (objectUrl: string) => ({
    objectUrl,
    includes: [{ 'class:includeType': 'main', 'abapsource:sourceUri': `${objectUrl}/source/main` }],
  }));
  getObjectSource.mockImplementation(async (url: string) => `" ${url}`);
}

// -------------------------------------------------------------------------
describe('push of a source object metadata .json', () => {
  it('rejects `.clas.json` with READONLY_METADATA and zero ADT calls', async () => {
    writeClassFixtures();
    const res = await runPush(['src/zcl_foo.clas.json']);

    expect(res.exitCode).toBe(7);
    expect(res.stdout).toBe('');
    const err = JSON.parse(res.stderr).error;
    expect(err.code).toBe('READONLY_METADATA');
    expect(err.category).toBe('VALIDATION_ERROR');
    expect(err.message).toMatch(/object metadata, not ABAP source/);
    // Per-file failures surface through the push result list (same shape as
    // any other failing push file).
    expect(err.details.failed).toBe(1);
    expect(err.details.results[0]).toMatchObject({
      file: 'src/zcl_foo.clas.json',
      status: 'failed',
      code: 'READONLY_METADATA',
    });
    const steps = err.nextSteps.join('\n');
    expect(steps).toContain('abap push src/zcl_foo.clas.abap');
    expect(steps).toContain('abap validate:aff src/zcl_foo.clas.json');

    // Purely local rejection: no client, no read, no write, no activation.
    expect(createClient).not.toHaveBeenCalled();
    expect(lock).not.toHaveBeenCalled();
    expect(setObjectSource).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it('does not fake success under --no-activate', async () => {
    writeClassFixtures();
    const res = await runPush(['src/zcl_foo.clas.json', '--no-activate']);

    expect(res.exitCode).toBe(7);
    expect(JSON.parse(res.stderr).error.code).toBe('READONLY_METADATA');
    expect(createClient).not.toHaveBeenCalled();
    expect(setObjectSource).not.toHaveBeenCalled();
  });

  it('rejects metadata of the other source-routed types (FUGR)', async () => {
    fs.writeFileSync(src('zfg.fugr.json'), JSON.stringify({ formatVersion: '1' }));
    const fugr = await runPush(['src/zfg.fugr.json']);
    const err = JSON.parse(fugr.stderr).error;
    expect(err.code).toBe('READONLY_METADATA');
    expect(err.details.results[0]).toMatchObject({
      file: 'src/zfg.fugr.json',
      code: 'READONLY_METADATA',
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('--atomic reports the metadata file as a validation failure and writes nothing', async () => {
    writeClassFixtures();
    const res = await runPush(['src/zcl_foo.clas.abap', 'src/zcl_foo.clas.json', '--atomic']);

    expect(res.exitCode).toBe(7);
    const err = JSON.parse(res.stderr).error;
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details.atomic).toBe(true);
    expect(err.details.failures).toEqual([
      expect.objectContaining({ file: 'src/zcl_foo.clas.json', code: 'READONLY_METADATA' }),
    ]);
    expect(createClient).not.toHaveBeenCalled();
    expect(setObjectSource).not.toHaveBeenCalled();
  });

  it('--dry-run also rejects instead of planning a bogus write', async () => {
    writeClassFixtures();
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zcl_foo.clas.json', '--dry-run', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    expect(JSON.parse(res.stderr).error.code).toBe('READONLY_METADATA');
    expect(createClient).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------------------------
describe('the guard does not block legitimate pushes', () => {
  it('pushes the .abap source file normally', async () => {
    writeClassFixtures();
    mockClassObject('ZCL_FOO');
    const res = await runPush(['src/zcl_foo.clas.abap', '--tr', 'TRN001']);

    expect(res.exitCode, res.stderr).toBeUndefined();
    expect(setObjectSource).toHaveBeenCalledWith(
      '/sap/bc/adt/oo/classes/zcl_foo/source/main',
      expect.stringContaining('CLASS zcl_foo'),
      'lock-1',
      'TRN001',
    );
    // The push path demands execution: a silent activation no-op must fail.
    expect(activate).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      { requireExecuted: true },
    );
    const results = JSON.parse(res.stdout).data.results as Array<{ status: string }>;
    expect(results[0]?.status).toBe('activated');
  });

  it('still pushes a channel-routed AFF artifact (.ttyp.json)', async () => {
    fs.writeFileSync(
      src('ztype.ttyp.json'),
      JSON.stringify({
        formatVersion: '1',
        header: { description: 'Namespaced table type', originalLanguage: 'EN' },
        accessType: 'standard',
        lineType: { rowType: 'STRING' },
      }),
    );
    const res = await runPush(['src/ztype.ttyp.json', '--tr', 'TRN001']);

    expect(res.exitCode, res.stderr).toBeUndefined();
    expect(getTtyp).toHaveBeenCalledWith('ZTYPE');
    expect(updateTtyp).toHaveBeenCalledWith('ZTYPE', expect.stringContaining('ttyp:tableType'), 'lock-1', 'TRN001');
    const results = JSON.parse(res.stdout).data.results as Array<{ status: string; stage: string }>;
    expect(results[0]).toMatchObject({ status: 'written', stage: 'channel-adt' });
  });

  it('--all ignores metadata .json and pushes only the source files', async () => {
    writeClassFixtures();
    mockClassObject('ZCL_FOO');
    const res = await runPush(['--all']);

    expect(res.exitCode, res.stderr).toBeUndefined();
    const results = JSON.parse(res.stdout).data.results as Array<{ file: string; status: string }>;
    expect(results.map((r) => r.file)).toEqual(['src/zcl_foo.clas.abap']);
    expect(results[0]?.status).toBe('activated');
  });
});
