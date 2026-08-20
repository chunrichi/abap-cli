import { Command } from 'commander';
import { runPush, type PushFileOptions } from '../flows/push-flow.js';
import { printError, printResult, jsonFromCommand } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';

export function registerPushCommand(program: Command): void {
  program
    .command('push')
    .description('Push local ABAP files to SAP (lock → set source → syntax check → activate → unlock)')
    .addHelpText('after', commonErrorsAfter())
    .argument('[files...]', 'Files to push')
    .option('--all', 'Push all .abap files under the current directory (honours .abapignore)')
    .option('--tr <transport>', 'Transport number (required in non-TTY mode)')
    .option('--check-only', 'Only perform syntax check; do not activate (mutex with --no-activate)')
    .option('--no-activate', 'Lock + write + skip check + skip activate + unlock')
    .option('--dry-run', 'Plan only — make no mutating ADT calls (FR-012)')
    .option('--fail-fast', 'Stop at the first failing file (default: --keep-going)')
    .option('--atomic', 'Validate all files first; write nothing if any file fails validation')
    .option('--yes', 'Skip confirmation prompt for write operations')
    .action(async (files: string[], opts: PushFileOptions, cmd) => {
      const mode = jsonFromCommand(cmd);
      try {
        const result = await runPush(files, opts);
        printResult(mode, result.data, result.human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}







