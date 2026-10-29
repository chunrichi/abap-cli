#!/usr/bin/env node

// Must be first: patches removed util.is* functions before abap-adt-api loads.
import './core/polyfill.js';
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { setProgram, buildMeta } from './output/meta.js';
import { registerLazyCommands } from './registry/lazy.js';
import { COMMAND_SPECS } from './registry/commands.js';
import { handleTopLevelError } from './top-error.js';
import { loadConfig } from './config/project-config.js';
import { installSignalHandlers } from './session/signals.js';
import { runAlwaysLogoutIfNeeded } from './session/end-of-command.js';


const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

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

// Workspace config + extension lockfile are resolved lazily on the first
// dispatch. This keeps commands that don't need `.abap.json` (init, profile,
// doctor, `--help`, `--version`) from being blocked by the CONFIG_ERROR
// thrown when no profile is bound yet. The promise is shared so the
// preAction and postAction hooks see the same resolved config.
const configPromise = (async (): Promise<Awaited<ReturnType<typeof loadConfig>> | null> => {
  try {
    // No secret: local/meta commands must not touch the OS keychain; SAP
    // commands re-load the config (and resolve credentials) themselves.
    return await loadConfig({ withSecret: false });
  } catch {
    // Missing or invalid `.abap.json` — fall back to no config. Commands
    // that need it (deploy, session, extensions-lock, …) re-call
    // `loadConfig()` themselves and surface the same CliError to the user.
    return null;
  }
})();

// Install lifecycle hooks globally once. Load the remaining (non-command)
// extensions on each dispatch so the user's real command always sees a
// fully-loaded validation + lifecycle set. The config + lockfile are awaited
// here so commands that need them (and the extension loader that uses
// `config.extensions`) see the resolved values, while meta/help/version paths
// never block on a missing profile.
program.hook('postAction', async (_thisCmd, actionCmd) => {
  // 034: release SAP sessions at command end when the policy demands it
  // (`always-logout`). The default `reuse` policy intentionally keeps the
  // session alive so the next CLI process can reuse it. Skipped when no
  // config was resolved (e.g. `init` in an unconfigured workspace).
  const config = await configPromise;
  if (config) {
    await runAlwaysLogoutIfNeeded(config);
  }
});

// 034: SIGINT/SIGTERM best-effort release of any live SAP session.
installSignalHandlers();

try {
  // parseAsync: lazy commands dispatch through an async _parseCommand,
  // so commander's sync help/error throws surface as rejections that only
  // parseAsync (which awaits the chain) re-throws into this catch block.
  await program.parseAsync();
} catch (error: unknown) {
  handleTopLevelError(error, { program, argv: process.argv, version });
}
