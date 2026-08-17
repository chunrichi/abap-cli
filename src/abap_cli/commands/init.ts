import { Command } from 'commander';
import { CliError, printError, printResult, jsonFromCommand } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';
import { runInitFromOpts, runInitWizard } from '../flows/init-flow.js';
import { scaffoldAgents, type AgentTarget } from '../flows/init-agents.js';

/** `abap init` (parent) help: option groups, examples, profile references. */
function initParamHelp(): string {
  return [
    '',
    'Option groups:',
    '  Profile binding:  --profile <name>           (use an existing global profile)',
    '  Workspace:        --tr <transport> --package <pkg>  (written to .abap.json as defaults)',
    '  Direct fields:    --url, --client, --username, --password, --language, --insecure, --ca',
    '                    (TTY mode only — non-interactive refuses per FR-022)',
    '  Test/verify:      --test-connection, --test-tls, --test-auth',
    '  Agent scaffold:   --agent copilot|claude|cursor|generic [--force]',
    '  Non-interactive:  --yes / --non-interactive',
    '',
    'Examples:',
    '  # Use an existing profile and set default transport & package',
    '  abap init --profile DEV --tr DEVK900001 --package Z_MY_PACKAGE --yes',
    '',
    '  # CI / non-interactive (profile must exist)',
    '  abap profile add CI --url https://... --username CI_USER --password ...',
    '  abap init --profile CI --yes',
    '',
    '  # Scaffold agent context (idempotent)',
    '  abap init --agent copilot',
    '  abap init --agent copilot --force    # overwrite existing files',
    '',
    'Connection profiles:',
    '  --url / --username / --password are accepted only in interactive (TTY) mode.',
    '  In scripts and CI, create a profile once:',
    '    abap profile add <name> --url <url> --username <user> --password <pass>',
    '  Then reference it here:',
    '    abap init --profile <name>',
    '',
    'To switch workspaces to an existing profile later, re-run `abap init --profile <name>`.',
    '',
  ].join('\n');
}

const AGENT_VALUES: AgentTarget[] = ['generic', 'copilot', 'claude', 'cursor'];

export function registerInitCommand(program: Command): void {
  const init = program
    .command('init')
    .description('Initialize the workspace: bind a profile (write .abap.json) and/or scaffold AI agent context. Run bare `abap init` for the interactive wizard.')
    .addHelpText('after', commonErrorsAfter())
    .addHelpText('after', initParamHelp())
    .option('--profile <name>', 'Use an existing global profile (created with `abap profile add`)')
    // Legacy alias (021 deprecation): --system still accepted, prints a hint to migrate.
    .option('--system <name>', 'DEPRECATED: alias of --profile; will be removed')
    .option('--url <url>', 'SAP system URL (TTY mode only)')
    .option('-c, --client <client>', 'SAP client number')
    .option('-u, --username <user>', 'SAP username')
    .option('-p, --password <password>', 'SAP password')
    .option('-l, --language <language>', 'SAP language')
    .option('--insecure', 'Skip SSL certificate verification (development only)')
    .option('--ca <path>', 'Path to a CA certificate (PEM) for SSL verification')
    .option('--tr <transport>', 'Default transport number (written to .abap.json)')
    .option('--package <package>', 'Default SAP package (written to .abap.json)')
    .option('--test-connection', 'Probe TLS + auth and report results (implies --test-tls --test-auth)')
    .option('--test-tls', 'Probe the TLS handshake')
    .option('--test-auth', 'Probe authentication (after TLS)')
    .option('--agent <target>', `Scaffold agent context files. One of: ${AGENT_VALUES.join(' | ')}`)
    .option('--force', 'Overwrite existing files when scaffolding --agent (default: skip)')
    .option('--yes', 'Skip all prompts; fail if required input is missing (alias: --non-interactive)')
    .option('--non-interactive', 'Alias of --yes')
    .action(async (opts, cmd) => {
      const jsonOutput = jsonFromCommand(cmd);

      // --agent can run independently of any profile/workspace fields.
      if (typeof opts.agent === 'string') {
        const target = opts.agent as AgentTarget;
        if (!AGENT_VALUES.includes(target)) {
          printError(jsonOutput, new CliError('USAGE',
            `Unknown --agent value '${target}'. Allowed: ${AGENT_VALUES.join(', ')}`,
            { nextSteps: ['Run `abap init --agent copilot` (or claude/cursor/generic).'], example: 'abap init --agent copilot' }));
          return;
        }
        const result = await scaffoldAgents(target, opts.force === true);
        printResult(jsonOutput, result, `Scaffolded agent context (${result.written.length} written, ${result.skipped.length} skipped).`);
        return;
      }

      // Bare `abap init` (no flags) → wizard (TTY).
      // Non-TTY without flags must error: Agent-First does not block on input.
      const hasAnyFlag = Object.keys(opts).length > 0;
      if (!hasAnyFlag) {
        if (!process.stdin.isTTY) {
          printError(jsonOutput, new CliError('USAGE',
            'Non-interactive environment detected. Provide flags: --profile/--tr/--package (or --agent).',
            { nextSteps: ["Run 'abap init --profile <name> --yes'.", "Or 'abap init --agent copilot'."], example: 'abap init --profile DEV --yes' }));
          return;
        }
        try {
          await runInitWizard(opts, jsonOutput);
        } catch (error: unknown) {
          printError(jsonOutput, error);
        }
        return;
      }

      try {
        await runInitFromOpts(opts, jsonOutput);
      } catch (error: unknown) {
        printError(jsonOutput, error);
      }
    });
}