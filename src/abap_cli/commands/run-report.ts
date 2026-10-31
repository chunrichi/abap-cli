import { Command } from 'commander';
import { runReport, formatRunReportHuman, type RunReportOptions } from '../flows/data/run-report.js';
import { CliError, printError, printResult, printSchema, jsonFromCommand } from '../output/json.js';

export const SCHEMA = {
  schemaVersion: 1,
  command: 'run-report',
  description:
    'Execute an activated REPORT and return its list output (read-only, via the bundled ICF /run/report endpoint). ' +
    'The report runs with DEFAULT selection values; only classic list output is captured. ' +
    '--format (raw|tsv|csv) and --param NAME=VALUE pass-through are supported.',
  usage: 'abap run-report <report> [--variant <name>] [--format raw|tsv|csv] [--param NAME=VALUE]...',
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
    {
      name: '--format',
      type: 'string',
      required: false,
      valuePlaceholder: '<raw|tsv|csv>',
      description:
        "Output format. 'raw' (default) keeps SAP's list layout (with `|` and `-----` separator bars). " +
        "'tsv' / 'csv' extract the columns to a tabular form. The transformation is client-side; the 'output' " +
        "field always carries the raw SAP list so callers can switch formats without re-running the report.",
    },
    {
      name: '--param',
      type: 'string',
      required: false,
      valuePlaceholder: '<NAME=VALUE>',
      description:
        'Ad-hoc selection-screen parameter, repeated. Forwarded to the SAP-side handler which echoes the ' +
        "list of params back in `data.params`. Apply them by changing report defaults or creating a variant.",
    },
  ],
  globalOptions: ['--json', '--pretty-json'],
  examples: [
    { description: 'Run a report and print its list', command: 'abap run-report ZR_MY_REPORT' },
    { description: 'Run with a selection variant, as JSON', command: 'abap run-report ZR_MY_REPORT --variant VAR1 --json' },
    { description: 'Run with --format tsv for machine-readable rows', command: 'abap run-report ZR_MY_REPORT --format tsv' },
    { description: 'Pass selection-screen params (forwarded to SAP, echoed in response)', command: 'abap run-report ZR_MY_REPORT --param P_USERNAME=DEVELOPER --param P_MAX=10' },
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
    .option('--format <fmt>', "Output format: raw|tsv|csv (default raw)")
    // `--param` is variadic — Commander parses it as a string list. The CLI
    // parses each 'NAME=VALUE' pair itself so we can validate the NAME
    // against the SAP parameter-name pattern before any SAP call.
    .option('--param <name=value>', 'Selection-screen parameter NAME=VALUE (repeatable)', (value, prev: string[]) => {
      const arr = Array.isArray(prev) ? prev : [];
      arr.push(value);
      return arr;
    }, [] as string[])
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (
      report: string | undefined,
      opts: { variant?: string; schema?: boolean; format?: string; param?: string[] },
      cmd: Command,
    ) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema || opts.schema) {
        printSchema(SCHEMA, mode);
        return;
      }
      try {
        // Validate format early so the schema path isn't tripped by
        // an obvious typo. The flow re-validates.
        const format = opts.format ?? 'raw';
        if (format !== 'raw' && format !== 'tsv' && format !== 'csv') {
          throw new CliError('INVALID_ARGUMENT', `--format must be 'raw', 'tsv', or 'csv' (got '${format}')`, {
            nextSteps: ['Drop --format for raw, or pick one of raw / tsv / csv.'],
            example: 'abap run-report ZR_FOO --format tsv',
          });
        }
        const params = parseParamFlags(opts.param);
        const result = await runReport(report ?? '', {
          variant: opts.variant,
          format,
          params,
        });
        printResult(mode, result, formatRunReportHuman(result));
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}

/**
 * Parse `--param NAME=VALUE` strings from Commander's variadic option
 * into the structured `{name, value}` shape the flow expects.
 *
 * `=` is the separator; values may contain `=` (only the first one is
 * the delimiter, matching shell conventions).
 */
function parseParamFlags(raw: string[] | undefined): Array<{ name: string; value: string }> {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out: Array<{ name: string; value: string }> = [];
  for (const [i, entry] of raw.entries()) {
    const eq = entry.indexOf('=');
    if (eq <= 0) {
      throw new CliError('INVALID_ARGUMENT', `--param #${i + 1} must be NAME=VALUE (got '${entry}')`, {
        nextSteps: ['Pass the parameter as `NAME=VALUE`; the `=` separates the two halves.'],
        example: 'abap run-report ZR_FOO --param P_USERNAME=DEVELOPER',
      });
    }
    out.push({ name: entry.slice(0, eq), value: entry.slice(eq + 1) });
  }
  return out;
}