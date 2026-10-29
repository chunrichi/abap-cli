/**
 * F-18 — `abap diff <object-name>` must fail with an actionable INVALID_ARGUMENT
 * ("you passed an object name") instead of the misleading FILE_PARSE_ERROR
 * "Cannot resolve object type from filename: ZCL_ZR_T5".
 *
 * The object-name heuristic is deliberately narrow (no path separator and no
 * `.` extension) so genuine bad filenames keep the FILE_PARSE_ERROR path.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: { create: (...a: unknown[]) => create(...a) },
}));

import { registerDiffCommand } from '../../src/abap_cli/commands/diff.js';
import { makeProgram, runCommand } from './cli-helper.js';

function envelope(res: { stdout: string; stderr: string }) {
  return JSON.parse(res.stdout || res.stderr);
}

async function runDiff(args: string[]) {
  const program = makeProgram();
  registerDiffCommand(program);
  const res = await runCommand(program, args);
  return { res, env: envelope(res) };
}

describe('abap diff — object name vs file path (F-18)', () => {
  beforeEach(() => {
    create.mockReset();
    // Any attempt to build a client proves the argument check ran too late.
    create.mockRejectedValue(new Error('must not create an ADT client'));
  });

  it('rejects a bare object name with INVALID_ARGUMENT before any SAP client is built', async () => {
    const { res, env } = await runDiff(['diff', 'ZCL_ZR_T5', '--json']);
    expect(res.exitCode).toBe(2);
    expect(env.status).toBe('error');
    expect(env.error.code).toBe('INVALID_ARGUMENT');
    expect(env.error.category).toBe('USAGE');
    // The message must name the argument as an object name, not a filename bug.
    expect(env.error.message).toContain('ZCL_ZR_T5');
    expect(env.error.message).toMatch(/object name/i);
    expect(env.error.message).not.toMatch(/Cannot resolve object type from filename/i);
    expect(create).not.toHaveBeenCalled();
  });

  it('nextSteps tell the user to pull the object first and then diff the local file', async () => {
    const { env } = await runDiff(['diff', 'zcl_zr_t5', '--json']);
    const steps: string[] = env.error.nextSteps ?? [];
    expect(steps.some((s) => s.includes('abap pull ZCL_ZR_T5 --type'))).toBe(true);
    expect(steps.some((s) => s.includes('abap diff src/zcl_zr_t5.clas.abap'))).toBe(true);
    expect(env.error.example).toContain('abap pull ZCL_ZR_T5 --type CLAS');
  });

  it('a positional argument with a path separator is still treated as a path (FILE_PARSE_ERROR)', async () => {
    create.mockResolvedValue({});
    const { res, env } = await runDiff(['diff', 'src/zcl_demo', '--json']);
    expect(res.exitCode).toBe(2);
    expect(env.error.code).toBe('FILE_PARSE_ERROR');
    expect(env.error.message).toMatch(/Cannot resolve object type from filename/i);
  });

  it('a bare filename with an extension is still treated as a path (not an object name)', async () => {
    create.mockResolvedValue({ searchObject: async () => [] });
    const { env } = await runDiff(['diff', 'zcl_demo.clas.abap', '--json']);
    expect(create).toHaveBeenCalled();
    expect(env.error.message).not.toMatch(/looks like an ABAP object name/i);
  });

  it('object-name error does not mask the file + --all scoping conflict', async () => {
    const { env } = await runDiff(['diff', 'ZCL_ZR_T5', '--all', '--json']);
    expect(env.error.code).toBe('INVALID_ARGUMENT');
    expect(env.error.message).toContain('--all/--remote/--local-only');
  });
});
