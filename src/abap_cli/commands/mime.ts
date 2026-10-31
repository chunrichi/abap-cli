import { Command } from 'commander';
import { createMimeFolder, deleteMimeFolder, type CreateMimeFolderOptions, type DeleteMimeFolderOptions } from '../flows/mime/mime-flow.js';
import { pushMimeResources, type PushMimeResourcesOptions } from '../flows/mime/mime-push.js';
import { jsonFromCommand, printError, printResult, printSchema, type OutputMode, type CommandSchema } from '../output/json.js';
import { schemaOption } from './schema-helpers.js';
import { failMissingInvocation } from '../output/usage.js';

export const SCHEMA: CommandSchema = {
  schemaVersion: 1,
  command: 'mime',
  description: 'Create, delete, or upload MIME Repository resources (subcommands: create | delete | push).',
  usage: 'abap mime create <path> [options]\nabap mime delete <path> [options]\nabap mime push <local> --root <path> [options]',
  scope: 'sap',
  arguments: [],
  options: [schemaOption()],
  globalOptions: ['--json', '--pretty-json'],
  examples: [
    { description: 'Create a MIME folder under $TMP', command: "abap mime create /zntf_ui --package '$TMP' --yes" },
    { description: 'Recursively delete a folder (with transport)', command: 'abap mime delete /zntf_ui --recursive --tr NDK123456 --yes' },
    { description: 'Upload local assets into an existing folder', command: 'abap mime push ./out --root /zntf_ui/assets --tr NDK123456 --yes' },
    { description: 'Dry-run (no SAP calls)', command: 'abap mime push ./out --root /zntf_ui/assets --dry-run' },
  ],
  errors: [
    { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
    { code: 'USAGE', category: 'USAGE', exitCode: 2 },
    { code: 'SAP_ERROR', category: 'SAP_ERROR', exitCode: 6 },
  ],
};

export function registerMimeCommand(program: Command): void {
  const mime = program
    .command('mime')
    .description('Create, delete, or upload MIME Repository resources (subcommands: create | delete | push)')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .showHelpAfterError()
    .action((_opts, cmd) => {
      if (cmd.optsWithGlobals().schema) {
        printSchema(SCHEMA, jsonFromCommand(cmd));
        return;
      }
      // Bare `abap mime` is a USAGE failure; help is only printed by
      // `abap mime --help`.
      failMissingInvocation(
        cmd,
        "Missing subcommand: use 'mime create', 'mime delete', or 'mime push'.",
        'abap mime create /zntf_ui --package $TMP --yes',
      );
    });

  mime
    .command('create <path>')
    .description('Create a MIME folder')
    .option('--package <package>', 'Root-folder package; defaults to $TMP', '$TMP')
    .option('--description <text>', 'Folder description')
    .option('--tr <transport>', 'Transport request for the folder operation')
    .option('--dry-run', 'Print the operation plan without calling SAP')
    .option('--yes', 'Confirm in non-interactive mode')
    .action(async (path: string, opts: CreateMimeFolderOptions, cmd) => {
      const json: OutputMode = jsonFromCommand(cmd);
      try {
        const data = await createMimeFolder(path, opts);
        printResult(json, data, `Created MIME folder ${path}`);
      } catch (error) {
        printError(json, error);
      }
    });

  mime
    .command('delete <path>')
    .description('Delete a MIME folder (use --recursive for non-empty folders)')
    .option('--recursive', 'Delete the folder and all contained resources')
    .option('--tr <transport>', 'Transport request for the folder operation')
    .option('--dry-run', 'Print the operation plan without calling SAP')
    .option('--yes', 'Confirm in non-interactive mode')
    .action(async (path: string, opts: DeleteMimeFolderOptions, cmd) => {
      const json: OutputMode = jsonFromCommand(cmd);
      try {
        const data = await deleteMimeFolder(path, opts);
        printResult(json, data, `Deleted MIME folder ${path}`);
      } catch (error) {
        printError(json, error);
      }
    });

  mime
    .command('push <local>')
    .description('Upload a local file or directory into an existing MIME folder')
    .option('--root <path>', 'Absolute MIME folder that receives the upload', (val) => val)
    .option('--tr <transport>', 'Transport request for the upload')
    .option('--dry-run', 'Print the operation plan without calling SAP')
    .option('--yes', 'Confirm in non-interactive mode')
    .action(async (local: string, opts: PushMimeResourcesOptions, cmd) => {
      const json: OutputMode = jsonFromCommand(cmd);
      try {
        const data = await pushMimeResources(local, opts);
        printResult(json, data, `Uploaded ${local} into ${opts.root ?? '(no --root)'}`);
      } catch (error) {
        printError(json, error);
      }
    });
}