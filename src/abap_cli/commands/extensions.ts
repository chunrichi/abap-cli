/**
 * `extensions` command group (T013).
 * Subcommands: list (registered extensions with status).
 */

import { Command } from 'commander';
import { printSchema, jsonFromCommand } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';
import { listExtensionsAction } from '../extensions/list-command.js';
import { commandSchemas } from '../flows/command-schemas.js';

export function registerExtensionsCommand(program: Command): void {
  const extensions = program
    .command('extensions')
    .description('Manage installed extensions')
    .addHelpText('after', commonErrorsAfter())
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action((_opts, cmd) => {
      if (cmd.optsWithGlobals().schema) {
        printSchema(commandSchemas['extensions']!, jsonFromCommand(cmd));
        return;
      }
      cmd.help();
    });

  extensions
    .command('list')
    .description('List registered extensions')
    .action(async (_opts, cmd) => {
      const json = cmd.optsWithGlobals().json ?? false;
      // ctx is a minimal ExtensionContext — no command/argv needed for list
      await listExtensionsAction({ command: 'extensions list', argv: process.argv.slice(2) }, { _json: json });
    });
}
