import { Command } from 'commander';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { computeDiff } from '../flows/search/diff.js';
import { CliError, printError, printResult, printSchema, jsonFromCommand } from '../output/json.js';
import { SEARCH_RESULT_LIMIT } from '../core/limits.js';
import { commandSchemas } from '../flows/setup/command-schemas.js';

interface DiffOptions {
  file?: string;
  all?: boolean;
  remote?: boolean;
  localOnly?: boolean;
  limit?: string;
}

/**
 * True when the positional argument is clearly an ABAP object name rather than
 * a local file path — i.e. it carries neither a path separator nor a `.` file
 * extension. F-18: `abap diff ZCL_ZR_T5` used to fall through to the filename
 * parser and fail with `FILE_PARSE_ERROR "Cannot resolve object type from
 * filename: ZCL_ZR_T5"`, which reads like a filename bug instead of "you
 * passed an object name". Genuine bad filenames (with a separator or an
 * extension) still reach that FILE_PARSE_ERROR path unchanged.
 */
function looksLikeObjectName(arg: string): boolean {
  return !arg.includes('/') && !arg.includes('\\') && !arg.includes('.');
}

export function registerDiffCommand(program: Command): void {
  program
    .command('diff [file]')
    .description('Compare local files against SAP')
    .option('--all', 'Compare the whole workspace')
    .option('--remote', 'Remote-only differences')
    .option('--local-only', 'Local-only differences')
    .option('--limit <n>', `Result bound (default ${SEARCH_RESULT_LIMIT})`)
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (file: string | undefined, opts: DiffOptions, cmd) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema) {
        printSchema(commandSchemas['diff']!, mode);
        return;
      }
      try {
        if (file && (opts.all || opts.remote || opts.localOnly)) {
          throw new CliError('INVALID_ARGUMENT', 'A file argument cannot be combined with --all/--remote/--local-only.', {
            nextSteps: ['Either diff a single file or scope the workspace; not both.'],
            example: 'abap diff src/zcl_demo.clas.abap --json',
          });
        }
        // Precedence: the scoping-conflict check above runs first (both problems
        // are argument-shape bugs); then an object-name argument is rejected
        // here before any client/SAP call, so the misleading FILE_PARSE_ERROR
        // from the filename resolver is never reached for bare names.
        if (file && looksLikeObjectName(file)) {
          const name = file.toUpperCase();
          throw new CliError(
            'INVALID_ARGUMENT',
            `'${file}' looks like an ABAP object name, not a file path. abap diff compares a local file against SAP and does not resolve object names.`,
            {
              nextSteps: [
                `Pull the object first: abap pull ${name} --type <T> (e.g. --type CLAS)`,
                `Then diff the pulled file: abap diff src/${file.toLowerCase()}.clas.abap`,
              ],
              example: `abap pull ${name} --type CLAS && abap diff src/${file.toLowerCase()}.clas.abap`,
            },
          );
        }
        const client = await AdtClientWrapper.create();
        const limit = opts.limit ? Number(opts.limit) : SEARCH_RESULT_LIMIT;
        const result = await computeDiff(client, {
          file,
          all: opts.all,
          remote: opts.remote,
          localOnly: opts.localOnly,
          limit,
        });
        const human = [
          ...(result.parts.length === 0
            ? ['No differences.']
            : result.parts.map((p) => {
                const sum = p.summary ? ` (+${p.summary.added}/-${p.summary.removed})` : '';
                return `  ${p.object} (${p.part}): ${p.direction}${sum}`;
              })),
          ...(result.truncated ? ['Result truncated — use --limit <n> or narrow with --remote/--local-only.'] : []),
        ].join('\n');
        printResult(mode, result, human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}
