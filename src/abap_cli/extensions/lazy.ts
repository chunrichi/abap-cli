/**
 * Lazy extension loading — argv first-word sniff.
 *
 * Startup must not `import()` any extension module. Two trigger points replace
 * the eager load: this argv sniff (so extension-contributed command names are
 * reachable by commander) and a `preAction` hook (validation / lifecycle).
 */

import type { Command } from 'commander';
import type { ExtensionManifest } from './types.js';
import { getExtensionRegistry } from './registry.js';

/** Reason a sniff decided not to load anything. */
export type SkipReason = 'help' | 'version' | 'doctor' | 'builtin-command' | 'empty-argv';

/** Context handed to the lazy trigger points. */
export interface LazyLoadContext {
  commandName: string;
  argv: string[];
  skipReason?: SkipReason;
}

/**
 * Built-in command names — kept in sync with `index.ts:COMMAND_SPECS`.
 * A built-in name can never be contributed by an extension (registry rejects
 * duplicates), so seeing one means no extension needs to load pre-parse.
 */
export const BUILTIN_COMMANDS: ReadonlySet<string> = new Set([
  'init', 'pull', 'run', 'select', 'push', 'check', 'search', 'create',
  'status', 'transport', 'extension', 'profile', 'doctor', 'inspect',
  'where-used', 'tcode', 'activate', 'diff', 'extensions',
]);

/** Classify why the sniff should skip loading, or null when a load is needed. */
export function classifySkipReason(firstArg: string | undefined): SkipReason | null {
  if (firstArg === undefined || firstArg === '') return 'empty-argv';
  if (firstArg === '--help' || firstArg === '-h' || firstArg === 'help') return 'help';
  if (firstArg === '--version' || firstArg === '-V') return 'version';
  if (firstArg === 'doctor') return 'doctor';
  if (BUILTIN_COMMANDS.has(firstArg)) return 'builtin-command';
  return null;
}

/**
 * Resolve the candidate command name from a raw `process.argv`.
 * Returns null when the first word is a flag or absent.
 */
export function detectCommandName(argv: string[]): string | null {
  const firstArg = argv[2];
  if (!firstArg || firstArg.startsWith('-')) return null;
  return firstArg;
}

/** True when `name` matches a `type:'command'` manifest entry. */
export function isCommandExtensionMatch(name: string, extensions: ExtensionManifest[]): boolean {
  return extensions.some((m) => m.type === 'command' && m.name === name);
}

/**
 * Pre-parse trigger: load only `type:'command'` extensions when argv's first
 * word is not a built-in / help / version / doctor path.
 *
 * Meta-commands (`extensions list`, `extensions lock`) are special: they need
 * a full picture of every registered extension regardless of the lazy-load
 * skip. For them we load ALL command extensions so conflicts and per-entry
 * lockfile state surface in `extensions list --json`.
 *
 * Failures follow 023 lenient/strict semantics — the registry collects them.
 */
export async function tryLoadCommandExtensionsForArgv(
  program: Command,
  extensions: ExtensionManifest[] | undefined,
  argv: string[],
): Promise<{ loaded: boolean; skipReason?: SkipReason }> {
  const skipReason = classifySkipReason(argv[2]);
  if (skipReason !== null) return { loaded: false, skipReason };

  if (!extensions || extensions.length === 0) return { loaded: false };

  await getExtensionRegistry().loadCommandExtensions(program, extensions);
  return { loaded: true };
}

/**
 * Force-load all extensions (validation + lifecycle + command) for the
 * meta-commands `extensions list` and `extensions lock`. Returns true when
 * the current argv is one of those meta-commands.
 */
export function isMetaExtensionsCommand(argv: string[]): boolean {
  if (argv[2] !== 'extensions') return false;
  const sub = argv[3];
  return sub === 'list' || sub === 'lock';
}
