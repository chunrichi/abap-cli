/**
 * SRVB create — metadata-only ADT binding + optional publish.
 *
 * Pins the AFF → ADT mapping (binding type/category/services) and the
 * create → activate → optional publish lifecycle. The publish job endpoint is
 * mocked here; real-SAP publish requires a client/transport configuration that
 * permits local publishing.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { registerCreateCommand } from '../../src/abap_cli/commands/create.js';
import { makeProgram, runCommand } from './cli-helper.js';
import {
  buildSrvbCreateBody,
  parseBindingType,
  parsePublishJobResponse,
} from '../../src/abap_cli/clients/srvb.js';
import type { SrvbLocal } from '../../src/abap_cli/formats/srvb/json.js';

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { systemVersion: '793' } as { systemVersion?: string },
}));

const createSrvb = vi.fn(async () => undefined);
const activate = vi.fn(async () => undefined);
const publishSrvb = vi.fn(async () => ({ severity: 'OK', shortText: 'published locally', longText: '' }));

vi.mock('../../src/abap_cli/config/project-config.js', () => ({
  loadConfig: async () => mockConfig,
  readCaCertificate: () => undefined,
}));

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      createSrvb,
      activate,
      publishSrvb,
      getConfig: () => ({ transport: 'TRN001' }),
    }),
  },
}));

const SRVB_JSON = JSON.stringify({
  formatVersion: '1',
  header: { description: 'Travel service binding', originalLanguage: 'en' },
  bindingType: 'ODATA V4',
  bindingTypeCategory: 'webApi',
  services: [
    {
      name: '/AIF/MESSAGEMONITOR',
      versions: [{ serviceVersion: '0001', serviceDefinition: '/AIF/MESSAGEMONITOR' }],
    },
  ],
}, null, 2) + '\n';

const DOC = JSON.parse(SRVB_JSON) as SrvbLocal;

let cwd: string;

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.systemVersion = '793';
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'create-srvb-'));
});

function writeFixture(file = 'zcli_tc_srvb.srvb.json'): string {
  fs.writeFileSync(path.join(cwd, file), SRVB_JSON, 'utf8');
  return file;
}

function run(args: string[]) {
  const program = makeProgram();
  registerCreateCommand(program);
  return runCommand(
    program,
    [...args, '--package', '$TMP', '--description', 'test object', '--yes', '--json'],
    { cwd },
  );
}

describe('create SRVB — happy path', () => {
  it('creates and activates the binding without publishing', async () => {
    const file = writeFixture();
    const res = await run(['create', 'SRVB', 'ZCLI_TC_SRVB', '--file', file]);
    expect(res.exitCode).toBeUndefined();
    expect(createSrvb).toHaveBeenCalledWith('ZCLI_TC_SRVB', DOC, { packageName: '$TMP' });
    expect(activate).toHaveBeenCalledWith(
      '/sap/bc/adt/businessservices/bindings/zcli_tc_srvb',
      'SRVB/SVB',
      'ZCLI_TC_SRVB',
    );
    expect(publishSrvb).not.toHaveBeenCalled();
    expect(JSON.parse(res.stdout)).toMatchObject({
      status: 'success',
      data: { object: 'ZCLI_TC_SRVB', type: 'SRVB', action: 'created', channel: 'adt' },
    });
  });

  it('publishes when --publish is set', async () => {
    const file = writeFixture();
    const res = await run(['create', 'SRVB', 'ZCLI_TC_SRVB', '--file', file, '--publish']);
    expect(res.exitCode).toBeUndefined();
    expect(publishSrvb).toHaveBeenCalledWith('ZCLI_TC_SRVB', '0001', 'V4');
    expect(JSON.parse(res.stdout).data).toMatchObject({ published: true });
  });

  it('rejects --publish with --no-activate', async () => {
    const file = writeFixture();
    const res = await run(['create', 'SRVB', 'ZCLI_TC_SRVB', '--file', file, '--publish', '--no-activate']);
    expect(res.exitCode).toBe(7);
    expect(JSON.parse(res.stderr).error.code).toBe('VALIDATION_ERROR');
    expect(createSrvb).not.toHaveBeenCalled();
  });

  it('rejects an invalid bindingType before touching SAP', async () => {
    const bad = { ...DOC, bindingType: 'ODATA' };
    fs.writeFileSync(path.join(cwd, 'zcli_tc_srvb.srvb.json'), JSON.stringify(bad), 'utf8');
    const res = await run(['create', 'SRVB', 'ZCLI_TC_SRVB', '--file', 'zcli_tc_srvb.srvb.json']);
    expect(res.exitCode).toBe(7);
    expect(JSON.parse(res.stderr).error.code).toBe('VALIDATION_ERROR');
    expect(createSrvb).not.toHaveBeenCalled();
  });
});

describe('SRVB wire mapping', () => {
  it('parses the binding type into ADT type/version', () => {
    expect(parseBindingType('ODATA V4')).toEqual({ type: 'ODATA', version: 'V4' });
    expect(parseBindingType('ODATA V2')).toEqual({ type: 'ODATA', version: 'V2' });
    expect(parseBindingType('INA')).toEqual({ type: 'INA', version: '' });
  });

  it('builds a serviceBinding body with category and services', () => {
    const body = buildSrvbCreateBody(DOC, {
      name: 'ZCLI_TC_SRVB',
      packageName: '$TMP',
      language: 'EN',
    });
    expect(body).toContain('<srvb:serviceBinding');
    expect(body).toContain('adtcore:name="ZCLI_TC_SRVB"');
    expect(body).toContain('adtcore:type="SRVB/SVB"');
    expect(body).toContain('<adtcore:packageRef adtcore:name="$TMP"/>');
    expect(body).toContain('<srvb:services srvb:name="/AIF/MESSAGEMONITOR">');
    expect(body).toContain('<srvb:content srvb:version="0001">');
    expect(body).toContain('<srvb:serviceDefinition adtcore:name="/AIF/MESSAGEMONITOR"/>');
    expect(body).toContain('<srvb:binding srvb:type="ODATA" srvb:version="V4" srvb:category="1">');
  });

  it('parses publish job status', () => {
    expect(
      parsePublishJobResponse(
        '<asx:abap><asx:values><DATA><SEVERITY>OK</SEVERITY><SHORT_TEXT>published locally</SHORT_TEXT><LONG_TEXT/></DATA></asx:values></asx:abap>',
      ),
    ).toEqual({ severity: 'OK', shortText: 'published locally', longText: '' });
  });
});
