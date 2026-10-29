import { Command } from 'commander';
import { printError, printResult, printSchema, jsonFromCommand } from '../output/json.js';
import { SEARCH_RESULT_LIMIT } from '../core/limits.js';
import { commandSchemas } from '../flows/setup/command-schemas.js';
import { runStatus, type StatusRunOptions } from '../flows/search/status.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show local vs SAP sync status')
    .option('--remote-only', 'Objects on SAP but not locally')
    .option('--local-only', 'Objects locally but not on SAP')
    .option('--limit <n>', `Max result count (default ${SEARCH_RESULT_LIMIT})`)
    .option('--since <iso-date>', 'Compare files modified since date (YYYY-MM-DD[THH:mm:ss])')
    .option('--all', 'Include unchanged objects')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (opts: StatusRunOptions, cmd) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema) {
        printSchema(commandSchemas['status']!, mode);
        return;
      }
      try {
        const result = await runStatus(opts);
        printResult(mode, result.data, result.human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}
