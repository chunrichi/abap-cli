import { Command } from 'commander';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { planSync } from '../sync/sync-flow.js';
import { CliError, printError, printResult, jsonFromCommand } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';

interface SyncOptions {
  status?: boolean;
  pull?: boolean;
  push?: boolean;
  dryRun?: boolean;
  yes?: boolean;
}

export function registerSyncCommand(program: Command): void {
  program
    .command('sync')
    .description('Chain status / pull / push into one workflow')
    .addHelpText('after', commonErrorsAfter())
    .option('--status', 'Report local↔SAP state (default)')
    .option('--pull', 'Pull remote-only + divergent changes down')
    .option('--push', 'Push local changes up (divergent requires --yes)')
    .option('--dry-run', 'Plan only — no mutating SAP calls')
    .option('--yes', 'Confirm a push that touches divergent changes')
    .action(async (opts: SyncOptions, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        const directions = [opts.status ? 'status' : null, opts.pull ? 'pull' : null, opts.push ? 'push' : null].filter(Boolean);
        if (directions.length > 1) {
          throw new CliError('INVALID_ARGUMENT', 'sync accepts exactly one direction flag (--status | --pull | --push).', {
            nextSteps: ['Pick one direction: abap sync --status / --pull / --push'],
            example: 'abap sync --pull --dry-run',
          });
        }
        const direction = (directions[0] ?? 'status') as 'status' | 'pull' | 'push';
        const client = await AdtClientWrapper.create();
        const result = await planSync(client, { direction, dryRun: opts.dryRun, yes: opts.yes });
        const human = [
          `sync ${direction}${result.dryRun ? ' (dry-run)' : ''}:`,
          ...result.parts.map((p) => `  ${p.object} (${p.part}): ${p.status}${p.reason ? ` — ${p.reason}` : ''}`),
          ...result.nextSteps.map((s) => `  → ${s}`),
        ].join('\n');
        printResult(json, result, human);
      } catch (error: unknown) {
        printError(json, error);
      }
    });
}
