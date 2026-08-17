import { Command } from 'commander';
import { printError, printResult, jsonFromCommand, CliError } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';
import {
  buildDryRun,
  runSelect,
  validateLimit,
  validateOffset,
  validateWhere,
  validateFields,
  validateOrderBy,
  type SelectResult,
} from '../flows/select-flow.js';

const SCHEMA = {
  command: 'select',
  description:
    'Query table data read-only via the bundled ICF /data endpoint (SE16N equivalent): --table ZTAB [--fields ...] [--where ...] [--limit N] [--offset N] [--order-by ...] [--count-only]',
  scope: 'sap',
  options: [
    {
      name: '--table',
      type: 'string',
      required: true,
      valuePlaceholder: '<name>',
      description:
        'Target ABAP table or view name (e.g. ZTAB_FIXTURE). Uppercased and validated against DDIC on SAP side.',
    },
    {
      name: '--fields',
      type: 'string',
      required: false,
      valuePlaceholder: '<csv>',
      description:
        'Comma-separated field names to project. Omit for all fields (large-object fields STRG/RSTR/LCHR/LRAW excluded, listed in data.excludedFields).',
    },
    {
      name: '--where',
      type: 'string',
      required: false,
      valuePlaceholder: '<clause>',
      maxLength: 2000,
      description:
        "Filter clause: FIELD OP VALUE joined by AND. Ops: = <> > >= < <= LIKE. Strings in single quotes ('' for escape), numbers bare, dates 'YYYYMMDD'. MANDT filter rejected (implicit session client).",
    },
    {
      name: '--limit',
      type: 'int',
      required: false,
      valuePlaceholder: '<n>',
      default: 100,
      minimum: 1,
      maximum: 10000,
      description:
        'Maximum rows returned. SAP fetches limit+1 to detect truncation (data.truncated).',
    },
    {
      name: '--offset',
      type: 'int',
      required: false,
      valuePlaceholder: '<n>',
      default: 0,
      minimum: 0,
      maximum: 100000,
      description: 'Row offset for pagination. Deterministic pagination requires --order-by.',
    },
    {
      name: '--order-by',
      type: 'string',
      required: false,
      valuePlaceholder: '<csv>',
      description: 'Comma-separated FIELD:ASC|DESC pairs, e.g. "ID:ASC,AMOUNT:DESC".',
    },
    {
      name: '--count-only',
      type: 'boolean',
      required: false,
      default: false,
      description: 'Return only the matching row count (data.count); rows/fields omitted.',
    },
    {
      name: '--dry-run',
      type: 'boolean',
      required: false,
      default: false,
      description: 'Plan only — print the query envelope without invoking the ICF endpoint.',
    },
    {
      name: '--json',
      type: 'boolean',
      required: false,
      default: false,
      global: true,
      description: 'Emit the unified JSON envelope on stdout (012 output contract).',
    },
    {
      name: '--schema',
      type: 'boolean',
      required: false,
      default: false,
      description: 'Print this schema as JSON and exit 0 without any SAP call.',
    },
  ],
  exclusiveGroups: [['<no_exclusive_groups>']],
  globalOptions: ['--json'],
  examples: [
    {
      description: 'Basic query with filter and limit',
      command: 'abap select --table ZTAB_FIXTURE --where "STATUS = \'X\'" --limit 50',
    },
    {
      description: 'Projection + sort + pagination',
      command: 'abap select --table ZTAB_FIXTURE --fields "ID,AMOUNT" --order-by "ID:ASC" --limit 20 --offset 40',
    },
    {
      description: 'Count matching rows',
      command: 'abap select --table ZTAB_FIXTURE --where "AMOUNT > 100" --count-only',
    },
    {
      description: 'Agent integration: JSON envelope',
      command: 'abap select --table ZTAB_FIXTURE --where "STATUS = \'X\'" --limit 50 --json',
    },
    {
      description: 'Dry-run: zero SAP calls',
      command: 'abap select --table ZTAB_FIXTURE --where "STATUS = \'X\'" --dry-run',
    },
  ],
  errors: [
    { code: 'TABLE_NOT_FOUND', category: 'NOT_FOUND', exitCode: 8 },
    { code: 'TABLE_TYPE_NOT_SUPPORTED', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'INVALID_FIELD', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'INVALID_WHERE', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'LIMIT_EXCEEDED', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'OFFSET_EXCEEDED', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'QUERY_FAILED', category: 'SAP_ERROR', exitCode: 6 },
    { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
  ],
};

export function registerSelectCommand(program: Command): void {
  program
    .command('select')
    .description(
      'Query table data read-only via the bundled ICF /data endpoint (SE16N equivalent)',
    )
    .addHelpText('after', commonErrorsAfter())
    .option('--table <name>', 'Target ABAP table or view name (e.g. ZTAB_FIXTURE)')
    .option('--fields <csv>', 'Comma-separated field names to project')
    .option('--where <clause>', 'Filter clause (FIELD OP VALUE joined by AND)')
    .option('--limit <n>', 'Maximum rows returned (1–10000, default 100)', '100')
    .option('--offset <n>', 'Row offset for pagination (0–100000, default 0)', '0')
    .option('--order-by <csv>', 'Comma-separated FIELD:ASC|DESC pairs')
    .option('--count-only', 'Return only the matching row count')
    .option('--dry-run', 'Plan only — print the request envelope without invoking the ICF endpoint')
    .option('--schema', 'Print the command parameter schema as JSON and exit 0')
    .action(
      async (
        opts: {
          table?: string;
          fields?: string;
          where?: string;
          limit?: string;
          offset?: string;
          orderBy?: string;
          countOnly?: boolean;
          dryRun?: boolean;
        },
        cmd: Command,
      ) => {
        const json = jsonFromCommand(cmd);

        // --schema branch — emit machine-readable parameter schema, no SAP call.
        if (cmd.optsWithGlobals().schema) {
          console.log(JSON.stringify(SCHEMA, null, json ? 2 : undefined));
          return;
        }

        try {
          const table = (opts.table ?? '').trim();
          if (!table) {
            throw new CliError('INVALID_ARGUMENT', '--table is required', {
              nextSteps: ['Specify a table or view name, e.g. --table ZTAB_FIXTURE'],
            });
          }
          // Pre-validate cheap CLI fields so that bad inputs surface before any
          // SAP call. The SAP-side handler re-validates authoritatively.
          validateLimit(opts.limit);
          validateOffset(opts.offset);
          validateWhere(opts.where);
          validateFields(opts.fields);
          validateOrderBy(opts.orderBy);

          if (opts.dryRun) {
            const dry = buildDryRun(table, {
              fields: opts.fields,
              where: opts.where,
              limit: opts.limit,
              offset: opts.offset,
              orderBy: opts.orderBy,
              countOnly: opts.countOnly,
              dryRun: true,
            });
            printResult(json, dry, formatHuman(dry));
            return;
          }

          const result = await runSelect(table, {
            fields: opts.fields,
            where: opts.where,
            limit: opts.limit,
            offset: opts.offset,
            orderBy: opts.orderBy,
            countOnly: opts.countOnly,
          });
          printResult(json, result, formatHuman(result));
        } catch (error: unknown) {
          printError(json, error);
        }
      },
    );
}

/**
 * Render the SelectResult as a human-readable ASCII table. Mirrors the
 * conventions used for the human output of other read-only commands (e.g.
 * `inspect`, `search`): a header row, a separator, one row per data row,
 * and a trailing summary line. Values are native-typed (017 Q1 B: numbers,
 * YYYY-MM-DD dates, strings) and are stringified via String() — null → ''.
 */
export function formatHuman(result: SelectResult): string {
  const lines: string[] = [];
  if (result.dryRun) {
    lines.push(`(dry-run) would query`);
    lines.push(`  table: ${result.table}`);
    if (result.fields.length > 0) {
      lines.push(`  fields: ${result.fields.join(', ')}`);
    } else {
      lines.push(`  fields: (all — large-object fields excluded)`);
    }
    if (result.orderBy && result.orderBy.length > 0) {
      lines.push(
        `  orderBy: ${result.orderBy.map((o) => `${o.field}:${o.direction}`).join(', ')}`,
      );
    }
    lines.push(`  limit: ${result.limit}`);
    lines.push(`  offset: ${result.offset}`);
    if (result.countOnly) {
      lines.push(`  countOnly: true`);
    }
    return lines.join('\n');
  }
  if (result.countOnly) {
    lines.push(`table: ${result.table}`);
    lines.push(`count: ${result.count ?? 0}`);
    lines.push(`time:  ${result.durationMs}ms`);
    return lines.join('\n');
  }

  const headers = result.fields;
  if (headers.length === 0) {
    lines.push(`table: ${result.table}`);
    lines.push(`0 row(s)`);
    return lines.join('\n');
  }

  // Compute column widths from headers + row values.
  const widths: number[] = headers.map((h) => h.length);
  for (const row of result.rows) {
    headers.forEach((h, i) => {
      const v = row[h] ?? '';
      widths[i] = Math.max(widths[i] ?? h.length, String(v).length);
    });
  }

  const headerLine = headers.map((h, i) => h.padEnd(widths[i] ?? h.length)).join('  ');
  const separator = widths.map((w) => '-'.repeat(w)).join('  ');
  lines.push(headerLine);
  lines.push(separator);
  for (const row of result.rows) {
    const cells = headers.map((h, i) => String(row[h] ?? '').padEnd(widths[i] ?? h.length));
    lines.push(cells.join('  '));
  }
  const summary = `${result.rowCount} row(s)`;
  lines.push(separator);
  if (result.truncated) {
    lines.push(
      `${summary} (truncated — pass a larger --limit or use --offset to continue pagination)`,
    );
  } else {
    lines.push(summary);
  }
  if (result.excludedFields.length > 0) {
    lines.push(
      `excluded: ${result.excludedFields.join(', ')} (large-object fields; not projected)`,
    );
  }
  lines.push(`time: ${result.durationMs}ms`);
  return lines.join('\n');
}
