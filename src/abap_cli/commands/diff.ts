import { Command } from 'commander';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { computeDiff } from '../flows/diff.js';
import { CliError, printError, printResult, jsonFromCommand } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';
import { SEARCH_RESULT_LIMIT } from '../core/limits.js';

interface DiffOptions {
  file?: string;
  all?: boolean;
  remote?: boolean;
  localOnly?: boolean;
  limit?: string;
}

export function registerDiffCommand(program: Command): void {
  program
    .command('diff [file]')
    .description('Compare local files against SAP (read-only)')
    .addHelpText('after', commonErrorsAfter())
    .option('--all', 'Compare the whole workspace')
    .option('--remote', 'Only remote-only differences')
    .option('--local-only', 'Only local-only differences')
    .option('--limit <n>', `Bounds the result (default ${SEARCH_RESULT_LIMIT})`)
    .action(async (file: string | undefined, opts: DiffOptions, cmd) => {
      const mode = jsonFromCommand(cmd);
      try {
        if (file && (opts.all || opts.remote || opts.localOnly)) {
          throw new CliError('INVALID_ARGUMENT', 'A file argument cannot be combined with --all/--remote/--local-only.', {
            nextSteps: ['Either diff a single file or scope the workspace; not both.'],
            example: 'abap diff src/zcl_demo.clas.abap --json',
          });
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
