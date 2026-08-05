#!/usr/bin/env node

// Must be first: patches removed util.is* functions before abap-adt-api loads.
import './util-polyfill.js';
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { setProgram } from './output/meta.js';
import { registerLazyCommands, type LazyCommandSpec } from './commands/lazy.js';
import { writeStuckReport, recordFailure, shouldAutoReport } from './sync/stuck-reports.js';
import { handleTopLevelError } from './top-error.js';

// 声明式惰性注册（P1.6）：只有 name + description 在启动时加载，模块体在
// 命令真正被调用（或请求其 --help）时才 import。
const COMMAND_SPECS: LazyCommandSpec[] = [
  {
    name: 'init',
    scope: 'local',
    description: 'Initialize workspace configuration for SAP connection',
    load: () => import('./commands/init.js').then((m) => ({ register: m.registerInitCommand })),
  },
  {
    name: 'pull',
    description: 'Download ABAP objects from SAP to local files',
    load: () => import('./commands/pull.js').then((m) => ({ register: m.registerPullCommand })),
  },
  {
    name: 'push',
    description: 'Push local ABAP files to SAP (lock → set source → syntax check → activate → unlock)',
    load: () => import('./commands/push.js').then((m) => ({ register: m.registerPushCommand })),
  },
  {
    name: 'check',
    description: 'Validate local ABAP files: --syntax (default, against SAP), --content (local), --atc (against SAP)',
    load: () => import('./commands/check.js').then((m) => ({ register: m.registerCheckCommand })),
  },
  {
    name: 'search',
    description: 'Search for ABAP objects in SAP system',
    load: () => import('./commands/search.js').then((m) => ({ register: m.registerSearchCommand })),
  },
  {
    name: 'create',
    description: 'Create a new ABAP source object (CLAS, INTF, PROG, FUGR) and activate it',
    load: () => import('./commands/create.js').then((m) => ({ register: m.registerCreateCommand })),
  },
  {
    name: 'atc',
    description: 'DEPRECATED: ATC checks moved to `abap check --atc`',
    load: () => import('./commands/atc.js').then((m) => ({ register: m.registerAtcCommand })),
  },
  {
    name: 'status',
    description: 'Show differences between local files and SAP system (changed parts)',
    load: () => import('./commands/status.js').then((m) => ({ register: m.registerStatusCommand })),
  },
  {
    name: 'transport',
    description: 'Manage SAP transport requests',
    load: () => import('./commands/transport.js').then((m) => ({ register: m.registerTransportCommand })),
  },
  {
    name: 'deploy',
    description: 'Deploy bundled ICF ABAP service to SAP system (--dry-run/--diff preview available)',
    load: () => import('./commands/deploy.js').then((m) => ({ register: m.registerDeployCommand })),
  },
  {
    name: 'connection',
    scope: 'local',
    description: 'Manage global connection profiles',
    load: () => import('./commands/connection.js').then((m) => ({ register: m.registerConnectionCommand })),
  },
  {
    name: 'doctor',
    scope: 'local',
    description: 'Diagnose the CLI environment: environment, config, connections',
    load: () => import('./commands/doctor.js').then((m) => ({ register: m.registerDoctorCommand })),
  },
  {
    name: 'inspect',
    description: 'Inspect SAP object metadata read-only (no local files required)',
    load: () => import('./commands/inspect.js').then((m) => ({ register: m.registerInspectCommand })),
  },
  {
    name: 'activate',
    description: 'Activate all inactive items of an object (method/OSI level)',
    load: () => import('./commands/activate.js').then((m) => ({ register: m.registerActivateCommand })),
  },
  {
    name: 'diff',
    description: 'Compare local files against SAP (read-only)',
    load: () => import('./commands/diff.js').then((m) => ({ register: m.registerDiffCommand })),
  },
  {
    name: 'sync',
    description: 'Chain status / pull / push into one workflow',
    load: () => import('./commands/sync.js').then((m) => ({ register: m.registerSyncCommand })),
  },
  {
    name: 'report-stuck',
    scope: 'local',
    description: 'Record a stuck-agent report locally (feedback loop)',
    load: () => import('./commands/report-stuck.js').then((m) => ({ register: m.registerReportStuckCommand })),
  },
];

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

// Register all commands lazily (P1.6): stubs up front, modules on demand.
registerLazyCommands(program, COMMAND_SPECS);

// 注册命令树供 buildMeta 推导规范命令名（FR-003）。
setProgram(program);

try {
  // parseAsync: lazy commands (P1.6) dispatch through an async _parseCommand,
  // so commander's sync help/error throws surface as rejections that only
  // parseAsync (which awaits the chain) re-throws into this catch block.
  await program.parseAsync();
} catch (error: unknown) {
  // Feedback loop (FR-023): record the failure before the structured handler
  // runs so the stuck report captures the original error unchanged.
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
  handleTopLevelError(error, { program, argv: process.argv, version });
}
