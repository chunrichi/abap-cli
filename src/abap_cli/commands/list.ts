import { Command } from 'commander';
import { runList, type ListOptions } from '../flows/data/list.js';
import { CliError, printError, printResult, printSchema, jsonFromCommand } from '../output/json.js';
import { SEARCH_RESULT_LIMIT } from '../core/limits.js';

export const SCHEMA = {
  schemaVersion: 1,
  command: 'list',
  description:
    'List ABAP objects in a package (read-only, ADT quickSearch-backed). ' +
    'Useful for cleaning up scratch objects or auditing a package before mass pull/push.',
  usage: 'abap list --package <pkg> [--type <type>] [--limit <n>]',
  scope: 'sap',
  arguments: [],
  options: [
    {
      name: '--package',
      type: 'string',
      required: true,
      valuePlaceholder: '<package>',
      description: 'Filter by package (e.g., $TMP). Required.',
    },
    {
      name: '--type',
      type: 'string',
      required: false,
      valuePlaceholder: '<type>',
      description: 'Filter by object type (CLAS, PROG, INTF, ...).',
    },
    {
      name: '--limit',
      type: 'string',
      required: false,
      valuePlaceholder: '<n>',
      description: `Max results (default ${SEARCH_RESULT_LIMIT}).`,
    },
    {
      name: '--schema',
      type: 'boolean',
      required: false,
      description: 'Print the command parameter schema as JSON and exit (no SAP call).',
    },
  ],
  globalOptions: ['--json', '--pretty-json'],
  examples: [
    { description: 'List everything in $TMP', command: 'abap list --package $TMP' },
    { description: 'List every local scratch class', command: 'abap list --package $TMP --type CLAS' },
    { description: 'Limit the result set', command: 'abap list --package $TMP --type CLAS --limit 50' },
  ],
  errors: [
    { code: 'USAGE', category: 'USAGE', exitCode: 2 },
  ],
};

interface CliListOptions {
  package?: string;
  type?: string;
  limit?: string;
  schema?: boolean;
}

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('List ABAP objects in a package (read-only)')
    // Use plain `.option` (not `requiredOption`) so `--schema` can be evaluated
    // before argument validation — matches the `fields` / `select` pattern that
    // the envelope-schema contract test depends on.
    .option('--package <pkg>', 'Filter by package (e.g., $TMP). Required for listing.')
    .option('--type <type>', 'Filter by object type (CLAS, PROG, ...).')
    .option('--limit <n>', `Max results (default ${SEARCH_RESULT_LIMIT})`)
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (opts: CliListOptions, cmd: Command) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema || opts.schema) {
        printSchema(SCHEMA, mode);
        return;
      }
      try {
        if (!opts.package) {
          throw new CliError('USAGE', '--package is required for listing', {
            nextSteps: ['Re-run with --package <pkg> (e.g., $TMP).'],
            example: 'abap list --package $TMP --type CLAS',
          });
        }
        const parsedLimit = opts.limit ? Number.parseInt(opts.limit, 10) : undefined;
        const listOpts: ListOptions = {
          package: opts.package,
          ...(opts.type ? { type: opts.type } : {}),
          ...(parsedLimit !== undefined && Number.isFinite(parsedLimit) ? { limit: parsedLimit } : {}),
        };
        const { data, human } = await runList(listOpts);
        printResult(mode, data, human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}