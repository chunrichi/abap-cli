import { Command } from 'commander';
import {
  CliError,
  printError,
  printResult,
  printSchema,
  jsonFromCommand,
  type OutputMode,
  type CommandSchema,
} from '../output/json.js';
import {
  runDoctorChecks,
  applySafeFixes,
  remainingIssues,
  type DoctorReport,
  type DoctorFixApplied,
  type DoctorRemaining,
} from '../flows/setup/doctor-checks.js';
import { baseSchema, schemaOption } from './schema-helpers.js';

export const SCHEMA: CommandSchema = {
  ...baseSchema('doctor', 'Diagnose CLI environment and configuration (read-only; no live SAP probes).', 'abap doctor [options]', 'local'),
  arguments: [],
  options: [
    { name: '--verbose', type: 'boolean', description: 'Include detail (versions, paths, underlying messages).' },
    { name: '--strict', type: 'boolean', description: 'Exit 3 with CONFIG_ERROR when any environment/config check fails (CI / agent gate).' },
    { name: '--fix', type: 'boolean', description: 'Apply safe, reversible fixes (requires --yes).' },
    { name: '--yes', type: 'boolean', description: 'Confirm --fix without prompting.' },
    schemaOption(),
  ],
  // --pretty-json is a global flag; the envelope honours it for this command too.
  globalOptions: ['--json', '--pretty-json'],
  examples: [
    { description: 'Diagnose the environment', command: 'abap doctor' },
    { description: 'Gate on a healthy environment (exit 3 when not ok)', command: 'abap doctor --strict --json' },
    { description: 'Apply safe fixes', command: 'abap doctor --fix --yes' },
  ],
  errors: [
    { code: 'VALIDATION_ERROR', category: 'VALIDATION_ERROR', exitCode: 7 },
    { code: 'CONFIG_ERROR', category: 'CONFIG_ERROR', exitCode: 3 },
  ],
};

interface DoctorOptions {
  verbose?: boolean;
  strict?: boolean;
  fix?: boolean;
  yes?: boolean;
}

/** Fix bookkeeping emitted by `--fix --yes` (absent otherwise). */
interface FixReport {
  applied: DoctorFixApplied[];
  remaining: DoctorRemaining[];
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose CLI environment and configuration (read-only)')
    .option('--verbose', 'Include detail (versions, paths, messages)')
    .option('--strict', 'Exit 3 (CONFIG_ERROR) when any check fails')
    .option('--fix', 'Apply safe, reversible fixes (requires --yes)')
    .option('--yes', 'Confirm --fix without prompting')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (opts: DoctorOptions, cmd) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema) {
        printSchema(SCHEMA, mode);
        return;
      }
      try {
        await runDoctor(opts, mode);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}

/** Build the `data` payload. `ok` is always present so a gate can branch on
 *  one boolean instead of scanning both sections. */
function doctorData(report: DoctorReport, fix?: FixReport): Record<string, unknown> {
  const data: Record<string, unknown> = {
    ok: report.ok,
    environment: report.environment,
    config: report.config,
    nextSteps: report.nextSteps,
  };
  if (fix) {
    data.fixed = fix.applied.length;
    data.fixesApplied = fix.applied;
    data.remaining = fix.remaining;
  }
  return data;
}

async function runDoctor(opts: DoctorOptions, mode: OutputMode): Promise<void> {
  if (opts.fix && !opts.yes && !process.stdin.isTTY) {
    throw new CliError('VALIDATION_ERROR', '--fix is a write operation; confirm with --yes.', {
      nextSteps: ['Re-run with --yes to apply safe, reversible fixes.', 'Review the report first: abap doctor --json'],
      example: 'abap doctor --fix --yes',
    });
  }

  let report = await runDoctorChecks({ verbose: opts.verbose });
  let fix: FixReport | undefined;

  if (opts.fix && opts.yes) {
    const applied = applySafeFixes();
    // Re-diagnose after fixing so `data.ok` / `data.remaining` describe the
    // post-fix state instead of the findings that triggered the fix.
    report = await runDoctorChecks({ verbose: opts.verbose });
    fix = { applied, remaining: remainingIssues(report) };
  }

  if (opts.strict && !report.ok) {
    const failing = [...report.environment, ...report.config].filter((item) => item.status === 'err');
    throw new CliError(
      'CONFIG_ERROR',
      `Doctor found ${failing.length} blocking issue(s): ${failing.map((item) => item.key).join(', ')}.`,
      {
        details: {
          ok: false,
          issues: failing.map((item) => ({ key: item.key, message: item.message })),
          ...(fix ? { fixed: fix.applied.length, fixesApplied: fix.applied } : {}),
        },
        nextSteps: report.nextSteps,
      },
    );
  }

  printResult(mode, doctorData(report, fix), humanize(report, fix), undefined, {
    ...(fix ? { preserveEmpty: ['fixesApplied', 'remaining'] } : {}),
  });
}

function humanize(report: DoctorReport, fix?: FixReport): string {
  const lines: string[] = [`ok: ${report.ok}`];
  for (const [label, section] of [
    ['environment', report.environment],
    ['config', report.config],
  ] as const) {
    lines.push(`${label}:`);
    for (const item of section) {
      lines.push(`  ${item.key}: ${item.status}${item.message ? ` — ${item.message}` : ''}`);
    }
  }
  if (fix) {
    lines.push(`fixes: ${fix.applied.length} applied, ${fix.remaining.length} remaining`);
    for (const applied of fix.applied) lines.push(`  applied ${applied.id}: ${applied.action}`);
  }
  if (report.nextSteps.length > 0) {
    lines.push('nextSteps:');
    for (const step of report.nextSteps) lines.push(`  - ${step}`);
  }
  return lines.join('\n');
}
