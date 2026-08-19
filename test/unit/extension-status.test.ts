import { describe, expect, it, vi } from 'vitest';

const mockGet = vi.fn();
vi.mock('../../src/abap_cli/clients/icf-client.js', () => ({
  IcfClient: {
    create: async () => ({ get: mockGet }),
  },
}));

import { Command } from 'commander';
import { registerExtensionCommand } from '../../src/abap_cli/commands/extension.js';
import { CliError } from '../../src/abap_cli/output/json.js';

async function run(args: string[]): Promise<{ data: unknown; exitCode: number | undefined }> {
  const program = new Command().option('--json', 'json').exitOverride();
  registerExtensionCommand(program);
  const stdoutLines: string[] = [];
  let exitCode: number | undefined;
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...a) => { stdoutLines.push(a.map(String).join(' ')); });
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* swallow */ });
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
    exitCode = code as number;
    throw new Error(`__exit_${code}`);
  });
  try {
    await program.parseAsync(args, { from: 'user' });
  } catch (e) {
    if (e instanceof Error && !e.message.startsWith('__exit_')) throw e;
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
  }
  const jsonLine = stdoutLines.find((l) => l.includes('"status"')) ?? stdoutLines.join('\n');
  // eslint-disable-next-line no-console
  let envelope: unknown;
  try { envelope = JSON.parse(jsonLine); } catch (e) {
    // eslint-disable-next-line no-console
    envelope = null;
  }
  const data = (envelope as { data?: unknown } | null)?.data;
  return { data, exitCode };
}

describe('abap extension status (021: new subcommand)', () => {
  it('returns installed=false when not deployed (404 path)', async () => {
    mockGet.mockReset();
    mockGet.mockRejectedValueOnce(new CliError('NOT_FOUND', 'not found', { details: { httpStatus: 404 } }));
    const { data, exitCode } = await run(['extension', 'status', '--json']);
    // eslint-disable-next-line no-console
    expect(exitCode).toBeUndefined();
    const d = data as { installed: boolean; status: string };
    expect(d.installed).toBe(false);
    expect(d.status).toBe('not_deployed');
  });

  it('returns installed=true and match=true when remote version equals expected', async () => {
    mockGet.mockReset();
    mockGet.mockResolvedValueOnce({ status: 'success', data: { version: '0.5.0' } });
    const { data } = await run(['extension', 'status', '--json']);
    const d = data as { installed: boolean; match: boolean; remoteVersion: string; expectedVersion: string };
    expect(d.installed).toBe(true);
    expect(d.match).toBe(true);
    expect(d.remoteVersion).toBe('0.5.0');
  });

  it('returns installed=true but match=false when version differs', async () => {
    mockGet.mockReset();
    mockGet.mockResolvedValueOnce({ status: 'success', data: { version: '0.3.0' } });
    const { data } = await run(['extension', 'status', '--json']);
    const d = data as { installed: boolean; match: boolean; remoteVersion: string };
    expect(d.installed).toBe(true);
    expect(d.match).toBe(false);
    expect(d.remoteVersion).toBe('0.3.0');
  });

  it('returns installed=false on unreachable (non-blocking)', async () => {
    mockGet.mockReset();
    mockGet.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const { data } = await run(['extension', 'status', '--json']);
    const d = data as { installed: boolean; status: string };
    expect(d.installed).toBe(false);
    expect(d.status).toBe('unreachable');
  });
});