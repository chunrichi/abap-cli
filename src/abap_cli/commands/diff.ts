import { Command } from 'commander';
import { printError, printResult, printSchema, jsonFromCommand, type CommandSchema } from '../output/json.js';
import { SEARCH_RESULT_LIMIT } from '../core/limits.js';
import { runDiff, type DiffRunOptions } from '../flows/search/diff.js';
import { baseSchema, schemaOption } from './schema-helpers.js';

export const SCHEMA: CommandSchema = {
  ...baseSchema('diff', 'Compare local files against SAP (read-only) with a per-part change summary.', 'abap diff [options] [file]', 'sap'),
  arguments: [{ name: 'file', type: 'string', required: false, description: 'Single file to diff (mutually exclusive with --all/--remote/--local-only).' }],
  options: [
    { name: '--all', type: 'boolean', description: 'Compare the whole workspace.' },
    { name: '--remote', type: 'boolean', description: 'Only remote-only differences.' },
    { name: '--local-only', type: 'boolean', description: 'Only local-only differences.' },
    { name: '--limit', type: 'int', valuePlaceholder: '<n>', default: SEARCH_RESULT_LIMIT, description: 'Bounds the result.' },
    schemaOption(),
  ],
  exclusiveGroups: [['<file>', '--all'], ['<file>', '--remote'], ['<file>', '--local-only']],
  examples: [
    { description: 'Diff a single file', command: 'abap diff src/zcl_demo.clas.abap' },
    { description: 'Diff the workspace', command: 'abap diff --all --limit 50' },
  ],
  errors: [
    { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
  ],
};

export function registerDiffCommand(program: Command): void {
  program
    .command('diff [file]')
    .description('Compare local files against SAP')
    .option('--all', 'Compare the whole workspace')
    .option('--remote', 'Remote-only differences')
    .option('--local-only', 'Local-only differences')
    .option('--limit <n>', `Result bound (default ${SEARCH_RESULT_LIMIT})`)
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (file: string | undefined, opts: DiffRunOptions, cmd) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema) {
        printSchema(SCHEMA, mode);
        return;
      }
      try {
        const result = await runDiff(file, opts);
        printResult(mode, result.data, result.human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}
