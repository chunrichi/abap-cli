/**
 * 037 US4: pull TABL graceful fallback when SAP can't parse the DDL source.
 *
 * When the SAP-side DDIC DDL parser hits an unsupported fragment (real bug
 * observed against vhcala4hci 2026-09-04: `abap.string(000000)` after empty
 * `.INCLUDE`), the ICF handler returns HTTP 500 with the ABAP short dump
 * body. We surface this as `TABL_DDL_PARSE_FAILED` so the agent gets a
 * structured error with `nextSteps` instead of a generic `SAP_ERROR`.
 *
 * Three cases:
 *  - 500 + `abap.string(N)` body → TABL_DDL_PARSE_FAILED (exit 8)
 *  - 200 normal → pull proceeds as usual
 *  - 500 + unrelated body → propagates as SAP_ERROR (no false positive)
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CliError } from '../../src/abap_cli/output/json.js';
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

const icfGetDdic = vi.fn();
vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: {
    create: async () => ({
      getDdic: icfGetDdic,
      postDdic: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
    }),
  },
}));

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tabl-fallback-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
});

const SAP_500_BODY =
  'ABAP short dump: error at line 42\n' +
  'Type "abap.string(000000)" is not supported by DDL parser\n' +
  'CX_DD_DDL_PARSE_ERROR';

describe('037 US4 — TABL graceful fallback', () => {
  it('returns TABL_DDL_PARSE_FAILED when SAP 500 contains abap.string(N)', async () => {
    icfGetDdic.mockRejectedValueOnce(
      new CliError('SAP_ERROR', 'ICF request failed: HTTP 500', {
        details: {
          httpStatus: 500,
          sapErrorBody: SAP_500_BODY.slice(0, 400),
        },
        nextSteps: ['Try a different TABL or use the ICF push path (not yet implemented).'],
      }),
    );
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZMY_TABL_BROKEN_DDL', '--type', 'TABL', '--dir', 'src', '--json'], { cwd });
    expect(res.exitCode).toBe(8);
    const out = JSON.parse(res.stdout || res.stderr);
    expect(out.error.message).toMatch(/TABL.*ZMY_TABL_BROKEN_DDL.*DDL/i);
    expect(Array.isArray(out.error.nextSteps)).toBe(true);
    expect(out.error.nextSteps.length).toBeGreaterThan(0);
    expect(out.error.details?.sapErrorBody ?? '').toContain('abap.string');
  });

  it('returns TABL_DDL_PARSE_FAILED with exit 8 in human mode', async () => {
    icfGetDdic.mockRejectedValueOnce(
      new CliError('SAP_ERROR', 'ICF request failed', {
        details: { httpStatus: 500, sapErrorBody: SAP_500_BODY.slice(0, 400) },
      }),
    );
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZMY_TABL_BROKEN_DDL', '--type', 'TABL', '--dir', 'src'], { cwd });
    expect(res.exitCode).toBe(8);
  });

  it('does not trigger TABL_DDL_PARSE_FAILED on a normal SAP_ERROR without the DDL marker', async () => {
    icfGetDdic.mockRejectedValueOnce(
      new CliError('SAP_ERROR', 'ICF request failed: HTTP 500', {
        details: {
          httpStatus: 500,
          sapErrorBody: 'Unrelated ABAP error: TSV_TNEW_PAGE_ALLOC_FAILED',
        },
      }),
    );
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZMY_TABL_OTHER', '--type', 'TABL', '--dir', 'src', '--json'], { cwd });
    // Falls through to generic SAP_ERROR (exit 6), not TABL_DDL_PARSE_FAILED.
    const out = JSON.parse(res.stderr);
    expect(out.error.code).not.toBe('TABL_DDL_PARSE_FAILED');
    expect(res.exitCode).toBe(6);
  });

  it('returns success on a normal 200 response', async () => {
    icfGetDdic.mockResolvedValueOnce({
      status: 'success' as const,
      data: {
        name: 'ZMY_TABL_OK',
        type: 'TABL',
        mainJson: '{"formatVersion":"1","header":{"description":"OK","originalLanguage":"en"}}',
        ddicSource: "@EndUserText.label : 'OK'\ndefine table zmy_tabl_ok {\n  key client : abap.clnt not null;\n}\n",
        settingsJson: undefined,
        hasSettings: false,
      },
      error: null,
    });
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZMY_TABL_OK', '--type', 'TABL', '--dir', 'src', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const out = JSON.parse(res.stdout);
    expect(out.data.entries[0].status).toBe('written');
  });
});
