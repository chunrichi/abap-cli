import { Command } from 'commander';
import { printError, printResult, printSchema, jsonFromCommand, type CommandSchema } from '../output/json.js';
import { SEARCH_RESULT_LIMIT } from '../core/limits.js';
import { runStatus, type StatusRunOptions } from '../flows/search/status.js';
import { baseSchema, schemaOption } from './schema-helpers.js';

export const SCHEMA: CommandSchema = {
  ...baseSchema('status', 'Show local vs SAP sync status as a standardised changedParts list.', 'abap status [options]', 'sap'),
  arguments: [],
  options: [
    { name: '--remote-only', type: 'boolean', description: 'Only remote-only differences.' },
    { name: '--local-only', type: 'boolean', description: 'Only local-only differences.' },
    { name: '--limit', type: 'int', valuePlaceholder: '<n>', default: SEARCH_RESULT_LIMIT, description: 'Bounds the result; truncated: true when capped.' },
    { name: '--since', type: 'string', valuePlaceholder: '<iso-date>', description: 'Only files modified at or after the date (YYYY-MM-DD[THH:mm:ss]).' },
    { name: '--all', type: 'boolean', description: 'Include unchanged entries.' },
    schemaOption(),
  ],
  examples: [
    { description: 'Default sync status', command: 'abap status' },
    { description: 'Only remote-only', command: 'abap status --remote-only --limit 50' },
  ],
  errors: [
    { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
  ],
};

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show local vs SAP sync status')
    .option('--remote-only', 'Objects on SAP but not locally')
    .option('--local-only', 'Objects locally but not on SAP')
    .option('--limit <n>', `Max result count (default ${SEARCH_RESULT_LIMIT})`)
    .option('--since <iso-date>', 'Compare files modified since date (YYYY-MM-DD[THH:mm:ss])')
    .option('--all', 'Include unchanged objects')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (opts: StatusRunOptions, cmd) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema) {
        printSchema(SCHEMA, mode);
        return;
      }
      try {
        const result = await runStatus(opts);
        printResult(mode, result.data, result.human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}
