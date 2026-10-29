import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerPullCommand } from '../../src/abap_cli/commands/pull.js';
import { makeProgram, runCommand } from './cli-helper.js';

const searchObject = vi.fn();
const objectStructure = vi.fn();
const getObjectSource = vi.fn();

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      searchObject,
      objectStructure,
      getObjectSource,
      getConfig: () => ({ transport: undefined }),
    }),
  },
}));

const GROUP = '/sap/bc/adt/functions/groups/zfg_fixpoint';

function fixtureWithMeta(meta: Record<string, unknown>) {
  searchObject.mockImplementation(async (query: string) => {
    if (query === 'LZFG_FIXPOINT*') {
      return [
        { 'adtcore:name': 'LZFG_FIXPOINTTOP', 'adtcore:type': 'FUGR/I', 'adtcore:uri': '/sap/bc/adt/programs/includes/lzfg_fixpointtop' },
      ];
    }
    return [
      { 'adtcore:name': 'ZFG_FIXPOINT', 'adtcore:type': 'FUGR/F', 'adtcore:uri': GROUP },
      { 'adtcore:name': 'ZFG_FIXPOINT_FM', 'adtcore:type': 'FUGR/FF', 'adtcore:uri': `${GROUP}/fmodules/zfg_fixpoint_fm` },
    ];
  });
  objectStructure.mockImplementation(async (uri: string) => {
    if (uri.startsWith('/sap/bc/adt/programs/includes/')) {
      return {
        metaData: {
          'adtcore:name': uri.split('/').pop()!.toUpperCase(),
          'adtcore:type': 'FUGR/I',
          'adtcore:description': '',
          'adtcore:masterLanguage': 'EN',
          'abapsource:sourceUri': 'source/main',
          ...meta,
        },
      };
    }
    return {
      metaData: {
        'adtcore:name': 'ZFG_FIXPOINT',
        'adtcore:type': 'FUGR/F',
        'adtcore:description': 'fixpoint test',
        'adtcore:masterLanguage': 'EN',
        'abapsource:sourceUri': 'source/main',
        ...meta,
      },
    };
  });
  getObjectSource.mockImplementation(async (url: string) => {
    if (url.includes('lzfg_fixpointuxx')) return 'REPORT nope.';
    return `SOURCE ${url}`;
  });
}

let cwd: string;
beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'fugr-fixpoint-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
});

describe('032 US4: FUGR fixPointArithmetic fallback', () => {
  it('emits true when abapsource:fixPointArithmetic="true" is present', async () => {
    fixtureWithMeta({ 'abapsource:fixPointArithmetic': true });
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZFG_FIXPOINT', '--type', 'FUGR', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const fugr = JSON.parse(fs.readFileSync(path.join(cwd, 'src', 'fugr', 'zfg_fixpoint', 'zfg_fixpoint.fugr.json'), 'utf-8'));
    expect(fugr.fixPointArithmetic).toBe(true);
  });

  it('emits false when abapsource:fixPointArithmetic="false" is present', async () => {
    fixtureWithMeta({ 'abapsource:fixPointArithmetic': false });
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZFG_FIXPOINT', '--type', 'FUGR', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const fugr = JSON.parse(fs.readFileSync(path.join(cwd, 'src', 'fugr', 'zfg_fixpoint', 'zfg_fixpoint.fugr.json'), 'utf-8'));
    expect(fugr.fixPointArithmetic).toBe(false);
  });

  it('defaults to false when abapsource:fixPointArithmetic is missing (mock partial source)', async () => {
    fixtureWithMeta({});
    const program = makeProgram();
    registerPullCommand(program);
    const res = await runCommand(program, ['pull', 'ZFG_FIXPOINT', '--type', 'FUGR', '--json'], { cwd });
    expect(res.exitCode).toBeUndefined();
    const fugr = JSON.parse(fs.readFileSync(path.join(cwd, 'src', 'fugr', 'zfg_fixpoint', 'zfg_fixpoint.fugr.json'), 'utf-8'));
    expect(fugr.fixPointArithmetic).toBe(false);
  });
});
