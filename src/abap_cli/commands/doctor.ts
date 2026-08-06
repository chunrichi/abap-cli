import { Command } from 'commander';
import { CliError, printError, printResult, jsonFromCommand } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';
import { runDoctorChecks, applySafeFixes } from '../flows/doctor-checks.js';

interface DoctorOptions {
  verbose?: boolean;
  fix?: boolean;
  yes?: boolean;
  system?: string;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose the CLI environment: environment, config, connections')
    .addHelpText('after', commonErrorsAfter())
    .option('--verbose', 'Include detail (versions, paths, underlying messages)')
    .option('--fix', 'Apply only safe, reversible fixes (requires --yes in non-interactive environments)')
    .option('--yes', 'Confirm --fix without prompting')
    .option('--system <name>', 'Scope the connection section to a named profile')
    .action(async (opts: DoctorOptions, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        await runDoctor(opts, json);
      } catch (error: unknown) {
        printError(json, error);
      }
    });
}

async function runDoctor(opts: DoctorOptions, json: boolean): Promise<void> {
  if (opts.fix && !opts.yes && !process.stdin.isTTY) {
    throw new CliError('VALIDATION_ERROR', '--fix is a write operation; confirm with --yes.', {
      nextSteps: ['Re-run with --yes to apply safe, reversible fixes.', 'Review the report first: abap doctor --json'],
      example: 'abap doctor --fix --yes',
    });
  }

  const report = await runDoctorChecks({ verbose: opts.verbose, system: opts.system });

  let human: string;
  if (opts.fix && opts.yes) {
    const fixesApplied = applySafeFixes();
    report.fixesApplied = fixesApplied;
    human =
      `Doctor report (${fixesApplied.length > 0 ? 'fixes applied' : 'no fixes needed'}):\n` +
      humanize(report);
  } else {
    human = humanize(report);
  }

  printResult(json, report, human);
}

function humanize(report: { environment: { key: string; status: string; message: string }[]; config: { key: string; status: string; message: string }[]; connection: { key: string; status: string; message: string }[]; nextSteps: string[] }): string {
  const lines: string[] = [];
  for (const [label, section] of [
    ['environment', report.environment],
    ['config', report.config],
    ['connection', report.connection],
  ] as const) {
    lines.push(`${label}:`);
    for (const item of section) {
      lines.push(`  ${item.key}: ${item.status}${item.message ? ` — ${item.message}` : ''}`);
    }
  }
  if (report.nextSteps.length > 0) {
    lines.push('nextSteps:');
    for (const s of report.nextSteps) lines.push(`  - ${s}`);
  }
  return lines.join('\n');
}
