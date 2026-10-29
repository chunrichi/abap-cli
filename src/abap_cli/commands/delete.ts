import { Command } from 'commander';
import { runDelete, type DeleteOptions } from '../flows/edit/delete.js';
import { CliError, printError, printResult, printSchema, jsonFromCommand } from '../output/json.js';
import { normalizeTypeInput } from '../cli/type-alias.js';

export const SCHEMA = {
  schemaVersion: 1,
  command: 'delete',
  description:
    'Delete an ABAP object from SAP (lock → delete → unlock). ' +
    'Type is required to avoid ambiguity; --yes is required for non-interactive confirmation; ' +
    'a transport request is required for non-$TMP objects (matching `abap push` semantics).',
  usage: 'abap delete <object> --type <type> [--tr <request>] --yes',
  scope: 'sap',
  arguments: [
    {
      name: 'object',
      type: 'string',
      required: true,
      description: 'Object name (e.g., ZCL_MY_CLASS, ZR_USER_CHANGES).',
    },
  ],
  options: [
    {
      name: '--type',
      type: 'string',
      required: true,
      valuePlaceholder: '<type>',
      description: 'Object type code (CLAS, PROG, INTF, FUGR, TABL, ...).',
    },
    {
      name: '--tr',
      type: 'string',
      required: false,
      valuePlaceholder: '<request>',
      description: 'Transport request number (required for non-$TMP packages).',
    },
    {
      name: '--yes',
      type: 'boolean',
      required: true,
      description: 'Confirm the deletion. Required — there is no implicit confirmation.',
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
    { description: 'Delete a local $TMP class', command: 'abap delete ZCL_ZR_CHK9 --type CLAS --yes' },
    { description: 'Delete a transport-bound object', command: 'abap delete ZR_OLD --type PROG --tr NDK900123 --yes' },
  ],
  errors: [
    { code: 'USAGE', category: 'USAGE', exitCode: 2 },
    { code: 'OBJECT_NOT_FOUND', category: 'NOT_FOUND', exitCode: 8 },
    { code: 'AMBIGUOUS_OBJECT', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'TYPE_NOT_SUPPORTED', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'MISSING_TRANSPORT', category: 'USAGE', exitCode: 2 },
    { code: 'LOCK_FAILED', category: 'SAP_ERROR', exitCode: 6 },
    { code: 'DELETE_FAILED', category: 'SAP_ERROR', exitCode: 6 },
  ],
};

export function registerDeleteCommand(program: Command): void {
  program
    .command('delete')
    .description('Delete an ABAP object from SAP (requires --type and --yes)')
    .argument('[object]', 'Object name (e.g., ZCL_MY_CLASS). Required for actual deletion; omitted under --schema.')
    // Use plain `.option` (not `requiredOption`) so `--schema` can be evaluated
    // before argument validation — matches the `fields` / `select` pattern that
    // the envelope-schema contract test depends on.
    .option('--type <type>', 'Object type code (CLAS, PROG, INTF, ...). Required for deletion.')
    .option('--tr <request>', 'Transport request number (required for non-$TMP packages)')
    .option('--yes', 'Confirm the deletion. Required for deletion.')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (object: string | undefined, opts: DeleteOptions & { type?: string; schema?: boolean }, cmd: Command) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema || opts.schema) {
        printSchema(SCHEMA, mode);
        return;
      }
      try {
        // --schema is the contract-discovery path; runDelete has no need to see
        // it. The same instance-pattern is used by fields / select / pull.
        if (!opts.type || !object) {
          throw new CliError('USAGE', 'Object name and --type are required for deletion', {
            nextSteps: ['Re-run with the object name and `--type <type>`.'],
            example: 'abap delete ZCL_MY_CLASS --type CLAS --yes',
          });
        }
        // Normalize the type at the command layer so `cl`, `Clas`, `clas` all work,
        // matching `abap pull`/`create` semantics.
        opts.type = normalizeTypeInput(opts.type).type;
        const { data, human } = await runDelete(object, opts);
        printResult(mode, data, human);
      } catch (error: unknown) {
        if (error instanceof CliError && error.code === 'USAGE' && /--yes/.test(String(error.message))) {
          // Pass USAGE through unchanged so the missing-confirm hint is loud.
          printError(mode, error);
          return;
        }
        printError(mode, error);
      }
    });
}