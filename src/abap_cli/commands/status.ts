import { Command } from 'commander';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError, printError, printResult, jsonFromCommand } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';
import { computeChangedParts, type ChangedPart } from '../sync/status.js';
import { SEARCH_RESULT_LIMIT } from '../sync/resolve.js';

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
    .description('Show differences between local files and SAP system (changed parts)')
    .addHelpText('after', commonErrorsAfter())
    .option('--remote-only', 'Show only objects that exist on SAP but not locally')
    .option('--local-only', 'Show only objects that exist locally but not on SAP')
    .option('--limit <n>', `Maximum result count (default ${SEARCH_RESULT_LIMIT})`)
    .option('--since <iso-date>', 'Only compare local files modified since this date (YYYY-MM-DD[THH:mm:ss])')
    .option('--all', 'Include unchanged objects')
    .action(async (opts: StatusOptions, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        const client = await AdtClientWrapper.create();
        const result = await computeChangedParts(client, {
          remoteOnly: opts.remoteOnly,
          localOnly: opts.localOnly,
          limit: opts.limit !== undefined ? parseLimit(opts.limit) : undefined,
          since: opts.since,
          all: opts.all,
        });
        printResult(json, result, humanSummary(result.changedParts));
      } catch (error: unknown) {
        printError(json, error);
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
