import { Command } from 'commander';
import { runPull, type PullOptions } from '../flows/pull-flow.js';
import { printError, printResult, jsonFromCommand } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';
import { SEARCH_RESULT_LIMIT } from '../core/limits.js';

export function registerPullCommand(program: Command): void {
  program
    .command('pull')
    .description('Download ABAP objects from SAP to local files')
    .addHelpText('after', commonErrorsAfter())
    .argument('[object-name]', 'Object name to download (e.g., ZCL_MY_CLASS)')
    .option('--type <type>', 'Object type (CLAS, PROG, INTF, etc.)')
    .option('--package <package>', 'Download all objects in a package')
    .option('--limit <n>', `Batch page size for --package (default ${SEARCH_RESULT_LIMIT})`)
    .option('--page <n>', 'Batch page number for --package (1-based)', '1')
    .option('--dir <path>', 'Output directory', 'src/')
    .option('--overwrite', 'Allow replacing a local file with different content')
    .option('--skip-existing', 'Skip files that already exist locally')
    .option('--include-tests', 'Include testclasses source part')
    .option('--include-all-parts', 'Include every source-code part')
    .option('--textpool', '014: also pull textpool files (.texts/.selections/.headings.<lang>.properties)')
    .action(async (objectName: string, opts: PullOptions, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        const result = await runPull(objectName, opts);
        printResult(json, result.data, result.human);
      } catch (error: unknown) {
        printError(json, error);
      }
    });
}




