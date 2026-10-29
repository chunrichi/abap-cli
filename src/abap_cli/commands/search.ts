import { Command } from 'commander';
import { printError, printResult, printSchema, jsonFromCommand, type CommandSchema } from '../output/json.js';
import { SEARCH_RESULT_LIMIT, PAGE_ALL_DEFAULT_MAX } from '../core/limits.js';
import { runSearch, type SearchRunOptions } from '../flows/search/search-flow.js';

/** Machine-readable parameter contract for `abap search --schema`. */
export const SCHEMA: CommandSchema = {
  schemaVersion: 1,
  command: 'search',
  description: 'Search for ABAP objects in SAP system',
  usage: 'abap search [options] <query>',
  arguments: [{ name: 'query', type: 'string', required: true, description: 'Search query (supports * wildcard)' }],
  options: [
    { name: '--type', type: 'string', valuePlaceholder: '<type>', description: 'Filter by SAP ADT object type. Common values: CLAS, INTF, PROG, FUGR, TABL, TABL/DT (transparent table), TABL/DB (pooled), TABL/DY (append structure), DOMA, DTEL, STRU, MSAG, TYPE, TTYP.' },
    { name: '--limit', type: 'int', valuePlaceholder: '<n>', default: SEARCH_RESULT_LIMIT, description: 'Maximum results per page' },
    { name: '--page', type: 'int', valuePlaceholder: '<n>', default: 1, description: 'Page number (1-based)' },
    { name: '--exact', type: 'boolean', description: 'Exact name match (mutually exclusive with --fuzzy)' },
    { name: '--fuzzy', type: 'boolean', description: 'Substring match (default)' },
    { name: '--package', type: 'string', valuePlaceholder: '<package>', description: 'Filter by package' },
    { name: '--page-all', type: 'boolean', description: 'Fetch all results in one request (cap = --page-all-max × --limit; mutually exclusive with --page)' },
    { name: '--page-all-max', type: 'int', valuePlaceholder: '<n>', default: PAGE_ALL_DEFAULT_MAX, description: 'Page-count cap that sizes the --page-all single request' },
    { name: '--schema', type: 'boolean', default: false, description: 'Print the command parameter schema as JSON and exit (no SAP call).' },
  ],
  exclusiveGroups: [['--exact', '--fuzzy'], ['--page', '--page-all']],
  globalOptions: ['--json'],
  examples: [
    { description: 'Filter by type', command: 'abap search ZCL_* --type CLAS --limit 50' },
    { description: 'Exact name match', command: 'abap search ZCL_DEMO --exact' },
    { description: 'Fetch all results in one request', command: 'abap search ZCL_* --page-all' },
  ],
};

export function registerSearchCommand(program: Command): void {
  program
    .command('search')
    .description('Search for ABAP objects in SAP system')
    // [query]（可选）是因为 --schema 模式下不需要查询词；真实搜索仍需 query。
    .argument('[query]', 'Search query (supports * wildcard)')
    .option('--type <type>', 'Filter by object type')
    .option('--limit <n>', `Max results per page (default ${SEARCH_RESULT_LIMIT})`)
    .option('--page <n>', 'Page number (1-based)', '1')
    .option('--exact', 'Exact name match (mutually exclusive with --fuzzy)')
    .option('--fuzzy', 'Substring match (default)')
    .option('--package <package>', 'Filter by package')
    .option('--page-all', 'Fetch all results in one request (cap = --page-all-max × --limit; mutually exclusive with --page)')
    .option('--page-all-max <n>', `Page-count cap that sizes the --page-all single request (default ${PAGE_ALL_DEFAULT_MAX})`)
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (query: string | undefined, opts: SearchRunOptions & { schema?: boolean }, cmd) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema || opts.schema) {
        printSchema(SCHEMA, mode);
        return;
      }
      try {
        const result = await runSearch(query, opts);
        printResult(mode, result.data, result.human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}
