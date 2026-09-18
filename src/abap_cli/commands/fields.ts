import { Command } from 'commander';
import { printError, printResult, printSchema, jsonFromCommand } from '../output/json.js';
import { formatFieldsHuman, runFields } from '../flows/data/fields.js';

export const SCHEMA = {
  schemaVersion: 1,
  command: 'fields',
  description:
    'List the DDIC fields of a table or view (read-only): abap fields VRSD [--json]',
  usage: 'abap fields <table> [--json]',
  scope: 'sap',
  arguments: [
    {
      name: 'table',
      type: 'string',
      required: true,
      description: 'Table or view name (e.g. VRSD). Uppercased.',
    },
  ],
  options: [
    {
      name: '--json',
      type: 'boolean',
      required: false,
      description: 'Emit a single JSON envelope (global flag).',
    },
  ],
  examples: [
    { description: 'Field inventory as JSON', command: 'abap fields VRSD --json' },
    { description: 'Human-readable listing', command: 'abap fields VRSD' },
  ],
  errors: [
    { code: 'OBJECT_NOT_FOUND', category: 'NOT_FOUND', exitCode: 8 },
    { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
    { code: 'QUERY_FAILED', category: 'SAP_ERROR', exitCode: 6 },
  ],
};

export function registerFieldsCommand(program: Command): void {
  program
    .command('fields')
    .description('List the fields of a table or view (read-only, DD03L-backed)')
    // Optional positional so `abap fields --schema` can be evaluated before
    // argument validation; `runFields` rejects an empty name with USAGE.
    .argument('[table]', 'Table or view name (e.g. VRSD)')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (table: string | undefined, opts: { schema?: boolean }, cmd: Command) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema || opts.schema) {
        printSchema(SCHEMA, mode);
        return;
      }
      try {
        const result = await runFields(table ?? '');
        printResult(mode, result, formatFieldsHuman(result));
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}
