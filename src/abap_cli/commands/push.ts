import { Command } from 'commander';
import { runPush } from '../flows/edit/push.js';
import type { PushFileOptions } from '../flows/edit/push-types.js';
import { printError, printResult, printSchema, jsonFromCommand, type CommandSchema } from '../output/json.js';
import { baseSchema, schemaOption } from './schema-helpers.js';

export const SCHEMA: CommandSchema = {
  ...baseSchema('push', 'Push local ABAP files to SAP: lock → set source → syntax check → activate → unlock.', 'abap push [options] [files...]', 'sap'),
  arguments: [{ name: 'files', type: 'string', required: false, description: 'Files to push (positional, variadic).' }],
  options: [
    { name: '--all', type: 'boolean', description: 'Push all .abap files under the scan root (sourceDir or current dir; honours .abapignore).' },
    { name: '--tr', type: 'string', valuePlaceholder: '<transport>', description: 'Transport number override for unbound objects.' },
    { name: '--check-only', type: 'boolean', description: 'Syntax check only; do not activate. Not supported for ICF-routed or channel-routed JSON files (DDIC / HTTP / TRAN / XSLT / TTYP / MSAG / DDLS) — those are validated during push.' },
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
    { code: 'READONLY_METADATA', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'NO_TRANSPORT', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'LOCK_FAILED', category: 'LOCKED', exitCode: 9 },
    { code: 'SYNTAX_ERROR', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'ACTIVATION_FAILED', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'FILE_PARSE_ERROR', category: 'USAGE', exitCode: 2 },
    { code: 'VALIDATION_ERROR', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'OBJECT_NOT_FOUND', category: 'NOT_FOUND', exitCode: 8 },
    { code: 'XSLT_PUSH_FAILED', category: 'SAP_ERROR', exitCode: 6 },
    { code: 'XSLT_ACTIVATION_FAILED', category: 'VALIDATION_ERROR', exitCode: 7 },
  ],
};

export function registerPushCommand(program: Command): void {
  program
    .command('push')
    .description('Push local ABAP files to SAP')
    .argument('[files...]', 'Files to push')
    .option('--all', 'Push all files under the scan root (sourceDir or current dir; honours .abapignore)')
    .option('--tr <transport>', 'Transport number override for unbound objects')
    .option('--check-only', 'Syntax check only; do not activate')
    .option('--no-activate', 'Lock + write + skip check + skip activate + unlock')
    .option('--dry-run', 'Plan only — no mutating ADT calls')
    .option('--fail-fast', 'Stop at the first failing file (default: --keep-going)')
    .option('--atomic', 'Validate all files first; write nothing if any file fails validation')
    .option('--yes', 'Confirm in non-interactive mode')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (files: string[], opts: PushFileOptions, cmd) => {
      const mode = jsonFromCommand(cmd);
      // --schema branch — emit machine-readable parameter schema (no SAP call).
      if (cmd.optsWithGlobals().schema) {
        printSchema(SCHEMA, mode);
        return;
      }
      try {
        const result = await runPush(files, opts);
        printResult(mode, result.data, result.human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}







