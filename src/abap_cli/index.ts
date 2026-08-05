#!/usr/bin/env node

// Must be first: patches removed util.is* functions before abap-adt-api loads.
import './util-polyfill.js';
import { createRequire } from 'node:module';
import { Command, CommanderError } from 'commander';
import { CliError, renderError } from './output/json.js';
import { setProgram, buildMeta } from './output/meta.js';
import { registerInitCommand } from './commands/init.js';
import { registerPullCommand } from './commands/pull.js';
import { registerPushCommand } from './commands/push.js';
import { registerCheckCommand } from './commands/check.js';
import { registerSearchCommand } from './commands/search.js';
import { registerCreateCommand } from './commands/create.js';
import { registerAtcCommand } from './commands/atc.js';
import { registerStatusCommand } from './commands/status.js';
import { registerTransportCommand } from './commands/transport.js';
import { registerDeployCommand } from './commands/deploy.js';
import { registerConnectionCommand } from './commands/connection.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerInspectCommand } from './commands/inspect.js';
import { registerDiffCommand } from './commands/diff.js';
import { registerSyncCommand } from './commands/sync.js';
import { registerReportStuckCommand } from './commands/report-stuck.js';
import { writeStuckReport, recordFailure, shouldAutoReport } from './sync/stuck-reports.js';

const program = new Command();

// 单一版本来源：从 package.json 读取
const require = createRequire(import.meta.url);
const { version } = require('../../../package.json') as { version: string };

program
  .name('abap-cli')
  .description('CLI tool for ABAP vibe coding — agent-driven ABAP development')
  .version(version)
  .option('--json', 'Output in JSON format')
  .option('--report-stuck', 'Record a stuck report when this command fails (feedback loop, FR-023)');

// 顶层错误处理（FR-005/FR-007）：commander 抛错（缺参/未知选项）由这里归一化为
// 结构化错误；--help/--version 仍走 commander 自带输出并 exit 0。
program.exitOverride();
program.configureOutput({ writeErr: () => {} });

// Register all commands
registerInitCommand(program);
registerPullCommand(program);
registerPushCommand(program);
registerCheckCommand(program);
registerSearchCommand(program);
registerCreateCommand(program);
registerAtcCommand(program);
registerStatusCommand(program);
registerTransportCommand(program);
registerDeployCommand(program);
registerConnectionCommand(program);
registerDoctorCommand(program);
registerInspectCommand(program);
registerDiffCommand(program);
registerSyncCommand(program);
registerReportStuckCommand(program);

// 注册命令树供 buildMeta 推导规范命令名（FR-003）。
setProgram(program);

try {
  program.parse();
} catch (error: unknown) {
  const json = process.argv.includes('--json');
  if (error instanceof CommanderError) {
    // commander routes help bodies to writeErr (swallowed above) and reports
    // both `--help` and missing-required-args as help errors. Re-print the
    // right help ourselves: bare `abap` shows the top-level help (exit 0),
    // while a missing required argument shows that subcommand's help (exit 2).
    const helpShown = error.code === 'commander.helpDisplayed' || error.code === 'commander.help';
    if (helpShown) {
      if (error.code === 'commander.help') {
        const firstArg = process.argv.slice(2).find((a) => !a.startsWith('-'));
        const sub = program.commands.find((c) => c.name() === firstArg);
        if (sub) {
          console.log(sub.helpInformation());
          console.error('Missing required argument(s). See the usage above.');
          process.exit(2);
        }
        console.log(program.helpInformation());
      }
      process.exit(0);
    }
    if (error.exitCode === 0) process.exit(0);
    // Missing required argument/option: surface that subcommand's usage so the
    // caller sees exactly what is expected (the error itself follows on stderr).
    if (
      error.code === 'commander.missingArgument' ||
      error.code === 'commander.missingMandatoryOptionValue' ||
      error.code === 'commander.optionMissingArgument'
    ) {
      const firstArg = process.argv.slice(2).find((a) => !a.startsWith('-'));
      const sub = program.commands.find((c) => c.name() === firstArg);
      if (sub) console.log(sub.helpInformation());
    }
    const usage = new CliError('USAGE', error.message.replace(/^error: /, ''), {
      nextSteps: ['Check the command usage: abap <command> --help.'],
      example: 'abap <command> --help',
    });
    writeError(json, usage);
  } else {
    writeError(json, error);
  }
}

function writeError(json: boolean, error: unknown): never {
  // Feedback loop (FR-023): --report-stuck flag or ABAP_REPORT_STUCK=1 after the
  // failure threshold records a local report; the original error is unchanged.
  recordFailure();
  const reportFlag = process.argv.includes('--report-stuck');
  if (reportFlag || shouldAutoReport(process.env.ABAP_REPORT_STUCK)) {
    const err = error as { code?: string; message?: string };
    writeStuckReport({
      goal: 'unknown',
      where: process.argv.slice(2).filter((a) => !a.startsWith('--report-stuck')).join(' ') || 'abap',
      tried: `command failed: ${err.code ?? ''} ${err.message ?? ''}`,
      command: 'abap',
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      cliVersion: version,
    });
  }
  const out = renderError(json, error, buildMeta());
  for (const line of out.stderr) console.error(line);
  process.exit(out.exitCode ?? 1);
}
