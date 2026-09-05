/**
 * Centralised `--schema` definitions for commands that don't keep the schema
 * inline in their `commands/*.ts` file.
 *
 * Commands with non-trivial schema shapes (create, run, select, search, tcode,
 * where-used) keep their SCHEMA constants in the command module because they
 * need command-specific helpers / types. The simpler read-only / set-of-options
 * commands expose their contract here so the doc generator has a single
 * import surface (`commandSchemas`) and the schema literal does not bloat
 * the small command files.
 */
import { SEARCH_RESULT_LIMIT, PAGE_ALL_DEFAULT_MAX } from '../../core/limits.js';
import { SUPPORTED_WHERE_USED_TYPES, DEFAULT_WHERE_USED_LIMIT, MAX_WHERE_USED_LIMIT } from '../search/where-used-ops.js';
import type { CommandSchema } from '../../output/json.js';

/** Single import surface for the doc generator (`scripts/build-commands-doc.ts`).
 *  Typed as a non-optional record so call sites (and printSchema) don't have to
 *  guard for undefined — the doc generator owns the canonical list. */
export const commandSchemas: { [k: string]: CommandSchema } = {
  init: initSchema(),
  pull: pullSchema(),
  push: pushSchema(),
  check: checkSchema(),
  transport: transportSchema(),
  deploy: deploySchema(),
  profile: profileSchema(),
  status: statusSchema(),
  doctor: doctorSchema(),
  inspect: inspectSchema(),
  activate: activateSchema(),
  diff: diffSchema(),
  extensions: extensionsSchema(),
  mime: mimeSchema(),
  'validate:aff': validateAffSchema(),
  session: sessionSchema(),
};

/** Single source of the `--schema` option literal — every command schema
 *  exposes it so `abap <cmd> --schema` discovers the same surface. */
function schemaOption() {
  return {
    name: '--schema',
    type: 'boolean' as const,
    default: false,
    description: 'Print the command parameter schema as JSON and exit (no SAP call).',
  };
}

function base(command: string, description: string, usage: string, scope: 'sap' | 'local'): CommandSchema {
  return {
    schemaVersion: 1,
    command,
    description,
    usage,
    scope,
    arguments: [],
    options: [schemaOption()],
    exclusiveGroups: [],
    globalOptions: ['--json'],
    examples: [],
  };
}

