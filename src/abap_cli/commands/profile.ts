import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { printError, printResult, printSchema, jsonFromCommand, CliError, type OutputMode } from '../output/json.js';
import { collectWarning } from '../output/meta.js';
import { exportProfiles, importProfiles, type ProfileBundle } from '../config/profiles.js';
import { runList, runShow, runTest, runDelete } from '../flows/setup/profile.js';
import { runAdd, runSet } from '../flows/setup/profile.js';
import { runLogin } from '../flows/setup/sso.js';
import { toOutputPath } from '../core/path-output.js';
import { commandSchemas } from '../flows/setup/command-schemas.js';

export function registerProfileCommand(program: Command): void {
  const profile = program
    .command('profile')
    .description('Manage global connection profiles')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action((_opts, cmd) => {
      if (cmd.optsWithGlobals().schema) {
        printSchema(commandSchemas['profile']!, jsonFromCommand(cmd));
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
    .option('--ca <path>', 'Path to a CA certificate (PEM) for SSL verification')
    .option('--auth-method <method>', 'Login strategy: basic (default) | cert (X.509 client cert, 025) | browser_sso (BTP trial / SAML, 026) | oauth_password (BTP / CF service-key JWT, 027)')
    .option('--auth-option <kv>', 'Generic auth option, repeatable as key=value (e.g. --auth-option certPath=/abs/cert.pem). New auth methods add no Commander options — they read from this bag.')
    .option('--cert-path <path>', 'X.509 client cert file (PEM) — used when --auth-method=cert')
    .option('--cert-key <path>', 'X.509 private key file (PEM) — used when --auth-method=cert')
    .option('--cert-ca <path>', 'Optional X.509 client CA override — used when --auth-method=cert')
    .option('--cert-passphrase <passphrase>', 'Passphrase for .p12 / encrypted key — written to keychain')
    .option('--sso-cookie-file <path>', 'SSO cookie jar path — used when --auth-method=browser_sso')
    .option('--service-key <path>', 'BTP service key JSON — used when --auth-method=oauth_password (extracts uaa.url/clientid/clientsecret)')
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
    .option('-u, --username <user>', 'New SAP username')
    .option('-l, --language <lang>', 'New SAP language')
    .option('-p, --password <password>', 'New password (updates keychain credential)')
    .option('--remove-password', 'Remove the stored password from keychain')
    .option('--insecure', 'Skip SSL certificate verification (self-signed certs, development only)')
    .option('--ca <path>', 'Path to a CA certificate (PEM) for SSL verification')
    .option('--clear-ca', 'Remove the CA certificate setting')
    .option('--auth-method <method>', 'Login strategy: basic | cert | browser_sso | oauth_password')
    .option('--auth-option <kv>', 'Generic auth option, repeatable as key=value (e.g. --auth-option certPath=/abs/cert.pem). New auth methods add no Commander options — they read from this bag.')
    .option('--cert-path <path>', 'X.509 client cert file (PEM)')
    .option('--cert-key <path>', 'X.509 private key file (PEM)')
    .option('--cert-ca <path>', 'X.509 client CA override (PEM)')
    .option('--cert-passphrase <passphrase>', 'Passphrase for .p12 / encrypted key — written to keychain')
    .option('--remove-cert-passphrase', 'Remove the stored cert passphrase from keychain')
    .option('--clear-cert-auth', 'Reset to basic auth (drops authMethod and certAuth)')
    .option('--sso-cookie-file <path>', 'SSO cookie jar path — used when --auth-method=browser_sso')
    .option('--clear-sso-cookie-file', 'Reset SSO cookie file path to the default')
    .option('--service-key <path>', 'BTP service key JSON — used when --auth-method=oauth_password (extracts uaa.url/clientid/clientsecret)')
    .option('--clear-oauth-password', 'Drop oauthPassword config (reset to authMethod)')
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
    .command('login <name>')
    .description('Capture browser-SSO cookies for a profile (BTP trial / SAML); writes the cookie jar file')
    .action(async (name: string, _opts, cmd) => {
      try {
        await runLogin(name, jsonFromCommand(cmd));
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