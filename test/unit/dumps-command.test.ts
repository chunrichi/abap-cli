import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DumpsFeed } from 'abap-adt-api';
import { registerDumpsCommand, formatHuman } from '../../src/abap_cli/commands/dumps.js';
import { makeProgram, runCommand } from './cli-helper.js';
import { CliError } from '../../src/abap_cli/output/json.js';
import { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';

const dumpsFn = vi.fn();

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({ dumps: dumpsFn }),
  },
}));

function feedWith(dumps: DumpsFeed['dumps']): DumpsFeed {
  return {
    href: '/sap/bc/adt/runtime/dumps',
    title: 'Recent ABAP runtime dumps',
    updated: new Date('2026-08-31T12:00:00.000Z'),
    dumps,
  };
}

function feedEntry(overrides: Partial<DumpsFeed['dumps'][number]>): DumpsFeed['dumps'][number] {
  return {
    id: 'DUMP-1',
    categories: [{ term: 'TIME_OUT', label: 'ABAP runtime error' }],
    links: [],
    author: 'DEVELOPER',
    text: 'Runtime error TIME_OUT in program ZCL_TEST->RUN',
    type: 'text',
    ...overrides,
  };
}

function parseData(res: { stdout: string }): { data: unknown; error: unknown; status: string } {
  const envelope = JSON.parse(res.stdout);
  if (envelope.error) return { data: null, error: envelope.error, status: envelope.status };
  return { data: envelope.data, error: null, status: envelope.status };
}

function makeProgramWithDumps(): { program: ReturnType<typeof makeProgram> } {
  return { program: makeProgram() };
}

