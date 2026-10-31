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
import { failMissingInvocation } from '../output/usage.js';

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
    { description: 'Inspect a subcommand schema', command: 'abap profile add --schema' },
  ],
  errors: [
    { code: 'CONFIG_ERROR', category: 'CONFIG_ERROR', exitCode: 3 },
    { code: 'TLS_ERROR', category: 'TLS_ERROR', exitCode: 4 },
    { code: 'AUTH_ERROR', category: 'AUTH_ERROR', exitCode: 5 },
    { code: 'SAP_ERROR', category: 'SAP_ERROR', exitCode: 6 },
    { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
  ],
};

const NAME_ARGUMENT = {
  name: 'name',
  type: 'string' as const,
  required: true,
  description: 'Connection profile name (1-64 chars: letters, digits, "_", ".", "-").',
};

/** Per-subcommand machine contracts. The parent schema cannot express which
 *  option belongs to `add` vs `set` vs `export`; agents can query
 *  `abap profile <command> --schema --json` for the exact surface. */
const SUBCOMMAND_SCHEMAS: Record<string, CommandSchema> = {
  list: {
    ...baseSchema('profile list', 'List all saved connection profiles.', 'abap profile list', 'local'),
    examples: [{ description: 'List profiles', command: 'abap profile list --json' }],
  },
  show: {
    ...baseSchema('profile show', 'Show one connection profile (no secrets).', 'abap profile show <name>', 'local'),
    arguments: [NAME_ARGUMENT],
    examples: [{ description: 'Show a profile', command: 'abap profile show DEV --json' }],
  },
  add: {
    ...baseSchema('profile add', 'Create a new connection profile. Does not connect; verify with `profile test`.', 'abap profile add <name> --url <url> --username <user>', 'local'),
    arguments: [NAME_ARGUMENT],
    options: [
      { name: '--url', type: 'string', valuePlaceholder: '<url>', description: 'SAP system URL; normalized to scheme://host:port (path/query dropped).' },
      { name: '--client', type: 'string', valuePlaceholder: '<client>', description: 'SAP client number (3 digits, default 100).' },
      { name: '--username', type: 'string', valuePlaceholder: '<user>', description: 'SAP username.' },
      { name: '--language', type: 'string', valuePlaceholder: '<lang>', description: 'SAP language (2 letters, default EN).' },
      { name: '--password', type: 'string', valuePlaceholder: '<password>', description: 'Password; stored in the OS keychain.' },
      { name: '--insecure', type: 'boolean', description: 'Skip SSL certificate verification (development only).' },
      { name: '--ca', type: 'string', valuePlaceholder: '<path>', description: 'PEM CA certificate to import and bind to this profile.' },
      schemaOption(),
    ],
    examples: [{ description: 'Add a profile', command: 'abap profile add dev --url https://sap.example.com:44300 --username DEV --password ***' }],
  },
  set: {
    ...baseSchema('profile set', 'Modify an existing connection profile (fields or password).', 'abap profile set <name> [options]', 'local'),
    arguments: [NAME_ARGUMENT],
    options: [
      { name: '--url', type: 'string', valuePlaceholder: '<url>', description: 'New SAP system URL; normalized to scheme://host:port.' },
      { name: '--client', type: 'string', valuePlaceholder: '<client>', description: 'New SAP client number.' },
      { name: '--username', type: 'string', valuePlaceholder: '<username>', description: 'New SAP username.' },
      { name: '--language', type: 'string', valuePlaceholder: '<lang>', description: 'New SAP language.' },
      { name: '--password', type: 'string', valuePlaceholder: '<password>', description: 'New password; updates the keychain credential.' },
      { name: '--remove-password', type: 'boolean', description: 'Remove the stored password from the keychain.' },
      { name: '--insecure', type: 'boolean', description: 'Skip SSL certificate verification (development only).' },
      { name: '--ca', type: 'string', valuePlaceholder: '<path>', description: 'PEM CA certificate to import and bind to this profile.' },
      { name: '--clear-ca', type: 'boolean', description: 'Remove the CA certificate setting.' },
      schemaOption(),
    ],
    examples: [{ description: 'Update a password', command: 'abap profile set dev --password ***' }],
  },
  test: {
    ...baseSchema('profile test', 'Probe a connection profile end-to-end (tls -> auth -> adt -> icf).', 'abap profile test <name>', 'local'),
    arguments: [NAME_ARGUMENT],
    examples: [{ description: 'Probe a profile', command: 'abap profile test dev --json' }],
  },
  delete: {
    ...baseSchema('profile delete', 'Delete a connection profile and its stored password.', 'abap profile delete <name> --yes', 'local'),
    arguments: [NAME_ARGUMENT],
    options: [{ name: '--yes', type: 'boolean', description: 'Skip the confirmation prompt.' }, schemaOption()],
    examples: [{ description: 'Delete a profile', command: 'abap profile delete dev --yes' }],
  },
  export: {
    ...baseSchema('profile export', 'Export connection profiles to a bundle (passwords excluded by default).', 'abap profile export [names...] [--file <path>]', 'local'),
    arguments: [{ name: 'names', type: 'string', required: false, description: 'Profile names to export (default: all).' }],
    options: [
      { name: '--file', type: 'string', valuePlaceholder: '<path>', description: 'Write the bundle to a file (default: stdout).' },
      { name: '--with-passwords', type: 'boolean', description: 'Include passwords in the bundle (warned opt-in).' },
      schemaOption(),
    ],
    examples: [{ description: 'Export all profiles', command: 'abap profile export --file profiles.json' }],
  },
  import: {
    ...baseSchema('profile import', 'Import connection profiles from a bundle.', 'abap profile import <file>', 'local'),
    arguments: [{ name: 'file', type: 'string', required: true, description: 'Bundle file path.' }],
    options: [
      { name: '--overwrite', type: 'boolean', description: 'Update profiles that already exist.' },
      schemaOption(),
    ],
    examples: [{ description: 'Import profiles', command: 'abap profile import profiles.json --overwrite' }],
  },
};

