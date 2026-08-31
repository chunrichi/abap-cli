/**
  pull HTTP service via the ICF route.
 * Drives `abap pull <name> --type HTTP` → GET /http/<name> → local abap-file-format JSON.
 * Mirrors ddic-pull.test.ts but for the HTTP service object type.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerPullCommand } from '../../src/abap_cli/commands/pull.js';
import { makeProgram, runCommand } from './cli-helper.js';

const searchObject = vi.fn(async () => [] as any[]);

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      searchObject: (...args: unknown[]) => searchObject(...args),
      getConfig: () => ({ sap: { username: 'MOCKUSER', client: '001', language: 'EN' }, transport: 'TRN001', package: '$TMP' }),
      raw: { classRun: vi.fn() },
    }),
  },
}));

const icfGetHttp = vi.fn(async () => ({
  status: 'success' as const,
  data: {
    name: 'ZHTTP_TEST',
    description: 'HTTP service',
    originalLanguage: 'EN',
    handlerClass: 'ZCL_HTTP_HANDLER',
    url: '/sap/zhttp_test',
  },
  error: null,
}));

vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: {
    create: async () => ({
      getHttp: icfGetHttp,
      postHttp: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
    }),
  },
}));

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'http-pull-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
});

describe('022 pull HTTP service', () => {
  it('pulls an HTTP service via GET /http/<name> and writes local JSON', async () => {
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZHTTP_TEST', '--type', 'HTTP', '--dir', 'src', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfGetHttp).toHaveBeenCalledWith('ZHTTP_TEST');
    const out = JSON.parse(res.stdout);
    expect(out.data).toMatchObject({
      object: 'ZHTTP_TEST',
      type: 'HTTP',
      entries: [{ file: 'src/http/zhttp_test.http.json', status: 'written' }],
    });
    const written = fs.readFileSync(path.join(cwd, 'src/http/zhttp_test.http.json'), 'utf-8');
    const parsed = JSON.parse(written);
    // The local shape is the abap-file-format nested one (header + generalInformation).
    expect(parsed.name).toBe('ZHTTP_TEST');
    expect(parsed.formatVersion).toBe('1');
    expect(parsed.header.description).toBe('HTTP service');
    expect(parsed.header.originalLanguage).toBe('EN');
    expect(parsed.generalInformation.handlerClass).toBe('ZCL_HTTP_HANDLER');
    expect(parsed.generalInformation.url).toBe('/sap/zhttp_test');
  });

  it('uses --overwrite to replace an existing file', async () => {
    fs.mkdirSync(path.join(cwd, 'src/http'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src/http/zhttp_test.http.json'), '{"old":true}');
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZHTTP_TEST', '--type', 'HTTP', '--dir', 'src', '--overwrite', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const written = JSON.parse(fs.readFileSync(path.join(cwd, 'src/http/zhttp_test.http.json'), 'utf-8'));
    expect(written.name).toBe('ZHTTP_TEST');
  });

  it('maps HTTP_OBJECT_NOT_FOUND to OBJECT_NOT_FOUND (exit 8)', async () => {
    icfGetHttp.mockResolvedValueOnce({
      status: 'error',
      data: null,
      error: { code: 'HTTP_OBJECT_NOT_FOUND', message: 'not found' },
    });
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZHTTP_MISSING', '--type', 'HTTP', '--dir', 'src', '--json'], { cwd });
    expect(res.exitCode).toBe(8);
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('OBJECT_NOT_FOUND');
  });
});
