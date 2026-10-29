import { Command } from 'commander';
import { printError, printResult, printSchema, jsonFromCommand, type CommandSchema } from '../output/json.js';
import { runActivate, type ActivateRunOptions } from '../flows/edit/activate.js';
import { baseSchema, schemaOption } from './schema-helpers.js';

export const SCHEMA: CommandSchema = {
  ...baseSchema('activate', 'Activate all inactive items (method/OSI level) of an object.', 'abap activate <object> [options]', 'sap'),
  arguments: [{ name: 'object', type: 'string', required: true, description: 'SAP object name.' }],
  options: [
    { name: '--type', type: 'string', valuePlaceholder: '<type>', description: 'Object type (CLAS, PROG, INTF, etc.) — disambiguates same-name objects.' },
    { name: '--yes', type: 'boolean', description: 'Confirm in non-interactive environments.' },
    schemaOption(),
  ],
  examples: [
    { description: 'Activate a class', command: 'abap activate ZCL_MY_CLASS --yes' },
    { description: 'Disambiguate same-prefix names', command: 'abap activate ZCL_FOO --type CLAS --yes' },
  ],
  errors: [
    { code: 'ACTIVATION_FAILED', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'OBJECT_NOT_FOUND', category: 'NOT_FOUND', exitCode: 8 },
    { code: 'VALIDATION_ERROR', category: 'VALIDATION_ERROR', exitCode: 7 },
  ],
};

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
        printSchema(SCHEMA, mode);
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
