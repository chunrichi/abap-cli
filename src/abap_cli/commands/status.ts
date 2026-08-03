import { Command } from 'commander';
import { CliError, printError, jsonFromCommand } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show differences between local files and SAP system')
    .addHelpText('after', commonErrorsAfter())
    .action(async (_opts, cmd) => {
      const json = jsonFromCommand(cmd);
      printError(json, new CliError('NOT_IMPLEMENTED', 'abap status: not yet implemented'));
    });
}
