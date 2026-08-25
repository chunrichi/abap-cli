import { Command } from 'commander';
import { printError, printResult, jsonFromCommand } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';
import {
  buildDryRun,
  runRun,
  validateClassName,
  validateMethodName,
  validateTimeout,
} from '../flows/run-flow.js';

const SCHEMA = {
  command: 'run',
  description:
    'Execute an ABAP class (classrun) or a static method via the bundled runner wrapper; returns stdout + exit code (read-only).',
  scope: 'sap',
  arguments: [
    {
      name: 'class-name',
      type: 'string',
      required: true,
      pattern: '^[A-Za-z][A-Za-z0-9_~]{0,29}$',
      description:
        'Target ABAP class name (e.g. ZCL_MY_THING). Local classes with `~` are rejected with LOCAL_CLASS_NOT_RUNNABLE.',
    },
  ],
  options: [
    {
      name: '--method',
      type: 'string',
      required: false,
      pattern: '^[A-Za-z_][A-Za-z0-9_]*$',
      description:
        'PUBLIC STATIC method name to invoke via ZCL_ABAP_VIBE_RUNNER. When omitted, the class is run via ADT classrun (if_oo_adt_classrun~main).',
    },
    {
      name: '--args',
      type: 'json',
      required: false,
      default: '{}',
      description:
        'JSON object of method arguments, mapped to IMPORTING parameters (case-insensitive). Must be a JSON object, not array/null.',
    },
    {
      name: '--timeout',
      type: 'number',
      required: false,
      default: 30000,
      minimum: 100,
      maximum: 600000,
      description:
        'Maximum execution time in ms. Wrapper path enforces server-side via cl_abap_runtime; classrun path uses ADT endpoint timeout (~5min) plus CLI-side AbortController fallback.',
    },
    {
      name: '--dry-run',
      type: 'boolean',
      required: false,
      default: false,
      description: 'Plan only — print the request envelope without invoking ADT classrun.',
    },
    {
      name: '--json',
      type: 'boolean',
      required: false,
      default: false,
      global: true,
      description: 'Emit the unified JSON envelope on stdout (012 output contract).',
    },
    {
      name: '--schema',
      type: 'boolean',
      required: false,
      default: false,
      description: 'Print this schema as JSON and exit 0 without any SAP call.',
    },
  ],
  exclusive: [
    '--schema runs alone (rejected with INVALID_ARGUMENT if combined with class-name or --method)',
  ],
  examples: [
    { description: 'Trigger classrun (no --method)', command: 'abap run ZCL_MY_THING' },
    {
      description: 'Invoke a static method with arguments',
      command: 'abap run ZCL_MY_HELPER --method compute --args \'{"x":3,"y":5}\'',
    },
    { description: 'Dry-run with timeout', command: 'abap run ZCL_LONG_RUN --timeout 60000 --dry-run' },
    {
      description: 'Agent integration: JSON envelope',
      command: 'abap run ZCL_FOO --method bar --args \'{}\' --json',
    },
  ],
  errors: [
    { code: 'METHOD_FAILED', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'METHOD_NOT_SUPPORTED', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'CLASS_NOT_RUNNABLE', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'OBJECT_NOT_ACTIVE', category: 'SAP_ERROR', exitCode: 6 },
    { code: 'LOCAL_CLASS_NOT_RUNNABLE', category: 'SAP_ERROR', exitCode: 6 },
    { code: 'TIMEOUT', category: 'SAP_ERROR', exitCode: 6 },
    { code: 'WRAPPER_NOT_DEPLOYED', category: 'NOT_FOUND', exitCode: 8 },
    { code: 'OBJECT_NOT_FOUND', category: 'NOT_FOUND', exitCode: 8 },
    { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
  ],
};

export function registerRunCommand(program: Command): void {
  program
    .command('run')
    .description(
      'Execute ABAP class (classrun) or PUBLIC STATIC method; returns stdout + exit code',
    )
    .addHelpText('after', commonErrorsAfter())
    .argument('[class-name]', 'Class name (e.g. ZCL_MY_THING)')
    .option('--method <name>', 'PUBLIC STATIC method to invoke via ZCL_ABAP_VIBE_RUNNER')
    .option('--args <json>', 'Method arguments JSON', '{}')
    .option('--timeout <ms>', 'Execution timeout in ms (100–600000)', '30000')
    .option('--dry-run', 'Print the request envelope without invoking ADT classrun')
    .option('--schema', 'Print the command parameter schema as JSON and exit 0')
    .action(
      async (
        className: string | undefined,
        opts: {
          method?: string;
          args?: string;
          timeout?: string;
          dryRun?: boolean;
        },
        cmd: Command,
      ) => {
        const mode = jsonFromCommand(cmd);

        // --schema branch — emit machine-readable parameter schema, no SAP call.
        if (cmd.optsWithGlobals().schema) {
          console.log(JSON.stringify(SCHEMA, null, mode === 'pretty-json' ? 2 : 0));
          return;
        }

        if (!className) {
          // Bare `abap run` — print command help (mirrors pull/config behaviour).
          process.stdout.write(cmd.helpInformation());
          return;
        }

        try {
          // Pre-validate cheap fields so command-line errors surface before
          // any flow / wrapper logic.
          validateClassName(className);
          if (opts.method) validateMethodName(opts.method);
          validateTimeout(opts.timeout);

          if (opts.dryRun) {
            const dry = buildDryRun(className, {
              method: opts.method,
              args: opts.args,
              timeout: opts.timeout,
            });
            printResult(mode, dry, formatHuman(dry));
            return;
          }

          const result = await runRun(className, {
            method: opts.method,
            args: opts.args,
            timeout: opts.timeout,
          });
          printResult(mode, result, formatHuman(result));
        } catch (error: unknown) {
          printError(mode, error);
        }
      },
    );
}

function formatHuman(result: ReturnType<typeof buildDryRun>): string {
  const lines: string[] = [];
  lines.push(`route: ${result.route}`);
  if (result.dryRun) {
    lines.push(`(dry-run) would run classrun`);
    lines.push(`className: ${result.className}`);
    if (result.method) lines.push(`method:    ${result.method}`);
    lines.push(`timeout:   ${result.timeout}ms`);
    return lines.join('\n');
  }
  lines.push(`exit:    ${result.exitCode}`);
  lines.push(`time:    ${result.durationMs}ms`);
  if (result.method) lines.push(`method:  ${result.method}`);
  if (result.output) lines.push('--- stdout ---');
  if (result.output) lines.push(result.output);
  return lines.join('\n');
}