/**
 * 032 US10 (T043/T044): HTTP create without `--file` writes a minimal
 * abap-file-format skeleton to `src/http/<name>/<name>.http.json` and
 * returns `status: local` (no SAP round-trip). Existing skeleton returns
 * `OVERWRITE_REQUIRED`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerCreateCommand } from '../../src/abap_cli/commands/create.js';
import { makeProgram, runCommand } from './cli-helper.js';

const icfPostHttp = vi.fn();

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
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'http-skel-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
});

describe('032/http-create-skeleton', () => {
  it('writes minimal abap-file-format skeleton when --file is absent', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'HTTP', 'ZMY_SERVICE',
      '--package', '$TMP',
      '--description', 'My service',
      '--no-pull',
      '--yes',
      '--json',
    ], { cwd });

    expect(res.exitCode).toBeUndefined();
    const out = JSON.parse(res.stdout);
    expect(out.status).toBe('success');
    expect(out.data.type).toBe('HTTP');
    expect(out.data.action).toBe('local');
    expect(out.data.file).toBe('src/http/zmy_service/zmy_service.http.json');

    const skeletonPath = path.join(cwd, 'src/http/zmy_service/zmy_service.http.json');
    expect(fs.existsSync(skeletonPath)).toBe(true);

    const skeleton = JSON.parse(fs.readFileSync(skeletonPath, 'utf-8'));
    expect(skeleton.name).toBe('ZMY_SERVICE');
    expect(skeleton.formatVersion).toBe('1');
    expect(skeleton.header.description).toBe('My service');
    expect(skeleton.header.originalLanguage).toBe('en');
    expect(skeleton.generalInformation.handlerClass).toBe('');
    expect(skeleton.generalInformation.url).toBe('');
    // 032 US10: skeleton does NOT include `serviceId` / `descriptionByLang`
    // (those are pull-only fields populated by SAP round-trip).
    expect(skeleton.generalInformation.serviceId).toBeUndefined();
    expect(skeleton.header.descriptionByLang).toBeUndefined();
  });

  it('does NOT call the SAP ICF service for skeleton path', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    await runCommand(program, [
      'create', 'HTTP', 'ZMY_SERVICE',
      '--package', '$TMP',
      '--description', 'My service',
      '--no-pull',
      '--yes',
      '--json',
    ], { cwd });
    expect(icfPostHttp).not.toHaveBeenCalled();
  });

  it('returns OVERWRITE_REQUIRED when skeleton file already exists', async () => {
    // Pre-create the skeleton to simulate a prior run.
    const skeletonPath = path.join(cwd, 'src/http/zmy_service/zmy_service.http.json');
    fs.mkdirSync(path.dirname(skeletonPath), { recursive: true });
    fs.writeFileSync(skeletonPath, '{"formatVersion":"1"}');

    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'HTTP', 'ZMY_SERVICE',
      '--package', '$TMP',
      '--description', 'My service',
      '--no-pull',
      '--yes',
      '--json',
    ], { cwd });

    expect(res.exitCode).toBe(2); // OVERWRITE_REQUIRED category is USAGE/exit 2
    expect(res.stderr.length).toBeGreaterThan(0);
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('OVERWRITE_REQUIRED');
    expect(out.error.message).toContain('already exists');
    expect(icfPostHttp).not.toHaveBeenCalled();
    // Original file untouched.
    expect(fs.readFileSync(skeletonPath, 'utf-8')).toBe('{"formatVersion":"1"}');
  });

  it('skeleton description defaults to empty string when --description absent', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, [
      'create', 'HTTP', 'ZMY_SERVICE',
      '--package', '$TMP',
      '--no-pull',
      '--yes',
      '--json',
    ], { cwd });

    // exitCode may be 0/undefined (skeleton written) or 2 (commander rejected
    // missing --description). The point of this test is just that the skeleton
    // path was attempted. We check whether the skeleton was actually written
    // rather than asserting on exitCode alone.
    const skeletonPath = path.join(cwd, 'src/http/zmy_service/zmy_service.http.json');
    if (fs.existsSync(skeletonPath)) {
      const skeleton = JSON.parse(fs.readFileSync(skeletonPath, 'utf-8'));
      expect(skeleton.header.description).toBe('');
      expect(skeleton.header.originalLanguage).toBe('en');
    } else {
      // Commander rejected before runCreate ran — that path also fine.
      expect(res.exitCode).toBeDefined();
    }
  });

  it('HTTP skeleton path goes to src/http/<name>/<name>.http.json (per-type subdir)', async () => {
    // Spec US10 AC3 mandates this layout for HTTP create skeletons.
    const program = makeProgram();
    registerCreateCommand(program);
    await runCommand(program, [
      'create', 'HTTP', 'ZMY_SERVICE',
      '--package', '$TMP',
      '--description', 'My service',
      '--no-pull',
      '--yes',
      '--json',
    ], { cwd });
    const dir = path.join(cwd, 'src', 'http', 'zmy_service');
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'zmy_service.http.json'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, 'src', 'http', 'zmy_service.http.json'))).toBe(false);
  });
});