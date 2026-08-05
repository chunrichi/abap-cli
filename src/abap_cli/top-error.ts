/**
 * Top-level commander-error handler (P1.7).
 *
 * Every commander error thrown by `program.parseAsync` flows through
 * `handleTopLevelError`. The handler is responsible for the stream-separation
 * contract:
 *  - Real help exits (`--help`, `--version`, no-args root): plain text on
 *    stdout, no stderr, exit 0 (per contract §1.4).
 *  - USAGE / unknown-command / unknown-option exits: stdout carries the
 *    subcommand's help in human mode; in `--json` mode stdout stays empty and
 *    the help body accompanies the JSON envelope on stderr so the JSON
 *    contract (stdout empty on failure) is preserved.
 *  - Any other thrown error: routes through `renderError` so the standard
 *    envelope / exit-code mapping applies.
 *
 * The function never returns; it always calls `process.exit()`.
 */

import { CommanderError, type Command } from 'commander';
import { CliError, renderError } from './output/json.js';
import { buildMeta } from './output/meta.js';

export interface TopErrorContext {
  program: Command;
  argv: readonly string[];
  /** Output version, surfaced in stuck-report metadata. */
  version: string;
}

/** First non-flag argv token; the subcommand the user addressed. */
export function firstSubcommandArg(argv: readonly string[]): string | undefined {
  return argv.slice(2).find((a) => !a.startsWith('-'));
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

/** Decide whether an argv contains the `--json` flag. */
export function isJson(argv: readonly string[]): boolean {
  return argv.includes('--json');
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
  const json = isJson(ctx.argv);

  if (error instanceof CommanderError) {
    if (error.code === 'commander.helpDisplayed' || error.code === 'commander.help') {
      const firstArg = firstSubcommandArg(ctx.argv);
      const sub = resolveSubcommand(ctx.program, firstArg, ctx.argv);
      const helpBody = sub.helpInformation();
      if (error.code === 'commander.help' && sub !== ctx.program) {
        // Bare subcommand (e.g. `abap transport` with no subcommand): exit 2
        // with the subcommand's usage and a USAGE error. JSON mode keeps
        // stdout empty.
        if (json) {
          const usage = new CliError('USAGE', 'Missing required subcommand or argument.', {
            nextSteps: ['Check the command usage: abap <command> --help.'],
            example: `abap ${firstArg ?? '<command>'} --help`,
          });
          const out = renderError(json, usage, buildMeta());
          writeBlock(streams.stderr, out.stderr.join('\n'));
          streams.stderr.write('\n');
          writeBlock(streams.stderr, helpBody);
          exit(out.exitCode ?? 2);
        }
        writeBlock(streams.stdout, helpBody);
        streams.stderr.write('Missing required argument(s). See the usage above.\n');
        exit(2);
      }
      // Real help exit (--help/--version/no-args root): plain text on stdout,
      // exit 0, no stderr (contract §1.4).
      writeBlock(streams.stdout, helpBody);
      exit(0);
    }
    if (error.exitCode === 0) exit(0);
    if (
      error.code === 'commander.missingArgument' ||
      error.code === 'commander.missingMandatoryOptionValue' ||
      error.code === 'commander.optionMissingArgument'
    ) {
      const firstArg = firstSubcommandArg(ctx.argv);
      const sub = resolveSubcommand(ctx.program, firstArg, ctx.argv);
      const helpBody = sub.helpInformation();
      if (json) {
        const usage = new CliError('USAGE', error.message.replace(/^error: /, ''), {
          nextSteps: ['Check the command usage: abap <command> --help.'],
          example: `abap ${firstArg ?? '<command>'} --help`,
        });
        const out = renderError(json, usage, buildMeta());
        writeBlock(streams.stderr, out.stderr.join('\n'));
        streams.stderr.write('\n');
        writeBlock(streams.stderr, helpBody);
        exit(out.exitCode ?? 2);
      }
      writeBlock(streams.stdout, helpBody);
      const usage = new CliError('USAGE', error.message.replace(/^error: /, ''), {
        nextSteps: ['Check the command usage: abap <command> --help.'],
        example: 'abap <command> --help',
      });
      const out = renderError(json, usage, buildMeta());
      writeBlock(streams.stderr, out.stderr.join('\n'));
      exit(out.exitCode ?? 2);
    }
    const usage = new CliError('USAGE', error.message.replace(/^error: /, ''), {
      nextSteps: ['Check the command usage: abap <command> --help.'],
      example: 'abap <command> --help',
    });
    const out = renderError(json, usage, buildMeta());
    writeBlock(streams.stderr, out.stderr.join('\n'));
    exit(out.exitCode ?? 2);
  }

  const out = renderError(json, error, buildMeta());
  writeBlock(streams.stderr, out.stderr.join('\n'));
  exit(out.exitCode ?? 1);
}
