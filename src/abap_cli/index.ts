#!/usr/bin/env node

// Must be first: patches removed util.is* functions before abap-adt-api loads.
import './util-polyfill.js';
import { createRequire } from 'node:module';
import { Command, CommanderError } from 'commander';
import { CliError, renderError } from './output/json.js';
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
import { registerSystemCommand } from './commands/system.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerAuthCommand } from './commands/auth.js';
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
registerSystemCommand(program);
registerDoctorCommand(program);
registerAuthCommand(program);
registerInspectCommand(program);
registerDiffCommand(program);
registerSyncCommand(program);
registerReportStuckCommand(program);

try {
  program.parse();
} catch (error: unknown) {
  const json = process.argv.includes('--json');
  if (error instanceof CommanderError) {
    // Help/version already printed to stdout; exit 0 without touching config.
    if (error.exitCode === 0) process.exit(0);
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
  const out = renderError(json, error);
  for (const line of out.stderr) console.error(line);
  process.exit(out.exitCode ?? 1);
}
