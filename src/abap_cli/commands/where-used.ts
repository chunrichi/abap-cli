import { Command } from 'commander';
import { AdtClientWrapper } from '../clients/adt-client.js';
import {
  CliError,
  jsonFromCommand,
  printError,
  printResult,
  printSchema,
  type CommandSchema,
} from '../output/json.js';
import {
  runWhereUsed,
  SUPPORTED_WHERE_USED_TYPES,
  validateWhereUsedType,
  DEFAULT_WHERE_USED_LIMIT,
  MAX_WHERE_USED_LIMIT,
  type WhereUsedOptions,
  type WhereUsedResult,
} from '../flows/where-used-ops.js';

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
    .action(async (object: string | undefined, opts: WhereUsedCliOptions, cmd: Command) => {
      const mode = jsonFromCommand(cmd);
      try {
        if (cmd.optsWithGlobals().schema) {
          printSchema(whereUsedSchema(), mode);
          return;
        }
        const target = requireObject(object);
        validateWhereUsedType(opts.type, '--type');
        validateWhereUsedType(opts.refType, '--ref-type');
        const options: WhereUsedOptions = {
          type: opts.type,
          refType: opts.refType,
          packageName: opts.package,
          limit: parseLimit(opts.limit),
        };
        const client = await AdtClientWrapper.create();
        const result = await runWhereUsed(client, target, options);
        printResult(mode, result, formatHuman(result));
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}

interface WhereUsedCliOptions {
  type?: string;
  refType?: string;
  package?: string;
  limit?: string;
  schema?: boolean;
}

function requireObject(object: string | undefined): string {
  if (!object?.trim()) {
    throw new CliError('USAGE', 'where-used requires an object name.', {
      nextSteps: ['Provide a supported SAP object name.'],
      example: 'abap where-used ZCL_MY_CLASS --type CLAS',
    });
  }
  return object.trim();
}

function parseLimit(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_WHERE_USED_LIMIT;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_WHERE_USED_LIMIT) {
    throw new CliError('INVALID_ARGUMENT', `--limit must be an integer from 1 to ${MAX_WHERE_USED_LIMIT}`, {
      nextSteps: [`Use --limit between 1 and ${MAX_WHERE_USED_LIMIT}.`],
      example: 'abap where-used ZCL_MY_CLASS --limit 100',
    });
  }
  return limit;
}

export function formatHuman(result: WhereUsedResult): string {
  const lines = [
    `${result.target.name} (${result.target.type})`,
    `  uri: ${result.target.uri}`,
    ...(result.target.packageName ? [`  package: ${result.target.packageName}`] : []),
    result.queryStatus === 'empty'
      ? 'No direct references found.'
      : `References: ${result.count} returned of ${result.totalCount}`,
  ];
  for (const reference of result.references) {
    const packageName = reference.packageName ? ` [${reference.packageName}]` : '';
    const context = reference.usageInformation ? ` — ${reference.usageInformation}` : '';
    lines.push(`  ${reference.name} (${reference.type})${packageName}${context}`);
  }
  if (result.truncated) {
    lines.push(`  truncated: increase --limit up to ${MAX_WHERE_USED_LIMIT} or use --ref-type/--package`);
  }
  return lines.join('\n');
}

function whereUsedSchema(): CommandSchema {
  return {
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
      { name: '--schema', type: 'boolean', description: 'Print this schema without making a SAP call.', default: false },
    ],
    globalOptions: ['--json'],
    examples: [
      'abap where-used ZCL_TARGET --type CLAS',
      'abap references ZTAB_TARGET --type TABL --ref-type TABL --json',
    ],
  };
}
