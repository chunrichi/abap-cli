/**
 * `extensions` command group (T013).
 * Subcommands: list (registered extensions with status).
 */

import { Command } from 'commander';
import { commonErrorsAfter } from '../output/help-text.js';
import { listExtensionsAction } from '../extensions/list-command.js';

export function registerExtensionsCommand(program: Command): void {
  const extensions = program
    .command('extensions')
    .description('Manage installed extensions')
    .addHelpText('after', commonErrorsAfter());

  extensions
    .command('list')
    .description('List registered extensions')
    .action(async (_opts, cmd) => {
      const json = cmd.optsWithGlobals().json ?? false;
      // ctx is a minimal ExtensionContext — no command/argv needed for list
      await listExtensionsAction({ command: 'extensions list', argv: process.argv.slice(2) }, { _json: json });
    });
}
