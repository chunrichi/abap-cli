import { Command } from 'commander';
import { CliError, printError, jsonFromCommand } from '../output/json.js';

export function registerSearchCommand(program: Command): void {
  program
    .command('search')
    .description('Search for ABAP objects in SAP system')
    .argument('<query>', 'Search query (supports * wildcard)')
    .option('--type <type>', 'Filter by object type')
    .option('--max <n>', 'Maximum results', '100')
    .action(async (_query, _opts, cmd) => {
      const json = jsonFromCommand(cmd);
      printError(json, new CliError('NOT_IMPLEMENTED', 'abap search: not yet implemented'));
    });
}
