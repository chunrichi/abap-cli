import { Command } from 'commander';
import {
  jsonFromCommand,
  printError,
  printResult,
  printSchema,
  type CommandSchema,
} from '../output/json.js';
import { runUnitTest, type UnitTestOptions } from '../flows/core/unit-test.js';
import { baseSchema, schemaOption } from './schema-helpers.js';

/** Machine-readable parameter contract for `abap test --schema`. */
export const SCHEMA: CommandSchema = {
  ...baseSchema(
    'test',
    'Run ABAP Unit tests for an object and report the summary plus failing tests (read-only).',
    'abap test [options] <object>',
    'sap',
  ),
  arguments: [
    {
      name: 'object',
      type: 'string',
      required: true,
      description:
        'ABAP object to test — a class or program name (e.g. ZCL_MY_THING). Resolved through the ADT object repository.',
    },
  ],
  options: [
    {
      name: '--type',
      type: 'string',
      valuePlaceholder: '<tadir>',
      description:
        'Object type filter for name resolution (CLAS, PROG, …); needed only when the name matches several object kinds.',
    },
    {
      name: '--risk',
      type: 'string',
      valuePlaceholder: '<levels>',
      default: 'harmless',
      allowedValues: ['harmless', 'dangerous', 'critical'],
      description: 'Comma-separated risk levels to execute (default: harmless).',
    },
    {
      name: '--duration',
      type: 'string',
      valuePlaceholder: '<levels>',
      default: 'short',
      allowedValues: ['short', 'medium', 'long'],
      description: 'Comma-separated duration levels to execute (default: short).',
    },
    {
      name: '--all',
      type: 'boolean',
      default: false,
      description: 'Run every risk level and every duration level (instead of the defaults).',
    },
    {
      name: '--strict',
      type: 'boolean',
      default: false,
      description: 'Treat warning alerts as failures.',
    },
    schemaOption(),
  ],
  exclusiveGroups: [['--all', '--risk'], ['--all', '--duration']],
  examples: [
    { description: 'Run the default (harmless / short) ABAP Unit tests', command: 'abap test ZCL_MY_THING' },
    { description: 'Run every risk and duration level', command: 'abap test ZCL_MY_THING --all' },
    { description: 'Treat warnings as failures', command: 'abap test ZCL_MY_THING --strict --json' },
    { description: 'Agent integration: read summary + failures from the envelope', command: 'abap test ZCL_MY_THING --json' },
  ],
  errors: [
    { code: 'TEST_FAILED', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'OBJECT_NOT_FOUND', category: 'NOT_FOUND', exitCode: 8 },
    { code: 'AMBIGUOUS_OBJECT', category: 'NOT_FOUND', exitCode: 8 },
    { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
    { code: 'USAGE', category: 'USAGE', exitCode: 2 },
    { code: 'CONFIG_ERROR', category: 'CONFIG_ERROR', exitCode: 3 },
    { code: 'AUTH_ERROR', category: 'AUTH_ERROR', exitCode: 5 },
    { code: 'SAP_ERROR', category: 'SAP_ERROR', exitCode: 6 },
  ],
};

/** Commander action options for `abap test` (plus the schema switch). */
type TestCommandOptions = UnitTestOptions & { schema?: boolean };

export function registerTestCommand(program: Command): void {
  program
    .command('test')
    .description('Run ABAP Unit tests for an object (read-only)')
    // `[object]` stays optional so `--schema` needs no positional; a real run
    // without a name fails with USAGE (exit 2) from the flow.
    .argument('[object]', 'Object to test (class or program name, e.g. ZCL_MY_THING)')
    .option('--type <tadir>', 'Object type filter for name resolution (CLAS, PROG, …)')
    .option('--risk <levels>', 'Comma-separated risk levels: harmless, dangerous, critical (default harmless)')
    .option('--duration <levels>', 'Comma-separated duration levels: short, medium, long (default short)')
    .option('--all', 'Run all risk and duration levels')
    .option('--strict', 'Treat warnings as failures')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (object: string | undefined, opts: TestCommandOptions, cmd: Command) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema) {
        printSchema(SCHEMA, mode);
        return;
      }
      try {
        const result = await runUnitTest(object, opts);
        printResult(mode, result.data, result.human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}
