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
import { installSignalHandlers } from './session/signals.js';
import { runAlwaysLogoutIfNeeded } from './session/end-of-command.js';

// 声明式惰性注册：只有 name + description 在启动时加载，模块体在
// 命令真正被调用（或请求其 --help）时才 import。
const COMMAND_SPECS: LazyCommandSpec[] = [
  {
    name: 'init',
    scope: 'local',
    description: 'Initialize the workspace (bind a profile, write .abap.json) and/or scaffold AI agent context',
    load: () => import('./commands/init.js').then((m) => ({ register: m.registerInitCommand })),
  },
  {
    name: 'pull',
    description: 'Download ABAP objects from SAP to local files',
    load: () => import('./commands/pull.js').then((m) => ({ register: m.registerPullCommand })),
  },
  {
    name: 'run',
    scope: 'sap',
    description: 'Execute ABAP class (classrun) or PUBLIC STATIC method; returns stdout + exit code',
    load: () => import('./commands/run.js').then((m) => ({ register: m.registerRunCommand })),
  },
  {
    name: 'select',
    scope: 'sap',
    description: 'Query table data read-only (SE16N equivalent) via the bundled ICF /data endpoint',
    load: () => import('./commands/select.js').then((m) => ({ register: m.registerSelectCommand })),
  },
  {
    name: 'push',
    description: 'Push local ABAP files to SAP',
    load: () => import('./commands/push.js').then((m) => ({ register: m.registerPushCommand })),
  },
  {
    name: 'check',
    description: 'Validate ABAP source code (syntax / content / atc)',
    load: () => import('./commands/check.js').then((m) => ({ register: m.registerCheckCommand })),
  },
  {
    name: 'search',
    description: 'Search for ABAP objects in SAP system',
    load: () => import('./commands/search.js').then((m) => ({ register: m.registerSearchCommand })),
  },
  {
    name: 'create',
    description: 'Create and activate a new ABAP object (CLAS, INTF, PROG, FUGR, TABL, STRU, DOMA, DTEL, HTTP)',
    load: () => import('./commands/create.js').then((m) => ({ register: m.registerCreateCommand })),
  },
  {
    name: 'status',
    description: 'Show local vs SAP sync status',
    load: () => import('./commands/status.js').then((m) => ({ register: m.registerStatusCommand })),
  },
  {
    name: 'transport',
    description: 'Manage transport requests',
    load: () => import('./commands/transport.js').then((m) => ({ register: m.registerTransportCommand })),
  },
  {
    name: 'deploy',
    description: 'Deploy bundled ICF ABAP service to SAP',
    load: () => import('./commands/deploy.js').then((m) => ({ register: m.registerDeployCommand })),
  },
  {
    name: 'profile',
    scope: 'local',
    description: 'Manage global connection profiles',
    load: () => import('./commands/profile.js').then((m) => ({ register: m.registerProfileCommand })),
  },
  {
    name: 'doctor',
    scope: 'local',
    description: 'Diagnose CLI environment and configuration',
    load: () => import('./commands/doctor.js').then((m) => ({ register: m.registerDoctorCommand })),
  },
  {
    name: 'inspect',
    description: 'View ABAP object metadata',
    load: () => import('./commands/inspect.js').then((m) => ({ register: m.registerInspectCommand })),
  },
  {
    name: 'where-used',
    scope: 'sap',
    description: 'Find SAP object references (read-only)',
    load: () => import('./commands/where-used.js').then((m) => ({ register: m.registerWhereUsedCommand })),
  },
  {
    name: 'tcode',
    scope: 'sap',
    description: 'Resolve transaction code to its ABAP entry program (read-only)',
    load: () => import('./commands/tcode.js').then((m) => ({ register: m.registerTcodeCommand })),
  },
  {
    name: 'activate',
    description: 'Activate inactive ABAP objects',
    load: () => import('./commands/activate.js').then((m) => ({ register: m.registerActivateCommand })),
  },
  {
    name: 'diff',
    description: 'Compare local files against SAP',
    load: () => import('./commands/diff.js').then((m) => ({ register: m.registerDiffCommand })),
  },
  {
    name: 'dumps',
    scope: 'sap',
    description: 'List recent ST22 ABAP runtime dumps (read-only)',
    load: () => import('./commands/dumps.js').then((m) => ({ register: m.registerDumpsCommand })),
  },
  {
    name: 'extensions',
    scope: 'local',
    description: 'Manage installed extensions',
    load: () => import('./commands/extensions.js').then((m) => ({ register: m.registerExtensionsCommand })),
  },
  {
    name: 'mime',
    scope: 'sap',
    description: 'Create, delete, or upload MIME Repository resources (create | delete | push)',
    load: () => import('./commands/mime.js').then((m) => ({ register: m.registerMimeCommand })),
  },
  {
    // Two-segment command name: `abap validate:aff <file-or-dir> ...`.
    // Lazy-loaded like any other command so it doesn't bloat startup.
    name: 'validate:aff',
    description: 'Validate JSON files against official abap-file-format (AFF) canonical schemas (Draft 2020-12)',
    load: () => import('./commands/validate-aff.js').then((m) => ({ register: m.registerValidateAffCommand })),
  },
  {
    // 034: session reuse inspector — read-only, no SAP traffic.
    name: 'session',
    description: 'Inspect / manage session cookie reuse state',
    load: () => import('./commands/session.js').then((m) => ({ register: m.registerSessionCommand })),
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
  .option('--json', 'Output in JSON format (compact, default for agents)')
  .option('--pretty-json', 'Output in pretty JSON format (overrides --json)');

// 顶层错误处理：commander 抛错（缺参/未知选项）由这里归一化为
// 结构化错误；--help/--version 让 commander 自己写 stdout（包含 addHelpText
// 后置 section），我们在 catch 里只补 USAGE/JSON 信封和退出码，避免重复。
program.exitOverride();
program.configureOutput({ writeErr: () => {} });

// Register all commands lazily: stubs up front, modules on demand.
registerLazyCommands(program, COMMAND_SPECS);

setProgram(program);

// Load extensions lazily. The argv sniff registers only
// `type:'command'` extensions whose name matches argv[2]; validation and
// lifecycle extensions defer to the preAction hook so that
// `--help` / `--version` / `doctor` / empty-argv invocations never
// import any extension module.
const config = await loadConfig();
const registry = new ExtensionRegistry();
let extensionsLockfile: Awaited<ReturnType<typeof import('./extensions/lockfile.js').readLockfile>> = null;
let extensionsLockfilePath: string | undefined;
try {
  const { readLockfile, extensionsLockPath } = await import('./extensions/lockfile.js');
  const configDir = await import('./config/project-config.js').then((m) => m.findWorkspaceConfig());
  if (configDir) {
    extensionsLockfilePath = extensionsLockPath(require('node:path').dirname(configDir));
    extensionsLockfile = await readLockfile(require('node:path').dirname(configDir));
  }
} catch {
  // Lockfile unreadable — treat as absent; loader will surface per-entry failures.
}
const loadCtx = { lock: extensionsLockfile, lockfilePath: extensionsLockfilePath };

try {
  const { tryLoadCommandExtensionsForArgv, isMetaExtensionsCommand } = await import('./extensions/lazy.js');
  if (isMetaExtensionsCommand(process.argv)) {
    // Meta-commands need the full extension picture (per-entry conflicts,
    // per-entry lockfile status, etc.).
    await registry.loadAndRegisterExtensions(program, config.extensions ?? [], loadCtx);
  } else {
    await tryLoadCommandExtensionsForArgv(program, config.extensions ?? [], process.argv);
  }
} catch (err) {
  if (err instanceof CliError && err.code === 'EXTENSION_LOAD_FAILED') {
    const out = renderError('json', err, buildMeta());
    for (const line of out.stderr) console.error(line);
    process.exit(out.exitCode ?? EXIT_GENERIC_FALLBACK);
  }
  // Surface non-fatal load failures into registry.failed via loadRemainingExtensions.
  await registry.loadRemainingExtensions(program, config.extensions ?? [], loadCtx);
}

// Set singletons for json.ts and list-command.ts
setExtensionRegistry(registry);
setExtRegJson(registry);

// Install lifecycle hooks globally once. Load the remaining (non-command)
// extensions on each dispatch so the user's real command always sees a
// fully-loaded validation + lifecycle set.
program.hook('preAction', async (_thisCmd, actionCmd) => {
  const argv = process.argv.slice(2);
  const cmdName = actionCmd.name();
  // Strict-mode failures exit with a hardcoded JSON envelope (matches the
  // baseline behavior for `EXTENSION_LOAD_FAILED`); nothing further runs.
  await registry.loadRemainingExtensions(program, config.extensions ?? [], loadCtx);
  await registry.dispatchBeforeCommand({
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
  // 034: release SAP sessions at command end when the policy demands it
  // (`always-logout`). The default `reuse` policy intentionally keeps the
  // session alive so the next CLI process can reuse it.
  await runAlwaysLogoutIfNeeded(config);
});

// 034: SIGINT/SIGTERM best-effort release of any live SAP session.
installSignalHandlers();

try {
  // parseAsync: lazy commands dispatch through an async _parseCommand,
  // so commander's sync help/error throws surface as rejections that only
  // parseAsync (which awaits the chain) re-throws into this catch block.
  await registry.dispatch('beforeParse', {
    command: process.argv[2] ?? '',
    argv: process.argv.slice(2),
  });
  await program.parseAsync();
} catch (error: unknown) {
  handleTopLevelError(error, { program, argv: process.argv, version }, undefined, undefined, registry);
}
