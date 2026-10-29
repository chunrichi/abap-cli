import { Command } from 'commander';
import { printError, printResult, printSchema, jsonFromCommand } from '../output/json.js';
import { SEARCH_RESULT_LIMIT } from '../core/limits.js';
import { commandSchemas } from '../flows/setup/command-schemas.js';
import { runDiff, type DiffRunOptions } from '../flows/search/diff.js';

export function registerDiffCommand(program: Command): void {
  program
    .command('diff [file]')
    .description('Compare local files against SAP')
    .option('--all', 'Compare the whole workspace')
    .option('--remote', 'Remote-only differences')
    .option('--local-only', 'Local-only differences')
    .option('--limit <n>', `Result bound (default ${SEARCH_RESULT_LIMIT})`)
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (file: string | undefined, opts: DiffRunOptions, cmd) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema) {
        printSchema(commandSchemas['diff']!, mode);
        return;
      }
      try {
        const result = await runDiff(file, opts);
        printResult(mode, result.data, result.human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}
