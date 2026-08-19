#!/usr/bin/env node

// Must be first: patches removed util.is* functions before abap-adt-api loads.
import './core/polyfill.js';
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { setProgram, buildMeta } from './output/meta.js';
import { registerLazyCommands, type LazyCommandSpec } from './core/lazy.js';
import { handleTopLevelError } from './top-error.js';
import { ExtensionRegistry, setExtensionRegistry } from './extensions/registry.js';
import { setExtensionRegistry as setExtRegJson, CliError, renderError } from './output/json.js';
import { EXIT_GENERIC_FALLBACK } from './output/exit-codes.js';
import { loadConfig } from './config/project-config.js';

// 声明式惰性注册（P1.6）：只有 name + description 在启动时加载，模块体在
// 命令真正被调用（或请求其 --help）时才 import。
const COMMAND_SPECS: LazyCommandSpec[] = [
  {
    name: 'init',
    scope: 'local',
    description: 'Initialize the workspace: bind a profile (write .abap.json) and/or scaffold AI agent context. Run bare `abap init` for the interactive wizard.',
    load: () => import('./commands/init.js').then((m) => ({ register: m.registerInitCommand })),
  },
  {
    name: 'config',
    scope: 'local',
    description: 'Show or modify the current workspace configuration (.abap.json). Does not manage profiles — use `abap profile` for that.',
    load: () => import('./commands/config.js').then((m) => ({ register: m.registerConfigCommand })),
  },
  {
    name: 'pull',
    description: 'Download ABAP objects from SAP to local files',
    load: () => import('./commands/pull.js').then((m) => ({ register: m.registerPullCommand })),
  },
  {
    name: 'run',
    scope: 'sap',
    description: 'Execute an ABAP class (classrun) or a static method via the bundled runner wrapper; returns stdout + exit code (read-only).',
    load: () => import('./commands/run.js').then((m) => ({ register: m.registerRunCommand })),
  },
  {
    name: 'select',
    scope: 'sap',
    description: 'Query table data read-only via the bundled ICF /data endpoint (SE16N equivalent): --table ZTAB [--fields ...] [--where ...] [--limit N] [--offset N] [--order-by ...] [--count-only].',
    load: () => import('./commands/select.js').then((m) => ({ register: m.registerSelectCommand })),
  },
  {
    name: 'push',
    description: 'Push local ABAP files to SAP (lock → set source → syntax check → activate → unlock)',
    load: () => import('./commands/push.js').then((m) => ({ register: m.registerPushCommand })),
  },
  {
    name: 'check',
    description: 'Validate local ABAP files. Subcommands: syntax (default), content (local-only), atc.',
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
    name: 'extension',
    description: 'Manage the bundled ICF ABAP extension. Subcommands: deploy (install/update), status (probe installation).',
    load: () => import('./commands/extension.js').then((m) => ({ register: m.registerExtensionCommand })),
  },
  {
    name: 'profile',
    scope: 'local',
    description: 'Manage global connection profiles. Run `abap init --profile <name>` to bind the current workspace.',
    load: () => import('./commands/profile.js').then((m) => ({ register: m.registerProfileCommand })),
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
    name: 'where-used',
    scope: 'sap',
    description: 'Find direct references to a SAP object (read-only): where-used ZCL_MY_CLASS [--type CLAS] [--ref-type ...] [--package ...] [--limit N].',
    load: () => import('./commands/where-used.js').then((m) => ({ register: m.registerWhereUsedCommand })),
  },
  {
    name: 'tcode',
    scope: 'sap',
    description: 'Resolve a transaction code to its configured ABAP entry program and screen (read-only).',
    load: () => import('./commands/tcode.js').then((m) => ({ register: m.registerTcodeCommand })),
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
    name: 'extensions',
    scope: 'local',
    description: 'Manage installed extensions. Subcommands: list.',
    load: () => import('./commands/extensions.js').then((m) => ({ register: m.registerExtensionsCommand })),
  },
];

const require = createRequire(import.meta.url);
const { version } = require('../../../package.json') as { version: string };

const program = new Command();

// .name() controls the "Usage:" line in --help. It must match the bin name in
// package.json ("abap"), not the package name — users invoke `abap`, never
// `abap-cli`, so the help line shows the real command.
program
  .name('abap')
  .description('CLI tool for ABAP vibe coding — agent-driven ABAP development')
  .version(version)
  .option('--json', 'Output in JSON format');

// 顶层错误处理（FR-005/FR-007）：commander 抛错（缺参/未知选项）由这里归一化为
// 结构化错误；--help/--version 让 commander 自己写 stdout（包含 addHelpText
// 后置 section），我们在 catch 里只补 USAGE/JSON 信封和退出码，避免重复。
program.exitOverride();
program.configureOutput({ writeErr: () => {} });

// Register all commands lazily (P1.6): stubs up front, modules on demand.
registerLazyCommands(program, COMMAND_SPECS);

setProgram(program);

// Load project config and extensions before parsing commands
let registry: ExtensionRegistry;
try {
  const config = await loadConfig();
  registry = new ExtensionRegistry();
  await registry.loadAndRegisterExtensions(program, config.extensions ?? []);
} catch (err) {
  // Extension loading failures are non-fatal in lenient mode.
  // Strict mode errors (EXTENSION_LOAD_FAILED) are fatal — exit with proper code + error envelope.
  if (err instanceof CliError && err.code === 'EXTENSION_LOAD_FAILED') {
    // Fatal: exit with the JSON error envelope even in human mode, so the
    // error code is visible to the caller (test / script).  This runs before
    // parseAsync so Commander's own error handling is not yet active.
    const out = renderError(true, err, buildMeta());
    for (const line of out.stderr) console.error(line);
    process.exit(out.exitCode ?? EXIT_GENERIC_FALLBACK);
  }
  registry = new ExtensionRegistry();
}

// Set singletons for json.ts and list-command.ts
setExtensionRegistry(registry);
setExtRegJson(registry);

// Install lifecycle hooks globally once (FR-007)
program.hook('preAction', async (_thisCmd, actionCmd) => {
  const argv = process.argv.slice(2);
  const cmdName = actionCmd.name();
  await registry.dispatch('beforeCommand', {
    command: cmdName,
    argv,
    ts: Date.now(),
  });
});

program.hook('postAction', async (_thisCmd, actionCmd) => {
  const argv = process.argv.slice(2);
  const cmdName = actionCmd.name();
  await registry.dispatch('afterCommand', {
    command: cmdName,
    argv,
    ts: Date.now(),
  });
});

try {
  // parseAsync: lazy commands (P1.6) dispatch through an async _parseCommand,
  // so commander's sync help/error throws surface as rejections that only
  // parseAsync (which awaits the chain) re-throws into this catch block.
  await program.parseAsync();
} catch (error: unknown) {
  handleTopLevelError(error, { program, argv: process.argv, version }, undefined, undefined, registry);
}
