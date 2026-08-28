import { Command } from 'commander';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError, printError, printResult, printSchema, jsonFromCommand } from '../output/json.js';
import { computeChangedParts, type ChangedPart } from '../flows/status.js';
import { SEARCH_RESULT_LIMIT } from '../core/limits.js';
import { commandSchemas } from '../flows/command-schemas.js';

interface StatusOptions {
  remoteOnly?: boolean;
  localOnly?: boolean;
  limit?: string;
  since?: string;
  all?: boolean;
}

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show local vs SAP sync status')
    .option('--remote-only', 'Objects on SAP but not locally')
    .option('--local-only', 'Objects locally but not on SAP')
    .option('--limit <n>', `Max result count (default ${SEARCH_RESULT_LIMIT})`)
    .option('--since <iso-date>', 'Compare files modified since date (YYYY-MM-DD[THH:mm:ss])')
    .option('--all', 'Include unchanged objects')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (opts: StatusOptions, cmd) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema) {
        printSchema(commandSchemas['status']!, mode);
        return;
      }
      try {
        const client = await AdtClientWrapper.create();
        const result = await computeChangedParts(client, {
          remoteOnly: opts.remoteOnly,
          localOnly: opts.localOnly,
          limit: opts.limit !== undefined ? parseLimit(opts.limit) : undefined,
          since: opts.since,
          all: opts.all,
        });
        printResult(mode, result, humanSummary(result.changedParts));
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}

function parseLimit(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new CliError('INVALID_ARGUMENT', '--limit must be a positive integer', {
      example: 'abap status --limit 20',
    });
  }
  return n;
}

function humanSummary(parts: ChangedPart[]): string {
  if (parts.length === 0) return 'No differences between local files and SAP.';
  const lines = [`${parts.length} difference(s):`];
  for (const p of parts) {
    lines.push(`  ${p.object} (${p.part}) — ${p.direction}${p.detail ? ` — ${p.detail}` : ''}`);
  }
  return lines.join('\n');
}
