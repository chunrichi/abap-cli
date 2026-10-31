import { Command } from 'commander';
import { CliError, printError, printResult, printSchema, jsonFromCommand } from '../output/json.js';
import { typeCatalog, tadirObjectFor, type TadirMapping } from '../flows/setup/types-catalog.js';

export const SCHEMA = {
  schemaVersion: 1,
  command: 'types',
  description:
    'Print the canonical CLI type ↔ TADIR PGMID/OBJECT ↔ DDIC tabclass mapping. ' +
    'Pure local — no SAP call. Surfaces the non-obvious mappings that cost real ' +
    'time when joining CLI write paths to TADIR queries (CLI HTTP ↔ TADIR SICF, ' +
    'CLI STRU ↔ TADIR TABL + DD02L-TABCLASS=INTTAB, etc.).',
  usage: 'abap types [--json] | abap types <type> [--json]',
  scope: 'local',
  arguments: [
    {
      name: 'type',
      type: 'string',
      required: false,
      description: 'Optional CLI type code to look up (e.g., STRU, HTTP, PROG).',
    },
  ],
  options: [
    {
      name: '--tadir-object',
      type: 'boolean',
      required: false,
      description: 'With a single type, print only the TADIR OBJECT value (one line, no table).',
    },
    {
      name: '--json',
      type: 'boolean',
      required: false,
      description: 'Emit a single JSON envelope (global flag).',
    },
  ],
  examples: [
    { description: 'Print the full type catalog', command: 'abap types' },
    { description: 'Look up a single type', command: 'abap types HTTP' },
    { description: 'Print only the TADIR object for STRU (for use in scripts)', command: 'abap types STRU --tadir-object' },
  ],
  errors: [
    { code: 'USAGE', category: 'USAGE', exitCode: 2 },
    { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
  ],
};

interface CliTypesOptions {
  tadirObject?: boolean;
}

export function registerTypesCommand(program: Command): void {
  program
    .command('types')
    .description('Print the CLI type ↔ TADIR / DDIC mapping (local, no SAP call)')
    .argument('[type]', 'Optional CLI type code to look up')
    .option('--tadir-object', 'With a single type, print only the TADIR OBJECT value')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (type: string | undefined, opts: CliTypesOptions & { schema?: boolean }, cmd: Command) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema || opts.schema) {
        printSchema(SCHEMA, mode);
        return;
      }
      try {
        const all = typeCatalog();

        if (type) {
          const upper = type.toUpperCase();
          const hit = all.find((r) => r.cliType === upper);
          if (!hit) {
            throw new CliError('USAGE', `Unknown CLI type code '${type}'`, {
              nextSteps: [
                'Run `abap types` for the full catalog.',
                `Known codes: ${all.map((r) => r.cliType).join(', ')}`,
              ],
            });
          }
          if (opts.tadirObject) {
            // One-line output for shell pipelines: just the TADIR OBJECT.
            // Wrap in JSON envelope when --json is also set so script
            // consumers can parse either way.
            printResult(mode, { type: hit.cliType, tadirObject: hit.tadirObject }, hit.tadirObject);
            return;
          }
          printResult(mode, hit, formatSingleTypeHuman(hit));
          return;
        }

        printResult(mode, all, formatTypesHuman(all));
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}

/** Human rendering for the full catalog. */
function formatTypesHuman(rows: TadirMapping[]): string {
  const lines: string[] = [
    `abap-cli type catalog (${rows.length} entries)`,
    '',
    '  CLI   TADIR OBJECT   DDIC tabclass   CHANNEL  AFF SCHEMA          DESCRIPTION',
  ];
  for (const r of rows) {
    const tadir = r.tadirObject.padEnd(13);
    const tabclass = (r.ddicTabclass || '—').padEnd(14);
    const channel = r.channel.padEnd(8);
    const schema = r.affSchema.padEnd(19);
    lines.push(`  ${r.cliType.padEnd(6)} ${tadir} ${tabclass} ${channel} ${schema} ${r.description}`);
  }
  return lines.join('\n');
}

/** Human rendering for a single lookup. */
function formatSingleTypeHuman(r: TadirMapping): string {
  return [
    `${r.cliType}`,
    `  TADIR OBJECT     : ${r.tadirObject}`,
    `  DDIC tabclass    : ${r.ddicTabclass || '—'}`,
    `  Routing channel  : ${r.channel}`,
    `  AFF schema       : ${r.affSchema}`,
    `  Description      : ${r.description}`,
  ].join('\n');
}