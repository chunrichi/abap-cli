/**
 * Lazy command registration.
 *
 * index.ts declares every command by name + description only; the heavy module
 * import is deferred until that command is actually addressed. Each spec
 * contributes a lightweight stub command so `abap --help` stays fast and
 * dependency-light.
 *
 * Stubs are plain commander commands: no private parser internals are patched.
 * Instead, `primeLazyCommands()` runs before `program.parseAsync()` in
 * index.ts, resolves the command the user addressed (first positional token,
 * including the `help <cmd>` form), and replaces that stub with the module's
 * real registration. Root help, `--version`, and unknown commands never match
 * a spec and therefore stay import-free.
 *
 * The module's `register(program)` keeps the existing
 * `register<Name>Command(program: Command): void` shape (it creates the real
 * command as a child of `program`), so priming removes the stub and
 * re-registers the command at the same position in the root command list.
 */

import type { Command } from 'commander';

export type CommandScope = 'local' | 'sap';

export interface LazyCommandSpec {
  /** Command name as typed on the CLI, e.g. 'pull' (no positional args). */
  name: string;
  /** One-line description shown in root help (must match the module). */
  description: string;
  /**
   * Whether the command talks to SAP. Used by root --help to group commands
   * under "Local Commands" / "SAP Commands" sections. Defaults to 'sap'
   * so existing specs stay grouped with the SAP section unless explicitly
   * overridden.
   */
  scope?: CommandScope;
  /** Dynamic import returning the module with a register(program) function. */
  load: () => Promise<{ register: (program: Command) => void }>;
}

interface LazyRegistry {
  specs: Map<string, LazyCommandSpec>;
  stubs: Map<string, Command>;
  /** Names whose real command has been imported and registered. */
  loaded: Set<string>;
}

// One registry per program, so `primeLazyCommands(program, argv)` can resolve
// the specs a program was registered with without a second argument.
const registries = new WeakMap<Command, LazyRegistry>();

/**
 * Register the given commands declaratively and lazily. Root help and unknown-
 * command handling only ever see the stubs; the module is imported on demand
 * by `primeLazyCommands` when the command is dispatched or its help is
 * requested.
 */
export function registerLazyCommands(program: Command, specs: LazyCommandSpec[]): void {
  const registry: LazyRegistry = {
    specs: new Map(),
    stubs: new Map(),
    loaded: new Set(),
  };
  for (const spec of specs) {
    registry.specs.set(spec.name, spec);
    const stub = program.command(spec.name).description(spec.description);
    // Only reachable when a caller parses without priming first; index.ts (and
    // the test helper) always prime, so this is a programmer error, not a
    // user-facing path.
    stub.action(() => {
      throw new Error(`lazy command '${spec.name}' was dispatched without being primed`);
    });
    registry.stubs.set(spec.name, stub);
  }
  registries.set(program, registry);

  // Root help: append a "Local commands" section so the agent can see
  // at a glance which commands don't need a SAP connection. The default
  // Commands: list above still shows every command; this section is a guide,
  // not a replacement.
  const localNames = specs.filter((s) => s.scope === 'local').map((s) => s.name);
  if (localNames.length > 0) {
    const localList = localNames.map((n) => `  ${n}`).join('\n');
    program.addHelpText('after', [
      '',
      'Local commands (no SAP connection required):',
      '',
      localList,
      '',
      'These commands do not call SAP. All other commands listed above do.',
      '',
    ].join('\n'));
  }
}

/**
 * Import and register the module for the command addressed by `userArgs` —
 * the argv tokens after the node executable and script path — so commander
 * sees the real command when it parses.
 *
 * No-op for root flags, unknown commands, and `help` without a lazy target:
 * those paths never import a command module.
 */
export async function primeLazyCommands(
  program: Command,
  userArgs: readonly string[],
): Promise<void> {
  const registry = registries.get(program);
  if (!registry) return;
  const name = lazyTargetName(program, registry, userArgs);
  if (name === undefined || registry.loaded.has(name)) return;
  await loadAndSwap(program, registry, name);
}

/** First token that names a lazy command; also resolves `help <cmd>`. */
function lazyTargetName(
  program: Command,
  registry: LazyRegistry,
  userArgs: readonly string[],
): string | undefined {
  const [first, second] = positionalTokens(program, userArgs);
  if (first === undefined) return undefined;
  if (first === 'help') {
    return second !== undefined && registry.specs.has(second) ? second : undefined;
  }
  return registry.specs.has(first) ? first : undefined;
}

/**
 * Up to two user positional tokens, skipping options and the values they
 * consume. Root options are declared on `program`, so this stays accurate if
 * the root gains a value-taking option later.
 */
function positionalTokens(program: Command, userArgs: readonly string[]): string[] {
  const tokens: string[] = [];
  for (let i = 0; i < userArgs.length && tokens.length < 2; i += 1) {
    const arg = userArgs[i]!;
    if (arg === '--') {
      // Everything after `--` is positional, even if it starts with a dash.
      tokens.push(...userArgs.slice(i + 1, i + 1 + (2 - tokens.length)));
      break;
    }
    if (arg.length > 1 && arg.startsWith('-')) {
      if (!arg.includes('=') && optionTakesValue(program, arg)) i += 1;
      continue;
    }
    tokens.push(arg);
  }
  return tokens;
}

function optionTakesValue(program: Command, flag: string): boolean {
  const option = program.options.find((o) => o.long === flag || o.short === flag);
  return option?.required === true;
}

/**
 * Replace the stub for `name` with the module's real registration, exactly
 * once and at the stub's original position in the root command list.
 */
async function loadAndSwap(
  program: Command,
  registry: LazyRegistry,
  name: string,
): Promise<void> {
  const spec = registry.specs.get(name)!;
  registry.loaded.add(name);
  try {
    const mod = await spec.load();
    // Drop the stub before register(): register() re-creates the command by
    // name and commander rejects a duplicate command name.
    const index = removeCommand(program, registry.stubs.get(name)!);
    mod.register(program);
    const real = program.commands.find((c) => c.name() === name);
    if (!real) throw new Error(`lazy command '${name}' did not register a command`);
    if (index >= 0) {
      // register() appends; restore the registry order that root help relies on.
      removeCommand(program, real);
      (program.commands as Command[]).splice(index, 0, real);
    }
  } catch (error) {
    // A failed import never removed the stub, so root help still lists the
    // command; clearing the marker lets a later prime attempt retry.
    registry.loaded.delete(name);
    throw error;
  }
}

/** Remove `command` from the root command list; returns its former index. */
function removeCommand(program: Command, command: Command): number {
  const commands = program.commands as Command[];
  const index = commands.indexOf(command);
  if (index >= 0) commands.splice(index, 1);
  return index;
}
