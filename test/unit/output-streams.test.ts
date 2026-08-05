import { describe, expect, it } from 'vitest';
import { Command, CommanderError } from 'commander';
import { CliError } from '../../src/abap_cli/output/json.js';
import { handleTopLevelError, isJson, type Streams } from '../../src/abap_cli/top-error.js';

/**
 * P1.7 — stdout/stderr separation audit. The CLI must never silently drop
 * output, and `--json` mode must never emit plain text on stdout (the JSON
 * envelope contract: success on stdout, failure on stderr, stdout empty on
 * failure). Real `--help`/`--version` exits are exempt by contract §1.4.
 *
 * The handler is exercised directly: feed it a `CommanderError` or `CliError`
 * with captured streams + a fake exit so we can assert on the actual bytes
 * written to each stream without booting the whole CLI.
 */

class FakeExit extends Error {
  constructor(public code?: number) {
    super(`exit ${code ?? 'undefined'}`);
  }
}

interface Capture {
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
}

function capture(): { streams: Streams; out: { stdout: string[]; stderr: string[] } } {
  const out = { stdout: [] as string[], stderr: [] as string[] };
  const streams: Streams = {
    stdout: { write: (s: string): boolean => { out.stdout.push(s); return true; } },
    stderr: { write: (s: string): boolean => { out.stderr.push(s); return true; } },
  };
  return { streams, out };
}

function run(
  error: unknown,
  argv: string[],
  program: Command = new Command().exitOverride(),
): Capture {
  const { streams, out } = capture();
  const originalArgv = process.argv;
  process.argv = ['node', 'abap', ...argv];
  let exitCode: number | undefined;
  try {
    handleTopLevelError(
      error,
      { program, argv: process.argv, version: '9.9.9' },
      streams,
      (code?: number): never => {
        exitCode = code;
        throw new FakeExit(code);
      },
    );
  } catch (caught) {
    if (!(caught instanceof FakeExit)) {
      process.argv = originalArgv;
      throw caught;
    }
  } finally {
    process.argv = originalArgv;
  }
  return {
    stdout: out.stdout.join(''),
    stderr: out.stderr.join(''),
    exitCode,
  };
}

