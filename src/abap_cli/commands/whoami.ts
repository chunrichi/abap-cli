import { Command } from 'commander';
import {
  jsonFromCommand,
  printError,
  printResult,
  printSchema,
  type CommandSchema,
} from '../output/json.js';
import { runWhoami } from '../flows/core/whoami.js';
import { baseSchema, schemaOption } from './schema-helpers.js';

export const SCHEMA: CommandSchema = {
  ...baseSchema(
    'whoami',
    'Show the identity the SAP system reports for the current connection (user / system / client), read from the bundled ICF service.',
    'abap whoami',
    'sap',
  ),
  options: [schemaOption()],
  examples: [
    { description: 'Show the system-reported identity of the current connection', command: 'abap whoami' },
    { description: 'Agent integration: compact JSON identity', command: 'abap whoami --json' },
    { description: 'Enable whoami after upgrading (deploy the bundled ICF service once)', command: 'abap deploy --yes' },
  ],
  errors: [
    { code: 'CONFIG_ERROR', category: 'CONFIG_ERROR', exitCode: 3 },
    { code: 'TLS_ERROR', category: 'TLS_ERROR', exitCode: 4 },
    { code: 'AUTH_ERROR', category: 'AUTH_ERROR', exitCode: 5 },
    { code: 'SAP_ERROR', category: 'SAP_ERROR', exitCode: 6 },
    { code: 'ICF_IDENTITY_UNAVAILABLE', category: 'NOT_FOUND', exitCode: 8 },
  ],
};

interface WhoamiOptions {
  schema?: boolean;
}

export function registerWhoamiCommand(program: Command): void {
  program
    .command('whoami')
    .description('Show the SAP system-reported identity of the current connection (user / system / client)')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (opts: WhoamiOptions, cmd: Command) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema) {
        printSchema(SCHEMA, mode);
        return;
      }
      try {
        const result = await runWhoami();
        printResult(mode, result.data, result.human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}
