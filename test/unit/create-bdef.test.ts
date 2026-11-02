/**
 * BDEF create — blueSource header + `.abdl` source write.
 *
 * The ADT endpoint is not part of abap-adt-api's typed creator, so this test
 * pins the CLI contract: the AFF JSON + `.abdl` pair is mandatory, the header
 * POST is followed by a locked source write, and no generic createObject path
 * is used.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { registerCreateCommand } from '../../src/abap_cli/commands/create.js';
import { makeProgram, runCommand } from './cli-helper.js';
import { buildBdefCreateBody, bdefObjectUrl } from '../../src/abap_cli/clients/bdef.js';

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { systemVersion: '793' } as { systemVersion?: string },
}));

const createBdef = vi.fn(async () => undefined);
const writeBdefSource = vi.fn(async () => undefined);

vi.mock('../../src/abap_cli/config/project-config.js', () => ({
  loadConfig: async () => mockConfig,
  readCaCertificate: () => undefined,
}));

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      createBdef,
      writeBdefSource,
      getConfig: () => ({ transport: 'TRN001' }),
    }),
  },
}));

const ABDL = 'managed;\ndefine behavior for ZI_TRAVEL alias Travel\n{\n  use create;\n}\n';

const BDEF_JSON = JSON.stringify({
  formatVersion: '1',
  header: { description: 'Travel behavior', originalLanguage: 'en' },
}, null, 2) + '\n';

let cwd: string;

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.systemVersion = '793';
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'create-bdef-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
});

function writePair(name = 'zmy_travel'): string {
  fs.writeFileSync(path.join(cwd, `${name}.bdef.json`), BDEF_JSON, 'utf8');
  fs.writeFileSync(path.join(cwd, `${name}.bdef.abdl`), ABDL, 'utf8');
  return `${name}.bdef.json`;
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

describe('create BDEF — happy path', () => {
  it('creates the blueSource header and writes the .abdl source', async () => {
    const file = writePair();
    const res = await run(['create', 'BDEF', 'ZMY_TRAVEL', '--file', file]);
    expect(res.exitCode).toBeUndefined();
    expect(createBdef).toHaveBeenCalledTimes(1);
    expect(createBdef).toHaveBeenCalledWith('ZMY_TRAVEL', {
      packageName: '$TMP',
      description: 'Travel behavior',
      originalLanguage: 'en',
    });
    expect(writeBdefSource).toHaveBeenCalledWith('ZMY_TRAVEL', ABDL, undefined);
    expect(JSON.parse(res.stdout)).toMatchObject({
      status: 'success',
      data: { object: 'ZMY_TRAVEL', type: 'BDEF', action: 'created', channel: 'adt' },
    });
  });

  it('rejects BDEF without --file with USAGE (exit 2)', async () => {
    const res = await run(['create', 'BDEF', 'ZMY_TRAVEL']);
    expect(res.exitCode).toBe(2);
    expect(JSON.parse(res.stderr).error.code).toBe('USAGE');
    expect(JSON.parse(res.stderr).error.message).toMatch(/requires --file/);
    expect(createBdef).not.toHaveBeenCalled();
  });

  it('rejects a missing .bdef.abdl companion (VALIDATION_ERROR, exit 7)', async () => {
    const file = writePair();
    fs.rmSync(path.join(cwd, 'zmy_travel.bdef.abdl'));
    const res = await run(['create', 'BDEF', 'ZMY_TRAVEL', '--file', file]);
    expect(res.exitCode).toBe(7);
    expect(JSON.parse(res.stderr).error.code).toBe('VALIDATION_ERROR');
    expect(JSON.parse(res.stderr).error.message).toMatch(/companion/);
    expect(createBdef).not.toHaveBeenCalled();
  });
});

describe('BDEF ADT body', () => {
  it('builds a blueSource body with escaped attributes and package ref', () => {
    const body = buildBdefCreateBody({
      name: 'ZMY_TRAVEL',
      packageName: '$TMP',
      description: 'R&D "travel" <test>',
      originalLanguage: 'en',
      language: 'EN',
    });
    expect(body).toContain('<blue:blueSource');
    expect(body).toContain('adtcore:name="ZMY_TRAVEL"');
    expect(body).toContain('adtcore:type="BDEF/BDO"');
    expect(body).toContain('adtcore:description="R&amp;D &quot;travel&quot; &lt;test&gt;"');
    expect(body).toContain('adtcore:language="EN"');
    expect(body).toContain('adtcore:masterLanguage="en"');
    expect(body).toContain('<adtcore:packageRef adtcore:name="$TMP"/>');
  });

  it('percent-encodes namespaced names in the object URL', () => {
    expect(bdefObjectUrl('/UI2/CL_JSON')).toBe(
      '/sap/bc/adt/bo/behaviordefinitions/%2Fui2%2Fcl_json',
    );
  });
});