// ---------- init ----------
function initSchema(): CommandSchema {
  return {
    ...base('init', 'Initialize the workspace (bind a profile, write .abap.json) and/or scaffold AI agent context.', 'abap init [options]', 'local'),
    description: 'Initialize the workspace — bind a profile, write .abap.json, inspect, clear fields, or scaffold AI agent context.',
    arguments: [],
    options: [
      { name: '--profile', type: 'string', valuePlaceholder: '<name>', description: 'Use an existing global profile (created with `abap profile add`).' },
      { name: '--system', type: 'string', valuePlaceholder: '<name>', deprecated: true, description: 'DEPRECATED alias of --profile; will be removed.' },
      { name: '--url', type: 'string', valuePlaceholder: '<url>', description: 'SAP system URL (TTY wizard only).' },
      { name: '--client', type: 'string', valuePlaceholder: '<client>', description: 'SAP client number.' },
      { name: '--username', type: 'string', valuePlaceholder: '<user>', description: 'SAP username.' },
      { name: '--password', type: 'string', valuePlaceholder: '<password>', description: 'SAP password (stored in keychain).' },
      { name: '--language', type: 'string', valuePlaceholder: '<language>', description: 'SAP language.' },
      { name: '--insecure', type: 'boolean', description: 'Skip SSL certificate verification (development only).' },
      { name: '--ca', type: 'string', valuePlaceholder: '<path>', description: 'Path to a CA certificate (PEM) for SSL verification.' },
      { name: '--auth-method', type: 'string', valuePlaceholder: '<method>', description: 'Login strategy: basic | cert | browser_sso | oauth_password.' },
      { name: '--auth-option', type: 'string', valuePlaceholder: '<kv>', description: 'Generic auth option, repeatable as key=value. New auth methods add no Commander options — they read from this bag.' },
      { name: '--cert-path', type: 'string', valuePlaceholder: '<path>', description: 'X.509 client cert file (PEM) — used with --auth-method=cert.' },
      { name: '--cert-key', type: 'string', valuePlaceholder: '<path>', description: 'X.509 private key file (PEM) — used with --auth-method=cert.' },
      { name: '--cert-ca', type: 'string', valuePlaceholder: '<path>', description: 'Optional X.509 client CA override — used with --auth-method=cert.' },
      { name: '--cert-passphrase', type: 'string', valuePlaceholder: '<pwd>', description: 'Passphrase for .p12 / encrypted key — written to keychain.' },
      { name: '--sso-cookie-file', type: 'string', valuePlaceholder: '<path>', description: 'SSO cookie jar path — used with --auth-method=browser_sso.' },
      { name: '--service-key', type: 'string', valuePlaceholder: '<path>', description: 'BTP service key JSON — used with --auth-method=oauth_password.' },
      { name: '--tr', type: 'string', valuePlaceholder: '<transport>', description: 'Default transport number (written to .abap.json).' },
      { name: '--package', type: 'string', valuePlaceholder: '<package>', description: 'Default SAP package (written to .abap.json).' },
      { name: '--source-dir', type: 'string', valuePlaceholder: '<path>', description: 'Base directory for `push --all` / `check --all` (written to .abap.json).' },
      { name: '--show-config', type: 'boolean', description: 'Print the current workspace config (.abap.json) as JSON and exit.' },
      { name: '--unset-package', type: 'boolean', description: 'Remove the `package` key from .abap.json.' },
      { name: '--unset-tr', type: 'boolean', description: 'Remove the `transport` key from .abap.json.' },
      { name: '--unset-source-dir', type: 'boolean', description: 'Remove the `sourceDir` key from .abap.json.' },
      { name: '--test-connection', type: 'boolean', description: 'Probe TLS + auth and report results (implies --test-tls --test-auth).' },
      { name: '--test-tls', type: 'boolean', description: 'Probe the TLS handshake.' },
      { name: '--test-auth', type: 'boolean', description: 'Probe authentication (after TLS).' },
      { name: '--agent', type: 'string', valuePlaceholder: '<target>', description: 'Scaffold agent context files. One of: copilot | claude | cursor | generic.', allowedValues: ['generic', 'copilot', 'claude', 'cursor'] },
      { name: '--force', type: 'boolean', description: 'Overwrite existing files when scaffolding --agent (default: skip).' },
      { name: '--yes', type: 'boolean', description: 'Skip all prompts; fail if required input is missing.' },
      { name: '--non-interactive', type: 'boolean', description: 'Alias of --yes.' },
      schemaOption(),
    ],
    exclusiveGroups: [
      ['--unset-package', '--unset-tr', '--unset-source-dir'],
      ['--profile', '--system'],
    ],
    examples: [
      { description: 'First-time bind', command: 'abap init --profile DEV --tr DEVK900001 --package Z_MY_PACKAGE --yes' },
      { description: 'Inspect current config', command: 'abap init --show-config' },
      { description: 'Scaffold agent context', command: 'abap init --agent copilot' },
    ],
    errors: [
      { code: 'CONFIG_ERROR', category: 'CONFIG_ERROR', exitCode: 3 },
      { code: 'FILE_EXISTS', category: 'USAGE', exitCode: 2 },
      { code: 'USAGE', category: 'USAGE', exitCode: 2 },
      { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
    ],
  };
}

// ---------- pull ----------
function pullSchema(): CommandSchema {
  return {
    ...base('pull', 'Download ABAP objects from SAP to local files.', 'abap pull [options] [object-name]', 'sap'),
    arguments: [{ name: 'object-name', type: 'string', required: false, description: 'Object name (e.g. ZCL_MY_CLASS).' }],
    options: [
      { name: '--type', type: 'string', valuePlaceholder: '<type>', description: 'Object type (CLAS, PROG, INTF, etc.).' },
      { name: '--package', type: 'string', valuePlaceholder: '<package>', description: 'Download all objects in a package (bounded by --limit).' },
      { name: '--limit', type: 'int', valuePlaceholder: '<n>', default: SEARCH_RESULT_LIMIT, description: 'Batch page size for --package.' },
      { name: '--page', type: 'int', valuePlaceholder: '<n>', default: 1, description: 'Batch page number for --package (1-based).' },
      { name: '--dir', type: 'string', valuePlaceholder: '<path>', default: 'src/', description: 'Output directory.' },
      { name: '--overwrite', type: 'boolean', description: 'Replace local file with different content.' },
      { name: '--skip-existing', type: 'boolean', description: 'Skip files that already exist.' },
      { name: '--include-tests', type: 'boolean', description: 'Include testclasses source part.' },
      { name: '--include-all-parts', type: 'boolean', description: 'Include every source-code part.' },
      { name: '--textpool', type: 'boolean', description: 'Also pull textpool files (.texts/.selections/.headings.<lang>.properties).' },
      { name: '--remote', type: 'string', valuePlaceholder: '<remoteid>', description: 'Pull the object\'s active version source from a remote system (Version Management).' },
      { name: '--tr', type: 'string', valuePlaceholder: '<request>', description: 'Pull all objects bound to a transport request (mutually exclusive with object name and --package).' },
      schemaOption(),
    ],
    exclusiveGroups: [['--tr', '<object-name>'], ['--tr', '--package']],
    examples: [
      { description: 'Pull a single class', command: 'abap pull ZCL_MY_CLASS --type CLAS' },
      { description: 'Pull a whole package', command: 'abap pull --package ZPKG --limit 50' },
      { description: 'Pull all objects bound to a transport', command: 'abap pull --tr DEVK900001' },
      { description: 'Pull textpool files alongside the source', command: 'abap pull ZCL_MY_CLASS --textpool' },
    ],
    errors: [
      { code: 'OBJECT_NOT_FOUND', category: 'NOT_FOUND', exitCode: 8 },
      { code: 'TYPE_NOT_SUPPORTED', category: 'VALIDATION_ERROR', exitCode: 7 },
      { code: 'DDIC_NOT_SUPPORTED', category: 'VALIDATION_ERROR', exitCode: 7 },
      { code: 'OVERWRITE_REQUIRED', category: 'USAGE', exitCode: 2 },
      { code: 'TRANSPORT_NOT_FOUND', category: 'VALIDATION_ERROR', exitCode: 7 },
      { code: 'PULL_PARTIAL_FAILURE', category: 'VALIDATION_ERROR', exitCode: 7 },
      { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
    ],
  };
}

// ---------- push ----------
function pushSchema(): CommandSchema {
  return {
    ...base('push', 'Push local ABAP files to SAP: lock → set source → syntax check → activate → unlock.', 'abap push [options] [files...]', 'sap'),
    arguments: [{ name: 'files', type: 'string', required: false, description: 'Files to push (positional, variadic).' }],
    options: [
      { name: '--all', type: 'boolean', description: 'Push all .abap files under the scan root (sourceDir or current dir; honours .abapignore).' },
      { name: '--tr', type: 'string', valuePlaceholder: '<transport>', description: 'Transport number override for unbound objects.' },
      { name: '--check-only', type: 'boolean', description: 'Syntax check only; do not activate.' },
      { name: '--no-activate', type: 'boolean', description: 'Lock + write + skip check + skip activate + unlock.' },
      { name: '--dry-run', type: 'boolean', description: 'Plan only — no mutating ADT calls.' },
      { name: '--fail-fast', type: 'boolean', description: 'Stop at the first failing file (default: --keep-going).' },
      { name: '--atomic', type: 'boolean', description: 'Validate all files first; write nothing if any file fails validation.' },
      { name: '--yes', type: 'boolean', description: 'Confirm in non-interactive mode.' },
      schemaOption(),
    ],
    exclusiveGroups: [['--check-only', '--no-activate']],
    examples: [
      { description: 'Push a single file', command: 'abap push src/zcl_demo.clas.abap --tr DEVK900001' },
      { description: 'Push all files under cwd', command: 'abap push --all --tr DEVK900001 --yes' },
      { description: 'Syntax check only (no activation)', command: 'abap push src/zcl_demo.clas.abap --check-only' },
    ],
    errors: [
      { code: 'PUSH_FAILED', category: 'VALIDATION_ERROR', exitCode: 7 },
      { code: 'NO_TRANSPORT', category: 'VALIDATION_ERROR', exitCode: 7 },
      { code: 'LOCK_FAILED', category: 'LOCKED', exitCode: 9 },
      { code: 'SYNTAX_ERROR', category: 'VALIDATION_ERROR', exitCode: 7 },
      { code: 'ACTIVATION_FAILED', category: 'VALIDATION_ERROR', exitCode: 7 },
      { code: 'FILE_PARSE_ERROR', category: 'USAGE', exitCode: 2 },
      { code: 'VALIDATION_ERROR', category: 'VALIDATION_ERROR', exitCode: 7 },
    ],
  };
}

// ---------- check ----------
function checkSchema(): CommandSchema {
  return {
    ...base('check', 'Validate ABAP source code (syntax / content / atc).', 'abap check [syntax|content|atc] [options]', 'sap'),
    arguments: [],
    options: [
      { name: '--variant', type: 'string', valuePlaceholder: '<variant>', description: 'ATC check variant (required with `check atc`).' },
      { name: '--all', type: 'boolean', description: 'Check all .abap files under the scan root (sourceDir or current dir).' },
      { name: '--changed', type: 'boolean', description: 'Check only files changed since the SAP version.' },
      { name: '--strict', type: 'boolean', description: 'Treat warnings as failures.' },
      { name: '--out', type: 'string', valuePlaceholder: '[file]', description: 'Persist raw ATC worklist to a file (only with `check atc`); defaults to .abap/atc/<variant>-<timestamp>.json.' },
      { name: '--files', type: 'string', valuePlaceholder: '<files...>', description: 'Shortcut: run syntax mode on the given files (equivalent to `abap check syntax <files...>`).' },
      schemaOption(),
    ],
    examples: [
      { description: 'Syntax check', command: 'abap check syntax src/zcl_demo.clas.abap' },
      { description: 'Local-only validation', command: 'abap check content src/zcl_demo.clas.abap' },
      { description: 'ATC check with persisted worklist', command: 'abap check atc src/zcl_demo.clas.abap --variant Z_ATC_VAR --out' },
    ],
    errors: [
      { code: 'SYNTAX_ERROR', category: 'VALIDATION_ERROR', exitCode: 7 },
      { code: 'VALIDATION_ERROR', category: 'VALIDATION_ERROR', exitCode: 7 },
      { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
    ],
  };
}

// ---------- transport ----------
function transportSchema(): CommandSchema {
  return {
    ...base('transport', 'Manage SAP transport requests (list / create / show / resolve / assign).', 'abap transport <list|create|show|resolve|assign> [options]', 'sap'),
    arguments: [],
    options: [schemaOption()],
    examples: [
      { description: 'List transports', command: 'abap transport list' },
      { description: 'Create a transport', command: 'abap transport create "my description" --yes' },
      { description: 'Assign an object', command: 'abap transport assign ZCL_MY --tr DEVK900001 --yes' },
    ],
    errors: [
      { code: 'TRANSPORT_CREATE_FAILED', category: 'VALIDATION_ERROR', exitCode: 7 },
      { code: 'TRANSPORT_NOT_FOUND', category: 'VALIDATION_ERROR', exitCode: 7 },
      { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
      { code: 'VALIDATION_ERROR', category: 'VALIDATION_ERROR', exitCode: 7 },
    ],
  };
}

// ---------- deploy ----------
function deploySchema(): CommandSchema {
  return {
    ...base('deploy', 'Deploy bundled ICF ABAP service to SAP.', 'abap deploy [options] | abap deploy status [options]', 'sap'),
    arguments: [],
    options: [
      { name: '--tr', type: 'string', valuePlaceholder: '<transport>', description: 'Transport number (required when --package is not $TMP).' },
      { name: '--package', type: 'string', valuePlaceholder: '<package>', default: '$TMP', description: 'Target SAP package (default $TMP — local, no transport needed).' },
      { name: '--dry-run', type: 'boolean', description: 'Plan only — make no mutating SAP calls.' },
      { name: '--diff', type: 'boolean', description: 'Report per-file source differences.' },
      { name: '--force', type: 'boolean', description: 'Bypass safety guards (forced: true in the result).' },
      { name: '--yes', type: 'boolean', description: 'Confirm in non-interactive mode.' },
      schemaOption(),
    ],
    examples: [
      { description: 'Deploy to $TMP (no transport)', command: 'abap deploy --yes' },
      { description: 'Deploy to a custom package', command: 'abap deploy --package ZPKG --tr DEVK900001 --yes' },
      { description: 'Read-only status probe', command: 'abap deploy status' },
    ],
    errors: [
      { code: 'NO_TRANSPORT', category: 'VALIDATION_ERROR', exitCode: 7 },
      { code: 'SAP_ERROR', category: 'SAP_ERROR', exitCode: 6 },
      { code: 'FORCE_BYPASSED', category: 'VALIDATION_ERROR', exitCode: 7 },
      { code: 'ICF_CHECK_DEGRADED', category: 'VALIDATION_ERROR', exitCode: 7 },
      { code: 'STEAMPUNK_ICF_MANUAL', category: 'VALIDATION_ERROR', exitCode: 7 },
    ],
  };
}

// ---------- profile ----------
function profileSchema(): CommandSchema {
  return {
    ...base('profile', 'Manage global connection profiles (list / show / add / set / test / login / delete / export / import).', 'abap profile <command> [options]', 'local'),
    arguments: [],
    options: [
      { name: '--url', type: 'string', valuePlaceholder: '<url>', description: 'SAP system URL.' },
      { name: '--client', type: 'string', valuePlaceholder: '<client>', description: 'SAP client number.' },
      { name: '--username', type: 'string', valuePlaceholder: '<user>', description: 'SAP username.' },
      { name: '--language', type: 'string', valuePlaceholder: '<lang>', description: 'SAP language.' },
      { name: '--password', type: 'string', valuePlaceholder: '<password>', description: 'Password (stores credential in keychain).' },
      { name: '--remove-password', type: 'boolean', description: 'Drop the stored password from keychain.' },
      { name: '--insecure', type: 'boolean', description: 'Skip SSL certificate verification (development only).' },
      { name: '--ca', type: 'string', valuePlaceholder: '<path>', description: 'Path to a CA certificate (PEM) for SSL verification.' },
      { name: '--clear-ca', type: 'boolean', description: 'Remove the CA certificate setting.' },
      { name: '--auth-method', type: 'string', valuePlaceholder: '<method>', description: 'Login strategy: basic | cert | browser_sso | oauth_password.' },
      { name: '--auth-option', type: 'string', valuePlaceholder: '<kv>', description: 'Generic auth option, repeatable as key=value.' },
      { name: '--cert-path', type: 'string', valuePlaceholder: '<path>', description: 'X.509 client cert file (PEM).' },
      { name: '--cert-key', type: 'string', valuePlaceholder: '<path>', description: 'X.509 private key file (PEM).' },
      { name: '--cert-ca', type: 'string', valuePlaceholder: '<path>', description: 'Optional X.509 client CA override (PEM).' },
      { name: '--cert-passphrase', type: 'string', valuePlaceholder: '<pwd>', description: 'Passphrase for .p12 / encrypted key — written to keychain.' },
      { name: '--remove-cert-passphrase', type: 'boolean', description: 'Remove the stored cert passphrase from keychain.' },
      { name: '--clear-cert-auth', type: 'boolean', description: 'Reset to basic auth (drops authMethod and certAuth).' },
      { name: '--sso-cookie-file', type: 'string', valuePlaceholder: '<path>', description: 'SSO cookie jar path — used with --auth-method=browser_sso.' },
      { name: '--clear-sso-cookie-file', type: 'boolean', description: 'Reset SSO cookie file path to the default.' },
      { name: '--service-key', type: 'string', valuePlaceholder: '<path>', description: 'BTP service key JSON — used with --auth-method=oauth_password.' },
      { name: '--clear-oauth-password', type: 'boolean', description: 'Drop oauthPassword config (reset to authMethod).' },
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
      { code: 'PASSWORD_EXPORT', category: 'VALIDATION_ERROR', exitCode: 7 },
      { code: 'PROFILE_MISMATCH', category: 'VALIDATION_ERROR', exitCode: 7 },
      { code: 'TLS_ERROR', category: 'TLS_ERROR', exitCode: 4 },
      { code: 'AUTH_ERROR', category: 'AUTH_ERROR', exitCode: 5 },
      { code: 'SAP_ERROR', category: 'SAP_ERROR', exitCode: 6 },
      { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
    ],
  };
}

// ---------- status ----------
function statusSchema(): CommandSchema {
  return {
    ...base('status', 'Show local vs SAP sync status as a standardised changedParts list.', 'abap status [options]', 'sap'),
    arguments: [],
    options: [
      { name: '--remote-only', type: 'boolean', description: 'Only remote-only differences.' },
      { name: '--local-only', type: 'boolean', description: 'Only local-only differences.' },
      { name: '--limit', type: 'int', valuePlaceholder: '<n>', default: SEARCH_RESULT_LIMIT, description: 'Bounds the result; truncated: true when capped.' },
      { name: '--since', type: 'string', valuePlaceholder: '<iso-date>', description: 'Only files modified at or after the date (YYYY-MM-DD[THH:mm:ss]).' },
      { name: '--all', type: 'boolean', description: 'Include unchanged entries.' },
      schemaOption(),
    ],
    examples: [
      { description: 'Default sync status', command: 'abap status' },
      { description: 'Only remote-only', command: 'abap status --remote-only --limit 50' },
    ],
    errors: [
      { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
    ],
  };
}

// ---------- doctor ----------
function doctorSchema(): CommandSchema {
  return {
    ...base('doctor', 'Diagnose CLI environment, configuration, and connections.', 'abap doctor [options]', 'local'),
    arguments: [],
    options: [
      { name: '--verbose', type: 'boolean', description: 'Include detail (versions, paths, underlying messages).' },
      { name: '--fix', type: 'boolean', description: 'Apply safe, reversible fixes (requires --yes).' },
      { name: '--yes', type: 'boolean', description: 'Confirm --fix without prompting.' },
      { name: '--system', type: 'string', valuePlaceholder: '<name>', description: 'Scope the connection section to a named profile.' },
      schemaOption(),
    ],
    examples: [
      { description: 'Diagnose the environment', command: 'abap doctor' },
      { description: 'Apply safe fixes', command: 'abap doctor --fix --yes' },
    ],
    errors: [
      { code: 'VALIDATION_ERROR', category: 'VALIDATION_ERROR', exitCode: 7 },
    ],
  };
}

// ---------- inspect ----------
function inspectSchema(): CommandSchema {
  return {
    ...base('inspect', 'View ABAP object metadata read-only (no local files required).', 'abap inspect [options] <object>', 'sap'),
    arguments: [{ name: 'object', type: 'string', required: false, description: 'SAP object name.' }],
    options: [
      { name: '--structure', type: 'boolean', description: 'Include structure elements.' },
      { name: '--includes', type: 'boolean', description: 'Include class include parts.' },
      { name: '--locks', type: 'boolean', description: 'Include lock / transport ownership (read-only).' },
      { name: '--package', type: 'boolean', description: 'Include the object package name.' },
      { name: '--activation', type: 'boolean', description: 'Verify active vs latest source per part (read-only; detect stale activation).' },
      schemaOption(),
    ],
    examples: [
      { description: 'Inspect a class', command: 'abap inspect ZCL_MY_CLASS' },
      { description: 'Detect stale activation', command: 'abap inspect ZCL_MY_CLASS --activation' },
    ],
    errors: [
      { code: 'OBJECT_NOT_FOUND', category: 'NOT_FOUND', exitCode: 8 },
      { code: 'TYPE_NOT_SUPPORTED', category: 'VALIDATION_ERROR', exitCode: 7 },
      { code: 'USAGE', category: 'USAGE', exitCode: 2 },
    ],
  };
}

// ---------- activate ----------
function activateSchema(): CommandSchema {
  return {
    ...base('activate', 'Activate all inactive items (method/OSI level) of an object.', 'abap activate <object> [options]', 'sap'),
    arguments: [{ name: 'object', type: 'string', required: true, description: 'SAP object name.' }],
    options: [
      { name: '--type', type: 'string', valuePlaceholder: '<type>', description: 'Object type (CLAS, PROG, INTF, etc.) — disambiguates same-name objects.' },
      { name: '--yes', type: 'boolean', description: 'Confirm in non-interactive environments.' },
      schemaOption(),
    ],
    examples: [
      { description: 'Activate a class', command: 'abap activate ZCL_MY_CLASS --yes' },
      { description: 'Disambiguate same-prefix names', command: 'abap activate ZCL_FOO --type CLAS --yes' },
    ],
    errors: [
      { code: 'ACTIVATION_FAILED', category: 'VALIDATION_ERROR', exitCode: 7 },
      { code: 'OBJECT_NOT_FOUND', category: 'NOT_FOUND', exitCode: 8 },
      { code: 'VALIDATION_ERROR', category: 'VALIDATION_ERROR', exitCode: 7 },
    ],
  };
}

// ---------- diff ----------
function diffSchema(): CommandSchema {
  return {
    ...base('diff', 'Compare local files against SAP (read-only) with a per-part change summary.', 'abap diff [options] [file]', 'sap'),
    arguments: [{ name: 'file', type: 'string', required: false, description: 'Single file to diff (mutually exclusive with --all/--remote/--local-only).' }],
    options: [
      { name: '--all', type: 'boolean', description: 'Compare the whole workspace.' },
      { name: '--remote', type: 'boolean', description: 'Only remote-only differences.' },
      { name: '--local-only', type: 'boolean', description: 'Only local-only differences.' },
      { name: '--limit', type: 'int', valuePlaceholder: '<n>', default: SEARCH_RESULT_LIMIT, description: 'Bounds the result.' },
      schemaOption(),
    ],
    exclusiveGroups: [['<file>', '--all'], ['<file>', '--remote'], ['<file>', '--local-only']],
    examples: [
      { description: 'Diff a single file', command: 'abap diff src/zcl_demo.clas.abap' },
      { description: 'Diff the workspace', command: 'abap diff --all --limit 50' },
    ],
    errors: [
      { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
    ],
  };
}

// ---------- extensions ----------
export function extensionsSchema(): CommandSchema {
  return {
    ...base('extensions', 'Manage installed extensions (extension mechanism 023).', 'abap extensions <list>', 'local'),
    arguments: [],
    options: [schemaOption()],
    examples: [
      { description: 'List installed extensions', command: 'abap extensions list' },
    ],
    errors: [
      { code: 'EXTENSION_LOAD_FAILED', category: 'CONFIG_ERROR', exitCode: 3 },
      { code: 'EXTENSION_VALIDATION_FAILED', category: 'VALIDATION_ERROR', exitCode: 7 },
    ],
  };
}

// ---------- search (centralised here so it can be co-located with the other
// command-level schemas; the SCHEMA in search.ts remains the live source) ----
export const searchCommandSchema: CommandSchema = {
  schemaVersion: 1,
  command: 'search',
  description: 'Search for ABAP objects in SAP system',
  usage: 'abap search [options] <query>',
  scope: 'sap',
  arguments: [{ name: 'query', type: 'string', required: true, description: 'Search query (supports * wildcard).' }],
  options: [
    { name: '--type', type: 'string', valuePlaceholder: '<type>', description: 'Filter by object type.' },
    { name: '--limit', type: 'int', valuePlaceholder: '<n>', default: SEARCH_RESULT_LIMIT, description: 'Maximum results per page.' },
    { name: '--page', type: 'int', valuePlaceholder: '<n>', default: 1, description: 'Page number (1-based).' },
    { name: '--exact', type: 'boolean', description: 'Exact name match (mutually exclusive with --fuzzy).' },
    { name: '--fuzzy', type: 'boolean', description: 'Substring match (default).' },
    { name: '--package', type: 'string', valuePlaceholder: '<package>', description: 'Filter by package.' },
    { name: '--max', type: 'int', valuePlaceholder: '<n>', deprecated: true, description: 'Deprecated alias for --limit.' },
    { name: '--page-all', type: 'boolean', description: 'Fetch all results in one request (cap = --page-all-max × --limit; mutually exclusive with --page).' },
    { name: '--page-all-max', type: 'int', valuePlaceholder: '<n>', default: PAGE_ALL_DEFAULT_MAX, description: 'Page-count cap that sizes the --page-all single request.' },
    schemaOption(),
  ],
  exclusiveGroups: [['--exact', '--fuzzy'], ['--page', '--page-all']],
  globalOptions: ['--json'],
  examples: [
    { description: 'Filter by type', command: 'abap search ZCL_* --type CLAS --limit 50' },
    { description: 'Exact name match', command: 'abap search ZCL_DEMO --exact' },
    { description: 'Fetch all in one request', command: 'abap search ZCL_* --page-all' },
  ],
  errors: [
    { code: 'AMBIGUOUS_OBJECT', category: 'NOT_FOUND', exitCode: 8 },
    { code: 'OBJECT_NOT_FOUND', category: 'NOT_FOUND', exitCode: 8 },
    { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
  ],
};

// ---------- where-used (mirror of whereUsedSchema in commands/where-used.ts) ----
export const whereUsedCommandSchema: CommandSchema = {
  schemaVersion: 1,
  command: 'where-used',
  description: 'Find direct SAP object references (read-only).',
  usage: 'abap where-used [options] <object>',
  scope: 'sap',
  arguments: [{ name: 'object', type: 'string', required: true, description: 'SAP object name.' }],
  options: [
    { name: '--type', type: 'string', valuePlaceholder: '<type>', description: 'Target object type.', allowedValues: [...SUPPORTED_WHERE_USED_TYPES] },
    { name: '--ref-type', type: 'string', valuePlaceholder: '<type>', description: 'Filter references by object type.', allowedValues: [...SUPPORTED_WHERE_USED_TYPES] },
    { name: '--package', type: 'string', valuePlaceholder: '<package>', description: 'Case-insensitive reference package filter.' },
    { name: '--limit', type: 'int', valuePlaceholder: '<n>', default: DEFAULT_WHERE_USED_LIMIT, description: `Maximum returned references (hard cap ${MAX_WHERE_USED_LIMIT}).` },
    schemaOption(),
  ],
  globalOptions: ['--json'],
  examples: [
    { description: 'Find references to a class', command: 'abap where-used ZCL_TARGET --type CLAS' },
    { description: 'JSON envelope via the references alias', command: 'abap references ZTAB_TARGET --type TABL --ref-type TABL --json' },
  ],
  errors: [
    { code: 'OBJECT_NOT_FOUND', category: 'NOT_FOUND', exitCode: 8 },
    { code: 'TYPE_NOT_SUPPORTED', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'USAGE', category: 'USAGE', exitCode: 2 },
    { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
  ],
};

// ---------- mime (create / delete / push) ----------
function mimeSchema(): CommandSchema {
  return {
    schemaVersion: 1,
    command: 'mime',
    description: 'Create, delete, or upload MIME Repository resources (subcommands: create | delete | push).',
    usage: 'abap mime create <path> [options]\nabap mime delete <path> [options]\nabap mime push <local> --root <path> [options]',
    scope: 'sap',
    arguments: [],
    options: [schemaOption()],
    globalOptions: ['--json', '--pretty-json'],
    examples: [
      { description: 'Create a MIME folder under $TMP', command: 'abap mime create /zntf_ui --package $TMP --yes' },
      { description: 'Recursively delete a folder (with transport)', command: 'abap mime delete /zntf_ui --recursive --tr NDK123456 --yes' },
      { description: 'Upload local assets into an existing folder', command: 'abap mime push ./out --root /zntf_ui/assets --tr NDK123456 --yes' },
      { description: 'Dry-run (no SAP calls)', command: 'abap mime push ./out --root /zntf_ui/assets --dry-run' },
    ],
    errors: [
      { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
      { code: 'USAGE', category: 'USAGE', exitCode: 2 },
      { code: 'SAP_ERROR', category: 'SAP_ERROR', exitCode: 1 },
    ],
  };
}

// ---------- validate:aff ----------
function validateAffSchema(): CommandSchema {
  return {
    schemaVersion: 1,
    command: 'validate:aff',
    description: 'Validate JSON files against official abap-file-format (AFF) canonical schemas (Draft 2020-12).',
    usage: 'abap validate:aff <file-or-dir> [--wire <wire-dir>]',
    scope: 'local',
    arguments: [{ name: 'file-or-dir', type: 'string', required: true, description: 'A JSON file or directory of JSON files to validate.' }],
    options: [
      { name: '--wire', type: 'string', valuePlaceholder: '<wire-dir>', description: 'Also recursively validate every JSON under a wire directory.' },
      schemaOption(),
    ],
    globalOptions: ['--json', '--pretty-json'],
    examples: [
      { description: 'Validate a single fixture', command: 'abap validate:aff test/fixtures/tabl/zmy_basic.tabl.json' },
      { description: 'Validate all fixtures', command: 'abap validate:aff test/fixtures/' },
      { description: 'Validate a wire payload directory', command: 'abap validate:aff --wire tmp/s4h/wire/' },
    ],
    errors: [
      { code: 'AFF_SCHEMA_MISSING', category: 'NOT_FOUND', exitCode: 2 },
      { code: 'AFF_SCHEMA_INVALID', category: 'NOT_FOUND', exitCode: 2 },
      { code: 'AFF_SCHEMA_COMPILE_ERROR', category: 'NOT_FOUND', exitCode: 2 },
    ],
  };
}

// ---------- session ----------
function sessionSchema(): CommandSchema {
  return {
    schemaVersion: 1,
    command: 'session',
    description: 'Inspect the session cookie reuse state for the active profile (no SAP call).',
    usage: 'abap session info [--profile <name>]',
    scope: 'local',
    arguments: [],
    options: [
      { name: '--profile', type: 'string', valuePlaceholder: '<name>', description: 'Override the active profile (defaults to .abap.json#system).' },
      schemaOption(),
    ],
    globalOptions: ['--json', '--pretty-json'],
    examples: [
      { description: 'Show session jar state for the active profile', command: 'abap session info --json' },
    ],
    errors: [
      { code: 'CONFIG_ERROR', category: 'CONFIG_ERROR', exitCode: 3 },
      { code: 'SESSION_JAR_DECRYPT_FAILED', category: 'VALIDATION_ERROR', exitCode: 7 },
    ],
  };
}