/**
 * 014 US4: textpool push/pull via the CLI (mixed-mode route).
 * TDD — written before the pushTextpoolFile / runPullTextpool wiring.
 * The route is read from the cached SystemProfile capability (no runtime probe).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerPushCommand } from '../../src/abap_cli/commands/push.js';
import { registerPullCommand } from '../../src/abap_cli/commands/pull.js';
import { makeProgram, runCommand } from './cli-helper.js';

const lock = vi.fn(async () => ({ LOCK_HANDLE: 'lock-1' }));
const unLock = vi.fn(async () => '');
const getTextElements = vi.fn();
const setTextElements = vi.fn();

const getSystem = vi.fn();
const loadConfig = vi.fn();

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      lock, unLock, getTextElements, setTextElements,
      getConfig: () => ({ sap: { username: 'MOCKUSER', client: '001', language: 'EN' }, transport: 'TRN001', package: '$TMP' }),
    }),
  },
}));

vi.mock('../../src/abap_cli/config/user-config.js', () => ({
  getSystem: (...a: unknown[]) => getSystem(...a),
  upsertSystem: vi.fn(),
}));

const icfGetTextpool = vi.fn();
const icfPostTextpool = vi.fn();
vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: {
    create: async () => ({
      getTextpool: icfGetTextpool,
      postTextpool: icfPostTextpool,
      getDdic: vi.fn(),
      postDdic: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
    }),
  },
}));

vi.mock('../../src/abap_cli/config/project-config.js', () => ({
  loadConfig: () => loadConfig(),
}));

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'textpool-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  fs.mkdirSync(path.join(cwd, 'src/zprog'), { recursive: true });
  loadConfig.mockResolvedValue({ systemName: 'mock', sap: {}, transport: '', package: '$TMP' });
});

describe('014/US4 textpool push (ICF route — write=false cached)', () => {
  beforeEach(() => {
    getSystem.mockReturnValue({ url: 'x', client: '100', username: 'u', language: 'EN', adtTextpool: { read: true, write: false } });
  });

  it('pushes a .texts.properties via ICF POST /textpool/texts', async () => {
    icfPostTextpool.mockResolvedValue({ status: 'success', data: { written: 1 }, error: null });
    fs.writeFileSync(path.join(cwd, 'src/zprog/zprog.prog.texts.en.properties'), '@MaxLength:10\n001=Example\n');
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zprog/zprog.prog.texts.en.properties', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(icfPostTextpool).toHaveBeenCalledWith(
      'texts',
      'ZPROG',
      'PROG',
      expect.objectContaining({ elements: expect.arrayContaining([
        expect.objectContaining({ id: '001', text: 'Example', maxLength: 10 }),
      ]) }),
    );
    expect(setTextElements).not.toHaveBeenCalled();
    const out = JSON.parse(res.stdout);
    expect(out.data.results[0].stage).toBe('textpool-icf');
  });

  it('propagates ICF failure as a structured error', async () => {
    icfPostTextpool.mockResolvedValue({
      status: 'error',
      data: null,
      error: { code: 'TEXTPOOL_WRITE_FAILED', message: 'simulated' },
    });
    fs.writeFileSync(path.join(cwd, 'src/zprog/zprog.prog.texts.en.properties'), '001=Example\n');
    const program = makeProgram();
    registerPushCommand(program);
    const res = await runCommand(program, ['push', 'src/zprog/zprog.prog.texts.en.properties', '--json'], { cwd });
    expect(res.exitCode).not.toBeUndefined();
    const out = JSON.parse(res.stderr);
    expect(out.error.code).toBe('TEXTPOOL_WRITE_FAILED');
  });
});

describe('014/US4 textpool pull (ADT route — read=true cached)', () => {
  beforeEach(() => {
    getSystem.mockReturnValue({ url: 'x', client: '100', username: 'u', language: 'EN', adtTextpool: { read: true, write: true } });
  });

  it('pulls the three .properties files via ADT getTextElements', async () => {
    // Per-category data so headings validation passes (001 is a symbol key, not a heading).
    getTextElements.mockImplementation(async (_type: string, _name: string, category: string) => {
      if (category === 'headings') return { textElements: [{ id: 'LISTHEADER', text: 'Report header' }] };
      if (category === 'selections') return { textElements: [{ id: 'SEL1', text: 'Choice one' }] };
      return { textElements: [{ id: '001', text: 'Example', maxLength: 10 }] };
    });
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZPROG', '--textpool', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    expect(getTextElements).toHaveBeenCalledTimes(3); // texts/selections/headings
    const out = JSON.parse(res.stdout);
    expect(out.data.route).toBe('adt');
    expect(out.data.written).toHaveLength(3);
    const texts = fs.readFileSync(path.join(cwd, 'src/zprog/zprog.prog.texts.en.properties'), 'utf-8');
    expect(texts).toContain('001=Example');
  });
});
