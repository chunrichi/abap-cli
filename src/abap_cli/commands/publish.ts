/**
 * `abap publish` / `abap unpublish` — publish jobs for OData service bindings.
 *
 * The binding metadata supplies the service version and protocol version; the
 * commands only need the object name. A binding that is already in the target
 * state is reported as such instead of triggering a second job (SAP answers a
 * same-session second publish with a ZERO-reference error).
 */
import { Command } from 'commander';
import { CliError, printError, printResult, printSchema, jsonFromCommand, type CommandSchema } from '../output/json.js';
import { runPublishSrvb, type PublishSrvbOptions } from '../flows/edit/publish-srvb.js';
import { baseSchema, schemaOption } from './schema-helpers.js';

const ARGUMENT = {
  name: 'object-name',
  type: 'string' as const,
  required: true,
  description: 'Service binding name (e.g. ZUI_MY_SERVICE).',
};

export const PUBLISH_SCHEMA: CommandSchema = {
  ...baseSchema(
    'publish',
    'Publish the local OData endpoint of a service binding (ADT publish job).',
    'abap publish <object-name> [options]',
    'sap',
  ),
  arguments: [ARGUMENT],
  options: [schemaOption()],
  examples: [
    { description: 'Publish a service binding', command: 'abap publish ZUI_MY_SERVICE' },
    { description: 'Publish and print the full envelope', command: 'abap publish ZUI_MY_SERVICE --json' },
  ],
  errors: [
    { code: 'OBJECT_NOT_FOUND', category: 'NOT_FOUND', exitCode: 8 },
    { code: 'VALIDATION_ERROR', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'SAP_ERROR', category: 'SAP_ERROR', exitCode: 6 },
  ],
};

export const UNPUBLISH_SCHEMA: CommandSchema = {
  ...baseSchema(
    'unpublish',
    'Unpublish the local OData endpoint of a service binding (ADT unpublish job).',
    'abap unpublish <object-name> [options]',
    'sap',
  ),
  arguments: [ARGUMENT],
  options: [schemaOption()],
  examples: [
    { description: 'Unpublish a service binding', command: 'abap unpublish ZUI_MY_SERVICE' },
    { description: 'Unpublish and print the full envelope', command: 'abap unpublish ZUI_MY_SERVICE --json' },
  ],
  errors: [
    { code: 'OBJECT_NOT_FOUND', category: 'NOT_FOUND', exitCode: 8 },
    { code: 'VALIDATION_ERROR', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'SAP_ERROR', category: 'SAP_ERROR', exitCode: 6 },
  ],
};

function registerJobCommand(program: Command, schema: CommandSchema, unpublish: boolean): void {
  const verb = unpublish ? 'unpublish' : 'publish';
  program
    .command(`${verb} [object-name]`)
    .description(
      unpublish
        ? 'Unpublish the local OData endpoint of a service binding'
        : 'Publish the local OData endpoint of a service binding',
    )
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (objectName: string | undefined, opts: PublishSrvbOptions, cmd) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema) {
        printSchema(schema, mode);
        return;
      }
      if (!objectName) {
        printError(
          mode,
          new CliError('USAGE', `missing required argument 'object-name'`, {
            help: `abap ${verb} --help`,
            nextSteps: [`Run 'abap ${verb} --help' for the full option list.`],
          }),
        );
        return;
      }
      try {
        const result = await runPublishSrvb(objectName, { unpublish });
        printResult(mode, result.data, result.human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}

export function registerPublishCommand(program: Command): void {
  registerJobCommand(program, PUBLISH_SCHEMA, false);
}

export function registerUnpublishCommand(program: Command): void {
  registerJobCommand(program, UNPUBLISH_SCHEMA, true);
}
