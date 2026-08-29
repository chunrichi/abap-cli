/**
  abap push of HTTP service .json files routes through the ICF /http/<name>
 * endpoint (pushHttpFile). Covers: wire conversion + transportRequest, $TMP
 * transport-free path, --check-only rejection, validation, dry-run.
 * Mirrors push-ddic.test.ts .
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerPushCommand } from '../../src/abap_cli/commands/push.js';
import { makeProgram, runCommand } from './cli-helper.js';

const icfPostHttp = vi.fn(async () => ({
  status: 'success' as const,
  data: { name: 'ZHTTP_TEST', type: 'HTTP', action: 'updated' },
  error: null,
}));

vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: {
    create: async () => ({
      postHttp: icfPostHttp,
      getHttp: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
    }),
  },
}));

// HTTP push never touches ADT — the client is created but unused.
vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      getConfig: () => ({ sap: { username: 'MOCKUSER' }, transport: '' }),
    }),
  },
}));

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'http-push-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
});

function writeHttpJson(pkg = 'ZPKG', extra: Record<string, unknown> = {}) {
  const json = {
    formatVersion: '1',
    header: { description: 'Test HTTP service', originalLanguage: 'EN' },
    generalInformation: { handlerClass: 'ZCL_HTTP_HANDLER', url: '/sap/zhttp_test' },
    name: 'ZHTTP_TEST',
    package: pkg,
    ...extra,
  };
  fs.writeFileSync(path.join(cwd, 'src/zhttp_test.http.json'), JSON.stringify(json, null, 2));
}

describe('022 abap push HTTP service (.json via ICF)', () => {
  it('pushes a .http.json via POST /http/<name> with the resolved transport', async () => {
    writeHttpJson('ZPKG');
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zhttp_test.http.json', '--tr', 'TRN001', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfPostHttp).toHaveBeenCalledWith('ZHTTP_TEST', expect.objectContaining({
      name: 'ZHTTP_TEST',
      description: 'Test HTTP service',
      originalLanguage: 'EN',
      handlerClass: 'ZCL_HTTP_HANDLER',
      url: '/sap/zhttp_test',
      transportRequest: 'TRN001',
    }));
    const out = JSON.parse(res.stdout);
    expect(out.data.results[0].status).toBe('written');
    expect(out.data.results[0].stage).toBe('ddic-icf');
    expect(out.data.results[0].transport).toBe('TRN001');
  });

  it('pushes a $TMP HTTP service with no transport and no --tr', async () => {
    writeHttpJson('$TMP');
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zhttp_test.http.json', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfPostHttp).toHaveBeenCalledWith('ZHTTP_TEST', expect.objectContaining({
      name: 'ZHTTP_TEST',
      transportRequest: undefined,
    }));
    const out = JSON.parse(res.stdout);
    expect(out.data.results[0].status).toBe('written');
    expect(out.data.results[0].transport).toBe('');
  });

  it('rejects --check-only for HTTP files', async () => {
    writeHttpJson('ZPKG');
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zhttp_test.http.json', '--check-only', '--yes', '--json'], { cwd });
    expect(res.exitCode).not.toBe(0);
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('VALIDATION_ERROR');
    expect(icfPostHttp).not.toHaveBeenCalled();
  });

  it('fails validation with VALIDATION_ERROR and writes nothing', async () => {
    // Missing description → invalid HTTP service.
    fs.writeFileSync(path.join(cwd, 'src/zhttp_test.http.json'), JSON.stringify({ name: 'ZHTTP_TEST' }, null, 2));
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zhttp_test.http.json', '--tr', 'TRN001', '--yes', '--json'], { cwd });
    expect(res.exitCode).not.toBe(0);
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('VALIDATION_ERROR');
    expect(icfPostHttp).not.toHaveBeenCalled();
  });

  it('plans only under --dry-run (no ICF call)', async () => {
    writeHttpJson('ZPKG');
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zhttp_test.http.json', '--tr', 'TRN001', '--dry-run', '--yes', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfPostHttp).not.toHaveBeenCalled();
    const out = JSON.parse(res.stdout);
    expect(out.data.dryRun).toBe(true);
    expect(out.data.results[0].plan).toContain('ddic-icf');
  });
});
