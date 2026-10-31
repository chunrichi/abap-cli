import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { printError, printResult, printSchema, jsonFromCommand, CliError, type OutputMode, type CommandSchema } from '../output/json.js';
import { collectWarning } from '../output/meta.js';
import { exportProfiles, importProfiles, type ProfileBundle } from '../config/profiles.js';
import { runList, runShow, runTest, runDelete } from '../flows/setup/profile.js';
import { runAdd, runSet } from '../flows/setup/profile.js';
import { toOutputPath } from '../core/path-output.js';
import { baseSchema, schemaOption } from './schema-helpers.js';

export const SCHEMA: CommandSchema = {
  ...baseSchema('profile', 'Manage global connection profiles (list / show / add / set / test / delete / export / import).', 'abap profile <command> [options]', 'local'),
  arguments: [],
  options: [
    { name: '--url', type: 'string', valuePlaceholder: '<url>', description: 'SAP system URL.' },
    { name: '--client', type: 'string', valuePlaceholder: '<client>', description: 'SAP client number.' },
    { name: '--username', type: 'string', valuePlaceholder: '<user>', description: 'SAP username.' },
    { name: '--language', type: 'string', valuePlaceholder: '<lang>', description: 'SAP language.' },
    { name: '--password', type: 'string', valuePlaceholder: '<password>', description: 'Password (stores credential in keychain).' },
    { name: '--remove-password', type: 'boolean', description: 'Drop the stored password from keychain.' },
    { name: '--insecure', type: 'boolean', description: 'Skip SSL certificate verification (development only).' },
    { name: '--ca', type: 'string', valuePlaceholder: '<path>', description: 'PEM CA certificate to import into ~/.abap-cli/certificates/ and bind to this profile.' },
    { name: '--clear-ca', type: 'boolean', description: 'Remove the CA certificate setting.' },
    { name: '--file', type: 'string', valuePlaceholder: '<path>', description: 'Bundle file path for export / import.' },
    { name: '--with-passwords', type: 'boolean', description: 'Include passwords in the export bundle (warned opt-in).' },
    { name: '--overwrite', type: 'boolean', description: 'Update profiles that already exist on import.' },
    { name: '--yes', type: 'boolean', description: 'Confirm in non-interactive mode.' },
    schemaOption(),
  ],
  examples: [
    { description: 'Add a profile', command: 'abap profile add DEV --url https://... --username DEV --password ***' },
    { description: 'Test a profile', command: 'abap profile test DEV' },
    { description: 'Export profiles', command: 'abap profile export --file profiles.json' },
  ],
  errors: [
    { code: 'CONFIG_ERROR', category: 'CONFIG_ERROR', exitCode: 3 },
    { code: 'TLS_ERROR', category: 'TLS_ERROR', exitCode: 4 },
    { code: 'AUTH_ERROR', category: 'AUTH_ERROR', exitCode: 5 },
    { code: 'SAP_ERROR', category: 'SAP_ERROR', exitCode: 6 },
    { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
  ],
};

export function registerProfileCommand(program: Command): void {
  const profile = program
    .command('profile')
    .description('Manage global connection profiles')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action((_opts, cmd) => {
      if (cmd.optsWithGlobals().schema) {
        printSchema(SCHEMA, jsonFromCommand(cmd));
        return;
      }
      // Bare `abap profile` prints the subcommand help (exit 0), like bare `abap`.
      console.log(cmd.helpInformation());
    });

  profile
    .command('list')
    .description('List all saved connection profiles')
    .action((_opts, cmd) => {
      runList(jsonFromCommand(cmd));
    });

  profile
    .command('show <name>')
    .description('Show details of a connection profile')
    .action(async (name: string, _opts, cmd) => {
      try {
        await runShow(name, jsonFromCommand(cmd));
      } catch (error: unknown) {
        handleError(jsonFromCommand(cmd), error);
      }
    });

  profile
    .command('add <name>')
    .description('Create a new connection profile')
    .option('--url <url>', 'SAP system URL')
    .option('-c, --client <client>', 'SAP client number')
    .option('-u, --username <user>', 'SAP username')
    .option('-l, --language <lang>', 'SAP language')
    .option('-p, --password <password>', 'Password (stores credential in keychain)')
    .option('--insecure', 'Skip SSL certificate verification (self-signed certs, development only)')
    .option('--ca <path>', 'PEM CA certificate to import into ~/.abap-cli/certificates/ and bind to this profile')
    .action(async (name: string, opts, cmd) => {
      try {
        await runAdd(name, opts, jsonFromCommand(cmd));
      } catch (error: unknown) {
        handleError(jsonFromCommand(cmd), error);
      }
    });

  profile
    .command('set <name>')
    .description('Modify an existing connection profile (fields or password)')
    .option('--url <url>', 'New SAP system URL')
    .option('-c, --client <client>', 'New SAP client number')
    .option('-u, --username <username>', 'New SAP username')
    .option('-l, --language <lang>', 'New SAP language')
    .option('-p, --password <password>', 'New password (updates keychain credential)')
    .option('--remove-password', 'Remove the stored password from keychain')
    .option('--insecure', 'Skip SSL certificate verification (self-signed certs, development only)')
    .option('--ca <path>', 'PEM CA certificate to import into ~/.abap-cli/certificates/ and bind to this profile')
    .option('--clear-ca', 'Remove the CA certificate setting')
    .action(async (name: string, opts, cmd) => {
      try {
        await runSet(name, opts, jsonFromCommand(cmd));
      } catch (error: unknown) {
        handleError(jsonFromCommand(cmd), error);
      }
    });

  profile
    .command('test <name>')
    .description('Probe a connection profile end-to-end')
    .action(async (name: string, _opts, cmd) => {
      try {
        await runTest(name, jsonFromCommand(cmd));
      } catch (error: unknown) {
        handleError(jsonFromCommand(cmd), error);
      }
    });

  profile
    .command('delete <name>')
    .description('Delete a connection profile and its stored password')
    .option('--yes', 'Delete without prompting')
    .action(async (name: string, opts: { yes?: boolean }, cmd) => {
      try {
        await runDelete(name, opts.yes === true, jsonFromCommand(cmd));
      } catch (error: unknown) {
        handleError(jsonFromCommand(cmd), error);
      }
    });

  profile
    .command('export [names...]')
    .description('Export connection profiles to a bundle')
    .option('--file <path>', 'Write the bundle to a file (default: stdout)')
    .option('--with-passwords', 'Include passwords in the bundle (warned opt-in)')
    .action(async (names: string[], opts: { file?: string; withPasswords?: boolean }, cmd) => {
      const mode = jsonFromCommand(cmd);
      try {
        if (opts.withPasswords) {
          collectWarning('PASSWORD_EXPORT', 'Exporting profiles WITH passwords. Keep the bundle secure.');
        }
        const bundle = await exportProfiles({ names, withPasswords: opts.withPasswords });
        const human = `Exported ${bundle.systems.length} profile(s)${opts.withPasswords ? ' (with passwords)' : ''}.`;
        if (opts.file) {
          fs.writeFileSync(path.resolve(opts.file), JSON.stringify(bundle, null, 2) + '\n', 'utf-8');
          const outFile = toOutputPath(opts.file);
          printResult(mode, { file: outFile, count: bundle.systems.length }, `${human} → ${outFile}`);
        } else {
          printResult(mode, bundle, human);
        }
      } catch (error: unknown) {
        handleError(mode, error);
      }
    });

  profile
    .command('import <file>')
    .description('Import connection profiles from a bundle')
    .option('--overwrite', 'Update profiles that already exist')
    .action(async (file: string, opts: { overwrite?: boolean }, cmd) => {
      const mode = jsonFromCommand(cmd);
      try {
        const raw = JSON.parse(fs.readFileSync(path.resolve(file), 'utf-8'));
        const bundle = validateBundle(raw);
        const result = await importProfiles(bundle, { overwrite: opts.overwrite });
        const human = result.imported
          .map((i) => `  ${i.name} — ${i.action}`)
          .join('\n');
        printResult(mode, result, `Imported ${result.imported.length} profile(s):\n${human}`);
      } catch (error: unknown) {
        handleError(mode, error);
      }
    });
}

/** Report command errors via the unified JSON-aware handler */
function handleError(mode: OutputMode, error: unknown): never {
  printError(mode, error);
}

/** Validate that a raw import payload is a ProfileBundle. */
function validateBundle(raw: unknown): ProfileBundle {
  const bundle = raw as Partial<ProfileBundle> | null;
  if (!bundle || bundle.format !== 'abap-cli-profiles' || !Array.isArray(bundle.systems)) {
    throw new CliError('INVALID_ARGUMENT', 'Not a valid abap-cli profiles bundle', {
      nextSteps: ['Export a bundle first: abap profile export --file profiles.json'],
      example: 'abap profile export --file profiles.json',
    });
  }
  return bundle as ProfileBundle;
}