describe('P1.7 stdout/stderr separation audit (handleTopLevelError)', () => {
  describe('isJson helper', () => {
    it('detects --json anywhere in argv', () => {
      expect(isJson(['node', 'abap', '--json', 'pull'])).toBe(true);
      expect(isJson(['node', 'abap', 'pull', '--json'])).toBe(true);
      expect(isJson(['node', 'abap', 'pull'])).toBe(false);
    });
  });

  describe('--json mode: failure paths keep stdout empty', () => {
    it('commander.missingArgument: JSON envelope + help on stderr, stdout empty', () => {
      const program = new Command().name('abap-cli');
      const transport = program.command('transport').description('transport commands');
      transport.command('create').argument('<description>', 'Transport description').action(() => {});
      const err = new CommanderError(1, 'commander.missingArgument', "error: missing required argument 'description'");
      const res = run(err, ['--json', 'transport', 'create'], program);
      expect(res.exitCode).toBe(2);
      expect(res.stdout).toBe('');
      const payload = JSON.parse(res.stderr.split('\n\n')[0]);
      expect(payload.status).toBe('error');
      expect(payload.error.code).toBe('USAGE');
      expect(payload.error.category).toBe('USAGE');
      // Help body accompanies the envelope on stderr.
      expect(res.stderr).toContain('Usage:');
      expect(res.stderr).toContain('<description>');
    });

    it('commander.help on bare subcommand: JSON envelope + sub help on stderr, stdout empty', () => {
      // `abap transport` (no subcommand) → commander.help with error:true.
      // Requires the program to actually have a `transport` subcommand
      // registered, otherwise resolveSubcommand walks back to root and
      // commander.help dispatches as a real help exit.
      const program = new Command().name('abap-cli');
      program.command('transport').description('transport commands');
      const err = new CommanderError(1, 'commander.help', '(outputHelp)');
      const res = run(err, ['--json', 'transport'], program);
      expect(res.exitCode).toBe(2);
      expect(res.stdout).toBe('');
      const payload = JSON.parse(res.stderr.split('\n\n')[0]);
      expect(payload.status).toBe('error');
      expect(payload.error.code).toBe('USAGE');
      expect(payload.error.message).toContain('Missing required');
      expect(res.stderr).toContain('Usage:');
    });

    it('commander.unknownCommand: stdout empty, USAGE envelope on stderr', () => {
      const err = new CommanderError(1, 'commander.unknownCommand', "error: unknown command 'no-such'");
      const res = run(err, ['--json', 'no-such']);
      expect(res.exitCode).toBe(2);
      expect(res.stdout).toBe('');
      const payload = JSON.parse(res.stderr);
      expect(payload.status).toBe('error');
      expect(payload.error.code).toBe('USAGE');
    });

    it('commander.unknownOption: stdout empty, USAGE envelope on stderr', () => {
      const err = new CommanderError(1, 'commander.unknownOption', "error: unknown option '--bogus'");
      const res = run(err, ['--json', 'pull', '--bogus']);
      expect(res.exitCode).toBe(2);
      expect(res.stdout).toBe('');
      const payload = JSON.parse(res.stderr);
      expect(payload.status).toBe('error');
      expect(payload.error.code).toBe('USAGE');
    });

    it('CliError thrown by an action: stdout empty, JSON envelope on stderr', () => {
      const err = new CliError('USAGE', 'demo missing arg', {
        nextSteps: ['try again'],
        example: 'abap boom --help',
      });
      const res = run(err, ['--json', 'boom']);
      expect(res.exitCode).toBe(2);
      expect(res.stdout).toBe('');
      const payload = JSON.parse(res.stderr);
      expect(payload.status).toBe('error');
      expect(payload.error.code).toBe('USAGE');
      expect(payload.error.example).toBe('abap boom --help');
    });

    it('unknown commander error code still exits 2 with USAGE envelope', () => {
      // Path not covered by an explicit branch — falls through to the generic
      // USAGE envelope with the original message.
      const err = new CommanderError(1, 'commander.executableRecursive', 'error: recursive exec');
      const res = run(err, ['--json']);
      expect(res.exitCode).toBe(2);
      expect(res.stdout).toBe('');
      const payload = JSON.parse(res.stderr);
      expect(payload.status).toBe('error');
      expect(payload.error.code).toBe('USAGE');
    });
  });

  describe('human mode: USAGE paths put help on stdout (when relevant) and error on stderr', () => {
    it('commander.missingArgument: sub help on stdout, structured error on stderr', () => {
      // Build a program with the relevant subcommand so resolveSubcommand
      // walks to the deepest one.
      const program = new Command().name('abap-cli');
      const transport = program.command('transport').description('transport commands');
      transport.command('create').argument('<description>', 'Transport description').action(() => {});
      const err = new CommanderError(1, 'commander.missingArgument', "error: missing required argument 'description'");
      const res = run(err, ['transport', 'create'], program);
      expect(res.exitCode).toBe(2);
      expect(res.stdout).toContain('Usage:');
      expect(res.stdout).toContain('<description>');
      expect(res.stderr).toMatch(/Error:.*description/);
    });

    it('commander.help on bare subcommand: sub help on stdout, USAGE note on stderr', () => {
      // Bare `abap transport` only fires commander.help when the program
      // actually has a `transport` subcommand registered — empty programs
      // dispatch it as a real help request (exit 0).
      const program = new Command().name('abap-cli');
      program.command('transport').description('transport commands');
      const err = new CommanderError(1, 'commander.help', '(outputHelp)');
      const res = run(err, ['transport'], program);
      expect(res.exitCode).toBe(2);
      expect(res.stdout).toContain('Usage:');
      expect(res.stderr).toMatch(/Missing required argument/);
    });

    it('commander.unknownCommand: error on stderr only (no stdout)', () => {
      const err = new CommanderError(1, 'commander.unknownCommand', "error: unknown command 'no-such'");
      const res = run(err, ['no-such']);
      expect(res.exitCode).toBe(2);
      expect(res.stdout).toBe('');
      expect(res.stderr).toMatch(/Error:.*no-such/);
    });

    it('CliError thrown by an action: error on stderr only', () => {
      const err = new CliError('USAGE', 'demo missing arg');
      const res = run(err, ['boom']);
      expect(res.exitCode).toBe(2);
      expect(res.stdout).toBe('');
      expect(res.stderr).toMatch(/Error:.*demo/);
    });
  });

  describe('true help exits follow contract §1.4: plain text on stdout, exit 0', () => {
    it('commander.helpDisplayed (--help): help on stdout, no stderr, exit 0', () => {
      const program = new Command().name('abap-cli');
      const err = new CommanderError(0, 'commander.helpDisplayed', '(outputHelp)');
      const res = run(err, ['--help'], program);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('Usage:');
      expect(res.stderr).toBe('');
    });

    it('commander.helpDisplayed with subcommands registered: still plain text stdout', () => {
      const program = new Command().name('abap-cli');
      const sub = program.command('pull').description('pull things');
      sub.action(() => {});
      const err = new CommanderError(0, 'commander.helpDisplayed', '(outputHelp)');
      const res = run(err, ['--help'], program);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('Usage:');
      expect(res.stderr).toBe('');
    });

    it('--json --help (commander.helpDisplayed): still plain text on stdout per contract §1.4', () => {
      const program = new Command().name('abap-cli');
      const err = new CommanderError(0, 'commander.helpDisplayed', '(outputHelp)');
      const res = run(err, ['--json', '--help'], program);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('Usage:');
      expect(res.stderr).toBe('');
    });

    it('commander error with exitCode 0 (e.g. --version): exit 0, no output', () => {
      // A non-help commander error with exitCode 0 still exits early — only
      // the help/helpDisplayed branches write to the streams.
      const err = new CommanderError(0, 'commander.executableRecursive', 'recursive');
      const res = run(err, []);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toBe('');
      expect(res.stderr).toBe('');
    });
  });
});
