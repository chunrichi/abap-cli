/**
 * Top-level commander-error handler.
 *
 * Every commander error thrown by `program.parseAsync` flows through
 * `handleTopLevelError`. The handler is responsible for the stream separation
 * contract:
 *  - Real help exits (`--help`, `--version`, `abap help <cmd>`): plain text on
 *    stdout, no stderr, exit 0. `--help` (and the `help` command) is the only
 *    path that prints human help.
 *  - USAGE / missing-argument / unknown-command / unknown-option exits: stdout
 *    stays empty in every mode; failures render the standard error contract on
 *    stderr. In `--json` mode that is exactly one envelope line, with a
 *    one-line `details.help` pointer instead of a spliced help block; human
 *    mode renders the `Error:` / `Try:` / `See:` lines only.
 *  - Any other thrown error: routes through `renderError` so the standard
 *    envelope / exit-code mapping applies.
 *
 * The function never returns; it always calls `process.exit()`.
 */

import { CommanderError, type Command } from 'commander';
import { renderError, type OutputMode } from './output/json.js';
import { buildMeta } from './output/meta.js';
import { commandPath, missingInvocationError } from './output/usage.js';

export interface TopErrorContext {
  program: Command;
  argv: readonly string[];
  /** Output version, surfaced in error metadata. */
  version: string;
}

/** First non-flag argv token; the subcommand the user addressed. */
export function firstSubcommandArg(argv: readonly string[]): string | undefined {
  return argv.slice(2).find((a) => !a.startsWith('-'));
}

/** All non-flag argv tokens (user tokens, in order). */
function nonFlagArgs(argv: readonly string[]): string[] {
  return argv.slice(2).filter((a) => !a.startsWith('-'));
}

/** Walk the program tree to find the deepest registered subcommand for argv.
 *  Falls back to the root when none of the tokens match a known subcommand. */
export function resolveSubcommand(program: Command, firstArg: string | undefined, argv: readonly string[]): Command {
  if (!firstArg) return program;
  let current = program;
  const direct = current.commands.find((c) => c.name() === firstArg);
  if (!direct) return current;
  current = direct;
  // Skip the leading node/bin entries; argv starts at the user tokens.
  const userArgv = argv.slice(2);
  const startIdx = userArgv.indexOf(firstArg);
  for (let i = startIdx + 1; i < userArgv.length; i++) {
    const next = userArgv[i];
    if (next === undefined || next.startsWith('-')) break;
    const child = current.commands.find((c) => c.name() === next);
    if (!child) break;
    current = child;
  }
  return current;
}

/** Write a multi-line block to the given writable, adding a trailing newline. */
function writeBlock(stream: { write: (s: string) => unknown }, block: string): void {
  stream.write(block.endsWith('\n') ? block : `${block}\n`);
}

/** Resolve the top-level output mode from argv.
 *  `--pretty-json` wins over `--json`. */
export function isJson(argv: readonly string[]): OutputMode {
  if (argv.includes('--pretty-json')) return 'pretty-json';
  if (argv.includes('--json')) return 'json';
  return 'human';
}

/** Stream handles for the handler; injected so unit tests can capture them. */
export interface Streams {
  stdout: { write: (s: string) => unknown };
  stderr: { write: (s: string) => unknown };
}

/**
 * Handle a single error caught by the top-level `await program.parseAsync()`
 * try/catch. Always exits via the injected `exit` function (defaults to
 * `process.exit`). Production calls it with no overrides; tests inject
 * capture streams and a fake exit so they can inspect the result.
 */
export function handleTopLevelError(
  error: unknown,
  ctx: TopErrorContext,
  streams: Streams = {
    stdout: process.stdout,
    stderr: process.stderr,
  },
  exit: (code?: number) => never = (code) => process.exit(code as number),
): never {
  const json: OutputMode = isJson(ctx.argv);

  /** Emit one USAGE failure: stdout stays empty, stderr carries the standard
   *  error rendering, and `details.help` points at the one-line help command
   *  instead of splicing the multi-line help body into the output. */
  const usageFailure = (message: string, sub: Command): never => {
    const usage = missingInvocationError(commandPath(sub), message);
    const out = renderError(json, usage, buildMeta());
    writeBlock(streams.stderr, out.stderr.join('\n'));
    exit(out.exitCode ?? 2);
  };

  if (error instanceof CommanderError) {
    if (error.code === 'commander.helpDisplayed') {
      // Real help exit (--help/--version/no-args root): commander has already
      // written the full help (including addHelpText sections) to stdout.
      // Exit 0, no stderr. Re-rendering would duplicate it.
      exit(0);
    }
    if (error.code === 'commander.help') {
      // commander.help(0) is an explicit help request (`abap help <cmd>`):
      // commander wrote the help to stdout, so it is a real help exit.
      if (error.exitCode === 0) exit(0);
      // Otherwise commander stopped on a command group without a subcommand
      // (or a help request for an unknown command): a USAGE failure.
      const args = nonFlagArgs(ctx.argv);
      if (args[0] === 'help') {
        const target = args[1];
        usageFailure(
          target ? `unknown command '${target}'` : 'Missing required subcommand or argument.',
          ctx.program,
        );
      }
      const firstArg = firstSubcommandArg(ctx.argv);
      usageFailure(
        'Missing required subcommand or argument.',
        resolveSubcommand(ctx.program, firstArg, ctx.argv),
      );
    }
    if (error.exitCode === 0) exit(0);
    // USAGE paths (missing argument / missing mandatory option value / unknown
    // option / unknown command) share one rendering: commander already wrote
    // its own text to the suppressed writeErr, so only the envelope remains.
    const firstArg = firstSubcommandArg(ctx.argv);
    const sub = resolveSubcommand(ctx.program, firstArg, ctx.argv);
    usageFailure(error.message.replace(/^error: /, ''), sub);
  }

  const out = renderError(json, error, buildMeta());
  writeBlock(streams.stderr, out.stderr.join('\n'));

  exit(out.exitCode ?? 1);
}
