import { Command } from 'commander';

export function registerCheckCommand(program: Command): void {
  program
    .command('check')
    .description('Perform syntax check on local ABAP files')
    .argument('[files...]', 'Files to check')
    .option('--all', 'Check all files')
    .action(async (files, opts) => {
      try {
        if ((!files || files.length === 0) && !opts.all) {
          console.error('Error: specify files or use --all');
          process.exit(1);
        }
        // TODO: Implement syntax check via adt-client
        console.log('abap check: not yet implemented');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}
