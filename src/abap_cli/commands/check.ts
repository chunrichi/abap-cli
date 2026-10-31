import { Command } from 'commander';
import { printError, printResult, printSchema, jsonFromCommand, type CommandSchema } from '../output/json.js';
import { runCheck, type CheckMode, type CheckRunOptions } from '../flows/core/check.js';
import { baseSchema, schemaOption } from './schema-helpers.js';
import { failMissingInvocation } from '../output/usage.js';

export const SCHEMA: CommandSchema = {
  ...baseSchema('check', 'Validate ABAP source code (syntax / content / atc).', 'abap check [syntax|content|atc] [options]', 'sap'),
  arguments: [],
  options: [
    { name: '--variant', type: 'string', valuePlaceholder: '<variant>', description: 'ATC check variant (required with `check atc`).' },
    { name: '--all', type: 'boolean', description: 'Check all .abap files under the scan root (sourceDir or current dir).' },
    { name: '--changed', type: 'boolean', description: 'Check only files changed since the SAP version.' },
    { name: '--strict', type: 'boolean', description: 'Treat warnings as failures.' },
    { name: '--out', type: 'string', valuePlaceholder: '[file]', description: 'Persist raw ATC worklist to a file (only with `check atc`); defaults to .abap/atc/<variant>-<timestamp>.json.' },
    { name: '--files', type: 'string', valuePlaceholder: '<files...>', description: 'Shortcut: run syntax mode on the given files (equivalent to `abap check syntax <files...>`).' },
    schemaOption(),
  ],
  examples: [
    { description: 'Syntax check', command: 'abap check syntax src/zcl_demo.clas.abap' },
    { description: 'Local-only validation', command: 'abap check content src/zcl_demo.clas.abap' },
    { description: 'ATC check with persisted worklist', command: 'abap check atc src/zcl_demo.clas.abap --variant Z_ATC_VAR --out' },
  ],
  errors: [
    { code: 'SYNTAX_ERROR', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'VALIDATION_ERROR', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
  ],
};

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
        printSchema(SCHEMA, jsonFromCommand(cmd));
        return;
      }
      // Bare `abap check` (no subcommand, no --files) is a USAGE failure:
      // human help is only printed by `abap check --help`.
      const hasShortcut = Array.isArray(opts.files) && opts.files.length > 0;
      if (!hasShortcut) {
        failMissingInvocation(
          cmd,
          "Missing subcommand: use 'check syntax', 'check content', or 'check atc'.",
          'abap check syntax src/zcl_demo.clas.abap --json',
        );
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
