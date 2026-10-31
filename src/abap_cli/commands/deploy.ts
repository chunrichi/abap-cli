/**
 * `deploy` command — bundled ICF ABAP service deployment.
 *
 * Declares `deploy` + `deploy status` and prints the flow result; the
 * transport/package guards and summary rendering live in
 * `flows/edit/deploy-flow.ts`.
 */
import { Command } from 'commander';
import { printError, printResult, printSchema, jsonFromCommand, type CommandSchema } from '../output/json.js';
import { runDeploy, runDeployStatus, type DeployRunOptions } from '../flows/edit/deploy-flow.js';
import { baseSchema, schemaOption } from './schema-helpers.js';

export const SCHEMA: CommandSchema = {
  ...baseSchema('deploy', 'Deploy bundled ICF ABAP service to SAP.', 'abap deploy [options] | abap deploy status [options]', 'sap'),
  arguments: [],
  options: [
    { name: '--tr', type: 'string', valuePlaceholder: '<transport>', description: 'Transport number (required when --package is not $TMP).' },
    { name: '--package', type: 'string', valuePlaceholder: '<package>', default: '$TMP', description: 'Target SAP package (default $TMP — local, no transport needed).' },
    { name: '--dry-run', type: 'boolean', description: 'Plan only — make no mutating SAP calls.' },
    { name: '--diff', type: 'boolean', description: 'Report per-file source differences.' },
    { name: '--dev', type: 'boolean', description: 'Deploy the global-class development form (maintainers; skips the release merge).' },
    { name: '--force', type: 'boolean', description: 'Bypass safety guards (forced: true in the result).' },
    { name: '--yes', type: 'boolean', description: 'Confirm in non-interactive mode.' },
    schemaOption(),
  ],
  examples: [
    { description: 'Deploy to $TMP (no transport)', command: 'abap deploy --yes' },
    { description: 'Deploy the global-class development form (maintainers)', command: 'abap deploy --dev --yes' },
    { description: 'Deploy to a custom package', command: 'abap deploy --package ZPKG --tr DEVK900001 --yes' },
    { description: 'Read-only status probe', command: 'abap deploy status' },
  ],
  errors: [
    { code: 'NO_TRANSPORT', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'SAP_ERROR', category: 'SAP_ERROR', exitCode: 6 },
    { code: 'DEPLOY_MANIFEST_INVALID', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'DEPLOY_MERGE_FAILED', category: 'VALIDATION_ERROR', exitCode: 7 },
  ],
};

type DeployOptions = DeployRunOptions & { schema?: boolean };

/** Apply the canonical deploy option set to a commander command. */
function applyDeployOptions(cmd: Command): Command {
  return cmd
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .option('--tr <transport>', 'Transport number (required when --package is not $TMP)')
    .option('--package <package>', 'Target SAP package (default $TMP — local, no transport needed)', '$TMP')
    .option('--dry-run', 'Plan only — make no mutating SAP calls')
    .option('--diff', 'Report per-file source differences')
    .option('--dev', 'Deploy the global-class development form (maintainers; skips the release merge)')
    .option('--force', 'Bypass safety guards')
    .option('--yes', 'Confirm in non-interactive mode');
}

/** Register `deploy` and the `deploy status` subcommand on the root program. */
export function registerDeployCommand(program: Command): void {
  const deploy = applyDeployOptions(
    program
      .command('deploy')
      .description('Deploy bundled ICF ABAP service to SAP'),
  );
  deploy.action(async (opts: DeployOptions, cmd) => {
    const mode = jsonFromCommand(cmd);
    if (cmd.optsWithGlobals().schema || opts.schema) {
      printSchema(SCHEMA, mode);
      return;
    }
    try {
      const result = await runDeploy(opts);
      printResult(mode, result.data, result.human);
    } catch (error: unknown) {
      printError(mode, error);
    }
  });

  const status = deploy
    .command('status')
    .description('Probe the SAP-side ICF service installation');
  status.action(async (_opts, cmd) => {
    const mode = jsonFromCommand(cmd);
    try {
      const result = await runDeployStatus();
      printResult(mode, result.data, result.human);
    } catch (error: unknown) {
      printError(mode, error);
    }
  });
}
