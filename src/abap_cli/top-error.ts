/**
 * Top-level commander-error handler.
 *
 * Every commander error thrown by `program.parseAsync` flows through
 * `handleTopLevelError`. The handler is responsible for the stream-separation
 * contract:
 *  - Real help exits (`--help`, `--version`, no-args root): plain text on
 *    stdout, no stderr, exit 0.
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
import { CliError, isJsonMode, renderError, type OutputMode } from './output/json.js';
import { buildMeta, deriveCommand } from './output/meta.js';
import type { ExtensionRegistry } from './extensions/registry.js';

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

/** Resolve the top-level output mode from argv (025 US1).
 *  `--pretty-json` wins over `--json`. */
export function isJson(argv: readonly string[]): OutputMode {
  if (argv.includes('--pretty-json')) return 'pretty-json';
  if (argv.includes('--json')) return 'json';
  return 'human';
}

/** Back-compat boolean predicate (true when any JSON mode is requested). */
export function isAnyJson(argv: readonly string[]): boolean {
  return isJsonMode(isJson(argv));
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
  registry?: ExtensionRegistry,
): never {
  const json: OutputMode = isJson(ctx.argv);

  if (error instanceof CommanderError) {
    if (error.code === 'commander.helpDisplayed') {
      // Real help exit (--help/--version/no-args root): commander has already
      // written the full help (including addHelpText sections) to stdout.
      // Exit 0, no stderr. Re-rendering would duplicate it.
      exit(0);
    }
    if (error.code === 'commander.help') {
      // commander.help fires for bare subcommands (e.g. `abap transport` with
      // no subcommand). commander has already written the subcommand help
      // (via outputHelp({ error: true })) to writeErr. We only need to emit
      // the JSON envelope in --json mode and a stderr hint in human mode.
      const firstArg = firstSubcommandArg(ctx.argv);
      if (isJsonMode(json)) {
        const usage = new CliError('USAGE', 'Missing required subcommand or argument.', {
          nextSteps: ['Check the command usage: abap <command> --help.'],
          example: `abap ${firstArg ?? '<command>'} --help`,
        });
        const out = renderError(json, usage, buildMeta());
        writeBlock(streams.stderr, out.stderr.join('\n'));
        exit(out.exitCode ?? 2);
      }
      streams.stderr.write('Missing required argument(s). See the usage above.\n');
      exit(2);
    }
    if (error.exitCode === 0) exit(0);
    if (
      error.code === 'commander.missingArgument' ||
      error.code === 'commander.missingMandatoryOptionValue' ||
      error.code === 'commander.optionMissingArgument'
    ) {
      // Missing-argument path: commander has already written the subcommand
      // usage to writeErr (via _displayError → outputHelp({ error: true })).
      // In human mode we mirror a plain help body to stdout so the user sees
      // the full options; helpInformation() omits addHelpText sections, which
      // is acceptable on this error path. JSON mode keeps stdout empty (envelope contract on failure).
      const firstArg = firstSubcommandArg(ctx.argv);
      const sub = resolveSubcommand(ctx.program, firstArg, ctx.argv);
      const helpBody = sub.helpInformation();
      if (isJsonMode(json)) {
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

  // Fire onError lifecycle hooks without blocking the exit path (failures swallowed)
  if (registry) {
    registry.dispatchAll('onError', {
      command: deriveCommand(process.argv),
      argv: process.argv.slice(2),
      error: out.stderr[0] ? JSON.parse(out.stderr[0])?.error ?? {} : {},
      ts: Date.now(),
    }).catch(() => {
      // Swallowed: onError hook failures are non-fatal
    });
  }

  exit(out.exitCode ?? 1);
}
