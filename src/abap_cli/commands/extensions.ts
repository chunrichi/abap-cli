/**
 * `extensions` command group.
 * Subcommands: list (registered extensions with status), lock.
 */

import { Command } from 'commander';
import { printSchema, jsonFromCommand } from '../output/json.js';
import { listExtensionsAction } from '../extensions/list-command.js';
import { commandSchemas } from '../flows/setup/command-schemas.js';

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

  // P3.2: `extensions verify` re-checks every lockfile entry's integrity
  // against the on-disk package contents. Useful in CI / pre-deploy hooks.
  extensions
    .command('verify')
    .description('Verify extensions.lock.json integrity against on-disk packages')
    .action(async (_opts: unknown, cmd: unknown) => {
      const { verifyLockfile } = await import('../extensions/lockfile.js');
      const c = cmd as { optsWithGlobals: () => { json?: boolean; prettyJson?: boolean } };
      const flags = c.optsWithGlobals();
      const result = await verifyLockfile(process.cwd());
      if (flags.prettyJson) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else if (flags.json) {
        process.stdout.write(JSON.stringify(result) + '\n');
      } else {
        if (result.ok) {
          console.log(`OK: ${result.total} extension(s) verified at ${result.lockfilePath}`);
        } else {
          console.error(`FAIL: ${result.mismatches.length} mismatch(es) at ${result.lockfilePath}`);
          for (const m of result.mismatches) {
            const reason = m.result.ok ? 'UNKNOWN' : m.result.reason;
            console.error(`  - ${m.packageName}: ${reason}`);
          }
          process.exit(1);
        }
      }
    });
}
