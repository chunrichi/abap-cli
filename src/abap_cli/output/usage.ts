/**
 * USAGE failures for invocation-shape errors.
 *
 * Contract (shared by the top-level commander error handler and command
 * actions that guard a bare invocation):
 *  - A missing subcommand/argument is always `USAGE` (exit 2).
 *  - Human help is only printed by `--help`; failure paths never splice a
 *    multi-line help block into stdout/stderr. The envelope carries a one-line
 *    pointer instead (`error.details.help`, mirrored by `nextSteps`/`example`).
 *  - `--json` mode keeps stdout empty and writes one JSON envelope to stderr.
 */

import type { Command } from 'commander';
import { CliError, jsonFromCommand, printError } from './json.js';

/** Canonical invocation path of a command (`abap transport create`). */
export function commandPath(cmd: Command): string {
  const parts: string[] = [];
  for (let cur: Command | undefined = cmd; cur && cur.parent; cur = cur.parent) {
    parts.unshift(cur.name());
  }
  return ['abap', ...parts].join(' ');
}

/** Build the USAGE error for a missing subcommand/argument. */
export function missingInvocationError(path: string, message: string, example?: string): CliError {
  const help = `${path} --help`;
  return new CliError('USAGE', message, {
    nextSteps: [`Run '${help}' for the full option list.`],
    example: example ?? help,
    details: { help },
  });
}

/** Fail a command action with the unified USAGE failure for a bare invocation. */
export function failMissingInvocation(cmd: Command, message: string, example?: string): never {
  printError(jsonFromCommand(cmd), missingInvocationError(commandPath(cmd), message, example));
}
