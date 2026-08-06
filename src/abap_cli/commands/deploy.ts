import { Command } from 'commander';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError, printError, printResult, jsonFromCommand } from '../output/json.js';
import { collectWarning } from '../output/meta.js';
import { commonErrorsAfter } from '../output/help-text.js';
import { resolveTransport } from '../flows/transport.js';
import { deployBundled, type DeploymentSummary } from '../flows/deploy-flow.js';

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
    .option('--tr <transport>', 'Transport number (required when --package is not $TMP)')
    .option('--package <package>', 'Target SAP package (default $TMP — local, no transport needed)', '$TMP')
    .option('--dry-run', 'Plan only — make no mutating SAP calls')
    .option('--diff', 'Report per-file source differences')
    .option('--force', 'Bypass safety guards (notes forced: true in the result)')
    .option('--yes', 'Confirm the deployment in non-interactive mode')
    .action(async (opts: DeployOptions, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        const targetPackage = (opts.package ?? '$TMP').trim().toUpperCase();
        if (targetPackage !== '$TMP' && !opts.tr) {
          throw new CliError(
            'NO_TRANSPORT',
            `--tr <transport> is required when --package is ${targetPackage} (only $TMP is transport-free)`,
            {
              nextSteps: [
                'Re-run with --tr <request> (e.g. --tr NDK123456).',
                `Or use --package $TMP for local objects (no transport needed).`,
              ],
              example: `abap deploy --package ${targetPackage} --tr NDK123456 --yes`,
            },
          );
        }
        const client = await AdtClientWrapper.create();
        const transport = opts.dryRun
          ? (opts.tr ?? client.getConfig().transport ?? 'DRY_RUN')
          : await resolveTransport(
              client,
              opts.tr,
              client.getConfig().transport,
              { transportOptional: targetPackage === '$TMP' },
            );
        const summary = await deployBundled(client, {
          transport,
          dryRun: opts.dryRun,
          diff: opts.diff,
          force: opts.force,
          yes: opts.yes,
          package: targetPackage,
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
  if (summary.objects.length > 0) {
    lines.push(`Objects (${summary.objects.length}):`);
    for (const o of summary.objects) {
      const reason = o.reason ? ` — ${o.reason}` : '';
      lines.push(`  ${o.object} (${o.type}) — ${o.status}${reason}`);
    }
  }
  if (summary.files.length > 0) {
    lines.push(`Files (${summary.files.length}):`);
    for (const f of summary.files) {
      const reason = f.reason ? ` — ${f.reason}` : '';
      const changed = f.changed !== undefined ? ` (changed: ${f.changed})` : '';
      lines.push(`  ${f.file} — ${f.status}${changed}${reason}`);
    }
  } else if (summary.objects.length === 0) {
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
