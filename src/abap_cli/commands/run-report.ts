import { Command } from 'commander';
import { printError, printResult, printSchema, jsonFromCommand } from '../output/json.js';
import { formatRunReportHuman, runReport } from '../flows/data/run-report.js';

export const SCHEMA = {
  schemaVersion: 1,
  command: 'run-report',
  description:
    'Execute an activated REPORT and return its list output (read-only, via the bundled ICF /run/report endpoint). The report runs with DEFAULT selection values; only classic list output is captured.',
  usage: 'abap run-report <report> [--variant <name>] [--json]',
  scope: 'sap',
  arguments: [
    {
      name: 'report',
      type: 'string',
      required: true,
      description: 'Executable program name (TRDIR subc = 1), e.g. ZR_MY_REPORT.',
    },
  ],
  options: [
    {
      name: '--variant',
      type: 'string',
      required: false,
      valuePlaceholder: '<name>',
      description: 'Selection variant to apply instead of the plain default values.',
    },
  ],
  globalOptions: ['--json', '--pretty-json'],
  examples: [
    { description: 'Run a report and print its list', command: 'abap run-report ZR_MY_REPORT' },
    { description: 'Run with a selection variant, as JSON', command: 'abap run-report ZR_MY_REPORT --variant VAR1 --json' },
  ],
  errors: [
    { code: 'REPORT_NOT_FOUND', category: 'NOT_FOUND', exitCode: 8 },
    { code: 'REPORT_NOT_EXECUTABLE', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'REPORT_RUN_FAILED', category: 'SAP_ERROR', exitCode: 6 },
    { code: 'REPORT_NO_LIST_OUTPUT', category: 'SAP_ERROR', exitCode: 6 },
    { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
  ],
};

export function registerRunReportCommand(program: Command): void {
  program
    .command('run-report')
    .description('Execute an activated REPORT and return its list output (read-only)')
    .argument('[report]', 'Executable program name (e.g. ZR_MY_REPORT)')
    .option('--variant <name>', 'Selection variant to apply instead of the default values')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (report: string | undefined, opts: { variant?: string; schema?: boolean }, cmd: Command) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema || opts.schema) {
        printSchema(SCHEMA, mode);
        return;
      }
      try {
        const result = await runReport(report ?? '', { variant: opts.variant });
        printResult(mode, result, formatRunReportHuman(result));
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}
