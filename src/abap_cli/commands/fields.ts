import { Command } from 'commander';
import { CliError, printError, printResult, printSchema, jsonFromCommand } from '../output/json.js';
import {
  formatFieldsHuman,
  formatFindHuman,
  runFields,
  runFindTablesByFields,
} from '../flows/data/fields.js';

export const SCHEMA = {
  schemaVersion: 1,
  command: 'fields',
  description:
    'List the DDIC fields of a table or view (read-only). ' +
    'Two modes: `abap fields <table>` enumerates the fields of one object; ' +
    '`abap fields --find <f1>,<f2>...` returns every table that contains those fields (S-2 reverse lookup).',
  usage: 'abap fields <table> [--json] | abap fields --find <f1>,<f2>,...',
  scope: 'sap',
  arguments: [
    {
      name: 'table',
      type: 'string',
      required: false,
      description: 'Table or view name (e.g. VRSD). Uppercased. Required unless --find is given.',
    },
  ],
  options: [
    {
      name: '--find',
      type: 'string',
      required: false,
      valuePlaceholder: '<field1,field2,...>',
      description:
        'Reverse lookup: list every table that contains the given fields. Comma-separated. ' +
        'Mutually exclusive with the positional table name.',
    },
    {
      name: '--any',
      type: 'boolean',
      required: false,
      description: 'With --find, return tables containing ANY of the requested fields (default: ALL).',
    },
    {
      name: '--with-text',
      type: 'boolean',
      required: false,
      description: 'With --find, include DDIC short text (DD03T/DD04T) for each matched field.',
    },
    {
      name: '--as4local',
      type: 'string',
      required: false,
      valuePlaceholder: '<A|I>',
      description:
        'With --find, the DDIC active/inactive version to scan. ' +
        "Default 'A' (active). Pass 'I' to include inactive / changed versions.",
    },
    {
      name: '--tabclass',
      type: 'string',
      required: false,
      valuePlaceholder: '<class>',
      description: 'With --find, restrict to a DDIC table class (TRANSP, VIEW, INTTAB, ...).',
    },
    {
      name: '--limit',
      type: 'string',
      required: false,
      valuePlaceholder: '<n>',
      description: 'Max matches to return (default 200, hard cap 5000).',
    },
    {
      name: '--json',
      type: 'boolean',
      required: false,
      description: 'Emit a single JSON envelope (global flag).',
    },
  ],
  examples: [
    { description: 'Field inventory as JSON', command: 'abap fields VRSD --json' },
    { description: 'Human-readable listing', command: 'abap fields VRSD' },
    { description: 'Reverse lookup: tables that record a change user + date', command: 'abap fields --find CHANGED_BY,CHANGED_ON --tabclass TRANSP' },
    { description: 'Reverse lookup: tables with a UNAM field', command: 'abap fields --find UNAM' },
  ],
  errors: [
    { code: 'OBJECT_NOT_FOUND', category: 'NOT_FOUND', exitCode: 8 },
    { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
    { code: 'QUERY_FAILED', category: 'SAP_ERROR', exitCode: 6 },
    { code: 'LIMIT_EXCEEDED', category: 'VALIDATION_ERROR', exitCode: 7 },
  ],
  notes: [
    // S-6: surface the DDIC version-filter conventions so callers do not
    // have to discover them by trial and error (feedback §10 / S-6).
    "DDIC version/status column conventions (active vs inactive rows):",
    "  - DD03L/AS4LOCAL  'A' (active) vs 'I' (inactive / changed). Default 'A'.",
    "  - DD02L/AS4VERS   ' ' (empty = current), 'S' (customer), 'O' (original). Default ' '.",
    "  - REPOSRC/R3STATE 'A' (active source) vs 'I' (inactive). Default 'A'.",
    "  - DDDLSRC/SOURCE_TYPE  'V' (CDS view), 'W' (table function), 'P' (DDLX), etc. Default 'V' for views.",
    "These columns are the canonical filters to scope a query to the current, active version of a DDIC object.",
  ],
};

interface FindFlags {
  find?: string;
  any?: boolean;
  tabclass?: string;
  limit?: string;
  withText?: boolean;
  as4local?: string;
}

export function registerFieldsCommand(program: Command): void {
  program
    .command('fields')
    .description('List DDIC fields of a table (or reverse-lookup tables that contain given fields)')
    // Optional positional so `abap fields --schema` can be evaluated before
    // argument validation; `runFields` / `runFindTablesByFields` reject
    // ambiguous input with USAGE.
    .argument('[table]', 'Table or view name (e.g. VRSD). Required unless --find is given.')
    .option('--find <fields>', 'Reverse lookup: comma-separated field names')
    .option('--any', 'With --find, return tables containing ANY of the fields (default: ALL)')
    .option('--tabclass <class>', 'With --find, restrict to a DDIC table class (TRANSP, VIEW, INTTAB)')
    .option('--limit <n>', 'Max matches for --find (default 200, hard cap 5000)')
    .option('--with-text', 'With --find, include DDIC short text (DD03T/DD04T) for each matched field')
    .option('--as4local <a|i>', "With --find, DDIC version filter (default 'A' = active)")
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (table: string | undefined, opts: FindFlags & { schema?: boolean }, cmd: Command) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema || opts.schema) {
        printSchema(SCHEMA, mode);
        return;
      }
      try {
        if (opts.find && table) {
          throw new CliError('USAGE', '--find is mutually exclusive with a table name', {
            nextSteps: ['Use either a positional table or --find, not both.'],
            examples: ['abap fields VRSD', 'abap fields --find CHANGED_BY,CHANGED_ON'],
          });
        }
        if (opts.find) {
          // Parse comma-separated into a string list. Whitespace is
          // trimmed; empty entries are dropped.
          const fields = String(opts.find)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          const parsedLimit = opts.limit ? Number.parseInt(opts.limit, 10) : undefined;
          const result = await runFindTablesByFields({
            fields,
            requireAll: !opts.any,
            ...(opts.tabclass ? { tabclass: opts.tabclass } : {}),
            ...(parsedLimit !== undefined && Number.isFinite(parsedLimit) ? { limit: parsedLimit } : {}),
            withText: opts.withText === true,
            ...(opts.as4local ? { as4local: opts.as4local.toUpperCase() } : {}),
          });
          printResult(mode, result, formatFindHuman(result));
          return;
        }

        if (!table) {
          throw new CliError('USAGE', 'Either a table name or --find <fields> is required', {
            nextSteps: ['Pass a table name, or use --find for reverse lookup.'],
            examples: ['abap fields VRSD', 'abap fields --find CHANGED_BY,CHANGED_ON'],
          });
        }
        const result = await runFields(table);
        printResult(mode, result, formatFieldsHuman(result));
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}