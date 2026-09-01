import { Command } from 'commander';
import {
  jsonFromCommand,
  printError,
  printResult,
  printSchema,
  type CommandSchema,
} from '../output/json.js';
import {
  listDumps,
  validateDumpLimit,
  validateDumpUser,
  type DumpsResult,
} from '../flows/core/dumps.js';

const SCHEMA: CommandSchema = {
  schemaVersion: 1,
  command: 'dumps',
  description: 'List recent ST22 ABAP runtime dumps through the read-only ADT feed.',
  usage: 'abap dumps [options]',
  scope: 'sap',
  arguments: [],
  options: [
    {
      name: '--limit <n>',
      type: 'number',
      valuePlaceholder: '<n>',
      required: false,
      default: 20,
      minimum: 1,
      maximum: 100,
      description: 'Maximum number of recent dump summaries to return. The limit is sent to ADT as $top.',
    },
    {
      name: '--user <name>',
      type: 'string',
      valuePlaceholder: '<name>',
      required: false,
      default: 'current SAP login user',
      description: 'Filter to an SAP user. Omit to use the current SAP login user; pass an empty value to query all users.',
    },
    {
      name: '--schema',
      type: 'boolean',
      required: false,
      default: false,
      description: 'Print this schema as JSON and exit 0 without any SAP call.',
    },
  ],
  exclusiveGroups: [],
  globalOptions: ['--json', '--pretty-json', '--report-stuck'],
  examples: [
    { description: 'List the most recent runtime dump summaries', command: 'abap dumps' },
    { description: 'Agent integration: restrict the result to five compact entries', command: 'abap dumps --limit 5 --json' },
    { description: 'Query all users (override default login-user filter)', command: 'abap dumps --user ""' },
  ],
  errors: [
    { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
    { code: 'CONFIG_ERROR', category: 'CONFIG_ERROR', exitCode: 2 },
    { code: 'AUTH_ERROR', category: 'AUTH_ERROR', exitCode: 5 },
    { code: 'SAP_ERROR', category: 'SAP_ERROR', exitCode: 6 },
  ],
};

interface DumpsOptions {
  limit?: string;
  user?: string;
  schema?: boolean;
}

export function registerDumpsCommand(program: Command): void {
  program
    .command('dumps')
    .description('List recent ST22 ABAP runtime dumps (read-only)')
    .option('--limit <n>', 'Maximum dump summaries to return (default 20)')
    .option('--user [name]', 'SAP user filter (default: current login user; pass empty value to query all users)')
    .option('--schema', 'Print the command parameter schema as JSON and exit 0')
    .action(async (opts: DumpsOptions, cmd: Command) => {
      const mode = jsonFromCommand(cmd);
      if (opts.schema) {
        printSchema(SCHEMA, mode);
        return;
      }

      try {
        const result = await listDumps(validateDumpLimit(opts.limit), validateDumpUser(opts.user));
        printResult(mode, result, formatHuman(result));
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}

export function formatHuman(result: DumpsResult): string {
  const header = `${result.returned} of ${result.total} recent dump(s)${
    result.updatedAt ? `; updated ${result.updatedAt}` : ''
  }`;
  if (result.dumps.length === 0) return header;
  const lines = [header];
  for (const dump of result.dumps) {
    const context = [dump.runtimeError || dump.category || 'Unknown runtime error', dump.author]
      .filter(Boolean)
      .join(' | ');
    lines.push(`  ${dump.id}: ${context}${dump.summary ? ` - ${dump.summary}` : ''}`);
  }
  return lines.join('\n');
}