import { Command } from 'commander';

export function registerPushCommand(program: Command): void {
  program
    .command('push')
    .description('Push local ABAP files to SAP (lock → set source → syntax check → activate → unlock)')
    .argument('[files...]', 'Files to push')
    .option('--all', 'Push all modified files')
    .option('--tr <transport>', 'Transport number')
    .option('--check-only', 'Only perform syntax check, do not activate')
    .action(async (files, opts) => {
      try {
        if ((!files || files.length === 0) && !opts.all) {
          console.error('Error: specify files or use --all');
          process.exit(1);
        }
        // TODO: Implement push logic via adt-client
        console.log('abap push: not yet implemented');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}
