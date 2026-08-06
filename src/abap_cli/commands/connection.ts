import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { printError, printResult, jsonFromCommand, CliError } from '../output/json.js';
import { collectWarning } from '../output/meta.js';
import { commonErrorsAfter } from '../output/help-text.js';
import { exportProfiles, importProfiles, type ProfileBundle } from '../config/profiles.js';
import { runList, runShow, runUse, runTest, runDelete } from '../flows/connection-flow.js';
import { runAdd, runSet } from '../flows/connection-profile.js';

export function registerConnectionCommand(program: Command): void {
  const connection = program
    .command('connection')
    .description('Manage global connection profiles')
    .addHelpText('after', commonErrorsAfter())
    .action((_opts, cmd) => {
      // Bare `abap connection` prints the subcommand help (exit 0), like bare `abap`.
      console.log(cmd.helpInformation());
    });

  connection
    .command('list')
    .description('List all saved connection profiles')
    .action((_opts, cmd) => {
      runList(jsonFromCommand(cmd));
    });

  connection
    .command('show <name>')
    .description('Show details of a connection profile')
    .action(async (name: string, _opts, cmd) => {
      try {
        await runShow(name, jsonFromCommand(cmd));
      } catch (error: unknown) {
        handleError(jsonFromCommand(cmd), error);
      }
    });

  connection
    .command('add <name>')
    .description('Create a new connection profile')
    .option('--url <url>', 'SAP system URL')
    .option('-c, --client <client>', 'SAP client number')
    .option('-u, --username <user>', 'SAP username')
    .option('-l, --language <lang>', 'SAP language')
    .option('-p, --password <password>', 'Password (stores credential in keychain)')
    .option('--insecure', 'Skip SSL certificate verification (self-signed certs, development only)')
    .option('--ca <path>', 'Path to a CA certificate (PEM) for SSL verification')
    .action(async (name: string, opts, cmd) => {
      try {
        await runAdd(name, opts, jsonFromCommand(cmd));
      } catch (error: unknown) {
        handleError(jsonFromCommand(cmd), error);
      }
    });

  connection
    .command('set <name>')
    .description('Modify an existing connection profile (fields or password)')
    .option('--url <url>', 'New SAP system URL')
    .option('-c, --client <client>', 'New SAP client number')
    .option('-u, --username <user>', 'New SAP username')
    .option('-l, --language <lang>', 'New SAP language')
    .option('-p, --password <password>', 'New password (updates keychain credential)')
    .option('--remove-password', 'Remove the stored password from keychain')
    .option('--insecure', 'Skip SSL certificate verification (self-signed certs, development only)')
    .option('--ca <path>', 'Path to a CA certificate (PEM) for SSL verification')
    .option('--clear-ca', 'Remove the CA certificate setting')
    .action(async (name: string, opts, cmd) => {
      try {
        await runSet(name, opts, jsonFromCommand(cmd));
      } catch (error: unknown) {
        handleError(jsonFromCommand(cmd), error);
      }
    });

  connection
    .command('use <name>')
    .description('Switch the current workspace to a connection profile')
    .action(async (name: string, _opts, cmd) => {
      try {
        await runUse(name, jsonFromCommand(cmd));
      } catch (error: unknown) {
        handleError(jsonFromCommand(cmd), error);
      }
    });

  connection
    .command('test <name>')
    .description('Probe a connection profile: tls → auth → adt → icf')
    .action(async (name: string, _opts, cmd) => {
      try {
        await runTest(name, jsonFromCommand(cmd));
      } catch (error: unknown) {
        handleError(jsonFromCommand(cmd), error);
      }
    });

  connection
    .command('delete <name>')
    .description('Delete a connection profile and its stored password')
    .option('--yes', 'Delete without prompting (required in non-interactive environments)')
    .action(async (name: string, opts: { yes?: boolean }, cmd) => {
      try {
        await runDelete(name, opts.yes === true, jsonFromCommand(cmd));
      } catch (error: unknown) {
        handleError(jsonFromCommand(cmd), error);
      }
    });

  connection
    .command('export [names...]')
    .description('Export connection profiles to a portable bundle (passwords excluded by default)')
    .option('--file <path>', 'Write the bundle to a file (default: stdout)')
    .option('--with-passwords', 'Include passwords in the bundle (warned opt-in)')
    .action(async (names: string[], opts: { file?: string; withPasswords?: boolean }, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        if (opts.withPasswords) {
          collectWarning('PASSWORD_EXPORT', 'Exporting profiles WITH passwords. Keep the bundle secure.');
        }
        const bundle = await exportProfiles({ names, withPasswords: opts.withPasswords });
        const human = `Exported ${bundle.systems.length} profile(s)${opts.withPasswords ? ' (with passwords)' : ''}.`;
        if (opts.file) {
          fs.writeFileSync(path.resolve(opts.file), JSON.stringify(bundle, null, 2) + '\n', 'utf-8');
          printResult(json, { file: opts.file, count: bundle.systems.length }, `${human} → ${opts.file}`);
        } else {
          printResult(json, bundle, human);
        }
      } catch (error: unknown) {
        handleError(json, error);
      }
    });

  connection
    .command('import <file>')
    .description('Import connection profiles from a bundle (existing profiles are skipped)')
    .option('--overwrite', 'Update profiles that already exist')
    .action(async (file: string, opts: { overwrite?: boolean }, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        const raw = JSON.parse(fs.readFileSync(path.resolve(file), 'utf-8'));
        const bundle = validateBundle(raw);
        const result = await importProfiles(bundle, { overwrite: opts.overwrite });
        const human = result.imported
          .map((i) => `  ${i.name} — ${i.action}`)
          .join('\n');
        printResult(json, result, `Imported ${result.imported.length} profile(s):\n${human}`);
      } catch (error: unknown) {
        handleError(json, error);
      }
    });
}

/** Report command errors via the unified JSON-aware handler */
function handleError(jsonOutput: boolean, error: unknown): never {
  printError(jsonOutput, error);
}

/** Validate that a raw import payload is a ProfileBundle. */
function validateBundle(raw: unknown): ProfileBundle {
  const bundle = raw as Partial<ProfileBundle> | null;
  if (!bundle || bundle.format !== 'abap-cli-profiles' || !Array.isArray(bundle.systems)) {
    throw new CliError('INVALID_ARGUMENT', 'Not a valid abap-cli profiles bundle', {
      nextSteps: ['Export a bundle first: abap connection export --file profiles.json'],
      example: 'abap connection export --file profiles.json',
    });
  }
  return bundle as ProfileBundle;
}
