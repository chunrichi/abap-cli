import { Command } from 'commander';
import { printError, printResult, printSchema, jsonFromCommand, type CommandSchema } from '../output/json.js';
import {
  runWhereUsedCommand,
  SUPPORTED_WHERE_USED_TYPES,
  DEFAULT_WHERE_USED_LIMIT,
  MAX_WHERE_USED_LIMIT,
  type WhereUsedRunOptions,
} from '../flows/search/where-used-ops.js';

/** Machine-readable parameter contract for `abap where-used --schema`. */
export const SCHEMA: CommandSchema = {
  schemaVersion: 1,
  command: 'where-used',
  description: 'Find direct SAP object references (read-only).',
  usage: 'abap where-used <object> [options]',
  arguments: [{ name: 'object', required: true, description: 'SAP object name.' }],
  options: [
    { name: '--type', type: 'string', valuePlaceholder: '<type>', description: 'Target object type.', allowedValues: [...SUPPORTED_WHERE_USED_TYPES] },
    { name: '--ref-type', type: 'string', valuePlaceholder: '<type>', description: 'Filter references by object type.', allowedValues: [...SUPPORTED_WHERE_USED_TYPES] },
    { name: '--package', type: 'string', valuePlaceholder: '<package>', description: 'Case-insensitive reference package filter.' },
    { name: '--limit', type: 'int', valuePlaceholder: '<n>', description: 'Maximum returned references.', default: DEFAULT_WHERE_USED_LIMIT },
    { name: '--schema', type: 'boolean', description: 'Print the command parameter schema as JSON and exit (no SAP call).', default: false },
  ],
  globalOptions: ['--json'],
  examples: [
    { description: 'Find references to a class', command: 'abap where-used ZCL_TARGET --type CLAS' },
    { description: 'JSON envelope via the references alias', command: 'abap references ZTAB_TARGET --type TABL --ref-type TABL --json' },
  ],
};

export function registerWhereUsedCommand(program: Command): void {
  program
    .command('where-used')
    .alias('references')
    .description('Find SAP object references (read-only)')
    .argument('[object]', 'SAP object name')
    .option('--type <type>', 'Target object type')
    .option('--ref-type <type>', 'Filter references by object type')
    .option('--package <package>', 'Filter references by package')
    .option('--limit <n>', `Max returned references (default ${DEFAULT_WHERE_USED_LIMIT}, max ${MAX_WHERE_USED_LIMIT})`)
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (object: string | undefined, opts: WhereUsedRunOptions, cmd: Command) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema) {
        printSchema(SCHEMA, mode);
        return;
      }
      try {
        const result = await runWhereUsedCommand(object, opts);
        printResult(mode, result.data, result.human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}