/** Print `abap profile <command> --schema` when requested; true means printed. */
function maybePrintSubSchema(cmd: Command, key: keyof typeof SUBCOMMAND_SCHEMAS): boolean {
  if (cmd.optsWithGlobals<{ schema?: boolean }>().schema !== true) return false;
  const schema = SUBCOMMAND_SCHEMAS[key];
  if (!schema) return false;
  printSchema(schema, jsonFromCommand(cmd));
  return true;
}

/** Subcommand positionals are optional at the parser level so `--schema` works
 *  without them; the action still fails with the same USAGE error when absent. */
function requireArg(value: string | undefined, name: string): string {
  if (value) return value;
  throw new CliError('USAGE', `missing required argument '${name}'`, {
    nextSteps: ["Run 'abap profile --help' for usage."],
    example: 'abap profile list --json',
  });
}

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
      // Bare `abap profile` is a USAGE failure; human help is only printed by
      // `abap profile --help`.
      failMissingInvocation(
        cmd,
        "Missing subcommand: use 'profile list', 'show', 'add', 'set', 'test', 'delete', 'export', or 'import'.",
        'abap profile list --json',
      );
    });

  profile
    .command('list')
    .description('List all saved connection profiles')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action((_opts, cmd) => {
      if (maybePrintSubSchema(cmd, 'list')) return;
      runList(jsonFromCommand(cmd));
    });

  profile
    .command('show [name]')
    .description('Show details of a connection profile')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (name: string | undefined, _opts, cmd) => {
      if (maybePrintSubSchema(cmd, 'show')) return;
      try {
        await runShow(requireArg(name, 'name'), jsonFromCommand(cmd));
      } catch (error: unknown) {
        handleError(jsonFromCommand(cmd), error);
      }
    });

  profile
    .command('add [name]')
    .description('Create a new connection profile')
    .option('--url <url>', 'SAP system URL')
    .option('-c, --client <client>', 'SAP client number')
    .option('-u, --username <user>', 'SAP username')
    .option('-l, --language <lang>', 'SAP language')
    .option('-p, --password <password>', 'Password (stores credential in keychain)')
    .option('--insecure', 'Skip SSL certificate verification (self-signed certs, development only)')
    .option('--ca <path>', 'PEM CA certificate to import into ~/.abap-cli/certificates/ and bind to this profile')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (name: string | undefined, opts, cmd) => {
      if (maybePrintSubSchema(cmd, 'add')) return;
      try {
        await runAdd(requireArg(name, 'name'), opts, jsonFromCommand(cmd));
      } catch (error: unknown) {
        handleError(jsonFromCommand(cmd), error);
      }
    });

  profile
    .command('set [name]')
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
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (name: string | undefined, opts, cmd) => {
      if (maybePrintSubSchema(cmd, 'set')) return;
      try {
        await runSet(requireArg(name, 'name'), opts, jsonFromCommand(cmd));
      } catch (error: unknown) {
        handleError(jsonFromCommand(cmd), error);
      }
    });

  profile
    .command('test [name]')
    .description('Probe a connection profile end-to-end')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (name: string | undefined, _opts, cmd) => {
      if (maybePrintSubSchema(cmd, 'test')) return;
      try {
        await runTest(requireArg(name, 'name'), jsonFromCommand(cmd));
      } catch (error: unknown) {
        handleError(jsonFromCommand(cmd), error);
      }
    });

  profile
    .command('delete [name]')
    .description('Delete a connection profile and its stored password')
    .option('--yes', 'Delete without prompting')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (name: string | undefined, opts: { yes?: boolean }, cmd) => {
      if (maybePrintSubSchema(cmd, 'delete')) return;
      try {
        await runDelete(requireArg(name, 'name'), opts.yes === true, jsonFromCommand(cmd));
      } catch (error: unknown) {
        handleError(jsonFromCommand(cmd), error);
      }
    });

  profile
    .command('export [names...]')
    .description('Export connection profiles to a bundle')
    .option('--file <path>', 'Write the bundle to a file (default: stdout)')
    .option('--with-passwords', 'Include passwords in the bundle (warned opt-in)')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (names: string[], opts: { file?: string; withPasswords?: boolean }, cmd) => {
      if (maybePrintSubSchema(cmd, 'export')) return;
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
    .command('import [file]')
    .description('Import connection profiles from a bundle')
    .option('--overwrite', 'Update profiles that already exist')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (file: string | undefined, opts: { overwrite?: boolean }, cmd) => {
      if (maybePrintSubSchema(cmd, 'import')) return;
      const mode = jsonFromCommand(cmd);
      try {
        const bundleFile = requireArg(file, 'file');
        const raw = JSON.parse(fs.readFileSync(path.resolve(bundleFile), 'utf-8'));
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
