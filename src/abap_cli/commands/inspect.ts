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
    { name: '--versions', type: 'boolean', description: 'Read the version history (ADT versions feed; read-only).' },
    { name: '--include', type: 'string', valuePlaceholder: '<part>', description: 'Include part for --versions: main | definitions | implementations | macros | testclasses (default main).' },
    { name: '--limit', type: 'int', valuePlaceholder: '<n>', description: 'Max version entries to return (default 50, max 200).', minimum: 1, maximum: 200 },
    { name: '--show', type: 'string', valuePlaceholder: '<version>', description: 'Return the source of one version (requires --versions).' },
    { name: '--out', type: 'string', valuePlaceholder: '<path>', description: 'Write the shown version source to a file instead of returning it.' },
    { name: '--symbols', type: 'boolean', description: 'Flatten the class/interface structure into symbols with source line ranges.' },
    { name: '--kinds', type: 'string', valuePlaceholder: '<list>', description: 'Filter --symbols by kind, comma separated (method, attribute, …).' },
    { name: '--name-pattern', type: 'string', valuePlaceholder: '<regex>', description: 'Filter --symbols by name (case-insensitive regular expression).' },
    schemaOption(),
  ],
  examples: [
    { description: 'Inspect a class', command: 'abap inspect ZCL_MY_CLASS' },
    { description: 'Detect stale activation', command: 'abap inspect ZCL_MY_CLASS --activation' },
    { description: 'List version history', command: 'abap inspect ZCL_MY_CLASS --versions' },
    { description: 'Read one version into a file', command: 'abap inspect ZCL_MY_CLASS --versions --show 000001 --out zcl_my_class.v1.abap' },
    { description: 'Symbols for methods only', command: 'abap inspect ZCL_MY_CLASS --symbols --kinds method' },
  ],
  errors: [
    { code: 'OBJECT_NOT_FOUND', category: 'NOT_FOUND', exitCode: 8 },
    { code: 'TYPE_NOT_SUPPORTED', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
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
    .option('--versions', 'Read the version history')
    .option('--include <part>', 'Include part for --versions (main / definitions / implementations / macros / testclasses)')
    .option('--limit <n>', 'Max version entries to return (default 50)')
    .option('--show <version>', 'Return the source of one version (requires --versions)')
    .option('--out <path>', 'Write the shown version source to a file')
    .option('--symbols', 'Flatten the class/interface structure into symbols')
    .option('--kinds <list>', 'Filter --symbols by kind (comma separated)')
    .option('--name-pattern <regex>', 'Filter --symbols by name (case-insensitive regex)')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (object: string | undefined, opts: InspectFlags & { limit?: string }, cmd) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema) {
        printSchema(SCHEMA, mode);
        return;
      }
      const flags: InspectFlags = {
        ...opts,
        ...(opts.limit !== undefined && opts.limit !== '' ? { limit: Number(opts.limit) } : {}),
      };
      try {
        const result = await runInspect(object, flags);
        printResult(mode, result.data, result.human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}
