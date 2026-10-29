import { Command } from 'commander';
import { vi } from 'vitest';

/** Thrown instead of process.exit so tests can capture the exit code. */
export class ExitSignal extends Error {
  constructor(public code?: number) {
    super(`exit ${code}`);
  }
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode?: number;
}

/**
 * Run a commander program with captured stdout/stderr and a process.exit that
 * throws ExitSignal. `--json` must be a registered root option.
 */
export async function runCommand(
  program: Command,
  args: string[],
  opts: { cwd?: string; isTTY?: boolean } = {},
): Promise<RunResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const cwdSpy = opts.cwd ? vi.spyOn(process, 'cwd').mockReturnValue(opts.cwd) : null;
  const isTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', { value: opts.isTTY ?? false, configurable: true });
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    stdout.push(a.map(String).join(' '));
  });
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    stderr.push(a.map(String).join(' '));
  });
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
    throw new ExitSignal(code);
  });

  let exitCode: number | undefined;
  try {
    await program.parseAsync(args, { from: 'user' });
  } catch (error) {
    if (error instanceof ExitSignal) exitCode = error.code;
    else throw error;
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
    cwdSpy?.mockRestore();
    if (isTTYDescriptor) Object.defineProperty(process.stdin, 'isTTY', isTTYDescriptor);
    else delete (process.stdin as { isTTY?: unknown }).isTTY;
  }
  return { stdout: stdout.join('\n'), stderr: stderr.join('\n'), exitCode };
}

/** Fresh root program with the global --json flag, ready for a command registerer. */
export function makeProgram(): Command {
  return new Command().option('--json', 'Output in JSON format');
}
