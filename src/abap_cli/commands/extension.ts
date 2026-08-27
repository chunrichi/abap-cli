import { Command } from 'commander';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError, printError, printResult, printSchema, jsonFromCommand } from '../output/json.js';
import { collectWarning } from '../output/meta.js';
import { commonErrorsAfter } from '../output/help-text.js';
import { resolveTransport } from '../core/transport.js';
import { deployBundled, type DeploymentSummary } from '../flows/deploy-flow.js';
import { checkIcfDeployment, ICF_SERVICE_VERSION } from '../icf/service-version.js';
import { loadConfig } from '../config/project-config.js';
import { commandSchemas } from '../flows/command-schemas.js';

interface DeployOptions {
  tr?: string;
  package?: string;
  dryRun?: boolean;
  diff?: boolean;
  force?: boolean;
  yes?: boolean;
}

export function registerExtensionCommand(program: Command): void {
  const extension = program
    .command('extension')
    .description('Manage the bundled ICF ABAP extension (deploy / status)')
    .addHelpText('after', commonErrorsAfter())
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action((_opts, cmd) => {
      if (cmd.optsWithGlobals().schema) {
        printSchema(commandSchemas['extension']!, jsonFromCommand(cmd));
        return;
      }
      // Bare `abap extension` prints subcommand help.
      console.log(cmd.helpInformation());
    });

  extension
    .command('deploy')
    .description('Deploy bundled ICF ABAP service to SAP')
    .option('--tr <transport>', 'Transport number (required when --package is not $TMP)')
    .option('--package <package>', 'Target SAP package (default $TMP — local, no transport needed)', '$TMP')
    .option('--dry-run', 'Plan only — make no mutating SAP calls')
    .option('--diff', 'Report per-file source differences')
    .option('--force', 'Bypass safety guards')
    .option('--yes', 'Confirm in non-interactive mode')
    .action(async (opts: DeployOptions, cmd) => {
      const mode = jsonFromCommand(cmd);
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
              example: `abap extension deploy --package ${targetPackage} --tr NDK123456 --yes`,
            },
          );
        }
        const client = await AdtClientWrapper.create();
        const projectConfig = client.getConfig();
        const transport = opts.dryRun
          ? (opts.tr ?? projectConfig.transport ?? 'DRY_RUN')
          : await resolveTransport(
              client,
              opts.tr,
              projectConfig.transport,
              { transportOptional: targetPackage === '$TMP' },
            );
        const summary = await deployBundled(client, {
          transport,
          dryRun: opts.dryRun,
          diff: opts.diff,
          force: opts.force,
          yes: opts.yes,
          package: targetPackage,
          profileName: projectConfig.systemName,
        });
        if (opts.force) {
          collectWarning('FORCE_BYPASSED', '--force bypassed safety guards.', { force: true });
        }
        printResult(mode, summary, humanSummary(summary));
      } catch (error: unknown) {
        printError(mode, error);
      }
    });

  extension
    .command('status')
    .description('Probe the SAP-side ICF extension installation')
    .action(async (_opts, cmd) => {
      const mode = jsonFromCommand(cmd);
      try {
        const projectConfig = await loadConfig();
        const info = await checkIcfDeployment(projectConfig.systemName);
        if (info.status === 'unreachable') {
          collectWarning('ICF_CHECK_DEGRADED', `ICF status probe degraded: ${info.error?.message ?? 'unreachable'}`);
        }
        const data = {
          installed: info.status !== 'not_deployed' && info.status !== 'unreachable',
          status: info.status,
          remoteVersion: info.remoteVersion ?? null,
          expectedVersion: info.expectedVersion,
          match: info.status === 'current',
          // 030: runtime tier + whether cl_icf_tree is blocked (Steampunk).
          runtime: info.runtime ?? 'unknown',
          icfSetupBlocked: info.icfSetupBlocked === true,
        };
        const runtimeHint = info.runtime === 'steampunk'
          ? ' (Steampunk: SICF service cannot be auto-registered, expose via Cloud Foundry destination — see wiki/commands/extension.md#steampunk)'
          : '';
        const hint = info.status === 'not_deployed'
          ? `ICF service not deployed${runtimeHint}. Run \`abap extension deploy\` to install it.`
          : info.status === 'outdated'
            ? `ICF service outdated (have ${info.remoteVersion}, need ${ICF_SERVICE_VERSION})${runtimeHint}. Run \`abap extension deploy\` to upgrade.`
            : info.status === 'unreachable'
              ? `ICF unreachable: ${info.error?.message ?? 'unknown'}`
              : `ICF service deployed and current (version ${info.remoteVersion}).`;
        printResult(mode, data, hint);
      } catch (error: unknown) {
        printError(mode, error);
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
  if (summary.deployKind) {
    lines.push(`Deploy kind: ${summary.deployKind}${summary.runtime ? ` (runtime: ${summary.runtime})` : ''}`);
  }
  if (summary.forced) lines.push('(forced)');
  return lines.join('\n');
}