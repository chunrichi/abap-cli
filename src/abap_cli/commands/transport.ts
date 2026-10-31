import { Command } from 'commander';
import { printError, printResult, printSchema, jsonFromCommand, type CommandSchema } from '../output/json.js';
import {
  runTransportAssign,
  runTransportCreate,
  runTransportList,
  runTransportResolve,
  runTransportShow,
} from '../flows/core/transport-ops.js';
import { baseSchema, schemaOption } from './schema-helpers.js';
import { failMissingInvocation } from '../output/usage.js';

export const SCHEMA: CommandSchema = {
  ...baseSchema('transport', 'Manage SAP transport requests (list / create / show / resolve / assign).', 'abap transport <list|create|show|resolve|assign> [options]', 'sap'),
  arguments: [],
  options: [schemaOption()],
  examples: [
    { description: 'List transports', command: 'abap transport list' },
    { description: 'Create a transport', command: 'abap transport create "my description" --yes' },
    { description: 'Assign an object', command: 'abap transport assign ZCL_MY --tr DEVK900001 --yes' },
  ],
  errors: [
    { code: 'TRANSPORT_CREATE_FAILED', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'TRANSPORT_NOT_FOUND', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
    { code: 'VALIDATION_ERROR', category: 'VALIDATION_ERROR', exitCode: 7 },
  ],
};

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
}
