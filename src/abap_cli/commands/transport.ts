import { Command } from 'commander';
import { printError, printResult, printSchema, jsonFromCommand } from '../output/json.js';
import { commandSchemas } from '../flows/setup/command-schemas.js';
import {
  runTransportAssign,
  runTransportCreate,
  runTransportList,
  runTransportResolve,
  runTransportShow,
} from '../flows/core/transport-ops.js';

export function registerTransportCommand(program: Command): void {
  const transportCmd = program
    .command('transport')
    .description('Manage transport requests')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action((_opts, cmd) => {
      if (cmd.optsWithGlobals().schema) {
        printSchema(commandSchemas['transport']!, jsonFromCommand(cmd));
        return;
      }
      cmd.help();
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
