import { Command } from 'commander';
import { printError, printResult, printSchema, jsonFromCommand } from '../output/json.js';
import { commandSchemas } from '../flows/setup/command-schemas.js';
import { runActivate, type ActivateRunOptions } from '../flows/edit/activate.js';

export function registerActivateCommand(program: Command): void {
  program
    .command('activate [object]')
    .description('Activate inactive ABAP objects')
    .option('--type <type>', 'Object type (CLAS, PROG, INTF, etc.)')
    .option('--yes', 'Confirm in non-interactive environments')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (object: string, opts: ActivateRunOptions, cmd) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema) {
        printSchema(commandSchemas['activate']!, mode);
        return;
      }
      try {
        const result = await runActivate(object, opts);
        printResult(mode, result.data, result.human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}
