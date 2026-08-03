import { Command } from 'commander';
import { CliError, printError, jsonFromCommand } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';

export function registerDeployCommand(program: Command): void {
  program
    .command('deploy')
    .description('Deploy bundled ICF ABAP service to SAP system')
    .addHelpText('after', commonErrorsAfter())
    .option('--tr <transport>', 'Transport number')
    .option('--package <package>', 'Target SAP package', 'ZABAP_VIBE')
    .action(async (_opts, cmd) => {
      const json = jsonFromCommand(cmd);
      // TODO: Implement deploy logic via deployer.ts
      printError(json, new CliError('NOT_IMPLEMENTED', 'abap deploy: not yet implemented'));
    });
}
