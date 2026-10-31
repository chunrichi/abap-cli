import { Command } from 'commander';
import { printError, printResult, printSchema, jsonFromCommand, CliError, type CommandSchema } from '../output/json.js';
import {
  runTransportAssign,
  runTransportCheck,
  runTransportCreate,
  runTransportList,
  runTransportRelease,
  runTransportResolve,
  runTransportShow,
} from '../flows/core/transport-ops.js';
import { baseSchema, schemaOption } from './schema-helpers.js';
import { failMissingInvocation } from '../output/usage.js';

export const SCHEMA: CommandSchema = {
  ...baseSchema(
    'transport',
    'Manage SAP transport requests (list / create / show / resolve / assign / check / release).',
    'abap transport <list|create|show|resolve|assign|check|release> [options]',
    'sap',
  ),
  arguments: [],
  options: [schemaOption()],
  examples: [
    { description: 'List transports', command: 'abap transport list' },
    { description: 'Create a transport', command: 'abap transport create "my description" --yes' },
    { description: 'Assign an object', command: 'abap transport assign ZCL_MY --tr DEVK900001 --yes' },
    { description: 'Check whether an object can be recorded', command: 'abap transport check ZCL_MY' },
    { description: 'Release a transport request', command: 'abap transport release DEVK900001 --yes' },
    { description: 'Inspect a subcommand schema', command: 'abap transport release --schema' },
  ],
  errors: [
    { code: 'TRANSPORT_CREATE_FAILED', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'TRANSPORT_NOT_FOUND', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
    { code: 'VALIDATION_ERROR', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'SAP_ERROR', category: 'SAP_ERROR', exitCode: 6 },
  ],
};

/** Per-subcommand machine contracts — the parent schema cannot express which
 *  option belongs to `check` vs `release`. Query
 *  `abap transport <command> --schema --json` for the exact surface. */
const SUBCOMMAND_SCHEMAS: Record<string, CommandSchema> = {
  check: {
    ...baseSchema(
      'transport check',
      'Read-only: report which transport request would record an object change, or the blocking messages.',
      'abap transport check <object> [--package <pkg>]',
      'sap',
    ),
    arguments: [{ name: 'object', type: 'string', required: true, description: 'ABAP object name to check.' }],
    options: [
      { name: '--package', type: 'string', valuePlaceholder: '<pkg>', description: 'Target SAP package for the check (defaults to the package SAP derives).' },
      schemaOption(),
    ],
    examples: [{ description: 'Check an object', command: 'abap transport check ZCL_MY_CLASS --json' }],
  },
  release: {
    ...baseSchema(
      'transport release',
      'Release a transport request. Destructive and irreversible.',
      'abap transport release <transport> [--ignore-locks] [--ignore-atc] [--dry-run] [--yes]',
      'sap',
    ),
    arguments: [{ name: 'transport', type: 'string', required: true, description: 'Transport request number, e.g. DEVK900001.' }],
    options: [
      { name: '--ignore-locks', type: 'boolean', description: 'Release even when objects are locked by other users (SAP override).' },
      { name: '--ignore-atc', type: 'boolean', description: 'Release even when ATC checks report findings (SAP override).' },
      { name: '--dry-run', type: 'boolean', description: 'Plan only — make no mutating SAP calls.' },
      { name: '--yes', type: 'boolean', description: 'Confirm in non-interactive mode.' },
      schemaOption(),
    ],
    examples: [
      { description: 'Preview a release', command: 'abap transport release DEVK900001 --dry-run --json' },
      { description: 'Release a request', command: 'abap transport release DEVK900001 --yes --json' },
    ],
  },
};

/** Print `abap transport <command> --schema` when requested; true means printed. */
function maybePrintSubSchema(cmd: Command, key: keyof typeof SUBCOMMAND_SCHEMAS): boolean {
  if (cmd.optsWithGlobals<{ schema?: boolean }>().schema !== true) return false;
  const schema = SUBCOMMAND_SCHEMAS[key];
  if (!schema) return false;
  printSchema(schema, jsonFromCommand(cmd));
  return true;
}

/** Subcommand positionals are optional at the parser level so `--schema` works
 *  without them; the action still fails with the same USAGE error when absent. */
function requireArg(value: string | undefined, name: string): string {
  if (value) return value;
  throw new CliError('USAGE', `missing required argument '${name}'`, {
    nextSteps: ["Run 'abap transport --help' for usage."],
    example: 'abap transport list --json',
  });
}

export function registerTransportCommand(program: Command): void {
  const transportCmd = program
    .command('transport')
    .description('Manage transport requests')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action((_opts, cmd) => {
      if (cmd.optsWithGlobals().schema) {
        printSchema(SCHEMA, jsonFromCommand(cmd));
        return;
      }
      // Bare `abap transport` is a USAGE failure; help is only printed by
      // `abap transport --help`.
      failMissingInvocation(
        cmd,
        "Missing subcommand: use 'transport list', 'create', 'show', 'resolve', or 'assign'.",
        'abap transport list --json',
      );
    });

  transportCmd
    .command('list')
    .description('List transport requests for current user')
    .option('--open', 'Show only open (unreleased) transports')
    .action(async (opts, cmd) => {
      const mode = jsonFromCommand(cmd);
      try {
        const result = await runTransportList(Boolean(opts.open));
        printResult(mode, result.data, result.human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });

  transportCmd
    .command('create')
    .description('Create a transport request')
    .argument('<description>', 'Transport description')
    .option('--package <package>', 'Target SAP package (default $TMP)')
    .option('--dry-run', 'Plan only — make no mutating SAP calls')
    .option('--yes', 'Confirm in non-interactive mode')
    .action(async (description, opts, cmd) => {
      const mode = jsonFromCommand(cmd);
      try {
        const result = await runTransportCreate(description, opts);
        printResult(mode, result.data, result.human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });

  transportCmd
    .command('show <req>')
    .description('Show transport request metadata')
    .action(async (req: string, _opts, cmd) => {
      const mode = jsonFromCommand(cmd);
      try {
        const result = await runTransportShow(req);
        printResult(mode, result.data, result.human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });

  transportCmd
    .command('resolve <object>')
    .description('Show which transport an object belongs to')
    .action(async (object: string, _opts, cmd) => {
      const mode = jsonFromCommand(cmd);
      try {
        const result = await runTransportResolve(object);
        printResult(mode, result.data, result.human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });

  transportCmd
    .command('assign <object>')
    .description('Attach an object to a transport request')
    .requiredOption('--tr <transport>', 'Target transport request')
    .option('--dry-run', 'Plan only — make no mutating SAP calls')
    .option('--yes', 'Confirm in non-interactive mode')
    .action(async (object: string, opts, cmd) => {
      const mode = jsonFromCommand(cmd);
      try {
        const result = await runTransportAssign(object, opts);
        printResult(mode, result.data, result.human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });

  transportCmd
    .command('check [object]')
    .description('Report which transport would record an object change (read-only)')
    .option('--package <package>', 'Target SAP package for the check')
    .option('--schema', 'Print the subcommand schema as JSON and exit (no SAP call)')
    .action(async (object: string | undefined, opts, cmd) => {
      if (maybePrintSubSchema(cmd, 'check')) return;
      const mode = jsonFromCommand(cmd);
      try {
        const result = await runTransportCheck(requireArg(object, 'object'), opts);
        printResult(mode, result.data, result.human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });

  transportCmd
    .command('release [transport]')
    .description('Release a transport request (destructive; cannot be undone)')
    .option('--ignore-locks', 'Release even when objects are locked by other users')
    .option('--ignore-atc', 'Release even when ATC checks report findings')
    .option('--dry-run', 'Plan only — make no mutating SAP calls')
    .option('--yes', 'Confirm in non-interactive mode')
    .option('--schema', 'Print the subcommand schema as JSON and exit (no SAP call)')
    .action(async (request: string | undefined, opts, cmd) => {
      if (maybePrintSubSchema(cmd, 'release')) return;
      const mode = jsonFromCommand(cmd);
      try {
        const result = await runTransportRelease(requireArg(request, 'transport'), opts);
        printResult(mode, result.data, result.human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}
