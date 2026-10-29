import { Command } from 'commander';
import { printError, printResult, printSchema, jsonFromCommand, type CommandSchema } from '../output/json.js';
import { runInspect, type InspectFlags } from '../flows/search/inspect-ops.js';
import { baseSchema, schemaOption } from './schema-helpers.js';

export const SCHEMA: CommandSchema = {
  ...baseSchema('inspect', 'View ABAP object metadata read-only (no local files required).', 'abap inspect [options] <object>', 'sap'),
  arguments: [{ name: 'object', type: 'string', required: false, description: 'SAP object name.' }],
  options: [
    { name: '--structure', type: 'boolean', description: 'Include structure elements.' },
    { name: '--includes', type: 'boolean', description: 'Include class include parts.' },
    { name: '--locks', type: 'boolean', description: 'Include lock / transport ownership (read-only).' },
    { name: '--package', type: 'boolean', description: 'Include the object package name.' },
    { name: '--activation', type: 'boolean', description: 'Verify active vs latest source per part (read-only; detect stale activation).' },
    schemaOption(),
  ],
  examples: [
    { description: 'Inspect a class', command: 'abap inspect ZCL_MY_CLASS' },
    { description: 'Detect stale activation', command: 'abap inspect ZCL_MY_CLASS --activation' },
  ],
  errors: [
    { code: 'OBJECT_NOT_FOUND', category: 'NOT_FOUND', exitCode: 8 },
    { code: 'TYPE_NOT_SUPPORTED', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'USAGE', category: 'USAGE', exitCode: 2 },
  ],
};

export function registerInspectCommand(program: Command): void {
  program
    .command('inspect [object]')
    .description('View ABAP object metadata')
    .option('--structure', 'Include object structure elements')
    .option('--includes', 'Include class include parts')
    .option('--locks', 'Include transport ownership (not ADT editor-session state)')
    .option('--package', 'Include the object package name')
    .option('--activation', 'Verify active vs latest source (detect stale activation)')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (object: string | undefined, opts: InspectFlags, cmd) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema) {
        printSchema(SCHEMA, mode);
        return;
      }
      try {
        const result = await runInspect(object, opts);
        printResult(mode, result.data, result.human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}
