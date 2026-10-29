/**
 * `abap deploy` flow — bundled ICF service deployment and its status probe.
 *
 * Owns the transport/package guards (only $TMP is transport-free, and $TMP must
 * never silently land in a user transport), the deployment summary rendering and
 * the `deploy status` interpretation (installed / current / outdated /
 * unreachable). The command layer only declares options and prints the result.
 */
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError } from '../../output/json.js';
import { collectWarning } from '../../output/meta.js';
import { resolveTransport } from '../../core/transport.js';
import { deployBundled, type DeploymentSummary } from './deploy.js';
import { checkIcfDeployment, ICF_SERVICE_VERSION } from '../../clients/icf-version.js';
import { loadConfig } from '../../config/project-config.js';

export interface DeployRunOptions {
  tr?: string;
  package?: string;
  dryRun?: boolean;
  diff?: boolean;
  force?: boolean;
  yes?: boolean;
}

/** Flow outcome: JSON envelope data + human summary, printed by the command layer. */
export interface DeployResult {
  data: Record<string, unknown>;
  human: string;
}

export async function runDeploy(opts: DeployRunOptions): Promise<DeployResult> {
  const targetPackage = (opts.package ?? '$TMP').trim().toUpperCase();
  if (targetPackage !== '$TMP' && !opts.tr) {
    throw new CliError(
      'NO_TRANSPORT',
      `--tr <transport> is required when --package is ${targetPackage} (only $TMP is transport-free)`,
      {
        nextSteps: [
          'Re-run with --tr <request> (e.g. --tr NDK123456).',
          'Or use --package $TMP for local objects (no transport needed).',
        ],
        example: `abap deploy --package ${targetPackage} --tr NDK123456 --yes`,
      },
    );
  }
  const client = await AdtClientWrapper.create();
  const projectConfig = client.getConfig();
  // When --package $TMP (local objects), NEVER use a transport. The
  // previous `transportOptional: true` flag was a footgun — `resolveTransport`
  // still preferred the user's first modifiable request before falling back
  // to '', so the new gc_version / source landed in a user transport instead
  // of $TMP. The transport's release/import gate then made `deploy status`
  // read back the old `gc_version` forever ("outdated" deadlock even after
  // re-deploying). $TMP is local — push source straight to the active object.
  if (targetPackage === '$TMP' && opts.tr) {
    throw new CliError(
      'NO_TRANSPORT',
      '--tr cannot be combined with --package $TMP (local objects do not need a transport)',
      {
        nextSteps: [
          'Re-run without --tr (the ICF sources are local in $TMP).',
          'Or use --package <custom> --tr <request> for a transportable deploy.',
        ],
        example: 'abap deploy --package $TMP --yes',
      },
    );
  }
  const transport = opts.dryRun
    ? (opts.tr ?? projectConfig.transport ?? 'DRY_RUN')
    : targetPackage === '$TMP'
      ? ''
      : await resolveTransport(client, opts.tr, projectConfig.transport);
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
  return { data: summary as unknown as Record<string, unknown>, human: humanSummary(summary) };
}

export async function runDeployStatus(): Promise<DeployResult> {
  const projectConfig = await loadConfig();
  const info = await checkIcfDeployment(projectConfig.systemName);
  if (info.status === 'unreachable') {
    collectWarning('ICF_CHECK_DEGRADED', `ICF status probe degraded: ${info.error?.message ?? 'unreachable'}`);
  }
  const data = {
    // F-19: only a positively confirmed 404/not-found means the service is
    // absent. A failed probe (timeout, connection error) leaves the install
    // state unknown → null, instead of falsely claiming `installed:false`.
    installed: info.status === 'unreachable' ? null : info.status !== 'not_deployed',
    status: info.status,
    probeFailed: info.probeFailed === true,
    remoteVersion: info.remoteVersion ?? null,
    expectedVersion: info.expectedVersion,
    match: info.status === 'current',
    // Runtime tier + whether cl_icf_tree is blocked (Steampunk).
    runtime: info.runtime ?? 'unknown',
    icfSetupBlocked: info.icfSetupBlocked === true,
  };
  const runtimeHint = info.runtime === 'steampunk'
    ? ' (Steampunk: SICF service cannot be auto-registered, expose via Cloud Foundry destination — see wiki/commands/deploy.md#steampunk)'
    : '';
  // When the remote gc_version is older than the bundled one and a
  // normal `deploy` was already attempted, the most likely
  // cause is that the new source landed in a user-owned transport (so
  // $TMP's active object is still the old version). Surface that as an
  // actionable nextStep alongside the "run deploy" hint.
  if (info.status === 'outdated') {
    collectWarning(
      'ICF_OUTDATED_DEADLOCK',
      `ICF service reports gc_version ${info.remoteVersion} but expected ${info.expectedVersion}.`,
      {
        nextSteps: [
          'Run: abap transport list --open — if a transport contains ZCL_ABAP_VIBE_*, release it and re-import to $TMP.',
          'Then run: abap deploy --yes (it now forces --package $TMP to bypass user transports).',
          'Verify with: abap deploy status',
        ],
      },
    );
  }
  const hint = info.status === 'not_deployed'
    ? `ICF service not deployed${runtimeHint}. Run \`abap deploy\` to install it.`
    : info.status === 'outdated'
      ? `ICF service outdated (have ${info.remoteVersion}, need ${ICF_SERVICE_VERSION})${runtimeHint}. Run \`abap deploy\` to upgrade.`
      : info.status === 'unreachable'
        ? `ICF status probe failed: ${info.error?.message ?? 'unknown'}. This is a probe failure, NOT a confirmed absence — it does NOT mean the ICF service is uninstalled or that ADT is unavailable. Re-run \`abap deploy status\` to retry.`
        : `ICF service deployed and current (version ${info.remoteVersion}).`;
  return { data, human: hint };
}

/** Human-readable deploy summary. */
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
