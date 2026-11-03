/**
 * Generic AFF flows through the real command layer (SAP clients mocked).
 *
 * The six AFF types use two transports:
 *   - APLO / CHDO / EVTB / SMBC: ADT blueSource resources whose `source/main`
 *     is the AFF document (create/pull/push/delete with ADT lock/corrNr);
 *   - ENHO / ENHS: read-only ICF `/aff` endpoint (pull only; create/push/delete
 *     are rejected locally with an actionable message).
 *
 * These tests pin the dispatch, document validation, transport rule, error
 * mapping (404/409/400/activation) and the dry-run/atomic guarantees.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { registerCreateCommand } from '../../src/abap_cli/commands/create.js';
import { registerPullCommand } from '../../src/abap_cli/commands/pull.js';
import { registerPushCommand } from '../../src/abap_cli/commands/push.js';
import { registerDeleteCommand } from '../../src/abap_cli/commands/delete.js';
import { makeProgram, runCommand } from './cli-helper.js';
import { CliError } from '../../src/abap_cli/output/json.js';

// --- ICF mock (ENHO/ENHS pull) -------------------------------------------
const icfGetAff = vi.fn();
const icfPostAff = vi.fn();
const icfPutAff = vi.fn();
const icfDeleteAff = vi.fn();

vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: {
    create: async () => ({ getAff: icfGetAff, postAff: icfPostAff, putAff: icfPutAff, deleteAff: icfDeleteAff }),
  },
}));

// --- ADT mock (APLO/CHDO/EVTB/SMBC) --------------------------------------
const adtCreate = vi.fn(async () => undefined);
const adtWrite = vi.fn(async () => undefined);
const adtGetMeta = vi.fn();
const adtGetSource = vi.fn();
const adtDelete = vi.fn(async () => undefined);

const adtMock = {
  createBlueSourceObject: adtCreate,
  writeBlueSourceSource: adtWrite,
  getBlueSourceObject: adtGetMeta,
  getBlueSourceSource: adtGetSource,
  deleteBlueSourceObject: adtDelete,
  getConfig: () => ({ sap: { username: 'MOCKUSER', client: '100', language: 'EN' }, transport: '' }),
};

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: { create: async () => adtMock },
}));

const HEADER = { description: 'mock AFF object', originalLanguage: 'en' };
const DOCS: Record<string, Record<string, unknown>> = {
  APLO: { formatVersion: '1', header: HEADER, subobjects: [] },
  CHDO: {
    formatVersion: '1',
    header: HEADER,
    tablesAndStructures: [],
    errorMessage: { id: 'MOCK', number: '001' },
  },
  EVTB: {
    formatVersion: '1',
    header: HEADER,
    producerNamespace: 'MOCK',
    boName: 'MOCK',
    boOperation: 'mock',
    events: [],
  },
  SMBC: {
    formatVersion: '1',
    header: HEADER,
    serviceConfiguration: {
      serviceBinding: 'MOCK',
      serviceName: 'MOCK',
      serviceVersion: '1',
      rootEntitySet: 'MOCK',
      name: 'MOCK',
    },
  },
  ENHS: {
    formatVersion: '1',
    header: HEADER,
    configuration: { tool: 'badiDefinition' },
  },
};

let cwd: string;

function metaXml(name: string, pkg = '$TMP', description = 'mock AFF object'): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<blue:blueSource xmlns:blue="http://www.sap.com/wbobj/blue" xmlns:adtcore="http://www.sap.com/adt/core"' +
    ` adtcore:name="${name}" adtcore:type="APLO/TYP" adtcore:description="${description}"` +
    ' adtcore:language="EN" adtcore:masterLanguage="EN">' +
    `<adtcore:packageRef adtcore:name="${pkg}"/>` +
    '</blue:blueSource>'
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aff-flows-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  adtGetMeta.mockResolvedValue(metaXml('ZCLI_MOCK_APLO'));
  adtGetSource.mockResolvedValue(JSON.stringify(DOCS.APLO));
  icfGetAff.mockResolvedValue({
    status: 'success' as const,
    data: {
      type: 'ENHS',
      name: 'ZCLI_MOCK_ENHS',
      package: '$TMP',
      files: [{ name: 'zcli_mock_enhs.enhs.json', content: JSON.stringify(DOCS.ENHS) + '\n' }],
    },
    error: null,
  });
});

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

function run(command: 'create' | 'pull' | 'push' | 'delete', args: string[]) {
  const program = makeProgram();
  if (command === 'create') registerCreateCommand(program);
  if (command === 'pull') registerPullCommand(program);
  if (command === 'push') registerPushCommand(program);
  if (command === 'delete') registerDeleteCommand(program);
  return runCommand(program, [command, ...args, '--json'], { cwd });
}

function parse(result: { stdout: string; stderr: string }): Record<string, any> {
  const text = result.stdout.trim() ? result.stdout : result.stderr;
  return JSON.parse(text.slice(text.indexOf('{')));
}

function writeDoc(type: string, name: string, doc: Record<string, unknown> = DOCS[type]!): string {
  const fileName = `${name.toLowerCase()}.${type.toLowerCase()}.json`;
  fs.writeFileSync(path.join(cwd, 'src', fileName), JSON.stringify(doc, null, 2) + '\n', 'utf8');
  return `src/${fileName}`;
}

function sapError(httpStatus: number, message: string): CliError {
  return new CliError('SAP_ERROR', message, {
    details: { httpStatus, sapErrorBody: `<message>${message}</message>` },
  });
}

describe('AFF create — ADT blueSource (APLO/CHDO/EVTB/SMBC)', () => {
  it('creates then writes the AFF document and pulls it back', async () => {
    const rel = writeDoc('APLO', 'ZCLI_MOCK_APLO');
    const res = await run('create', ['APLO', 'ZCLI_MOCK_APLO', '--file', rel, '--package', '$TMP', '--yes']);
    expect(res.exitCode).toBeUndefined();
    expect(adtCreate).toHaveBeenCalledTimes(1);
    expect(adtWrite).toHaveBeenCalledTimes(1);
    const [type, name, meta] = adtCreate.mock.calls[0]!;
    expect([type, name]).toEqual(['APLO', 'ZCLI_MOCK_APLO']);
    expect(meta).toMatchObject({ packageName: '$TMP', description: 'mock AFF object', originalLanguage: 'EN' });
    // create-then-pull
    expect(adtGetSource).toHaveBeenCalled();
    expect(adtGetMeta).toHaveBeenCalled();
    expect(parse(res).data).toMatchObject({
      object: 'ZCLI_MOCK_APLO',
      type: 'APLO',
      channel: 'adt',
      action: 'created',
      package: '$TMP',
      activated: true,
    });
  });

  it('POSTs the document verbatim (no field mapping)', async () => {
    const rel = writeDoc('CHDO', 'ZCLI_MOCK_CHDO');
    await run('create', ['CHDO', 'ZCLI_MOCK_CHDO', '--file', rel, '--package', '$TMP', '--yes']);
    const writeArgs = adtWrite.mock.calls[0]!;
    expect(writeArgs[2]).toBe(fs.readFileSync(path.join(cwd, rel), 'utf8'));
  });

  it('--no-pull skips the create-then-pull copy', async () => {
    const rel = writeDoc('EVTB', 'ZCLI_MOCK_EVTB');
    const res = await run('create', ['EVTB', 'ZCLI_MOCK_EVTB', '--file', rel, '--package', '$TMP', '--no-pull', '--yes']);
    expect(res.exitCode).toBeUndefined();
    expect(adtGetSource).not.toHaveBeenCalled();
    expect(parse(res).data).toMatchObject({ action: 'created', channel: 'adt' });
  });

  it('rejects a transportable package without --tr before any SAP write', async () => {
    const rel = writeDoc('APLO', 'ZCLI_MOCK_APLO');
    const res = await run('create', ['APLO', 'ZCLI_MOCK_APLO', '--file', rel, '--package', 'ZPKG', '--yes']);
    expect(res.exitCode).toBe(7);
    expect(parse(res).error.code).toBe('AFF_TRANSPORT_REQUIRED');
    expect(adtCreate).not.toHaveBeenCalled();
    expect(adtWrite).not.toHaveBeenCalled();
  });

  it('passes --tr through to the create/write calls', async () => {
    const rel = writeDoc('APLO', 'ZCLI_MOCK_APLO');
    const res = await run('create', [
      'APLO', 'ZCLI_MOCK_APLO', '--file', rel, '--package', 'ZPKG', '--tr', 'ndk900123', '--yes',
    ]);
    expect(res.exitCode).toBeUndefined();
    expect(adtCreate.mock.calls[0]![2]).toMatchObject({ transport: 'NDK900123' });
    expect(adtWrite.mock.calls[0]![3]).toMatchObject({ transport: 'NDK900123' });
  });

  it('maps a duplicate object (409) to AFF_ALREADY_EXISTS', async () => {
    adtCreate.mockRejectedValueOnce(sapError(409, 'CHDO ZCLI_MOCK_CHDO already exists'));
    const rel = writeDoc('CHDO', 'ZCLI_MOCK_CHDO');
    const res = await run('create', ['CHDO', 'ZCLI_MOCK_CHDO', '--file', rel, '--package', '$TMP', '--yes']);
    expect(res.exitCode).toBe(7);
    expect(parse(res).error.code).toBe('AFF_ALREADY_EXISTS');
  });

  it('maps a save rejection (400) to VALIDATION_ERROR with the SAP message', async () => {
    adtWrite.mockRejectedValueOnce(sapError(400, 'Event already exists'));
    const rel = writeDoc('EVTB', 'ZCLI_MOCK_EVTB');
    const res = await run('create', ['EVTB', 'ZCLI_MOCK_EVTB', '--file', rel, '--package', '$TMP', '--yes']);
    expect(res.exitCode).toBe(7);
    const err = parse(res).error;
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toContain('Event already exists');
  });

  it('surfaces activation failures as ACTIVATION_FAILED with SAP messages (exit 7)', async () => {
    adtWrite.mockRejectedValueOnce(
      new CliError('ACTIVATION_FAILED', 'Activation failed for ZCLI_MOCK_EVTB: duplicate events', {
        details: { messages: [{ type: 'E', text: 'duplicate event' }] },
        nextSteps: ['fix it'],
      }),
    );
    const rel = writeDoc('EVTB', 'ZCLI_MOCK_EVTB');
    const res = await run('create', ['EVTB', 'ZCLI_MOCK_EVTB', '--file', rel, '--package', '$TMP', '--yes']);
    expect(res.exitCode).toBe(7);
    expect(parse(res).error.code).toBe('ACTIVATION_FAILED');
    expect(parse(res).error.message).toContain('EVTB ZCLI_MOCK_EVTB');
  });

  it('validates the document against the vendored schema before any SAP call', async () => {
    const rel = writeDoc('APLO', 'ZCLI_MOCK_APLO', { formatVersion: '2' });
    const res = await run('create', ['APLO', 'ZCLI_MOCK_APLO', '--file', rel, '--package', '$TMP', '--yes']);
    expect(res.exitCode).toBe(7);
    expect(parse(res).error.code).toBe('VALIDATION_ERROR');
    expect(adtCreate).not.toHaveBeenCalled();
  });

  it('rejects a multi-file local bundle (ADT channel is single-document)', async () => {
    const rel = writeDoc('APLO', 'ZCLI_MOCK_APLO');
    fs.writeFileSync(path.join(cwd, 'src', 'zcli_mock_aplo.aplo.notes.txt'), 'companion', 'utf8');
    const res = await run('create', ['APLO', 'ZCLI_MOCK_APLO', '--file', rel, '--package', '$TMP', '--yes']);
    expect(res.exitCode).toBe(7);
    expect(parse(res).error.code).toBe('VALIDATION_ERROR');
    expect(adtCreate).not.toHaveBeenCalled();
  });

  it('applies --description to the AFF header', async () => {
    const rel = writeDoc('APLO', 'ZCLI_MOCK_APLO');
    await run('create', [
      'APLO', 'ZCLI_MOCK_APLO', '--file', rel, '--package', '$TMP', '--description', 'overridden', '--yes',
    ]);
    expect(JSON.parse(adtWrite.mock.calls[0]![2] as string).header.description).toBe('overridden');
    expect(adtCreate.mock.calls[0]![2]).toMatchObject({ description: 'overridden' });
  });

  it('--check-only validates locally without any SAP call', async () => {
    const rel = writeDoc('APLO', 'ZCLI_MOCK_APLO');
    const res = await run('create', ['APLO', 'ZCLI_MOCK_APLO', '--file', rel, '--package', '$TMP', '--check-only', '--yes']);
    expect(res.exitCode).toBeUndefined();
    expect(parse(res).data).toMatchObject({ checkOnly: true, valid: true, channel: 'adt-blue' });
    expect(adtCreate).not.toHaveBeenCalled();
  });

  it('rejects --no-activate (AFF writes save + activate in one step)', async () => {
    const rel = writeDoc('APLO', 'ZCLI_MOCK_APLO');
    const res = await run('create', ['APLO', 'ZCLI_MOCK_APLO', '--file', rel, '--package', '$TMP', '--no-activate', '--yes']);
    expect(res.exitCode).toBe(7);
    expect(parse(res).error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts APLO names up to 20 characters and rejects longer names locally', async () => {
    const okName = 'ZCLI_APLO_LONG_NAME1';
    expect(okName.length).toBe(20);
    const rel = writeDoc('APLO', okName);
    const ok = await run('create', ['APLO', okName, '--file', rel, '--package', '$TMP', '--no-pull', '--yes']);
    expect(ok.exitCode).toBeUndefined();
    expect(adtCreate.mock.calls[0]![1]).toBe(okName);

    const tooLong = 'ZCLI_APLO_LONG_NAME12';
    expect(tooLong.length).toBe(21);
    const rel2 = writeDoc('APLO', tooLong);
    const bad = await run('create', ['APLO', tooLong, '--file', rel2, '--package', '$TMP', '--yes']);
    expect(bad.exitCode).toBe(7);
    expect(parse(bad).error.code).toBe('VALIDATION_ERROR');
    expect(String(parse(bad).error.message)).toMatch(/20/);
  });

  it('rejects CHDO names above 16 characters before any SAP call', async () => {
    const rel = writeDoc('CHDO', 'ZCLI_MOCK_CHDO');
    const res = await run('create', [
      'CHDO', 'ZCLI_CHDO_SEVENTEEN', '--file', rel, '--package', '$TMP', '--yes',
    ]);
    expect(res.exitCode).toBe(7);
    expect(parse(res).error.code).toBe('VALIDATION_ERROR');
    expect(String(parse(res).error.message)).toMatch(/16/);
    expect(adtCreate).not.toHaveBeenCalled();
  });
});

describe('AFF pull — both channels', () => {
  it('pulls an ADT object: metadata + source/main written verbatim', async () => {
    const res = await run('pull', ['ZCLI_MOCK_APLO', '--type', 'APLO']);
    expect(res.exitCode).toBeUndefined();
    expect(adtGetSource).toHaveBeenCalledWith('APLO', 'ZCLI_MOCK_APLO');
    expect(adtGetMeta).toHaveBeenCalledWith('APLO', 'ZCLI_MOCK_APLO');
    const data = parse(res).data;
    expect(data).toMatchObject({
      object: 'ZCLI_MOCK_APLO',
      type: 'APLO',
      channel: 'adt-blue',
      package: '$TMP',
      written: ['src/zcli_mock_aplo.aplo.json'],
    });
    expect(fs.readFileSync(path.join(cwd, 'src', 'zcli_mock_aplo.aplo.json'), 'utf8')).toBe(
      JSON.stringify(DOCS.APLO),
    );
  });

  it('pulls an ICF read-only ENHS via /aff', async () => {
    const res = await run('pull', ['ZCLI_MOCK_ENHS', '--type', 'ENHS']);
    expect(res.exitCode).toBeUndefined();
    expect(icfGetAff).toHaveBeenCalledWith('ENHS', 'ZCLI_MOCK_ENHS');
    expect(parse(res).data).toMatchObject({
      object: 'ZCLI_MOCK_ENHS',
      type: 'ENHS',
      channel: 'icf',
      written: ['src/zcli_mock_enhs.enhs.json'],
    });
  });

  it('requires --overwrite for an existing file (exit 2)', async () => {
    writeDoc('APLO', 'ZCLI_MOCK_APLO');
    const res = await run('pull', ['ZCLI_MOCK_APLO', '--type', 'APLO']);
    expect(res.exitCode).toBe(2);
    expect(parse(res).error.code).toBe('OVERWRITE_REQUIRED');
  });

  it('maps a missing ADT object to OBJECT_NOT_FOUND (exit 8)', async () => {
    adtGetSource.mockRejectedValueOnce(sapError(404, 'not found'));
    const res = await run('pull', ['ZCLI_MOCK_APLO', '--type', 'APLO']);
    expect(res.exitCode).toBe(8);
    expect(parse(res).error.code).toBe('OBJECT_NOT_FOUND');
  });

  it('maps a missing ENHS to OBJECT_NOT_FOUND (exit 8)', async () => {
    icfGetAff.mockResolvedValueOnce({ status: 'error' as const, data: null, error: { code: 'AFF_NOT_FOUND', message: 'not found' } });
    const res = await run('pull', ['ZCLI_MOCK_ENHS', '--type', 'ENHS']);
    expect(res.exitCode).toBe(8);
    expect(parse(res).error.code).toBe('OBJECT_NOT_FOUND');
  });
});

describe('AFF push — ADT blueSource', () => {
  it('updates an existing object (metadata probe, locked write, activation)', async () => {
    const rel = writeDoc('APLO', 'ZCLI_MOCK_APLO');
    const res = await run('push', [rel, '--yes']);
    expect(res.exitCode).toBeUndefined();
    expect(adtGetMeta).toHaveBeenCalledWith('APLO', 'ZCLI_MOCK_APLO');
    expect(adtWrite).toHaveBeenCalledTimes(1);
    expect(parse(res).data.results[0]).toMatchObject({ status: 'written', channel: 'adt', transport: '' });
  });

  it('never writes on --dry-run', async () => {
    const rel = writeDoc('APLO', 'ZCLI_MOCK_APLO');
    const res = await run('push', [rel, '--dry-run', '--yes']);
    expect(res.exitCode).toBeUndefined();
    expect(parse(res).data).toMatchObject({ dryRun: true });
    expect(adtGetMeta).not.toHaveBeenCalled();
    expect(adtWrite).not.toHaveBeenCalled();
  });

  it('maps a missing object to OBJECT_NOT_FOUND with a create hint (exit 8)', async () => {
    adtGetMeta.mockRejectedValueOnce(sapError(404, 'not found'));
    const rel = writeDoc('APLO', 'ZCLI_MOCK_APLO');
    const res = await run('push', [rel, '--yes']);
    expect(res.exitCode).toBe(8);
    expect(parse(res).error.code).toBe('OBJECT_NOT_FOUND');
    expect(adtWrite).not.toHaveBeenCalled();
  });

  it('requires --tr when the existing object is transportable (exit 7)', async () => {
    adtGetMeta.mockResolvedValueOnce(metaXml('ZCLI_MOCK_APLO', 'ZPKG'));
    const rel = writeDoc('APLO', 'ZCLI_MOCK_APLO');
    const res = await run('push', [rel, '--yes']);
    expect(res.exitCode).toBe(7);
    expect(parse(res).error.code).toBe('AFF_TRANSPORT_REQUIRED');
    expect(adtWrite).not.toHaveBeenCalled();
  });

  it('passes --tr (corrNr) for a transportable object', async () => {
    adtGetMeta.mockResolvedValueOnce(metaXml('ZCLI_MOCK_APLO', 'ZPKG'));
    const rel = writeDoc('APLO', 'ZCLI_MOCK_APLO');
    const res = await run('push', [rel, '--tr', 'ndk900123', '--yes']);
    expect(res.exitCode).toBeUndefined();
    expect(adtWrite.mock.calls[0]![3]).toMatchObject({ transport: 'NDK900123' });
  });

  it('validates the bundle with --atomic before any write', async () => {
    const rel = writeDoc('APLO', 'ZCLI_MOCK_APLO', { formatVersion: '2' });
    const res = await run('push', [rel, '--atomic', '--yes']);
    expect(res.exitCode).toBe(7);
    expect(adtWrite).not.toHaveBeenCalled();
    expect(adtGetMeta).not.toHaveBeenCalled();
  });

  it('rejects a multi-file bundle for the single-document ADT channel', async () => {
    const rel = writeDoc('APLO', 'ZCLI_MOCK_APLO');
    fs.writeFileSync(path.join(cwd, 'src', 'zcli_mock_aplo.aplo.notes.txt'), 'companion', 'utf8');
    const res = await run('push', [rel, '--yes']);
    expect(res.exitCode).toBe(7);
    expect(parse(res).error.code).toBe('VALIDATION_ERROR');
    expect(adtWrite).not.toHaveBeenCalled();
  });
});

describe('AFF delete — ADT blueSource', () => {
  it('deletes through the ADT resource after reading the package', async () => {
    const res = await run('delete', ['ZCLI_MOCK_APLO', '--type', 'APLO', '--yes']);
    expect(res.exitCode).toBeUndefined();
    expect(adtDelete).toHaveBeenCalledWith('APLO', 'ZCLI_MOCK_APLO', undefined);
    expect(parse(res).data).toMatchObject({
      object: 'ZCLI_MOCK_APLO',
      type: 'APLO',
      channel: 'adt',
      packageName: '$TMP',
      deleted: true,
    });
  });

  it('requires --tr for a transportable object (exit 7)', async () => {
    adtGetMeta.mockResolvedValueOnce(metaXml('ZCLI_MOCK_APLO', 'ZPKG'));
    const res = await run('delete', ['ZCLI_MOCK_APLO', '--type', 'APLO', '--yes']);
    expect(res.exitCode).toBe(7);
    expect(parse(res).error.code).toBe('AFF_TRANSPORT_REQUIRED');
    expect(adtDelete).not.toHaveBeenCalled();
  });

  it('passes --tr as corrNr for a transportable object', async () => {
    adtGetMeta.mockResolvedValueOnce(metaXml('ZCLI_MOCK_APLO', 'ZPKG'));
    const res = await run('delete', ['ZCLI_MOCK_APLO', '--type', 'APLO', '--tr', 'ndk900123', '--yes']);
    expect(res.exitCode).toBeUndefined();
    expect(adtDelete).toHaveBeenCalledWith('APLO', 'ZCLI_MOCK_APLO', 'NDK900123');
  });

  it('maps a missing object to OBJECT_NOT_FOUND (exit 8)', async () => {
    adtGetMeta.mockRejectedValueOnce(sapError(404, 'not found'));
    const res = await run('delete', ['ZCLI_MOCK_APLO', '--type', 'APLO', '--yes']);
    expect(res.exitCode).toBe(8);
    expect(parse(res).error.code).toBe('OBJECT_NOT_FOUND');
    expect(adtDelete).not.toHaveBeenCalled();
  });
});

describe('AFF read-only types (ENHO/ENHS) — local rejections', () => {
  it('rejects create locally with an actionable message and no SAP call', async () => {
    const rel = writeDoc('ENHS', 'ZCLI_MOCK_ENHS');
    const res = await run('create', ['ENHS', 'ZCLI_MOCK_ENHS', '--file', rel, '--package', '$TMP', '--yes']);
    expect(res.exitCode).toBe(7);
    const err = parse(res).error;
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toMatch(/read-only/i);
    expect(icfPostAff).not.toHaveBeenCalled();
    expect(adtCreate).not.toHaveBeenCalled();
  });

  it('rejects push locally before any transport resolution', async () => {
    const rel = writeDoc('ENHS', 'ZCLI_MOCK_ENHS');
    const res = await run('push', [rel, '--yes']);
    expect(res.exitCode).toBe(7);
    const err = parse(res).error;
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toMatch(/read-only/i);
    expect(icfPutAff).not.toHaveBeenCalled();
    expect(adtWrite).not.toHaveBeenCalled();
  });

  it('rejects delete locally', async () => {
    const res = await run('delete', ['ZCLI_MOCK_ENHS', '--type', 'ENHS', '--yes']);
    expect(res.exitCode).toBe(7);
    expect(parse(res).error.code).toBe('VALIDATION_ERROR');
    expect(icfDeleteAff).not.toHaveBeenCalled();
    expect(adtDelete).not.toHaveBeenCalled();
  });
});
