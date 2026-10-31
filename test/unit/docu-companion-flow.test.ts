/**
 * DOMA/DTEL long-text companion behavior in `abap pull` / `abap push`.
 *
 * Pull decisions pinned here:
 *   - remote text → companion written and reported in `data.entries`
 *   - DOCU_NOT_FOUND → main object pulled, no companion file
 *   - DOCU_NOT_FOUND + --overwrite + stale local companion → removed + warning
 *   - docu endpoint failure → `DOCU_PULL_FAILED` warning, main pull succeeds
 *   - remote text failing docu-v1 → `DOCU_PULL_INVALID`, nothing written
 *
 * Push decisions pinned here:
 *   - companion validated before the main object is written
 *   - companion POSTed after the main object (lines [] → delete)
 *   - no companion → only the main object is POSTed
 *   - --dry-run plans `ddic-icf → docu-icf` without any SAP call
 *   - direct `push <name>.doma.docu.json` is rejected with a pointer to main
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { registerPullCommand } from '../../src/abap_cli/commands/pull.js';
import { registerPushCommand } from '../../src/abap_cli/commands/push.js';
import { getWarnings, resetWarnings } from '../../src/abap_cli/output/meta.js';
import { makeProgram, runCommand } from './cli-helper.js';

const searchObject = vi.fn(async () => [] as unknown[]);

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      searchObject: (...args: unknown[]) => searchObject(...args),
      getConfig: () => ({
        sap: { username: 'MOCKUSER', client: '001', language: 'EN' },
        transport: 'TRN001',
        package: '$TMP',
      }),
      raw: { classRun: vi.fn() },
    }),
  },
}));

const icfGetDdic = vi.fn();
const icfGetDdicDocu = vi.fn();
const icfPostDdic = vi.fn();
const icfPostDdicDocu = vi.fn();

vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: {
    create: async () => ({
      getDdic: icfGetDdic,
      getDdicDocu: icfGetDdicDocu,
      postDdic: icfPostDdic,
      postDdicDocu: icfPostDdicDocu,
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
    }),
  },
}));

const DOMA_WIRE = {
  name: 'ZDOMA_DOCU',
  description: 'Domain with documentation',
  package: '$TMP',
  format: { dataType: 'CHAR', length: 10 },
};

const DOCU_LINES = [
  { format: 'H1', line: 'Domain documentation' },
  { format: '', line: '\tSAPscript markers stay as-is' },
];

function okData(data: unknown) {
  return { status: 'success' as const, data, error: null };
}

function errData(code: string, message = 'mock error') {
  return { status: 'error' as const, data: null, error: { code, message } };
}

let cwd: string;

function srcPath(rel: string): string {
  return path.join(cwd, rel);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetWarnings();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'docu-flow-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  icfGetDdic.mockResolvedValue(okData(DOMA_WIRE));
  icfGetDdicDocu.mockResolvedValue(okData({ formatVersion: '1', lines: DOCU_LINES }));
  icfPostDdic.mockResolvedValue(okData({ name: 'ZDOMA_DOCU', type: 'DOMA', action: 'updated' }));
  icfPostDdicDocu.mockResolvedValue(okData({ name: 'ZDOMA_DOCU', type: 'DOCU', action: 'saved' }));
});

function companionWarnings() {
  return getWarnings().filter((w) => w.code.startsWith('DOCU_'));
}

function json(result: { stdout: string; stderr: string }): Record<string, any> {
  const text = result.stdout.trim() ? result.stdout : result.stderr;
  return JSON.parse(text.slice(text.indexOf('{')));
}

const COMPANION = 'src/zdoma_docu.doma.docu.json';
const MAIN = 'src/zdoma_docu.doma.json';

function readCompanion(): { formatVersion: string; lines: Array<{ format: string; line: string }> } {
  return JSON.parse(fs.readFileSync(srcPath(COMPANION), 'utf8'));
}

describe('pull DOCU companion', () => {
  it('pulls the long text next to the main document and reports both files', async () => {
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZDOMA_DOCU', '--type', 'DOMA', '--dir', 'src', '--json'], {
      cwd,
    });
    expect(res.exitCode).toBeUndefined();
    expect(icfGetDdicDocu).toHaveBeenCalledWith('doma', 'ZDOMA_DOCU');
    const out = json(res);
    expect(out.data.entries).toEqual([
      { file: MAIN, status: 'written' },
      { file: COMPANION, status: 'written', kind: 'docu' },
    ]);
    expect(out.data.written).toEqual([MAIN, COMPANION]);
    expect(readCompanion()).toEqual({ formatVersion: '1', lines: DOCU_LINES });
    expect(out.meta.warnings).toEqual([]);
  });

  it('does not write a companion when SAP reports DOCU_NOT_FOUND', async () => {
    icfGetDdicDocu.mockResolvedValueOnce(errData('DOCU_NOT_FOUND'));
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZDOMA_DOCU', '--type', 'DOMA', '--dir', 'src', '--json'], {
      cwd,
    });
    expect(res.exitCode).toBeUndefined();
    expect(fs.existsSync(srcPath(MAIN))).toBe(true);
    expect(fs.existsSync(srcPath(COMPANION))).toBe(false);
    expect(companionWarnings()).toEqual([]);
  });

  it.each([
    ['DDIC_OBJECT_NOT_FOUND', 'older ICF deployment without the docu route'],
    ['NOT_FOUND', 'front controller without the docu route'],
    ['METHOD_NOT_ALLOWED', 'deployment with an unsupported docu method'],
  ])('treats %s as "no documentation" (no warning, old deployment)', async (code) => {
    icfGetDdicDocu.mockResolvedValueOnce(errData(code));
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZDOMA_DOCU', '--type', 'DOMA', '--dir', 'src', '--json'], {
      cwd,
    });
    expect(res.exitCode).toBeUndefined();
    expect(fs.existsSync(srcPath(MAIN))).toBe(true);
    expect(fs.existsSync(srcPath(COMPANION))).toBe(false);
    expect(companionWarnings()).toEqual([]);
  });

  it('keeps a stale local companion by default when the remote has no text', async () => {
    fs.writeFileSync(srcPath(COMPANION), JSON.stringify({ formatVersion: '1', lines: [{ format: '', line: 'stale' }] }));
    icfGetDdicDocu.mockResolvedValueOnce(errData('DOCU_NOT_FOUND'));
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZDOMA_DOCU', '--type', 'DOMA', '--dir', 'src', '--json'], {
      cwd,
    });
    expect(res.exitCode).toBeUndefined();
    expect(fs.existsSync(srcPath(COMPANION))).toBe(true);
    expect(companionWarnings()).toEqual([]);
  });

  it('removes a stale local companion with --overwrite and warns', async () => {
    fs.writeFileSync(srcPath(COMPANION), JSON.stringify({ formatVersion: '1', lines: [{ format: '', line: 'stale' }] }));
    icfGetDdicDocu.mockResolvedValueOnce(errData('DOCU_NOT_FOUND'));
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(
      program,
      ['pull', 'ZDOMA_DOCU', '--type', 'DOMA', '--dir', 'src', '--overwrite', '--json'],
      { cwd },
    );
    expect(res.exitCode).toBeUndefined();
    expect(fs.existsSync(srcPath(COMPANION))).toBe(false);
    const out = json(res);
    expect(out.data.deleted).toEqual([COMPANION]);
    expect(out.meta.warnings.map((w: { code: string }) => w.code)).toContain('DOCU_LOCAL_STALE_REMOVED');
  });

  it('keeps the main pull successful when the docu endpoint errors', async () => {
    icfGetDdicDocu.mockRejectedValueOnce(new Error('HTTP 404 docu route missing'));
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZDOMA_DOCU', '--type', 'DOMA', '--dir', 'src', '--json'], {
      cwd,
    });
    expect(res.exitCode).toBeUndefined();
    expect(fs.existsSync(srcPath(MAIN))).toBe(true);
    expect(fs.existsSync(srcPath(COMPANION))).toBe(false);
    const out = json(res);
    expect(out.meta.warnings.map((w: { code: string }) => w.code)).toContain('DOCU_PULL_FAILED');
  });

  it('does not write a companion that fails docu-v1 (line > 72 chars)', async () => {
    icfGetDdicDocu.mockResolvedValueOnce(
      okData({ formatVersion: '1', lines: [{ format: '', line: 'x'.repeat(73) }] }),
    );
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZDOMA_DOCU', '--type', 'DOMA', '--dir', 'src', '--json'], {
      cwd,
    });
    expect(res.exitCode).toBeUndefined();
    expect(fs.existsSync(srcPath(MAIN))).toBe(true);
    expect(fs.existsSync(srcPath(COMPANION))).toBe(false);
    const out = json(res);
    expect(out.meta.warnings.map((w: { code: string }) => w.code)).toContain('DOCU_PULL_INVALID');
  });

  it('writes a 72-char line and 2-char format unchanged (boundary)', async () => {
    const boundary = [
      { format: 'H1', line: 'x'.repeat(72) },
      { format: '', line: 'y'.repeat(72) },
    ];
    icfGetDdicDocu.mockResolvedValueOnce(okData({ formatVersion: '1', lines: boundary }));
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZDOMA_DOCU', '--type', 'DOMA', '--dir', 'src', '--json'], {
      cwd,
    });
    expect(res.exitCode).toBeUndefined();
    expect(readCompanion().lines).toEqual(boundary);
  });

  it('pulls a DTEL companion as <name>.dtel.docu.json', async () => {
    icfGetDdic.mockResolvedValueOnce(
      okData({
        name: 'ZDTEL_DOCU',
        description: 'Data element',
        package: '$TMP',
        dataTypeInformation: { category: 'predefinedType', predefinedType: { dataType: 'CHAR', length: 10 } },
      }),
    );
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZDTEL_DOCU', '--type', 'DTEL', '--dir', 'src', '--json'], {
      cwd,
    });
    expect(res.exitCode).toBeUndefined();
    expect(icfGetDdicDocu).toHaveBeenCalledWith('dtel', 'ZDTEL_DOCU');
    expect(fs.existsSync(srcPath('src/zdtel_docu.dtel.docu.json'))).toBe(true);
  });

  it('does not call the docu endpoint for TABL/STRU', async () => {
    icfGetDdic.mockResolvedValueOnce(
      okData({
        name: 'ZTAB_DOCU',
        type: 'TABL',
        mainJson: '{"formatVersion":"1"}',
        ddicSource: 'define table ztab_docu {\n key client : abap.clnt not null;\n}\n',
        hasSettings: false,
      }),
    );
    const program = makeProgram();
    registerPullCommand(program);
    await runCommand(program, ['pull', 'ZTAB_DOCU', '--type', 'TABL', '--dir', 'src', '--json'], { cwd });
    expect(icfGetDdicDocu).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// push
// ---------------------------------------------------------------------------

function writeDomaMain(extra: Record<string, unknown> = {}): void {
  fs.writeFileSync(
    srcPath(MAIN),
    JSON.stringify(
      {
        name: 'ZDOMA_DOCU',
        description: 'Domain with documentation',
        package: '$TMP',
        format: { dataType: 'CHAR', length: 10 },
        ...extra,
      },
      null,
      2,
    ) + '\n',
  );
}

function writeCompanion(doc: unknown): void {
  fs.writeFileSync(srcPath(COMPANION), JSON.stringify(doc, null, 2) + '\n');
}

describe('push DOCU companion', () => {
  it('pushes the companion after the main document and reports the action', async () => {
    writeDomaMain();
    writeCompanion({ formatVersion: '1', lines: DOCU_LINES });
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', MAIN, '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfPostDdic).toHaveBeenCalledTimes(1);
    expect(icfPostDdicDocu).toHaveBeenCalledWith('doma', 'ZDOMA_DOCU', {
      formatVersion: '1',
      lines: DOCU_LINES,
    });
    const out = json(res);
    expect(out.data.results[0]).toMatchObject({ file: MAIN, status: 'written', docu: 'saved' });
  });

  it('deletes the remote long text when the companion has lines: []', async () => {
    writeDomaMain();
    writeCompanion({ formatVersion: '1', lines: [] });
    icfPostDdicDocu.mockResolvedValueOnce(okData({ name: 'ZDOMA_DOCU', type: 'DOCU', action: 'deleted' }));
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', MAIN, '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfPostDdicDocu).toHaveBeenCalledWith('doma', 'ZDOMA_DOCU', { formatVersion: '1', lines: [] });
    expect(json(res).data.results[0]).toMatchObject({ docu: 'deleted' });
  });

  it('does not push documentation when no companion exists', async () => {
    writeDomaMain();
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', MAIN, '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfPostDdic).toHaveBeenCalledTimes(1);
    expect(icfPostDdicDocu).not.toHaveBeenCalled();
    expect(json(res).data.results[0].docu).toBeUndefined();
  });

  it('rejects an invalid companion before writing the main object (AFF_FIXTURE_INVALID)', async () => {
    writeDomaMain();
    writeCompanion({ formatVersion: '1', lines: [{ format: '', line: 'x'.repeat(73) }] });
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', MAIN, '--yes', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    expect(icfPostDdic).not.toHaveBeenCalled();
    expect(icfPostDdicDocu).not.toHaveBeenCalled();
    const out = json(res);
    expect(out.error.code).toBe('AFF_FIXTURE_INVALID');
    // The pushed file is the main document; the companion path is named in the cause.
    expect(out.error.details.results[0].file).toBe(MAIN);
    expect(out.error.message).toContain(COMPANION);
  });

  it('rejects a companion with a bad paragraph format', async () => {
    writeDomaMain();
    writeCompanion({ formatVersion: '1', lines: [{ format: 'ABC', line: 'line' }] });
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', MAIN, '--yes', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    expect(icfPostDdic).not.toHaveBeenCalled();
    expect(json(res).error.code).toBe('AFF_FIXTURE_INVALID');
  });

  it('plans ddic-icf → docu-icf under --dry-run without any SAP write', async () => {
    writeDomaMain();
    writeCompanion({ formatVersion: '1', lines: DOCU_LINES });
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', MAIN, '--dry-run', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const out = json(res);
    expect(out.data.dryRun).toBe(true);
    expect(out.data.results[0].plan).toEqual(['ddic-icf', 'docu-icf']);
    expect(icfPostDdic).not.toHaveBeenCalled();
    expect(icfPostDdicDocu).not.toHaveBeenCalled();
  });

  it('plans only ddic-icf when no companion exists', async () => {
    writeDomaMain();
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', MAIN, '--dry-run', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(json(res).data.results[0].plan).toEqual(['ddic-icf']);
  });

  it('rejects pushing the companion file directly', async () => {
    writeDomaMain();
    writeCompanion({ formatVersion: '1', lines: DOCU_LINES });
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', COMPANION, '--yes', '--json'], { cwd });
    expect(res.exitCode).toBe(2);
    expect(icfPostDdic).not.toHaveBeenCalled();
    expect(json(res).error.code).toBe('INVALID_ARGUMENT');
  });

  it('--atomic validates the companion before any write', async () => {
    writeDomaMain();
    writeCompanion({ formatVersion: '1', lines: [{ format: '', line: 'x'.repeat(73) }] });
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', MAIN, '--atomic', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBe(7);
    expect(icfPostDdic).not.toHaveBeenCalled();
    expect(json(res).error.code).toBe('VALIDATION_ERROR');
  });

  it('pushes a DTEL companion through /ddic/dtel/<name>/docu', async () => {
    const main = 'src/zdtel_docu.dtel.json';
    fs.writeFileSync(
      srcPath(main),
      JSON.stringify(
        {
          name: 'ZDTEL_DOCU',
          description: 'Data element',
          package: '$TMP',
          dataTypeInformation: { category: 'predefinedType', predefinedType: { dataType: 'CHAR', length: 10 } },
        },
        null,
        2,
      ) + '\n',
    );
    fs.writeFileSync(
      srcPath('src/zdtel_docu.dtel.docu.json'),
      JSON.stringify({ formatVersion: '1', lines: DOCU_LINES }, null, 2) + '\n',
    );
    icfPostDdic.mockResolvedValueOnce(okData({ name: 'ZDTEL_DOCU', type: 'DTEL', action: 'updated' }));
    icfGetDdic.mockResolvedValueOnce(
      okData({
        name: 'ZDTEL_DOCU',
        description: 'Data element',
        package: '$TMP',
        dataTypeInformation: { category: 'predefinedType', predefinedType: { dataType: 'CHAR', length: 10 } },
      }),
    );
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', main, '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfPostDdicDocu).toHaveBeenCalledWith('dtel', 'ZDTEL_DOCU', {
      formatVersion: '1',
      lines: DOCU_LINES,
    });
  });

  it('surfaces a docu POST failure as DOCU_PUSH_FAILED (exit 6)', async () => {
    writeDomaMain();
    writeCompanion({ formatVersion: '1', lines: DOCU_LINES });
    icfPostDdicDocu.mockResolvedValueOnce(errData('DOCU_SAVE_FAILED', 'DOKTL write failed'));
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', MAIN, '--yes', '--json'], { cwd });
    expect(res.exitCode).toBe(6);
    const out = json(res);
    expect(out.error.code).toBe('DOCU_PUSH_FAILED');
    expect(out.error.message).toContain('DOKTL write failed');
  });
});
