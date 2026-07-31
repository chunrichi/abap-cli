import { Command } from 'commander';

export function registerSearchCommand(program: Command): void {
  program
    .command('search')
    .description('Search for ABAP objects in SAP system')
    .argument('<query>', 'Search query (supports * wildcard)')
    .option('--type <type>', 'Filter by object type')
    .option('--max <n>', 'Maximum results', '100')
    .action(async (query, opts) => {
      try {
        // TODO: Implement search via adt-client
        console.log('abap search: not yet implemented');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}
