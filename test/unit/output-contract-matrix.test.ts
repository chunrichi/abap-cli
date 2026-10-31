/**
 * Output-contract matrix for the invocation-shape (USAGE) failure paths.
 *
 * Every command in scope is driven through the production pipeline —
 * `program.parseAsync` → commander error / `CliError` → `handleTopLevelError`
 * — for three invocation shapes:
 *   - bare invocation (missing subcommand / required argument),
 *   - missing required argument or mandatory option value,
 *   - unknown option.
 * Each matrix case runs with `--json` and asserts the machine contract:
 *   - stdout is empty (a missing argument must never look like success),
 *   - stderr is exactly one JSON envelope (no spliced human help),
 *   - exit code matches `error.category` through the exit-code map.
 * `--help` stays the only path that prints human help.
 *
 * `doctor` and `validate:aff` are excluded: their output contract is owned by
 * a separate change unit.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { CliExit } from '../../src/abap_cli/output/exit.js';
import { categoryOf, type ErrorCode } from '../../src/abap_cli/output/error-codes.js';
import { exitCodeFor } from '../../src/abap_cli/output/exit-codes.js';
import { setProgram } from '../../src/abap_cli/output/meta.js';
import { handleTopLevelError, type Streams } from '../../src/abap_cli/top-error.js';
import { registerCheckCommand } from '../../src/abap_cli/commands/check.js';
import { registerMimeCommand } from '../../src/abap_cli/commands/mime.js';
import { registerProfileCommand } from '../../src/abap_cli/commands/profile.js';
import { registerPullCommand } from '../../src/abap_cli/commands/pull.js';
import { registerReportStuckCommand } from '../../src/abap_cli/commands/report-stuck.js';
import { registerRunCommand } from '../../src/abap_cli/commands/run.js';
import { registerSessionCommand } from '../../src/abap_cli/commands/session.js';
import { registerTcodeCommand } from '../../src/abap_cli/commands/tcode.js';
import { registerTransportCommand } from '../../src/abap_cli/commands/transport.js';

class ExitSignal extends Error {
  constructor(public readonly code: number | undefined) {
    super(`exit ${code ?? 'undefined'}`);
  }
}

interface MatrixResult {
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
}

/** Build the root program the way `src/abap_cli/index.ts` does. */
function makeProgram(): Command {
  const program = new Command()
    .name('abap')
    .option('--json', 'Output in JSON format')
    .option('--pretty-json', 'Output in pretty JSON format');
  program.exitOverride();
  // Production suppresses commander's own error/help writes to the error
  // stream; the shared handler is the single writer of failure output.
  program.configureOutput({ writeErr: () => {} });
  registerPullCommand(program);
  registerRunCommand(program);
  registerCheckCommand(program);
  registerProfileCommand(program);
  registerTcodeCommand(program);
  registerMimeCommand(program);
  registerTransportCommand(program);
  registerSessionCommand(program);
  registerReportStuckCommand(program);
  return program;
}

let savedArgv: string[];

beforeEach(() => {
  savedArgv = process.argv;
});

afterEach(() => {
  process.argv = savedArgv;
});

/**
 * Run one invocation end-to-end and capture every output channel:
 *  - `console.log` / `console.error` — the command actions' `printResult` /
 *    `printError` shims (vitest swaps `console`, so these do not reach the
 *    process streams),
 *  - `process.stdout.write` / `process.stderr.write` — commander's own help
 *    writes plus the shared handler (it writes through the process streams).
 */
async function runContract(argv: string[]): Promise<MatrixResult> {
  const out: string[] = [];
  const err: string[] = [];
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array): boolean => {
    out.push(String(chunk));
    return true;
  }) as never);
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array): boolean => {
    err.push(String(chunk));
    return true;
  }) as never);
  const logSpy = vi.spyOn(console, 'log').mockImplementation(((...args: unknown[]) => {
    out.push(args.map(String).join(' ') + '\n');
  }) as never);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(((...args: unknown[]) => {
    err.push(args.map(String).join(' ') + '\n');
  }) as never);

  const program = makeProgram();
  setProgram(program);
  process.argv = ['node', 'abap', ...argv];
  const streams: Streams = { stdout: process.stdout, stderr: process.stderr };
  const exit = (code?: number): never => {
    throw new ExitSignal(code);
  };

  let exitCode: number | undefined;
  try {
    // Default `from: 'node'` convention: argv[0] = node, argv[1] = bin, the
    // rest are the user arguments (matches the production entry point).
    await program.parseAsync(['node', 'abap', ...argv]);
  } catch (error: unknown) {
    if (error instanceof ExitSignal) {
      exitCode = error.code;
    } else if (error instanceof CliExit) {
      // printError already emitted the envelope; only the exit code is left.
      exitCode = error.exitCode;
    } else {
      try {
        handleTopLevelError(error, { program, argv: process.argv, version: '0.0.0' }, streams, exit);
      } catch (caught) {
        if (caught instanceof ExitSignal) exitCode = caught.code;
        else throw caught;
      }
    }
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  }
  return { stdout: out.join(''), stderr: err.join(''), exitCode };
}

