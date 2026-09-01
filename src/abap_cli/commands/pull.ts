import { Command } from 'commander';
import { runPull, type PullOptions } from '../flows/edit/pull.js';
import { printError, printResult, printSchema, jsonFromCommand } from '../output/json.js';
import { SEARCH_RESULT_LIMIT } from '../core/limits.js';
import { commandSchemas } from '../flows/setup/command-schemas.js';

export function registerPullCommand(program: Command): void {
  program
    .command('pull')
    .description('Download ABAP objects from SAP to local files')
    .argument('[object-name]', 'Object name (e.g., ZCL_MY_CLASS)')
    .option('--type <type>', 'Object type (CLAS, PROG, INTF, etc.)')
    .option('--package <package>', 'Download all objects in a package')
    .option('--limit <n>', `Batch page size for --package (default ${SEARCH_RESULT_LIMIT})`)
    .option('--page <n>', 'Batch page number for --package (1-based)', '1')
    .option('--dir <path>', 'Output directory', 'src/')
    .option('--overwrite', 'Replace local file with different content')
    .option('--skip-existing', 'Skip files that already exist')
    .option('--include-tests', 'Include testclasses source part')
    .option('--include-all-parts', 'Include every source-code part')
    .option('--textpool', 'Also pull textpool files (.texts/.selections/.headings.<lang>.properties)')
    .option('--remote <remoteid>', 'Pull the object\'s active version source from a remote system (Version Management)')
    .option('--tr <request>', 'Pull all objects bound to a transport request (mutually exclusive with object name and --package)')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (objectName: string, opts: PullOptions, cmd) => {
      // --schema branch — emit machine-readable parameter schema (no SAP call).
      if (cmd.optsWithGlobals().schema) {
        printSchema(commandSchemas['pull']!, jsonFromCommand(cmd));
        return;
      }
      // Bare `abap pull` (no object, no --package, no --tr) prints the command help, like `abap pull --help`.
      if (!objectName && !opts.package && !opts.tr) {
        console.log(cmd.helpInformation());
        return;
      }
      const mode = jsonFromCommand(cmd);
      try {
        const result = await runPull(objectName, opts);
        printResult(mode, result.data, result.human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}




