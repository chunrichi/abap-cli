import { Command } from 'commander';
import { originalArgv } from '../output/meta.js';
import { CliError, printError, jsonFromCommand } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';
import { runConfigFromOpts, runConfigWizard } from '../flows/config-flow.js';

/** `abap config` (parent) help: option groups, examples, connection profiles. */
function configParamHelp(): string {
  return [
    '',
    'Option groups:',
    '  Connection:      --system, --url, --client, --username, --password, --language, --insecure, --ca',
    '  Workspace:       --tr, --package  (written to .abap.json as defaults)',
    '  Test/verify:     --test-connection, --test-tls, --test-auth',
    '  Interactive:     --yes / --non-interactive',
    '',
    'Examples:',
    '  # Use an existing profile and set default transport & package',
    '  abap config --system DEV --tr DEVK900001 --package Z_MY_PACKAGE',
    '',
    '  # CI / non-interactive (profile must exist)',
    '  abap connection add CI --url https://... --username CI_USER --password ...',
    '  abap config --system CI --yes',
    '',
    '  # Run the interactive wizard instead of passing parameters',
    '  abap config init',
    '',
    'Connection profiles:',
    '  --url / --username / --password are accepted only in interactive mode.',
    '  In scripts and CI, create a profile once:',
    '    abap connection add <name> --url <url> --username <user> --password <pass>',
    '  Then reference it here:',
    '    abap config --system <name>',
    '',
  ].join('\n');
}

/** `abap config init` (wizard) help. */
function configInitHelpBlocks(): string {
  return [
    '',
    'The wizard prompts you to either select an existing system profile or create',
    'a new one, then writes .abap.json in the current directory. No flags are',
    'accepted — to pass parameters directly, use `abap config <flags>` instead.',
    '',
    'Equivalent flow:',
    '  abap config init             # interactive wizard (TTY only)',
    '  abap config --system DEV     # non-interactive write',
    '',
  ].join('\n');
}

export function registerConfigCommand(program: Command): void {
  const config = program
    .command('config')
    .description('Configure the workspace: write .abap.json from a system profile, or create one from full connection params. Run `abap config init` for the interactive wizard.')
    .addHelpText('after', commonErrorsAfter())
    .addHelpText('after', configParamHelp())
    .option('--system <name>', 'Use an existing system profile (created with `abap connection add`)')
    .option('--url <url>', 'SAP system URL (interactive mode only)')
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
    .option('--yes', 'Skip all prompts; fail if required input is missing (alias: --non-interactive)')
    .option('--non-interactive', 'Alias of --yes')
    .action(async (opts, cmd) => {
      // Bare `abap config` (no flag) prints the subcommand help, like `abap connection` does.
      if (Object.keys(opts).length === 0) {
        console.log(cmd.helpInformation());
        return;
      }
      const jsonOutput = jsonFromCommand(cmd);
      try {
        await runConfigFromOpts(opts, jsonOutput);
      } catch (error: unknown) {
        printError(jsonOutput, error);
      }
    });

  config
    .command('init')
    .description('Interactive wizard: prompts to select or create a system profile, then writes .abap.json. Does not accept any flags.')
    .addHelpText('after', configInitHelpBlocks())
    .action(async (opts, cmd) => {
      // Reject config-only flags after `config init` — the wizard accepts no
      // parameters. Global flags (--json, --report-stuck, --help) are ignored.
      // commander has already mutated process.argv by now, so we read the
      // snapshot taken at module load (output/meta.ts#originalArgv).
      const configFlags = new Set([
        '--system', '--url', '-c', '--client', '-u', '--username', '-p', '--password',
        '-l', '--language', '--insecure', '--ca', '--tr', '--package',
        '--test-connection', '--test-tls', '--test-auth', '--yes', '--non-interactive',
      ]);
      const initIdx = originalArgv.indexOf('init');
      const trailing = initIdx >= 0 ? originalArgv.slice(initIdx + 1) : [];
      const userFlags: string[] = [];
      for (let i = 0; i < trailing.length; i++) {
        const a = trailing[i]!;
        if (a.startsWith('-')) {
          // Include the value of `-x value` style short flags; commander
          // doesn't know the user passed it because we didn't define it.
          if (/^-[a-z]$/i.test(a) && i + 1 < trailing.length && !trailing[i + 1]!.startsWith('-')) {
            userFlags.push(a, trailing[i + 1]!);
            i++;
          } else {
            userFlags.push(a);
          }
        }
      }
      const offending = userFlags.filter((f) => configFlags.has(f));
      if (offending.length > 0) {
        throw new CliError(
          'USAGE',
          `abap config init does not accept flags. Got: ${offending.join(' ')}. Use \`abap config <flags>\` to pass parameters directly.`,
          {
            nextSteps: [
              'Drop the flags and run `abap config init` to enter the wizard.',
              'Or run `abap config --system <name>` to write .abap.json from parameters.',
            ],
            example: 'abap config init',
          },
        );
      }
      const jsonOutput = jsonFromCommand(cmd);
      try {
        await runConfigWizard(opts, jsonOutput);
      } catch (error: unknown) {
        printError(jsonOutput, error);
      }
    });
}