/** Assert the unified USAGE failure contract for one JSON-mode invocation. */
function expectUsageContract(result: MatrixResult, label: string): void {
  expect(result.stdout, `${label}: stdout must stay empty on failure`).toBe('');
  // Exactly one JSON document on stderr: a spliced help block would make this
  // JSON.parse throw (the regression this matrix exists to prevent).
  const payload = JSON.parse(result.stderr) as {
    status: string;
    error: { code: ErrorCode; category: string; message: string; details?: { help?: string } };
  };
  expect(payload.status, `${label}: status`).toBe('error');
  expect(payload.error.code, `${label}: code`).toBe('USAGE');
  expect(payload.error.category, `${label}: category`).toBe(categoryOf('USAGE'));
  expect(result.exitCode, `${label}: exit code maps from category`).toBe(
    exitCodeFor(categoryOf(payload.error.code)),
  );
  expect(result.exitCode, `${label}: exit code`).toBe(2);
  expect(payload.error.message.length, `${label}: message`).toBeGreaterThan(0);
  expect(payload.error.details?.help, `${label}: one-line help pointer`).toMatch(/^abap .*--help$/);
  expect(result.stderr, `${label}: no spliced human help`).not.toContain('Usage:');
}

/** Bare invocations: no subcommand / no required argument. */
const BARE_INVOCATIONS = [
  ['pull'],
  ['run'],
  ['check'],
  ['profile'],
  ['tcode'],
  ['mime'],
  ['transport'],
  ['session'],
  ['report-stuck'],
] as const;

/** Missing required argument / mandatory option value. */
const MISSING_ARGUMENTS = [
  ['check', 'atc'],
  ['transport', 'create'],
  ['transport', 'show'],
  ['transport', 'resolve'],
  ['transport', 'assign'],
  ['mime', 'create'],
  ['mime', 'delete'],
  ['mime', 'push'],
  ['pull', '--active'],
] as const;

/** Unknown option on an otherwise valid command. */
const UNKNOWN_OPTIONS = [
  ['pull', '--no-such-option'],
  ['run', '--no-such-option'],
  ['check', '--no-such-option'],
  ['profile', '--no-such-option'],
  ['tcode', '--no-such-option'],
  ['mime', '--no-such-option'],
  ['transport', '--no-such-option'],
  ['session', '--no-such-option'],
  ['report-stuck', '--no-such-option'],
] as const;

describe('output contract matrix: USAGE failures under --json', () => {
  it('bare invocation → empty stdout + one USAGE envelope (exit 2)', async () => {
    for (const argv of BARE_INVOCATIONS) {
      const result = await runContract([...argv, '--json']);
      expectUsageContract(result, argv.join(' '));
    }
  });

  it('missing required argument/option → empty stdout + one USAGE envelope (exit 2)', async () => {
    for (const argv of MISSING_ARGUMENTS) {
      const result = await runContract([...argv, '--json']);
      expectUsageContract(result, argv.join(' '));
    }
  });

  it('unknown option → empty stdout + one USAGE envelope (exit 2)', async () => {
    for (const argv of UNKNOWN_OPTIONS) {
      const result = await runContract([...argv, '--json']);
      expectUsageContract(result, argv.join(' '));
    }
  });

  it('human mode keeps stdout empty too and prints a help pointer on stderr', async () => {
    for (const argv of [['pull'], ['transport'], ['check', 'atc']] as const) {
      const result = await runContract([...argv]);
      expect(result.stdout, `${argv.join(' ')}: stdout`).toBe('');
      expect(result.exitCode, `${argv.join(' ')}: exit`).toBe(2);
      expect(result.stderr, `${argv.join(' ')}: error line`).toMatch(/^(Error:|  Try:)/m);
      expect(result.stderr, `${argv.join(' ')}: help pointer`).toContain('--help');
      expect(result.stderr, `${argv.join(' ')}: no help body`).not.toContain('Usage:');
    }
  });
});

describe('output contract matrix: help stays human-only', () => {
  it('--help exits 0 with human help on stdout and empty stderr', async () => {
    const result = await runContract(['pull', '--help', '--json']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: abap pull');
    expect(result.stderr).toBe('');
  });

  it('`abap help <command>` is a help exit (0), not a USAGE failure', async () => {
    const result = await runContract(['help', 'pull', '--json']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: abap pull');
    expect(result.stderr).toBe('');
  });
});
