/**
 * F-03 / F-04 — `abap create` description resolution + local-draft safety.
 *
 * F-03: `--file` is accepted as a substitute for `--description`, but the ADT
 * path forwarded `opts.description` (undefined) into the create body, where
 * `encodeAttr(undefined)` threw a raw
 * `Cannot read properties of undefined (reading 'replace')` reported as
 * `CREATE_FAILED`.
 *
 * F-04: `create` pulled the fresh skeleton back over an existing local draft
 * with no existence check, and wrote it to a different directory layout than
 * `abap pull` (`src/<obj>/` vs `src/<typeFolder>/<obj>/`).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { registerCreateCommand } from '../../src/abap_cli/commands/create.js';
import { CliError } from '../../src/abap_cli/output/json.js';
import { resetWarnings } from '../../src/abap_cli/output/meta.js';
import { makeProgram, runCommand } from './cli-helper.js';

const mocks = vi.hoisted(() => ({
  createObject: vi.fn(async () => undefined),
  validateNewObject: vi.fn(async () => ({ success: true, SHORT_TEXT: '' })),
  getObjectSource: vi.fn(async () => 'CLASS ZCL_NEW DEFINITION.\nENDCLASS.\n'),
  resolveObject: vi.fn(),
  getObjectParts: vi.fn(async () => [] as unknown[]),
  resolveTransport: vi.fn(async () => ''),
  pushObject: vi.fn(async () => undefined),
}));

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      createObject: mocks.createObject,
      validateNewObject: mocks.validateNewObject,
      getObjectSource: mocks.getObjectSource,
      getConfig: () => ({ transport: '' }),
    }),
  },
}));
vi.mock('../../src/abap_cli/core/resolve.js', () => ({
  resolveObject: mocks.resolveObject,
  getObjectParts: mocks.getObjectParts,
}));
vi.mock('../../src/abap_cli/core/transport.js', () => ({ resolveTransport: mocks.resolveTransport }));
vi.mock('../../src/abap_cli/flows/edit/push-object.js', () => ({ pushObject: mocks.pushObject }));
vi.mock('../../src/abap_cli/core/confirmation.js', () => ({ requireWriteConfirmation: () => undefined }));

let cwd: string;
let resolveCalls = 0;

beforeEach(() => {
  vi.clearAllMocks();
  resetWarnings();
  resolveCalls = 0;
  mocks.getObjectParts.mockResolvedValue([
    { subtype: 'main', sourceUrl: '/sap/bc/adt/programs/programs/znew/source/main' },
  ]);
  // First resolve (pre-create existence check) must report "not found";
  // afterwards the object resolves normally.
  mocks.resolveObject.mockImplementation(async (_client: unknown, name: string) => {
    resolveCalls += 1;
    if (resolveCalls === 1) {
      throw new CliError('OBJECT_NOT_FOUND', `Object ${name} not found in system`);
    }
    return {
      name,
      type: 'PROG/P',
      objectUrl: `/sap/bc/adt/programs/programs/${name.toLowerCase()}`,
      parts: [{ subtype: 'main', sourceUrl: `/sap/bc/adt/programs/programs/${name.toLowerCase()}/source/main` }],
    };
  });
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'create-f03-'));
});

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

function run(args: string[]) {
  const program = makeProgram();
  registerCreateCommand(program);
  return runCommand(program, ['create', ...args, '--package', '$TMP', '--yes', '--json'], { cwd });
}

function writeAff(rel: string, doc: unknown): string {
  const p = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(doc, null, 2));
  return rel;
}

describe('F-03 create --file description resolution', () => {
  it('fills the description from the AFF header instead of passing undefined', async () => {
    const file = writeAff('znew.prog.json', {
      formatVersion: '1',
      header: { description: 'From AFF header', originalLanguage: 'EN' },
      generalInformation: { programType: 'executableProgram' },
    });
    const res = await run(['PROG', 'ZNEW', '--file', file]);
    expect(res.exitCode, res.stderr).toBeUndefined();
    const arg = mocks.createObject.mock.calls[0]?.[0] as { description?: string };
    expect(arg.description).toBe('From AFF header');
    const parsed = JSON.parse(res.stdout);
    expect(parsed.status).toBe('success');
    expect(parsed.data.description).toBe('From AFF header');
  });

  it('accepts a flat top-level description (wire-flat shape)', async () => {
    const file = writeAff('znew.prog.json', {
      formatVersion: '1',
      description: 'Flat description',
      generalInformation: { programType: 'executableProgram' },
    });
    await run(['PROG', 'ZNEW', '--file', file]);
    const arg = mocks.createObject.mock.calls[0]?.[0] as { description?: string };
    expect(arg.description).toBe('Flat description');
  });

  it('reports a USAGE error (never a raw TypeError) when neither source has a description', async () => {
    const file = writeAff('znew.prog.json', {
      formatVersion: '1',
      header: { originalLanguage: 'EN' },
      generalInformation: { programType: 'executableProgram' },
    });
    const res = await run(['PROG', 'ZNEW', '--file', file]);
    const parsed = JSON.parse(res.stderr);
    expect(parsed.status).toBe('error');
    expect(parsed.error.code).toBe('USAGE');
    expect(parsed.error.message).toContain('header.description');
    expect(parsed.error.message).not.toContain('replace');
    expect(mocks.createObject).not.toHaveBeenCalled();
  });

  it('still requires one of --description / --file', async () => {
    const res = await run(['PROG', 'ZNEW']);
    const parsed = JSON.parse(res.stderr);
    expect(parsed.error.code).toBe('USAGE');
    expect(parsed.error.message).toContain('--description');
  });
});

describe('F-04 create local-draft safety + layout', () => {
  it('pulls the new object back with the same layout as `abap pull`', async () => {
    const res = await run(['PROG', 'ZNEW', '--description', 'd']);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.data.localFile).toBe('src/prog/znew/znew.prog.abap');
    expect(fs.existsSync(path.join(cwd, 'src/prog/znew/znew.prog.abap'))).toBe(true);
  });

  it('keeps an existing non-empty local draft and warns instead of clobbering it', async () => {
    const target = path.join(cwd, 'src/prog/znew/znew.prog.abap');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'REPORT znew.\n" my precious draft\n');
    const res = await run(['PROG', 'ZNEW', '--description', 'd']);
    const parsed = JSON.parse(res.stdout);
    expect(fs.readFileSync(target, 'utf-8')).toContain('my precious draft');
    expect(parsed.meta.warnings.map((w: { code: string }) => w.code)).toContain('LOCAL_FILE_KEPT');
  });

  it('--overwrite replaces the local draft', async () => {
    const target = path.join(cwd, 'src/prog/znew/znew.prog.abap');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'REPORT znew.\n" my precious draft\n');
    const res = await run(['PROG', 'ZNEW', '--description', 'd', '--overwrite']);
    const parsed = JSON.parse(res.stdout);
    expect(fs.readFileSync(target, 'utf-8')).not.toContain('my precious draft');
    expect(parsed.meta.warnings.map((w: { code: string }) => w.code)).not.toContain('LOCAL_FILE_KEPT');
  });

  it('overwrites silently when the existing file already matches SAP', async () => {
    const target = path.join(cwd, 'src/prog/znew/znew.prog.abap');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'CLASS ZCL_NEW DEFINITION.\nENDCLASS.\n');
    const res = await run(['PROG', 'ZNEW', '--description', 'd']);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.meta.warnings.map((w: { code: string }) => w.code)).not.toContain('LOCAL_FILE_KEPT');
  });
});
