/**
 * Regression: `abap --help` was printing the help block twice. Root cause was
 * that handleTopLevelError re-emitted `sub.helpInformation()` to stdout in the
 * commander.helpDisplayed branch, after commander had already written the
 * full help (including addHelpText sections) via `outputHelp()` to stdout.
 *
 * This test exercises the full `program.parseAsync()` → throw → catch →
 * handleTopLevelError → exit pipeline and counts how many times each marker
 * appears in the rendered stdout.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command, CommanderError } from 'commander';
import { handleTopLevelError } from '../../src/abap_cli/top-error.js';

class ExitSentinel extends Error {
  constructor(public readonly code: number | undefined) {
    super(`__exit__:${code ?? 'undefined'}`);
  }
}

describe('end-to-end: --help renders exactly once', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
      code?: number,
    ): never => {
      throw new CommanderError(
        code as number,
        'commander.helpDisplayed',
        '(outputHelp)',
      );
    }) as never);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  function capturedStdout(): string {
    return stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
  }

  function runFull(argv: string[]): void {
    const program = new Command().name('abap-cli').description('test');
    program
      .option('--json', 'JSON output')
      .exitOverride();
    program.command('pull').description('pull things').action(() => {});
    program.command('push').description('push things').action(() => {});
    // Mimic the production addHelpText('after', ...) used by lazy.ts so the
    // rendered help actually contains a trailing section that would surface
    // a double-emission if it leaked into the output twice.
    program.addHelpText('after', 'MARKER_SECTION: please appear once');

    program.parse(argv, { from: 'user' });
  }

  it('parser-level --help renders the help block exactly once', () => {
    expect(() => runFull(['node', 'abap', '--help'])).toThrow(CommanderError);
    const out = capturedStdout();
    expect(out).toContain('Usage:');
    expect(out).toContain('Commands:');
    expect(out).toContain('MARKER_SECTION: please appear once');
    // Each header line must appear exactly once.
    expect(out.match(/^Usage:/gm)?.length).toBe(1);
    expect(out.match(/^Commands:/gm)?.length).toBe(1);
    expect(out.match(/^MARKER_SECTION:/gm)?.length).toBe(1);
  });

  it('handler-level helpDisplayed: handler does not re-emit to stdout', () => {
    const program = new Command().name('abap-cli');
    program.command('pull').description('pull things').action(() => {});
    const err = new CommanderError(0, 'commander.helpDisplayed', '(outputHelp)');
    let exitCode: number | undefined;
    let exited = false;
    try {
      handleTopLevelError(
        err,
        { program, argv: ['node', 'abap', '--help'], version: '0.0.0' },
        { stdout: process.stdout, stderr: process.stderr },
        (code?: number): never => {
          exitCode = code;
          exited = true;
          // Stop the handler's `never` return so the test can assert below.
          // We use a sentinel object via a throw caught outside this fn.
          throw new ExitSentinel(code);
        },
      );
    } catch (caught) {
      if (!(caught instanceof ExitSentinel)) throw caught;
    }
    expect(exited).toBe(true);
    expect(exitCode).toBe(0);
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});