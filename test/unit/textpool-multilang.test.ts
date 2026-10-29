/**
 * 032 US12 (T053-T056): textpool `.properties` pull works for the 5 supported
 * object types — CLAS / INTF / PROG / FUGR / TABL / STRU. Per-type:
 *   - mock fixture stores TYPE:NAME:category keys; categories that are
 *     intentionally absent (CLAS has no selections, FUGR has no headings,
 *     STRU has no headings/selections) surface as `TEXTPOOL_CATEGORY_MISSING`
 *     warnings in `meta.warnings` — **not** as failures.
 *   - 5 categories per type are attempted; missing ones are soft-warned.
 *
 * AC2: `--include-tests --include-texts` combination works (textpool is a
 * separate flag from --include-tests; both can be passed together).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerPullCommand } from '../../src/abap_cli/commands/pull.js';
import { makeProgram, runCommand } from './cli-helper.js';

const icfGetTextpool = vi.fn();
const getTextElements = vi.fn();

const getSystem = vi.fn();
const loadConfig = vi.fn();

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      getTextElements,
      getConfig: () => ({ sap: { username: 'MOCKUSER', client: '001', language: 'EN' }, transport: 'TRN001', package: '$TMP' }),
    }),
  },
}));

vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: {
    create: async () => ({
      getTextpool: icfGetTextpool,
      getDdic: vi.fn(),
      postDdic: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
    }),
  },
}));

vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: (...a: unknown[]) => getSystem(...a),
  upsertSystem: vi.fn(),
}));

vi.mock('../../src/abap_cli/config/project-config.js', () => ({
  loadConfig: () => loadConfig(),
}));

import { resetWarnings } from '../../src/abap_cli/output/meta.js';

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  resetWarnings();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'textpool-ml-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  loadConfig.mockResolvedValue({ systemName: 'mock', sap: {}, transport: '', package: '$TMP' });
  // Default: ICF textpool route (read=false → ICF; ADT path uses
  // getTextElements which would need its own mock). Mock serves 200 with
  // elements for present keys, but TEXTPOOL_OBJECT_NOT_FOUND for missing.
  getSystem.mockReturnValue({ url: 'x', client: '100', username: 'u', language: 'EN', adtTextpool: { read: false, write: false } });
  icfGetTextpool.mockImplementation(async (category: string, name: string, type: string) => {
    // category is the URL path: 'texts' | 'selections' | 'headings'.
    // The mock-adt/server.js keys use ADT category names: 'symbols' | 'selections' | 'headings'.
    const adtCat = category === 'texts' ? 'symbols' : category;
    const present: Record<string, Array<{ id: string; text: string }>> = {
      'CLAS:ZCL_DEMO:symbols': [{ id: '001', text: 'Hello (en)' }],
      'CLAS:ZCL_DEMO:headings': [{ id: 'COLUMNHEADER_1', text: 'Col 1 (en)' }],
      'INTF:ZIF_DEMO:symbols': [{ id: '001', text: 'Iface (en)' }],
      'INTF:ZIF_DEMO:headings': [{ id: 'LISTHEADER', text: 'Header (en)' }],
      'FUGR:ZFG_DEMO:symbols': [{ id: '001', text: 'FG (en)' }],
      'TABL:ZTB_DEMO:symbols': [{ id: '001', text: 'Table (en)' }],
      'TABL:ZTB_DEMO:headings': [{ id: 'COLUMNHEADER_1', text: 'F1 (en)' }],
      'TABL:ZTB_DEMO:selections': [{ id: 'P_LANG', text: 'Lang (en)' }],
      'STRU:ZST_DEMO:symbols': [{ id: '001', text: 'Stru (en)' }],
    };
    const key = `${type}:${name}:${adtCat}`;
    if (present[key]) {
      return { status: 'success' as const, data: { object: name, type, category: adtCat, elements: present[key] }, error: null };
    }
    return {
      status: 'error' as const,
      data: null,
      error: { code: 'TEXTPOOL_OBJECT_NOT_FOUND', message: `${name} has no ${adtCat} text elements` },
    };
  });
});

async function runTextpool(type: string, name: string, extraArgs: string[] = []): Promise<{ res: Awaited<ReturnType<typeof runCommand>>; cwd: string }> {
  const program = makeProgram();
  registerPullCommand(program);
  const res = await runCommand(program, ['pull', name, '--type', type, '--textpool', '--json', ...extraArgs], { cwd });
  return { res, cwd };
}

function readOutput(res: { stdout: string; stderr: string }) {
  // printResult writes data to stdout; printError writes error envelope to stderr.
  const parsedStdout = res.stdout ? JSON.parse(res.stdout) : undefined;
  const parsedStderr = res.stderr ? JSON.parse(res.stderr) : undefined;
  return { stdout: parsedStdout, stderr: parsedStderr };
}

describe('032/textpool-multilang', () => {
  it('CLAS pulls texts (.texts.en.properties) with content from mock', async () => {
    const { res } = await runTextpool('CLAS', 'ZCL_DEMO');
    expect(res.exitCode).toBeUndefined();
    const path1 = path.join(cwd, 'src/clas/zcl_demo/zcl_demo.clas.texts.en.properties');
    expect(fs.existsSync(path1)).toBe(true);
    const content = fs.readFileSync(path1, 'utf-8');
    expect(content).toContain('001=Hello (en)');
  });

  it('CLAS pulls headings (.headings.en.properties) with COLUMNHEADER_1 entry', async () => {
    const { res } = await runTextpool('CLAS', 'ZCL_DEMO');
    expect(res.exitCode).toBeUndefined();
    const path1 = path.join(cwd, 'src/clas/zcl_demo/zcl_demo.clas.headings.en.properties');
    expect(fs.existsSync(path1)).toBe(true);
    expect(fs.readFileSync(path1, 'utf-8')).toContain('COLUMNHEADER_1=Col 1 (en)');
  });

  it('CLAS without selections emits TEXTPOOL_CATEGORY_MISSING warning, not failure', async () => {
    const { res } = await runTextpool('CLAS', 'ZCL_DEMO');
    expect(res.exitCode).toBeUndefined();
    const { stdout, stderr } = readOutput(res);
    expect(stderr).toBeUndefined();
    const warning = (stdout?.meta?.warnings ?? []).find((w: { code: string }) => w.code === 'TEXTPOOL_CATEGORY_MISSING');
    expect(warning).toBeDefined();
    expect(warning.message).toContain('CLAS ZCL_DEMO has no selections');
    // selections path lands in `skipped[]` (top-level), not `failed[]`
    const skipped = (stdout?.data?.skipped ?? []) as string[];
    expect(skipped.some((p: string) => p.endsWith('.selections.en.properties'))).toBe(true);
  });

  it('INTF pulls texts + headings', async () => {
    const { res } = await runTextpool('INTF', 'ZIF_DEMO');
    expect(res.exitCode).toBeUndefined();
    expect(fs.existsSync(path.join(cwd, 'src/intf/zif_demo/zif_demo.intf.texts.en.properties'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, 'src/intf/zif_demo/zif_demo.intf.headings.en.properties'))).toBe(true);
  });

  it('FUGR pulls texts; selections + headings both missing → warnings', async () => {
    const { res } = await runTextpool('FUGR', 'ZFG_DEMO');
    expect(res.exitCode).toBeUndefined();
    expect(fs.existsSync(path.join(cwd, 'src/fugr/zfg_demo/zfg_demo.fugr.texts.en.properties'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, 'src/fugr/zfg_demo/zfg_demo.fugr.headings.en.properties'))).toBe(false);
    expect(fs.existsSync(path.join(cwd, 'src/fugr/zfg_demo/zfg_demo.fugr.selections.en.properties'))).toBe(false);
    const { stdout } = readOutput(res);
    const warnings = (stdout?.meta?.warnings ?? []).filter((w: { code: string }) => w.code === 'TEXTPOOL_CATEGORY_MISSING');
    // FUGR mock has only `symbols`; both selections + headings missing
    // → 2 warnings (one per missing category).
    expect(warnings.length).toBe(2);
  });

  it('TABL pulls texts + headings + selections (all 3 categories)', async () => {
    const { res } = await runTextpool('TABL', 'ZTB_DEMO');
    expect(res.exitCode).toBeUndefined();
    expect(fs.existsSync(path.join(cwd, 'src/tabl/ztb_demo/ztb_demo.tabl.texts.en.properties'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, 'src/tabl/ztb_demo/ztb_demo.tabl.headings.en.properties'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, 'src/tabl/ztb_demo/ztb_demo.tabl.selections.en.properties'))).toBe(true);
  });

  it('STRU pulls texts; selections + headings both missing → 2 warnings', async () => {
    const { res } = await runTextpool('STRU', 'ZST_DEMO');
    expect(res.exitCode).toBeUndefined();
    expect(fs.existsSync(path.join(cwd, 'src/stru/zst_demo/zst_demo.stru.texts.en.properties'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, 'src/stru/zst_demo/zst_demo.stru.headings.en.properties'))).toBe(false);
    expect(fs.existsSync(path.join(cwd, 'src/stru/zst_demo/zst_demo.stru.selections.en.properties'))).toBe(false);
    const { stdout } = readOutput(res);
    const warnings = (stdout?.meta?.warnings ?? []).filter((w: { code: string }) => w.code === 'TEXTPOOL_CATEGORY_MISSING');
    expect(warnings.length).toBe(2);
  });

  it('textpool pull requires explicit --type (was PROG by default)', async () => {
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZCL_DEMO', '--textpool', '--json'], { cwd });
    expect(res.exitCode).toBe(2); // USAGE → exit 2
    const { stderr } = readOutput(res);
    expect(stderr?.error?.code).toBe('USAGE');
    expect(stderr?.error?.message).toContain('--type');
  });

  it('--include-tests --textpool combination works (regression — both flags coexist)', async () => {
    // The CLAS object has a `testclasses` source part; --include-tests keeps it
    // in the source pull. Textpool is an independent flag. We assert textpool
    // succeeds; the test inclusion is exercised elsewhere in pull-layout.test.ts.
    const { res } = await runTextpool('CLAS', 'ZCL_DEMO', ['--include-tests']);
    expect(res.exitCode).toBeUndefined();
    expect(fs.existsSync(path.join(cwd, 'src/clas/zcl_demo/zcl_demo.clas.texts.en.properties'))).toBe(true);
  });
});