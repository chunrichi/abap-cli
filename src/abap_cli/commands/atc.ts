import { Command } from 'commander';

export function registerAtcCommand(program: Command): void {
  program
    .command('atc')
    .description('Run ATC (ABAP Test Cockpit) checks')
    .argument('[files...]', 'Files to check')
    .option('--all', 'Check all files')
    .option('--variant <variant>', 'ATC check variant')
    .action(async (files, opts) => {
      try {
        // TODO: Implement ATC check via adt-client
        console.log('abap atc: not yet implemented');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}
