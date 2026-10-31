/**
 * `abap push` must reject DEVC package documents with a clear
 * TYPE_NOT_SUPPORTED: ADT exposes packages read-only after creation, so there
 * is no update endpoint to write a `.devc.json` back to.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { registerPushCommand } from '../../src/abap_cli/commands/push.js';
import { makeProgram, runCommand } from './cli-helper.js';

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      getConfig: () => ({ transport: 'TRN001' }),
    }),
  },
}));

let cwd: string;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'devc-push-'));
  fs.writeFileSync(
    path.join(cwd, '$zcli_tc_pkg01.devc.json'),
    JSON.stringify(
      {
        formatVersion: '1',
        header: { description: 'pkg', originalLanguage: 'en' },
        generalInformation: { type: 'development', softwareComponent: 'LOCAL' },
      },
      null,
      2,
    ),
  );
});

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

function run(args: string[]) {
  const program = makeProgram();
  registerPushCommand(program);
  return runCommand(program, [...args, '--json'], { cwd });
}

describe('push DEVC — read-only type', () => {
  it('rejects a .devc.json push with TYPE_NOT_SUPPORTED and the ADT limitation', async () => {
    const res = await run(['push', '$zcli_tc_pkg01.devc.json', '--yes']);
    expect(res.exitCode).toBe(7);
    const envelope = JSON.parse(res.stderr);
    expect(envelope.error.code).toBe('TYPE_NOT_SUPPORTED');
    expect(envelope.error.message).toContain('Cannot push DEVC changes');
    expect(envelope.error.message).toContain('PUT');
  });

  it('rejects the file in --atomic validation before any write', async () => {
    const res = await run(['push', '$zcli_tc_pkg01.devc.json', '--atomic', '--yes']);
    expect(res.exitCode).toBe(7);
    const envelope = JSON.parse(res.stderr);
    expect(envelope.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(envelope.error.details)).toContain('TYPE_NOT_SUPPORTED');
  });
});
