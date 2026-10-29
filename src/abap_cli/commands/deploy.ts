/**
 * `deploy` command — bundled ICF ABAP service deployment.
 *
 * Declares `deploy` + `deploy status` and prints the flow result; the
 * transport/package guards and summary rendering live in
 * `flows/edit/deploy-flow.ts`.
 */
import { Command } from 'commander';
import { printError, printResult, printSchema, jsonFromCommand } from '../output/json.js';
import { commandSchemas } from '../flows/setup/command-schemas.js';
import { runDeploy, runDeployStatus, type DeployRunOptions } from '../flows/edit/deploy-flow.js';

type DeployOptions = DeployRunOptions & { schema?: boolean };

/** Apply the canonical deploy option set to a commander command. */
function applyDeployOptions(cmd: Command): Command {
  return cmd
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .option('--tr <transport>', 'Transport number (required when --package is not $TMP)')
    .option('--package <package>', 'Target SAP package (default $TMP — local, no transport needed)', '$TMP')
    .option('--dry-run', 'Plan only — make no mutating SAP calls')
    .option('--diff', 'Report per-file source differences')
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
      printSchema(commandSchemas['deploy']!, mode);
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
