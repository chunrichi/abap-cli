/**
 * `extensions` command group.
 * Subcommands: list (registered extensions with status), lock.
 */

import { Command } from 'commander';
import { printSchema, jsonFromCommand } from '../output/json.js';
import { listExtensionsAction } from '../extensions/list-command.js';
import { commandSchemas } from '../flows/command-schemas.js';

export function registerExtensionsCommand(program: Command): void {
  const extensions = program
    .command('extensions')
    .description('Manage installed extensions')
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

  // Lazy-load the lock subcommand so its dependencies (file I/O, lockfile)
  // don't tax `extensions list --json` startup.
  extensions
    .command('lock')
    .description('Compute or refresh extensions.lock.json (npm extensions only)')
    .option('--allow-unsigned', 'Required to create a brand-new lockfile (first-run bootstrap)')
    .action(async (opts: { allowUnsigned?: boolean }, cmd: unknown) => {
      const { runExtensionsLock } = await import('./extensions-lock.js');
      const c = cmd as { optsWithGlobals: () => { json?: boolean; prettyJson?: boolean } };
      const flags = c.optsWithGlobals();
      const mode: 'pretty-json' | 'json' | 'human' = flags.prettyJson
        ? 'pretty-json'
        : flags.json
          ? 'json'
          : 'human';
      await runExtensionsLock(mode, { allowUnsigned: Boolean(opts.allowUnsigned) });
    });
}