describe('abap dumps (031-abap-dumps)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dumpsFn.mockReset();
    dumpsFn.mockResolvedValue(feedWith([]));
  });

  it('calls ADT with default limit (20) and no user filter', async () => {
    const { program } = makeProgramWithDumps();
    registerDumpsCommand(program);
    const res = await runCommand(program, ['dumps', '--json']);
    expect(res.exitCode).toBeUndefined();
    expect(dumpsFn).toHaveBeenCalledWith(20, undefined);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.status).toBe('success');
    // stripEmpty() drops empty `dumps: []` per the 022 token-efficient contract;
    // `total: 0` + `returned: 0` are the canonical "no dumps found" markers.
    expect(parsed.data.total).toBe(0);
    expect(parsed.data.returned).toBe(0);
  });

  it('forwards --limit to AdtClientWrapper.dumps()', async () => {
    const { program } = makeProgramWithDumps();
    registerDumpsCommand(program);
    await runCommand(program, ['dumps', '--limit', '5', '--json']);
    expect(dumpsFn).toHaveBeenCalledWith(5, undefined);
  });

  it('forwards --user when provided', async () => {
    const { program } = makeProgramWithDumps();
    registerDumpsCommand(program);
    await runCommand(program, ['dumps', '--user', 'DEVELOPER', '--json']);
    expect(dumpsFn).toHaveBeenCalledWith(20, 'DEVELOPER');
  });

  it('returns populated data.dumps with projected fields', async () => {
    dumpsFn.mockResolvedValue(
      feedWith([
        feedEntry({ id: 'A', author: 'MOCKUSER' }),
        feedEntry({ id: 'B', text: 'other error' }),
      ]),
    );
    const { program } = makeProgramWithDumps();
    registerDumpsCommand(program);
    const res = await runCommand(program, ['dumps', '--json']);
    const { data, status, error } = parseData(res);
    expect(status).toBe('success');
    expect(error).toBeNull();
    expect(data).toMatchObject({
      total: 2,
      returned: 2,
      dumps: [
        { id: 'A', runtimeError: 'TIME_OUT', category: 'ABAP runtime error', author: 'MOCKUSER' },
        { id: 'B', runtimeError: 'TIME_OUT' },
      ],
    });
  });

  it('--limit out of range returns INVALID_ARGUMENT envelope (exit 2)', async () => {
    const { program } = makeProgramWithDumps();
    registerDumpsCommand(program);
    const res = await runCommand(program, ['dumps', '--limit', '999', '--json']);
    expect(res.exitCode).toBe(2);
    const envelope = JSON.parse(res.stderr);
    expect(envelope.status).toBe('error');
    expect(envelope.error.code).toBe('INVALID_ARGUMENT');
    expect(envelope.error.example).toContain('--limit');
  });

  it('--user with invalid chars returns INVALID_ARGUMENT envelope (exit 2)', async () => {
    const { program } = makeProgramWithDumps();
    registerDumpsCommand(program);
    const res = await runCommand(program, ['dumps', '--user', 'dev-user', '--json']);
    expect(res.exitCode).toBe(2);
    const envelope = JSON.parse(res.stderr);
    expect(envelope.status).toBe('error');
    expect(envelope.error.code).toBe('INVALID_ARGUMENT');
  });

  it('--schema prints the schema envelope and skips the SAP call', async () => {
    const { program } = makeProgramWithDumps();
    registerDumpsCommand(program);
    const res = await runCommand(program, ['dumps', '--schema']);
    expect(dumpsFn).not.toHaveBeenCalled();
    const envelope = JSON.parse(res.stdout);
    expect(envelope.status).toBe('success');
    expect(envelope.data.command).toBe('dumps');
    expect(envelope.data.scope).toBe('sap');
    const options = envelope.data.options as Array<{ name: string }>;
    expect(options.map((o) => o.name)).toEqual(['--limit <n>', '--user <name>', '--schema']);
  });

  it('prints human-readable format when --json is absent', async () => {
    dumpsFn.mockResolvedValue(
      feedWith([feedEntry({ id: 'X', author: 'MOCKUSER', text: 'something broke' })]),
    );
    const { program } = makeProgramWithDumps();
    registerDumpsCommand(program);
    const res = await runCommand(program, ['dumps']);
    expect(res.stdout).toContain('1 of 1 recent dump(s)');
    expect(res.stdout).toContain('X: TIME_OUT | MOCKUSER - something broke');
  });

  it('propagates underlying SAP errors with structured envelope', async () => {
    dumpsFn.mockRejectedValue(
      new CliError('AUTH_ERROR', 'SAP returned 401', {
        nextSteps: ['Run `abap doctor` to diagnose the auth strategy.'],
      }),
    );
    const { program } = makeProgramWithDumps();
    registerDumpsCommand(program);
    const res = await runCommand(program, ['dumps', '--json']);
    expect(res.exitCode).toBe(5);
    const envelope = JSON.parse(res.stderr);
    expect(envelope.status).toBe('error');
    expect(envelope.error.code).toBe('AUTH_ERROR');
    expect(envelope.error.nextSteps?.[0]).toContain('abap doctor');
  });
});

describe('formatHuman', () => {
  it('shows header even when empty', () => {
    const text = formatHuman({
      total: 0,
      returned: 0,
      dumps: [],
      updatedAt: '2026-08-31T12:00:00.000Z',
    });
    expect(text).toBe('0 of 0 recent dump(s); updated 2026-08-31T12:00:00.000Z');
  });

  it('lists each dump with id, runtime error | author and optional summary', () => {
    const text = formatHuman({
      total: 2,
      returned: 2,
      dumps: [
        { id: 'A', runtimeError: 'TIME_OUT', category: 'ABAP runtime error', author: 'X', summary: 'oops' },
        { id: 'B', runtimeError: '', category: '', author: 'Y' },
      ],
    });
    expect(text).toContain('  A: TIME_OUT | X - oops');
    expect(text).toContain('  B: Unknown runtime error | Y');
  });
});

// Sanity: AdtClientWrapper.create is the only integration point we mock.
describe('AdtClientWrapper.dumps wiring', () => {
  it('uses the wrapper create() entry point', async () => {
    const createSpy = vi.spyOn(AdtClientWrapper, 'create');
    dumpsFn.mockResolvedValue(feedWith([]));
    const { program } = makeProgramWithDumps();
    registerDumpsCommand(program);
    await runCommand(program, ['dumps', '--json']);
    expect(createSpy).toHaveBeenCalled();
  });
});