import { Command } from 'commander';
import { runPush, type PushFileOptions } from '../flows/push-flow.js';
import { printError, printResult, printSchema, jsonFromCommand } from '../output/json.js';
import { commandSchemas } from '../flows/command-schemas.js';

export function registerPushCommand(program: Command): void {
  program
    .command('push')
    .description('Push local ABAP files to SAP')
    .argument('[files...]', 'Files to push')
    .option('--all', 'Push all files under current directory (honours .abapignore)')
    .option('--tr <transport>', 'Transport number override for unbound objects')
    .option('--check-only', 'Syntax check only; do not activate')
    .option('--no-activate', 'Lock + write + skip check + skip activate + unlock')
    .option('--dry-run', 'Plan only — no mutating ADT calls')
    .option('--fail-fast', 'Stop at the first failing file (default: --keep-going)')
    .option('--atomic', 'Validate all files first; write nothing if any file fails validation')
    .option('--yes', 'Confirm in non-interactive mode')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (files: string[], opts: PushFileOptions, cmd) => {
      const mode = jsonFromCommand(cmd);
      // --schema branch — emit machine-readable parameter schema (no SAP call).
      if (cmd.optsWithGlobals().schema) {
        printSchema(commandSchemas['push']!, mode);
        return;
      }
      try {
        const result = await runPush(files, opts);
        printResult(mode, result.data, result.human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}







