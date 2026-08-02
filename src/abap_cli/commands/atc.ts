import { Command } from 'commander';
import { CliError, printError, jsonFromCommand } from '../output/json.js';

export function registerAtcCommand(program: Command): void {
  program
    .command('atc')
    .description('Run ATC (ABAP Test Cockpit) checks')
    .argument('[files...]', 'Files to check')
    .option('--all', 'Check all files')
    .option('--variant <variant>', 'ATC check variant')
    .action(async (_files, _opts, cmd) => {
      const json = jsonFromCommand(cmd);
      printError(json, new CliError('NOT_IMPLEMENTED', 'abap atc: not yet implemented'));
    });
}
