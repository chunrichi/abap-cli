import { Command } from 'commander';
import { printError, printResult, printSchema, jsonFromCommand } from '../output/json.js';
import { commandSchemas } from '../flows/setup/command-schemas.js';
import { runCheck, type CheckMode, type CheckRunOptions } from '../flows/core/check.js';

/** Run options plus the parent-only `--files` shortcut. */
type CheckCommandOptions = CheckRunOptions & { files?: string[] };

export function registerCheckCommand(program: Command): void {
  // Note: the parent `check` has no positional argument — that would shadow
  // the subcommands (`check syntax --all` would otherwise put `syntax` into
  // the parent's `[files...]` variadic). The "bare `abap check <files>`"
  // shortcut is implemented via `check --files ...` (see option below) to
  // keep the subcommand dispatch unambiguous.
  const check = program
    .command('check')
    .description('Validate ABAP source code (syntax / content / atc)')
    .option('--files <files...>', 'Shortcut: run syntax mode on the given files (equivalent to `abap check syntax <files...>`)')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (opts: CheckCommandOptions, cmd) => {
      // --schema branch — emit machine-readable parameter schema (no SAP call).
      if (cmd.optsWithGlobals().schema) {
        printSchema(commandSchemas['check']!, jsonFromCommand(cmd));
        return;
      }
      // Bare `abap check` (no subcommand, no --files) prints subcommand help.
      const hasShortcut = Array.isArray(opts.files) && opts.files.length > 0;
      if (!hasShortcut) {
        console.log(cmd.helpInformation());
        return;
      }
      const files = opts.files as string[];
      await execute(files, opts, 'syntax', cmd);
    });

  check
    .command('syntax')
    .description('Syntax check against SAP')
    .argument('[files...]', 'Files to check')
    .option('--all', 'Check all .abap files under the scan root (sourceDir or current dir)')
    .option('--changed', 'Check only files changed since the SAP version')
    .option('--strict', 'Treat warnings as failures')
    .action(async (files: string[], opts: CheckCommandOptions, cmd) => {
      await execute(files, opts, 'syntax', cmd);
    });

  check
    .command('content')
    .description('Local-only validation, no SAP call')
    .argument('[files...]', 'Files to check')
    .option('--all', 'Check all .abap files under the scan root (sourceDir or current dir)')
    .option('--changed', 'Check only files changed since the SAP version')
    .option('--strict', 'Treat warnings as failures')
    .action(async (files: string[], opts: CheckCommandOptions, cmd) => {
      await execute(files, opts, 'content', cmd);
    });

  check
    .command('atc')
    .description('ATC check against SAP (requires --variant)')
    .argument('[files...]', 'Files to check')
    .requiredOption('--variant <variant>', 'ATC check variant')
    .option('--all', 'Check all .abap files under the scan root (sourceDir or current dir)')
    .option('--changed', 'Check only files changed since the SAP version')
    .option('--strict', 'Treat warnings as failures')
    .option('--out [file]', 'Persist raw ATC worklist to a file (only with --atc); defaults to .abap/atc/<variant>-<timestamp>.json')
    .action(async (files: string[], opts: CheckCommandOptions, cmd) => {
      await execute(files, opts, 'atc', cmd);
    });
}

/** Run the flow and print its envelope; errors go through the unified renderer. */
async function execute(
  files: string[],
  opts: CheckCommandOptions,
  mode: CheckMode,
  cmd: Command,
): Promise<void> {
  const outputMode = jsonFromCommand(cmd);
  try {
    const result = await runCheck(files, opts, mode);
    printResult(outputMode, result.data, result.human);
  } catch (error: unknown) {
    printError(outputMode, error);
  }
}
