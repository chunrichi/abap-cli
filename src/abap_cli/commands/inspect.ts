import { Command } from 'commander';
import { printError, printResult, printSchema, jsonFromCommand } from '../output/json.js';
import { commandSchemas } from '../flows/setup/command-schemas.js';
import { runInspect, type InspectFlags } from '../flows/search/inspect-ops.js';

export function registerInspectCommand(program: Command): void {
  program
    .command('inspect [object]')
    .description('View ABAP object metadata')
    .option('--structure', 'Include object structure elements')
    .option('--includes', 'Include class include parts')
    .option('--locks', 'Include transport ownership (not ADT editor-session state)')
    .option('--package', 'Include the object package name')
    .option('--activation', 'Verify active vs latest source (detect stale activation)')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (object: string | undefined, opts: InspectFlags, cmd) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema) {
        printSchema(commandSchemas['inspect']!, mode);
        return;
      }
      try {
        const result = await runInspect(object, opts);
        printResult(mode, result.data, result.human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}
