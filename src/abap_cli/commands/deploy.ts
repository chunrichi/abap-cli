import { Command } from 'commander';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { printError, printResult, jsonFromCommand } from '../output/json.js';
import { collectWarning } from '../output/meta.js';
import { commonErrorsAfter } from '../output/help-text.js';
import { resolveTransport } from '../sync/transport.js';
import { deployBundled, type DeploymentSummary } from '../sync/deploy-flow.js';

interface DeployOptions {
  tr?: string;
  package?: string;
  dryRun?: boolean;
  diff?: boolean;
  force?: boolean;
  yes?: boolean;
}

export function registerDeployCommand(program: Command): void {
  program
    .command('deploy')
    .description('Deploy bundled ICF ABAP service to SAP system (--dry-run/--diff preview available)')
    .addHelpText('after', commonErrorsAfter())
    .option('--tr <transport>', 'Transport number')
    .option('--package <package>', 'Target SAP package', 'ZABAP_VIBE')
    .option('--dry-run', 'Plan only — make no mutating SAP calls')
    .option('--diff', 'Report per-file source differences')
    .option('--force', 'Bypass safety guards (notes forced: true in the result)')
    .option('--yes', 'Confirm the deployment in non-interactive mode')
    .action(async (opts: DeployOptions, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        const client = await AdtClientWrapper.create();
        const transport = opts.dryRun
          ? (opts.tr ?? client.getConfig().transport ?? 'DRY_RUN')
          : await resolveTransport(client, opts.tr, client.getConfig().transport);
        const summary = await deployBundled(client, {
          transport,
          dryRun: opts.dryRun,
          diff: opts.diff,
          force: opts.force,
          yes: opts.yes,
        });
        if (opts.force) {
          collectWarning('FORCE_BYPASSED', '--force bypassed safety guards.', { force: true });
        }
        printResult(json, summary, humanSummary(summary));
      } catch (error: unknown) {
        printError(json, error);
      }
    });
}

function humanSummary(summary: DeploymentSummary): string {
  const lines: string[] = [];
  if (summary.files.length > 0) {
    lines.push(`Deploy ${summary.dryRun ? 'plan' : 'result'} (${summary.files.length} file(s)):`);
    for (const f of summary.files) {
      const reason = f.reason ? ` — ${f.reason}` : '';
      const changed = f.changed !== undefined ? ` (changed: ${f.changed})` : '';
      lines.push(`  ${f.file} — ${f.status}${changed}${reason}`);
    }
  } else {
    lines.push('No bundled sources to deploy.');
  }
  if (summary.icfNode) {
    const node = summary.icfNode;
    if (node.status === 'planned') {
      lines.push('ICF node: planned (setup will run on actual deploy)');
    } else if (node.status === 'success') {
      lines.push(`ICF node: ${node.status} (${node.action}) — ${node.url} active=${node.active}`);
    } else {
      lines.push(`ICF node: ${node.status}`);
    }
  }
  if (summary.forced) lines.push('(forced)');
  return lines.join('\n');
}
