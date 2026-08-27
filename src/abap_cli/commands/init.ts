import { Command } from 'commander';
import { CliError, printError, printResult, printSchema, jsonFromCommand } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';
import { runInitFromOpts, runInitWizard, runInitShowConfig, runInitUnset } from '../flows/init-flow.js';
import { scaffoldAgents, type AgentTarget } from '../flows/init-agents.js';
import { commandSchemas } from '../flows/command-schemas.js';

/** `abap init` (parent) help: option groups, examples, profile references. */
function initParamHelp(): string {
  return [
    '',
    'Option groups:',
    '  Profile binding:  --profile <name>           (use an existing global profile)',
    '  Workspace:        --tr <transport> --package <pkg> --source-dir <path>',
    '                    (written to .abap.json as defaults; existing file is updated, not replaced)',
    '  Inspect:          --show-config              (print current .abap.json as JSON)',
    '  Clear fields:     --unset-package | --unset-tr | --unset-source-dir',
    '                    (remove a single key from .abap.json; --yes to skip prompt)',
    '  Direct fields:    --url, --client, --username, --password, --language, --insecure, --ca',
    '                    (TTY mode only — non-interactive refuses per FR-022)',
    '  Test/verify:      --test-connection, --test-tls, --test-auth',
    '  Agent scaffold:   --agent copilot|claude|cursor|generic [--force]',
    '  Non-interactive:  --yes / --non-interactive',
    '',
    'Examples:',
    '  # First-time bind (creates .abap.json)',
    '  abap init --profile DEV --tr DEVK900001 --package Z_MY_PACKAGE --yes',
    '',
    '  # Update an existing workspace — change default transport / package only',
    '  abap init --tr DEVK900002 --package Z_NEW --yes',
    '  abap init --profile QA --yes          # rebind to a different profile',
    '',
    '  # Inspect / clear (replaces the former `abap config` command)',
    '  abap init --show-config',
    '  abap init --unset-package --yes',
    '  abap init --unset-tr --unset-source-dir --yes',
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
    .description('Initialize the workspace (bind a profile, write .abap.json) and/or scaffold AI agent context')
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
    .option('--auth-method <method>', 'Login strategy: basic (default) | cert (X.509 client cert, 025) | browser_sso (BTP trial / SAML, 026) | oauth_password (BTP / CF service-key JWT, 027)')
    .option('--auth-option <kv>', 'Generic auth option, repeatable as key=value (e.g. --auth-option certPath=/abs/cert.pem). New auth methods add no Commander options — they read from this bag.')
    .option('--cert-path <path>', 'X.509 client cert file (PEM) — used with --auth-method=cert')
    .option('--cert-key <path>', 'X.509 private key file (PEM) — used with --auth-method=cert')
    .option('--cert-ca <path>', 'Optional X.509 client CA override — used with --auth-method=cert')
    .option('--cert-passphrase <pwd>', 'Passphrase for .p12 / encrypted key — written to keychain')
    .option('--sso-cookie-file <path>', 'SSO cookie jar path — used with --auth-method=browser_sso')
    .option('--service-key <path>', 'BTP service key JSON — used with --auth-method=oauth_password')
    .option('--tr <transport>', 'Default transport number (written to .abap.json)')
    .option('--package <package>', 'Default SAP package (written to .abap.json)')
    .option('--source-dir <path>', 'Base directory for `push --all` / `check --all` (written to .abap.json)')
    .option('--show-config', 'Print the current workspace config (.abap.json) as JSON and exit (read-only; replaces `abap config show`)')
    .option('--unset-package', 'Remove the `package` key from .abap.json')
    .option('--unset-tr', 'Remove the `transport` key from .abap.json')
    .option('--unset-source-dir', 'Remove the `sourceDir` key from .abap.json')
    .option('--test-connection', 'Probe TLS + auth and report results (implies --test-tls --test-auth)')
    .option('--test-tls', 'Probe the TLS handshake')
    .option('--test-auth', 'Probe authentication (after TLS)')
    .option('--agent <target>', `Scaffold agent context files. One of: ${AGENT_VALUES.join(' | ')}`)
    .option('--force', 'Overwrite existing files when scaffolding --agent (default: skip)')
    .option('--yes', 'Skip all prompts; fail if required input is missing (alias: --non-interactive)')
    .option('--non-interactive', 'Alias of --yes')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (opts, cmd) => {
      const mode = jsonFromCommand(cmd);

      // --schema branch — emit machine-readable parameter schema (no SAP call).
      if (cmd.optsWithGlobals().schema) {
        printSchema(commandSchemas['init']!, mode);
        return;
      }

      // --agent can run independently of any profile/workspace fields.
      if (typeof opts.agent === 'string') {
        const target = opts.agent as AgentTarget;
        if (!AGENT_VALUES.includes(target)) {
          printError(mode, new CliError('USAGE',
            `Unknown --agent value '${target}'. Allowed: ${AGENT_VALUES.join(', ')}`,
            { nextSteps: ['Run `abap init --agent copilot` (or claude/cursor/generic).'], example: 'abap init --agent copilot' }));
          return;
        }
        const result = await scaffoldAgents(target, opts.force === true);
        printResult(mode, result, `Scaffolded agent context (${result.written.length} written, ${result.skipped.length} skipped).`);
        return;
      }

      // --show-config: read-only, no SAP call. Works in any mode (TTY / non-TTY).
      if (opts.showConfig === true) {
        try {
          await runInitShowConfig(opts, mode);
        } catch (error: unknown) {
          printError(mode, error);
        }
        return;
      }

      // --unset-*: mutating, needs .abap.json to exist; refuse without --yes in non-TTY.
      const unsetKeys: string[] = [];
      if (opts.unsetPackage === true) unsetKeys.push('package');
      if (opts.unsetTr === true) unsetKeys.push('transport');
      if (opts.unsetSourceDir === true) unsetKeys.push('sourceDir');
      if (unsetKeys.length > 0) {
        try {
          await runInitUnset(unsetKeys, opts.yes === true || opts.nonInteractive === true, mode);
        } catch (error: unknown) {
          printError(mode, error);
        }
        return;
      }

      // Bare `abap init` (no flags) → wizard (TTY).
      // Non-TTY without flags must error: Agent-First does not block on input.
      const hasAnyFlag = Object.keys(opts).length > 0;
      if (!hasAnyFlag) {
        if (!process.stdin.isTTY) {
          printError(mode, new CliError('USAGE',
            'Non-interactive environment detected. Provide flags: --profile/--tr/--package (or --agent).',
            { nextSteps: ["Run 'abap init --profile <name> --yes'.", "Or 'abap init --agent copilot'."], example: 'abap init --profile DEV --yes' }));
          return;
        }
        try {
          await runInitWizard(opts, mode);
        } catch (error: unknown) {
          printError(mode, error);
        }
        return;
      }

      try {
        await runInitFromOpts(opts, mode);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}